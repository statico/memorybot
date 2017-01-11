#!/usr/bin/env coffee

require('dotenv').config() # Read .env for local dev

Botkit = require 'botkit'
async = require 'artillery-async'
fs = require 'graceful-fs'
winston = require 'winston'
{inspect} = require 'util'

storage = require './lib/storage'
logic = require './lib/logic'

log = winston
log.remove winston.transports.Console
log.add winston.transports.Console, {timestamp: true, level: 'debug'}

if not process.env.SLACK_TOKEN
  throw new Error("Missing SLACK_TOKEN environment variable")

controller = Botkit.slackbot(
  debug: process.env.DEBUG_SLACK
  send_via_rtm: true
)

controller.on 'hello', (bot, msg) ->
  team = bot.team_info.id
  storage.initDatabase team, (err) ->
    if err then return log.error "Couldn't initialize database: #{err}"
    storage.updateBotMetadata bot, (err) ->
      if err then return log.error "Couldn't update bot metadata: #{err}"

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
    text = text.substr(name.length + 1).replace(/^:\s+/, '')
    handleMessage bot, msg.user, msg.channel, true, text
  else
    handleMessage bot, msg.user, msg.channel, false, text
  return

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

log.info "Starting memorybot..."
controller
  .spawn(token: process.env.SLACK_TOKEN)
  .startRTM (err) ->
    if err
      log.error "Startup failed: #{err}"

