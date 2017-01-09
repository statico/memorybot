#!/usr/bin/env coffee

# INIT ---------------------------------------------------------------------#{{{1

require('dotenv').config()

Botkit = require 'botkit'
SlackStrategy = require('./lib/passport-slack.js')
async = require 'artillery-async'
bodyParser = require 'body-parser'
express = require 'express'
fs = require 'graceful-fs'
winston = require 'winston'
passport = require 'passport'
sqlite3 = require('sqlite3').verbose()
{inspect} = require 'util'
{join} = require 'path'

app = express()

log = winston
log.remove(winston.transports.Console);
log.add(winston.transports.Console, {'timestamp':true});

# AUTH ---------------------------------------------------------------------#{{{1

passport.use new SlackStrategy {
  clientID: process.env.SLACK_CLIENT_ID
  clientSecret: process.env.SLACK_CLIENT_SECRET
  scope: ['bot']
  skipUserProfile: true
}, (accessToken, refreshToken, params, profile, done) ->
  if not params?.ok
    return done params?.error or "Failed to get any data from oauth"
  team = params.team_id
  async.series [
    (cb) -> setMetaData team, 'teamName', params.team_name, cb
    (cb) -> setMetaData team, 'teamId', params.team_id, cb
    (cb) -> setMetaData team, 'adminUserId', params.user_id, cb
    (cb) -> setMetaData team, 'botUserId', params.bot.bot_user_id, cb
    (cb) -> setMetaData team, 'token', params.bot.bot_access_token, cb
  ], (err) ->
    if not err
      startBot team
    done err, params

app.use passport.initialize()
app.use bodyParser.urlencoded(extended: true)

app.get '/', (req, res) ->
  res.send 'ok'

app.get '/auth/slack', passport.authorize('slack')

app.get '/auth/slack/callback',
  passport.authorize('slack'), # , { failureRedirect: '/' }),
  (req, res) ->
    log.info 'Got slack callback, redirecting'
    res.redirect '/'

app.listen process.env.PORT, ->
  log.info "Listening on #{process.env.PORT}..."

# FUNCTIONS ----------------------------------------------------------------#{{{1

getDatabase = (team) ->
  if not process.env.DATA_DIR? then throw new Error('DATA_DIR missing')
  return new sqlite3.cached.Database(join(process.env.DATA_DIR, team))

