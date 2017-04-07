import sqlite from 'sqlite'
import winston from 'winston'
import {join} from 'path'

const log = winston
const debug = process.env.DEBUG ? () => { log.debug(...arguments) } : () => {}

export class SQLiteStore {

  constructor (dataDir) {
    this.dataDir = dataDir
    if (!this.dataDir) throw new Error('dataDir argument must be set')
  }

  async initialize (team) {
    let db = await this.getDatabase(team)

    try {
      await db.get('SELECT COUNT(*) FROM metadata')
    } catch (err) {
      await db.run('CREATE TABLE metadata (key TEXT PRIMARY KEY COLLATE NOCASE, value TEXT)')
      await db.run('CREATE TABLE factoids (key TEXT PRIMARY KEY COLLATE NOCASE, value TEXT, last_edit TEXT)')
      await db.run('CREATE TABLE karma (key TEXT PRIMARY KEY COLLATE NOCASE, value INTEGER)')
      await db.run("INSERT INTO metadata VALUES('direct', 'no')")
      await db.run("INSERT INTO metadata VALUES('ambient', 'yes')")
      await db.run("INSERT INTO metadata VALUES('verbose', 'no')")
      await db.run("INSERT INTO factoids VALUES('Slack', 'is a cool way to talk to your team', 'by nobody')")
      await db.run("INSERT INTO factoids VALUES('the internet', 'is a great source of cat pictures', 'by nobody')")
      await db.run("INSERT INTO factoids VALUES('licks the bot', 'is <action>exudes a foul oil', 'by nobody')")
      await db.run("INSERT INTO karma VALUES('memorybot', 42)")
      log.info(`Successfully initialized database for team ${team}`)
    }
  }

  async getDatabase (team) {
    if (!team) throw new Error('team is undefined')
    return sqlite.open(join(this.dataDir, team), {verbose: true})
  }

  async getMetaData (team, key) {
    debug(`getting metadata ${JSON.stringify(key)}`)
    let db = await this.getDatabase(team)
    let {value} = await db.get('SELECT value FROM metadata WHERE key = $key', {$key: key})
    return (value === 'yes') ? true : (value === 'no') ? false : value
  }

  async setMetaData (team, key, value) {
    debug(`setting metadata ${JSON.stringify(key)} to ${JSON.stringify(value)}`)
    let db = await this.getDatabase(team)

    value = (value === true) ? 'yes' : (value === false) ? 'no' : value

    await db.run('INSERT OR REPLACE INTO metadata VALUES($key, $value)', {$key: key, $value: value})
    log.info(`Set metadata key ${key} for team ${team} with existing table`)
  }

  async updateBotMetadata (bot) {
    let team = bot.team_info.id
    let db = await this.getDatabase(team)

    if (bot.mbMeta == null) bot.mbMeta = {}
    let rows = await db.all('SELECT key, value FROM metadata')
    for (let {key, value} of rows) {
      bot.mbMeta[key] = (value === 'yes') ? true : (value === 'no') ? false : value
    }

    debug('Bot metadata is:', bot.mbMeta)
  }

  async countFactoids (team) {
    let db = await this.getDatabase(team)
    let row = await db.get('SELECT COUNT(*) AS count FROM factoids')
    return row ? row.count : null
  }

  async getFactoid (team, key) {
    debug(`getting factoid ${JSON.stringify(key)}`)
    let db = await this.getDatabase(team)

    let row = await db.get('SELECT value FROM factoids WHERE key = $key', {$key: key})
    if (row) return row.value

    row = await db.get('SELECT value FROM factoids WHERE key = $key', {$key: `the ${key}`})
    return row ? row.value : null
  }

  async setFactoid (team, key, value, lastEdit) {
    debug(`setting factoid ${JSON.stringify(key)} to ${JSON.stringify(value)}`)
    let db = await this.getDatabase(team)

    await db.run('INSERT OR REPLACE INTO factoids VALUES($key, $value, $lastEdit)', {$key: key, $value: value, $lastEdit: lastEdit})
    debug(`Set factoid key ${key} for team ${team}`)
  }

  async deleteFactoid (team, key) {
    debug(`deleting factoid ${JSON.stringify(key)}`)
    let db = await this.getDatabase(team)

    await db.run('DELETE FROM factoids WHERE key = $key', {$key: key})
    debug(`Deleted factoid key ${key} for team ${team}`)
  }

  async getKarma (team, key) {
    debug(`getting karma ${JSON.stringify(key)}`)
    let db = await this.getDatabase(team)

    let row = await db.get('SELECT value FROM karma WHERE key = $key', {$key: key})
    return row ? row.value : null
  }

  async setKarma (team, key, value) {
    debug(`setting karma ${JSON.stringify(key)} to ${JSON.stringify(value)}`)
    let db = await this.getDatabase(team)

    await db.run('INSERT OR REPLACE INTO karma VALUES($key, $value)', {$key: key, $value: value})
    debug(`Set karma for ${key} for team ${team}`)
  }
}
