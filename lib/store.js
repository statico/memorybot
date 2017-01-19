import async from 'artillery-async';
const sqlite3 = require('sqlite3').verbose();
import winston from 'winston';
import { join } from 'path';

const log = winston;
const debug = process.env.DEBUG ? () => { log.debug(...arguments); } : () => {};

export class SQLiteStore {

  constructor(dataDir) {
    this.dataDir = dataDir;
    if (!this.dataDir) throw new Error('dataDir argument must be set');
  }

  initialize(team, finalCb) {
    let db = this.getDatabase(team);
    if (db == null) return finalCb(`Couldn't get database for team ${team}`);

    db.get("SELECT COUNT(*) FROM metadata", (err, _) => {
      if (err) {
        async.series([
          cb => db.run("CREATE TABLE metadata (key TEXT PRIMARY KEY COLLATE NOCASE, value TEXT)", cb),
          cb => db.run("CREATE TABLE factoids (key TEXT PRIMARY KEY COLLATE NOCASE, value TEXT, last_edit TEXT)", cb),
          cb => db.run("CREATE TABLE karma (key TEXT PRIMARY KEY COLLATE NOCASE, value INTEGER)", cb),
          cb => db.run("INSERT INTO metadata VALUES('direct', 'no')", cb),
          cb => db.run("INSERT INTO metadata VALUES('ambient', 'yes')", cb),
          cb => db.run("INSERT INTO metadata VALUES('verbose', 'no')", cb),
          cb => db.run("INSERT INTO factoids VALUES('Slack', 'is a cool way to talk to your team', 'by nobody')", cb),
          cb => db.run("INSERT INTO factoids VALUES('internet', 'is a great source of cat pictures', 'by nobody')", cb),
          cb => db.run("INSERT INTO factoids VALUES('licks the bot', 'is <action>exudes a foul oil', 'by nobody')", cb),
          cb => db.run("INSERT INTO karma VALUES('memorybot', 42)", cb)
        ], err => {
          if (err) {
            log.error(`Failed to initialize database for team ${team}: ${err}`);
          } else {
            log.info(`Successfully initialized database for team ${team}`);
          }
          finalCb(err);
        });
      } else {
        finalCb(null);
      }
    });
  }

  getDatabase(team) {
    if (!team) throw new Error("team is undefined");
    return new sqlite3.cached.Database(join(this.dataDir, team));
  }

  getMetaData(team, key, cb) {
    debug(`getting metadata ${JSON.stringify(key)}`);
    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    db.get("SELECT value FROM metadata WHERE key = $key", {$key: key}, (err, row) => {
      if (err) return cb(`Couldn't get metadata for team ${team}: ${err}`);
      let {value} = row;
      if (value === 'yes') {
        cb(null, true);
      } else if (value === 'no') {
        cb(null, false);
      } else {
        cb(null, value);
      }
    });
  }

  setMetaData(team, key, value, cb) {
    debug(`setting metadata ${JSON.stringify(key)} to ${JSON.stringify(value)}`);
    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    if (value === true) {
      value = 'yes';
    } else if (value === false) {
      value = 'no';
    }

    db.run("INSERT OR REPLACE INTO metadata VALUES($key, $value)", {$key: key, $value: value}, err => {
      if (err) return cb(`Couldn't update metadata for team ${team}: ${err}`);
      log.info(`Set metadata key ${key} for team ${team} with existing table`);
      cb(null);
    });
  }

  updateBotMetadata(bot, cb) {
    let team = bot.team_info.id;

    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    if (bot.mbMeta == null) bot.mbMeta = {};
    db.all("SELECT key, value FROM metadata", (err, rows) => {
      if (err) return cb(`Couldn't get metadata for team ${team}: ${err}`);
      for (let {key, value} of rows) {
        if (value === 'yes') {
          bot.mbMeta[key] = true;
        } else if (value === 'no') {
          bot.mbMeta[key] = false;
        } else {
          bot.mbMeta[key] = value;
        }
      }

      debug("Bot metadata is:", bot.mbMeta);
      cb(null);
    });
  }

  countFactoids(team, cb) {
    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    db.get("SELECT COUNT(*) AS count FROM factoids", (err, row) => {
      if (err) return cb(`Couldn't get factoid count for team ${team}: ${err}`);
      cb(null, row ? row.count : null);
    });
  }

  getFactoid(team, key, cb) {
    debug(`getting factoid ${JSON.stringify(key)}`);
    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    db.get("SELECT value FROM factoids WHERE key = $key", {$key: key}, (err, row) => {
      if (err) return cb(`Couldn't get factoid for team ${team}: ${err}`);
      if (row) {
        cb(null, row.value);
      } else {
        db.get("SELECT value FROM factoids WHERE key = $key", {$key: `the ${key}`}, (err, row) => {
          if (err) return cb(`Couldn't get factoid for team ${team}: ${err}`);
          cb(null, row ? row.value : null);
        });
      }
    });
  }

  setFactoid(team, key, value, lastEdit, cb) {
    debug(`setting factoid ${JSON.stringify(key)} to ${JSON.stringify(value)}`);
    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    db.run("INSERT OR REPLACE INTO factoids VALUES($key, $value, $lastEdit)", {$key: key, $value: value, $lastEdit: lastEdit}, err => {
      if (err) return cb(`Couldn't update factoid for team ${team}: ${err}`);
      log.info(`Set factoid key ${key} for team ${team}`);
      cb(null);
    });
  }

  deleteFactoid(team, key, cb) {
    debug(`deleting factoid ${JSON.stringify(key)}`);
    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    db.run("DELETE FROM factoids WHERE key = $key", {$key: key}, err => {
      if (err) return cb(`Couldn't delete factoid for team ${team}: ${err}`);
      log.info(`Deleted factoid key ${key} for team ${team}`);
      cb(null);
    });
  }

  getKarma(team, key, cb) {
    debug(`getting karma ${JSON.stringify(key)}`);
    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    db.get("SELECT value FROM karma WHERE key = $key", {$key: key}, (err, row) => {
      if (err) return cb(`Couldn't get karma for team ${team}: ${err}`);
      cb(null, row ? row.value : null);
    });
  }

  setKarma(team, key, value, cb) {
    debug(`setting karma ${JSON.stringify(key)} to ${JSON.stringify(value)}`);
    let db = this.getDatabase(team);
    if (db == null) return cb(`Couldn't get database for team ${team}`);

    db.run("INSERT OR REPLACE INTO karma VALUES($key, $value)", {$key: key, $value: value}, err => {
      if (err) return cb(`Couldn't update karma for team ${team}: ${err}`);
      log.info(`Set factoid key ${key} for team ${team}`);
      cb(null);
    });
  }
}
