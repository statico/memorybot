#!/usr/bin/env coffee

require('dotenv').config() # Read .env for local dev

Botkit = require 'botkit'
async = require 'artillery-async'
fs = require 'graceful-fs'
winston = require 'winston'
{inspect} = require 'util'

Store = require('./lib/store').SQLiteStore
Engine = require('./lib/engine').MemoryBotEngine

log = winston
log.remove winston.transports.Console
log.add winston.transports.Console, {timestamp: true, level: 'debug'}

for name in ['SLACK_TOKEN', 'DATA_DIR']
  if not process.env[name]
    throw new Error("Missing #{name} environment variable")

store = new Store(process.env.DATA_DIR)
engine = new Engine(store)

controller = Botkit.slackbot(
  debug: process.env.DEBUG_SLACK
  send_via_rtm: true
)

controller.on 'hello', (bot, msg) ->
  team = bot.team_info.id
  store.initialize team, (err) ->
    if err then return log.error "Couldn't initialize database: #{err}"
    store.updateBotMetadata bot, (err) ->
      if err then return log.error "Couldn't update bot metadata: #{err}"

controller.on 'direct_mention', (bot, msg) ->
  return if msg.user is bot.identity?.id
  handleMessage bot, msg.user, msg.channel, true, msg.text

controller.on 'direct_message', (bot, msg) ->
  return if msg.user is bot.identity?.id
  handleMessage bot, msg.user, msg.channel, true, msg.text

controller.on 'me_message', (bot, msg) ->
  handleMessage bot, msg.user, msg.channel, false, msg.text

controller.on 'ambient', (bot, msg) ->
  return if msg.user is bot.identity?.id
  name = bot.identity?.name.toLowerCase()
  text = msg.text
  if text.toLowerCase().indexOf("#{name} ") == 0 or text.toLowerCase().indexOf("#{name}: ") == 0
    # Sometimes users might say "membot" instead of "@membot"
    text = text.substr(name.length + 1).replace(/^:\s+/, '')
    handleMessage bot, msg.user, msg.channel, true, text
  else
    handleMessage bot, msg.user, msg.channel, false, text
  return

# Cache Slack user IDs to names in memory.
userIdsToNames = {}

handleMessage = (bot, sender, channel, isDirect, msg) ->
  if sender of userIdsToNames
    engine.handleMessage bot, userIdsToNames[sender], channel, isDirect, msg
  else
    bot.api.users.info {user: sender}, (err, data) ->
      if err
        log.error "Could not call users.info for user #{sender}: #{err}"
      else
        name = data?.user?.name or sender
        userIdsToNames[sender] = name
      engine.handleMessage bot, name, channel, isDirect, msg

log.info "Starting memorybot..."
controller
  .spawn(token: process.env.SLACK_TOKEN)
  .startRTM (err) ->
    if err
      log.error "Startup failed: #{err}"

