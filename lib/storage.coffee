#!/usr/bin/env coffee

async = require 'artillery-async'
sqlite3 = require('sqlite3').verbose()
winston = require 'winston'
{join} = require 'path'

log = winston
debug = if process.env.DEBUG then (-> log.debug arguments...) else (->)

initDatabase = (team, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT COUNT(*) FROM metadata", (err, row) ->
    if err
      async.series [
        (cb) -> db.run "CREATE TABLE metadata (key TEXT PRIMARY KEY COLLATE NOCASE, value TEXT)", cb
        (cb) -> db.run "CREATE TABLE factoids (key TEXT PRIMARY KEY COLLATE NOCASE, value TEXT, last_edit TEXT)", cb
        (cb) -> db.run "CREATE TABLE karma (key TEXT PRIMARY KEY COLLATE NOCASE, value INTEGER)", cb
        (cb) -> db.run "INSERT INTO metadata VALUES('direct', 'no')", cb
        (cb) -> db.run "INSERT INTO metadata VALUES('ambient', 'yes')", cb
        (cb) -> db.run "INSERT INTO metadata VALUES('verbose', 'no')", cb
        (cb) -> db.run "INSERT INTO factoids VALUES('Slack', 'is a cool way to talk to your team', 'by nobody')", cb
        (cb) -> db.run "INSERT INTO factoids VALUES('internet', 'is a great source of cat pictures', 'by nobody')", cb
        (cb) -> db.run "INSERT INTO factoids VALUES('licks the bot', 'is <action>exudes a foul oil', 'by nobody')", cb
        (cb) -> db.run "INSERT INTO karma VALUES('memorybot', 42)", cb
      ], (err) ->
        if err
          log.error "Failed to initialize database for team #{team}: #{err}"
        else
          log.info "Successfully initialized database for team #{team}"
        cb err
    else
      cb null

getDatabase = (team) ->
  if not team then throw new Error("team is undefined")
  if not process.env.DATA_DIR? then throw new Error('DATA_DIR environment variable must be set')
  return new sqlite3.cached.Database(join(process.env.DATA_DIR, team))

getMetaData = (team, key, cb) ->
  debug "getting metadata #{JSON.stringify key}"
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT value FROM metadata WHERE key = $key", {$key: key}, (err, row) ->
    if err then return cb "Couldn't get metadata for team #{team}: #{err}"
    {value} = row
    if value is 'yes'
      cb null, true
    else if value is 'no'
      cb null, false
    else
      cb null, value

setMetaData = (team, key, value, cb) ->
  debug "setting metadata #{JSON.stringify key} to #{JSON.stringify value}"
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  if value is true
    value = 'yes'
  else if value is false
    value = 'no'

  db.run "INSERT OR REPLACE INTO metadata VALUES($key, $value)", {$key: key, $value: value}, (err) ->
    if err then return cb "Couldn't update metadata for team #{team}: #{err}"
    log.info "Set metadata key #{key} for team #{team} with existing table"
    return cb null

updateBotMetadata = (bot, cb) ->
  team = bot.team_info.id

  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  bot.mbMeta ?= {}
  db.all "SELECT key, value FROM metadata", (err, rows) ->
    if err then return cb "Couldn't get metadata for team #{team}: #{err}"
    for {key, value} in rows
      if value is 'yes'
        bot.mbMeta[key] = true
      else if value is 'no'
        bot.mbMeta[key] = false
      else
        bot.mbMeta[key] = value

    debug "Bot metadata is:", bot.mbMeta
    return cb null

countFactoids = (team, cb) ->
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT COUNT(*) AS count FROM factoids", (err, row) ->
    if err then return cb "Couldn't get factoid count for team #{team}: #{err}"
    return cb null, Number(row?.count) or null

getFactoid = (team, key, cb) ->
  debug "getting factoid #{JSON.stringify key}"
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT value FROM factoids WHERE key = $key", {$key: key}, (err, row) ->
    if err then return cb "Couldn't get factoid for team #{team}: #{err}"
    return cb null, row?.value or null

setFactoid = (team, key, value, lastEdit, cb) ->
  debug "setting factoid #{JSON.stringify key} to #{JSON.stringify value}"
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.run "INSERT OR REPLACE INTO factoids VALUES($key, $value, $lastEdit)", {$key: key, $value: value, $lastEdit: lastEdit}, (err) ->
    if err then return cb "Couldn't update factoid for team #{team}: #{err}"
    log.info "Set factoid key #{key} for team #{team}"
    return cb null

deleteFactoid = (team, key, cb) ->
  debug "deleting factoid #{JSON.stringify key}"
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.run "DELETE FROM factoids WHERE key = $key", {$key: key}, (err) ->
    if err then return cb "Couldn't delete factoid for team #{team}: #{err}"
    log.info "Deleted factoid key #{key} for team #{team}"
    return cb null

getKarma = (team, key, cb) ->
  debug "getting karma #{JSON.stringify key}"
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.get "SELECT value FROM karma WHERE key = $key", {$key: key}, (err, row) ->
    if err then return cb "Couldn't get karma for team #{team}: #{err}"
    return cb null, row?.value or null

setKarma = (team, key, value, cb) ->
  debug "setting karma #{JSON.stringify key} to #{JSON.stringify value}"
  db = getDatabase team
  if not db? then return cb "Couldn't get database for team #{team}"

  db.run "INSERT OR REPLACE INTO karma VALUES($key, $value)", {$key: key, $value: value}, (err) ->
    if err then return cb "Couldn't update karma for team #{team}: #{err}"
    log.info "Set factoid key #{key} for team #{team}"
    return cb null

exports.initDatabase = initDatabase
exports.getMetaData = getMetaData
exports.setMetaData = setMetaData
exports.updateBotMetadata = updateBotMetadata
exports.countFactoids = countFactoids
exports.getFactoid = getFactoid
exports.setFactoid = setFactoid
exports.deleteFactoid = deleteFactoid
exports.getKarma = getKarma
exports.setKarma = setKarma
