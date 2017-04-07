require('dotenv').config() // Read .env for local dev

import Botkit from 'botkit'
import winston from 'winston'
import denodeify from 'denodeify'

import {SQLiteStore} from './lib/store'
import {MemoryBotEngine} from './lib/engine'

const log = winston
log.remove(winston.transports.Console)
log.add(winston.transports.Console, {timestamp: true, level: 'debug'})

for (let name of ['SLACK_TOKEN', 'DATA_DIR']) {
  if (!process.env[name]) {
    throw new Error(`Missing ${name} environment variable`)
  }
}

const store = new SQLiteStore(process.env.DATA_DIR)
const engine = new MemoryBotEngine(store)
const controller = Botkit.slackbot({
  debug: process.env.DEBUG_SLACK,
  send_via_rtm: true
})

controller.on('hello', async (bot, _) => {
  let team = bot.team_info.id
  await store.initialize(team)
  await store.updateBotMetadata(bot)
})

controller.on('direct_mention', async (bot, msg) => {
  handleMessage(bot, msg.user, msg.channel, true, msg.text)
})

controller.on('direct_message', async (bot, msg) => {
  handleMessage(bot, msg.user, msg.channel, true, msg.text)
})

controller.on('me_message', async (bot, msg) => {
  handleMessage(bot, msg.user, msg.channel, false, msg.text)
})

controller.on('ambient', async (bot, msg) => {
  let name = bot.identity ? bot.identity.name.toLowerCase() : null
  let {text} = msg
  // Sometimes users might say "membot hey" or "membot: hey" instead of "@membot hey"
  if (text.toLowerCase().startsWith(`${name} `) || text.toLowerCase().startsWith(`${name}: `)) {
    text = text.substr(name.length + 1).replace(/^:\s+/, '')
    handleMessage(bot, msg.user, msg.channel, true, text)
  } else {
    handleMessage(bot, msg.user, msg.channel, false, text)
  }
})

// Cache Slack user IDs to names in memory.
let userIdsToNames = {}

async function handleMessage (bot, sender, channel, isDirect, msg) {
  if (sender === bot.identity.id) return
  try {
    if (sender in userIdsToNames) {
      await engine.handleMessage(bot, userIdsToNames[sender], channel, isDirect, msg)
    } else {
      let data = await denodeify(bot.api.users.info.bind(bot.api.users))({user: sender})
      let name = data ? data.user.name : sender
      userIdsToNames[sender] = name
      await engine.handleMessage(bot, name, channel, isDirect, msg)
    }
  } catch (err) {
    log.error(`handleMessage failed: ${err}`)
  }
}

log.info('Starting memorybot...')
const bot = controller.spawn({token: process.env.SLACK_TOKEN})
function startRTM () {
  bot.startRTM((err) => {
    if (err) {
      log.error(`Failed to start Slack RTM: ${err}`)
      setTimeout(startRTM, 30 * 1000)
    } else {
      log.info(`Successfully started Slack RTM`)
    }
  })
}
controller.on('rtm_close', startRTM)
startRTM()
