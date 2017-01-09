#!/usr/bin/env coffee

require('dotenv').config()

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
    (cb) -> setMetaData team, 'teamName', params.team, cb
    (cb) -> setMetaData team, 'teamId', params.team_id, cb
    (cb) -> setMetaData team, 'adminUserId', params.user_id, cb
    (cb) -> setMetaData team, 'botUserId', params.bot.bot_user_id, cb
    (cb) -> setMetaData team, 'token', params.bot.bot_access_token, cb
  ], (err) ->
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

bots = {}

startBot = (team) ->
  bots[team] ?= {}

for file in fs.readdirSync process.env.DATA_DIR
  log.info "Found db file for #{file}"
  startBot(file)

getDatabase = (team) ->
  if not process.env.DATA_DIR? then throw new Error('DATA_DIR missing')
  return new sqlite3.cached.Database(join(process.env.DATA_DIR, team))

getMetaData = (team, key, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT value FROM metadata WHERE key = $key", {$key: key}, (err, row) ->
    if err then return cb "Couldn't get metadata for team #{team}: #{err}"
    return cb null, row[0]

setMetaData = (team, key, value, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT COUNT(*) FROM metadata", (err, row) ->
    if err
      db.run "CREATE TABLE metadata (key TEXT, value TEXT)", (err) ->
        if err then return cb "Couldn't create metadata table for team #{team}"
        db.run "INSERT INTO metadata VALUES($key, $value)", {$key: key, $value: value}, (err) ->
          if err then return cb "Couldn't insert metadata #{key} into table for team #{team}: #{err}"
          log.info "Set metadata key #{key} for team #{team} with new table"
          return cb null
    else
      db.run "UPDATE metadata SET value = $value WHERE key = $key", {$key: key, $value: value}, (err) ->
        if err then return cb "Couldn't update metadata for team #{team}: #{err}"
        log.info "Set metadata key #{key} for team #{team} with existing table"
        return cb null
