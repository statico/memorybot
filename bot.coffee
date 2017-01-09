#!/usr/bin/env coffee

require('dotenv').config()

Botkit = require 'botkit'
SlackStrategy = require('./lib/passport-slack.js')
async = require 'artillery-async'
bodyParser = require 'body-parser'
express = require 'express'
fs = require 'graceful-fs'
log = require 'winston'
passport = require 'passport'
sqlite3 = require('sqlite3').verbose()
{inspect} = require 'util'
{join} = require 'path'

app = express()

# AUTH --------------------------------------------------------------------------

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

# FUNCTIONS ---------------------------------------------------------------------

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
      ], (err) ->
        if err then return cb "Couldn't initialize metadata for team #{team}: #{err}"
        log.info "Set metadata key #{key} for team #{team} with new table"
        return cb null
    else
      db.run "INSERT OR REPLACE INTO metadata VALUES($key, $value)", {$key: key, $value: value}, (err) ->
        if err then return cb "Couldn't update metadata for team #{team}: #{err}"
        log.info "Set metadata key #{key} for team #{team} with existing table"
        return cb null

# BOTS --------------------------------------------------------------------------

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

handleMessage = (bot, channel, isDirect, message) ->
  team = bot.identifyTeam()
  bot.reply {
    channel: channel
  }, {
    text: ":star: channel=#{channel} isDirect=#{isDirect} message=#{message}"
  }

controller.on 'direct_mention', (bot, msg) ->
  return if msg.user is bot.identity?.id
  handleMessage bot, msg.channel, true, msg.text

controller.on 'direct_message', (bot, msg) ->
  return if msg.user is bot.identity?.id
  handleMessage bot, msg.channel, true, msg.text

controller.on 'ambient', (bot, msg) ->
  return if msg.user is bot.identity?.id
  name = bot.identity?.name
  text = msg.text
  if text.toLowerCase().indexOf("#{ name } ") == 0
    text = text.substr(name.length + 1)
    handleMessage bot, msg.channel, true, text
  else
    handleMessage bot, msg.channel, false, text
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
    bot.startRTM()

for file in fs.readdirSync process.env.DATA_DIR
  log.info "Found db file for #{file}"
  startBot(file)

# LOGIC -------------------------------------------------------------------------