getMetaData = (team, key, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT value FROM metadata WHERE key = $key", {$key: key}, (err, row) ->
    if err then return cb "Couldn't get metadata for team #{team}: #{err}"
    return cb null, row.value

setMetaData = (team, key, value, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT COUNT(*) FROM metadata", (err, row) ->
    if err
      async.series [
        (cb) -> db.run "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)", cb
        (cb) -> db.run "CREATE TABLE factoids (key TEXT PRIMARY KEY, value TEXT, last_edit TEXT)", cb
        (cb) -> db.run "INSERT INTO metadata VALUES($key, $value)", {$key: key, $value: value}, cb
        (cb) -> db.run "INSERT INTO metadata VALUES('direct', 'no')", cb
        (cb) -> db.run "INSERT INTO metadata VALUES('ambient', 'yes')", cb
        (cb) -> db.run "INSERT INTO metadata VALUES('verbose', 'no')", cb
        (cb) -> db.run "INSERT INTO metadata VALUES('plan', 'free')", cb
      ], (err) ->
        if err then return cb "Couldn't initialize metadata for team #{team}: #{err}"
        log.info "Set metadata key #{key} for team #{team} with new table"
        return cb null
    else
      db.run "INSERT OR REPLACE INTO metadata VALUES($key, $value)", {$key: key, $value: value}, (err) ->
        if err then return cb "Couldn't update metadata for team #{team}: #{err}"
        log.info "Set metadata key #{key} for team #{team} with existing table"
        return cb null

updateBotMetadata = (bot, team, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  bot.mbMeta ?= {}
  db.all "SELECT key, value FROM metadata", (err, rows) ->
    if err then return cb "Couldn't get metadata for team #{team}: #{err}"
    for {key, value} in rows
      if key is 'yes'
        bot.mbMeta[key] = true
      if key is 'no'
        bot.mbMeta[key] = false
      else
        bot.mbMeta[key] = value
    return cb null

getFactoid = (team, key, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT value FROM factoids WHERE key = $key", {$key: key}, (err, row) ->
    if err then return cb "Couldn't get factoid for team #{team}: #{err}"
    return cb null, row?.value or null

setFactoid = (team, key, value, lastEdit, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.run "INSERT OR REPLACE INTO factoids VALUES($key, $value, $lastEdit)", {$key: key, $value: value, $lastEdit: lastEdit}, (err) ->
    if err then return cb "Couldn't update factoid for team #{team}: #{err}"
    log.info "Set factoid key #{key} for team #{team}"
    return cb null


# BOTS ---------------------------------------------------------------------#{{{1

bots = {}

controller = Botkit.slackbot(
  clientID: process.env.SLACK_CLIENT_ID
  clientSecret: process.env.SLACK_CLIENT_SECRET
  scopes: ['bot']
  debug: process.env.DEBUG
  send_via_rtm: true
)

#handler = (event) ->
  #return (bot, msg) ->
    #return if msg.type in ['user_typing', 'desktop_notification']
    #return if msg.user is bot.identity?.id
    #console.log new Array(80).join('-')
    #console.log "TEAM: #{bot.identifyTeam()} - TYPE: #{event} - DATA:"
    #console.log inspect msg
    #bot.reply msg, text: "#{event} ```#{inspect msg}```", (err) ->
      #log.error "Failed to reply: #{err}"
#for i in ['message_received', 'mention', 'direct_message', 'direct_mention', 'ambient']
  #controller.on i, handler(i)

controller.on 'direct_mention', (bot, msg) ->
  return if msg.user is bot.identity?.id
  handleMessage bot, msg.user, msg.channel, true, msg.text

controller.on 'direct_message', (bot, msg) ->
  return if msg.user is bot.identity?.id
  handleMessage bot, msg.user, msg.channel, true, msg.text

controller.on 'ambient', (bot, msg) ->
  return if msg.user is bot.identity?.id
  name = bot.identity?.name
  text = msg.text
  if text.toLowerCase().indexOf("#{ name } ") == 0
    text = text.substr(name.length + 1)
    handleMessage bot, msg.user, msg.channel, true, text
  else
    handleMessage bot, msg.user, msg.channel, false, text
  return

startBot = (team) ->
  log.info "Starting bot for team #{team}..."

  if team of bots
    log.warning "Bot for #{team} already started. Returning."
    return

  getMetaData team, 'token', (err, token) ->
    if err
      log.error "Couldn't get token for #{team}: #{err}"
      return

    bot = bots[team] = controller.spawn(token: token)
    updateBotMetadata bot, team, (err) ->
      if err
        log.error "Couldn't update bot metadata: #{err}"
        return
      bot.startRTM()

for file in fs.readdirSync process.env.DATA_DIR
  log.info "Found db file for #{file}"
  startBot(file)

# LOGIC --------------------------------------------------------------------#{{{1

handleMessage = (bot, from, channel, isDirect, msg) ->
  team = bot.identifyTeam()
  {mbMeta} = bot
  msg = msg.trim().replace(/\0/g, '').replace(/\n/g, ' ')
  reply = (text) -> bot.reply {channel: channel}, {text: text}
  update = (key, value) ->
    lastEdit = "on #{new Date()} by #{from}"
    setFactoid team, key, value, lastEdit, (err) ->
      if err
        log.error err
        if mbMeta.verbose then reply "There was an error updating that factoid. Please try again."
      else
        if mbMeta.verbose then reply "OK, #{key} is now #{value}"
      return
    return

  # Updating factoids {{{2
  if (/\s+is\s+/i).test(msg) and (isDirect or mbMeta.ambient)
    [key, value] = msg.split /\s+is\s+/i
    key = key.toLowerCase()

    isCorrecting = (/no,?\s+/i).test(key)
    key = key.replace(/no,?\s+/i, '') if isCorrecting

    isAppending = (/also,?\s+/i).test(key)
    key = key.replace(/also,?\s+/i, '') if isAppending

    isAppending or= (/also,?\s+/i).test(value)
    value = value.replace(/also,?\s+/i, '') if isAppending

    getFactoid team, key, (err, current) ->
      if err then return log.error(err)

      if current and isCorrecting
        update key, value

      else if current and isAppending
        value = "#{current} or #{value}"
        update key, value

      else if current == value
        reply "I already know that."

      else if current
        reply "But #{key} is already #{current}"

      else
        update key, value

  return
