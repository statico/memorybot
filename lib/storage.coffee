#!/usr/bin/env coffee

async = require 'artillery-async'
sqlite3 = require('sqlite3').verbose()
winston = require 'winston'
{join} = require 'path'

log = winston

initDatabase = (team, cb) ->
  async.series [
    (cb) -> db.run "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT)", cb
    (cb) -> db.run "CREATE TABLE factoids (key TEXT PRIMARY KEY, value TEXT, last_edit TEXT)", cb
    (cb) -> db.run "CREATE TABLE karma (key TEXT PRIMARY KEY, value INTEGER)", cb
    (cb) -> db.run "INSERT INTO metadata VALUES('direct', 'no')", cb
    (cb) -> db.run "INSERT INTO metadata VALUES('ambient', 'yes')", cb
    (cb) -> db.run "INSERT INTO metadata VALUES('verbose', 'no')", cb
  ], cb

getDatabase = (team) ->
  if not process.env.DATA_DIR? then throw new Error('DATA_DIR environment variable must be set')
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
        (cb) -> initDatabase cb
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

updateBotMetadata = (bot, team, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  bot.mbMeta ?= {}
  db.all "SELECT key, value FROM metadata", (err, rows) ->
    if err then return cb "Couldn't get metadata for team #{team}: #{err}"
    for {key, value} in rows
      if value is 'yes'
        bot.mbMeta[key] = true
      if value is 'no'
        bot.mbMeta[key] = false
      else
        bot.mbMeta[key] = value

    return cb null

countFactoids = (team, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT COUNT(*) AS count FROM factoids", (err, row) ->
    if err then return cb "Couldn't get factoid count for team #{team}: #{err}"
    return cb null, Number(row?.count) or null

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

getKarma = (team, key, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT value FROM karma WHERE key = $key", {$key: key}, (err, row) ->
    if err then return cb "Couldn't get karma for team #{team}: #{err}"
    return cb null, row?.value or null

setKarma = (team, key, value, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.run "INSERT OR REPLACE INTO karma VALUES($key, $value)", {$key: key, $value: value}, (err) ->
    if err then return cb "Couldn't update karma for team #{team}: #{err}"
    log.info "Set factoid key #{key} for team #{team}"
    return cb null

exports.getMetaData = getMetaData
exports.setMetaData = setMetaData
exports.updateBotMetadata = updateBotMetadata
exports.countFactoids = countFactoids
exports.getFactoid = getFactoid
exports.setFactoid = setFactoid
exports.getKarma = getKarma
exports.setKarma = setKarma
