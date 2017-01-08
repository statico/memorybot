#!/usr/bin/env coffee

require('dotenv').config()

SlackStrategy = require('passport-slack').Strategy
async = require 'artillery-async'
bodyParser = require 'body-parser'
express = require 'express'
log = require 'winston'
passport = require 'passport'
sqlite = require 'sqlite3'
{inspect} = require 'util'

app = express()

passport.use new SlackStrategy {
  clientID: process.env.SLACK_CLIENT_ID
  clientSecret: process.env.SLACK_CLIENT_SECRET
}, (accessToken, refreshToken, profile, done) ->
  console.log 'XXX accessToken=', accessToken
  console.log 'XXX refreshToken=', refreshToken
  console.log 'XXX profile=', inspect profile
  done null, profile

app.use passport.initialize()
app.use bodyParser.urlencoded(extended: true)

app.get '/auth/slack', passport.authorize('slack')

app.get '/auth/slack/callback',
  passport.authorize('slack', { failureRedirect: '/login' }),
  (req, res) ->
    log.info 'Got slack callback, redirecting'
    res.redirect '/'

app.listen process.env.PORT, ->
  log.info "Listening on #{process.env.PORT}..."
