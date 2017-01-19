require('dotenv').config(); // Read .env for local dev

import Botkit from 'botkit';
import winston from 'winston';

import {SQLiteStore as Store} from './lib/store';
import {MemoryBotEngine as Engine} from './lib/engine';

const log = winston;
log.remove(winston.transports.Console);
log.add(winston.transports.Console, {timestamp: true, level: 'debug'});

for (let name of ['SLACK_TOKEN', 'DATA_DIR']) {
  if (!process.env[name]) {
    throw new Error(`Missing ${name} environment variable`);
  }
}

const store = new Store(process.env.DATA_DIR);
const engine = new Engine(store);

const controller = Botkit.slackbot({
  debug: process.env.DEBUG_SLACK,
  send_via_rtm: true
});

controller.on('hello', (bot, _) => {
  let team = bot.team_info.id;
  store.initialize(team, err => {
    if (err) return log.error(`Couldn't initialize database: ${err}`);
    store.updateBotMetadata(bot, err => {
      if (err) return log.error(`Couldn't update bot metadata: ${err}`);
    });
  });
});

controller.on('direct_mention', (bot, msg) => {
  if (msg.user === bot.identity ? bot.identity.id : null) return;
  return handleMessage(bot, msg.user, msg.channel, true, msg.text);
});

controller.on('direct_message', (bot, msg) => {
  if (msg.user === bot.identity ? bot.identity.id : null) return;
  return handleMessage(bot, msg.user, msg.channel, true, msg.text);
});

controller.on('me_message', (bot, msg) => {
  handleMessage(bot, msg.user, msg.channel, false, msg.text);
});

controller.on('ambient', (bot, msg) => {
  if (msg.user === bot.identity ? bot.identity.id : null) return;
  let name = bot.identity ? bot.identity.name.toLowerCase() : null;
  let {text} = msg;
  if (text.toLowerCase().startsWith(`${name} `) || text.toLowerCase().startsWith(`${name}: `)) {
    // Sometimes users might say "membot" instead of "@membot"
    text = text.substr(name.length + 1).replace(/^:\s+/, '');
    handleMessage(bot, msg.user, msg.channel, true, text);
  } else {
    handleMessage(bot, msg.user, msg.channel, false, text);
  }
});

// Cache Slack user IDs to names in memory.
let userIdsToNames = {};

var handleMessage = (bot, sender, channel, isDirect, msg) => {
  if (sender in userIdsToNames) {
    engine.handleMessage(bot, userIdsToNames[sender], channel, isDirect, msg, err => {
      if (err) return log.error(`handleMessage failed: ${err}`);
    });
  } else {
    bot.api.users.info({user: sender}, (err, data) => {
      if (err) {
        log.error(`Could not call users.info for user ${sender}: ${err}`);
      } else {
        let name = data ? data.user.name : sender;
        userIdsToNames[sender] = name;
        engine.handleMessage(bot, name, channel, isDirect, msg, err => {
          if (err) return log.error(`handleMessage failed: ${err}`);
        });
      }
    });
  }
};

log.info("Starting memorybot...");
controller
  .spawn({token: process.env.SLACK_TOKEN})
  .startRTM(err => {
    if (err) log.error(`Startup failed: ${err}`);
  });
