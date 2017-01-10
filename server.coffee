#!/usr/bin/env coffee

require('dotenv').config() # Read .env for local dev

Botkit = require 'botkit'
SlackStrategy = require('passport-slack').Strategy
async = require 'artillery-async'
bodyParser = require 'body-parser'
express = require 'express'
fs = require 'graceful-fs'
winston = require 'winston'
passport = require 'passport'
{inspect} = require 'util'

storage = require './lib/storage'
logic = require './lib/logic'

app = express()

log = winston
log.remove winston.transports.Console
log.add winston.transports.Console, {timestamp: true}

passport.use new SlackStrategy {
  clientID: process.env.SLACK_CLIENT_ID
  clientSecret: process.env.SLACK_CLIENT_SECRET
  scope: ['bot']
  skipUserProfile: true
}, (accessToken, refreshToken, params, profile, done) ->
  if not params?.ok
    return done params?.error or "Failed to get any data from OAuth"

  # Save some information about the team for future use along with the auth token.
  team = params.team_id
  async.series [
    (cb) -> setMetaData team, 'teamName', params.team_name, cb
    (cb) -> setMetaData team, 'teamId', params.team_id, cb
    (cb) -> setMetaData team, 'adminUserId', params.user_id, cb
    (cb) -> setMetaData team, 'botUserId', params.bot.bot_user_id, cb
    (cb) -> setMetaData team, 'token', params.bot.bot_access_token, cb
  ], (err) ->
    # If OAauth worked successfully, start the bot for the team immediately.
    if not err
      startBot team
    done err, params

app.use passport.initialize()
app.use bodyParser.urlencoded(extended: true)

app.get '/', (req, res) -> res.send 'ok'

app.get '/auth/slack', passport.authorize('slack')

app.get '/auth/slack/callback',
  passport.authorize('slack'),
  (req, res) ->
    log.info 'Got slack callback, redirecting'
    res.redirect '/'

app.listen process.env.PORT, ->
  log.info "Listening on #{process.env.PORT}..."

# A map of Slack team ID -> running Botkit Bot instance
bots = {}

controller = Botkit.slackbot(
  clientID: process.env.SLACK_CLIENT_ID
  clientSecret: process.env.SLACK_CLIENT_SECRET
  scopes: ['bot']
  debug: process.env.DEBUG
  send_via_rtm: true
)

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
    # Sometimes users might say "membot" instead of "@membot"
    text = text.substr(name.length + 1)
    handleMessage bot, msg.user, msg.channel, true, text
  else
    handleMessage bot, msg.user, msg.channel, false, text
  return

startBot = (team) ->
  log.info "Starting bot for team #{team}..."

  if team of bots
    return log.warning "Bot for #{team} already started. Returning."

  storage.getMetaData team, 'token', (err, token) ->
    if err
      return log.error "Couldn't get token for #{team}: #{err}"

    bot = bots[team] = controller.spawn(token: token)
    storage.updateBotMetadata bot, team, (err) ->
      if err
        return log.error "Couldn't update bot metadata: #{err}"
      bot.startRTM()

# Cache Slack user IDs to names in memory.
userIdsToNames = {}

handleMessage = (bot, sender, channel, isDirect, msg) ->
  if sender of userIdsToNames
    logic.handleMessage bot, userIdsToNames[sender], channel, isDirect, msg
  else
    bot.api.users.info {user: sender}, (err, data) ->
      if err
        log.error "Could not call users.info for user #{sender}: #{err}"
      else
        name = data?.user?.name or sender
        userIdsToNames[sender] = name
      logic.handleMessage bot, name, channel, isDirect, msg

for file in fs.readdirSync process.env.DATA_DIR
  log.info "Found db file for #{file}"
  startBot(file)

