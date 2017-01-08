#!/usr/bin/env coffee

SlackBot = require 'slackbots'
async = require 'artillery-async'
sqlite = require 'sqlite3'
log = require 'winston'
{inspect} = require 'util'

bot = new SlackBot(
  token: 'c4cf1dd27a24ddabb4c807a446bc3f66'
  name: 'Memory Bot'
)

bot.on 'start', ->
  log.info 'started'
  bot.postMessageToChannel('general', 'hello')
  bot.postMessageToChannel('membot', 'testing #membot')

bot.on 'message', (data) ->
  log.info 'message', inspect(data)
