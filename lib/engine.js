import winston from 'winston';
import {AllHtmlEntities as Entities} from 'html-entities';
import {series} from 'artillery-async';

const log = winston;

import {version as VERSION} from '../package.json';

const MAX_FACTOID_SIZE = Number(process.env.MAX_FACTOID_SIZE || 2048);

const I_DONT_KNOW = [
  "I don't know what that is.",
  "I have no idea.",
  "No idea.",
  "I don't know."
];

const OKAY = [
  "OK, got it.",
  "I got it.",
  "Understood.",
  "Gotcha.",
  "OK"
];

const GREETINGS = [
  "Heya, $who!",
  "Hi $who!",
  "Hello, $who",
  "Hello, $who!",
  "Greetings, $who"
];

const ACKNOWLEDGEMENTS = [
  "Yes?",
  "Yep?",
  "Yeah?"
];

const IGNORED_FACTOIDS = [
  "he",
  "hers",
  "his",
  "it",
  "it's",
  "its",
  "she",
  "that",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "what",
  "when",
  "where",
  "who",
  "why"
];

export class MemoryBotEngine {

  constructor(store) {
    this.store = store;
    this.userIdsToNames = {};
  }

  random() { return Math.random(); }

  oneOf() {
    let arr;
    if (Array.isArray(arguments[0])) {
      arr = arguments[0];
    } else {
      arr = arguments;
    }
    return arr[Math.floor(this.random() * arr.length)];
  }

  handleMessage(bot, sender, channel, isDirect, msg, done) {
    const team = bot.identifyTeam();

    // Avoid context object (`this`) hell and fat arrows everywhere.
    const oneOf = this.oneOf.bind(this);
    const {store, userIdsToNames} = this;

    const {mbMeta} = bot;
    const shouldLearn = isDirect || mbMeta.ambient;
    const shouldReply = isDirect || !mbMeta.direct;
    const isVerbose = mbMeta.verbose;

    msg = Entities.decode(msg);
    msg = msg.substr(0, MAX_FACTOID_SIZE).trim().replace(/\0/g, '').replace(/\n/g, ' ');

    const reply = text => bot.reply({channel}, {text});

    const parseAndReply = (key, value, tell) => {
      if (tell == null) { tell = null; }
      let [_, verb, rest] = Array.from(value.match(/^(is|are)\s+(.*)/i));
      value = rest;

      value = value.replace(/\\\|/g, '\\&#124;');
      value = oneOf(value.split(/\|/i)).trim();
      value = value.replace(/&#124;/g, '|');

      const isReply = (/^<reply>\s*/i).test(value);
      if (isReply) value = value.replace(/^<reply>\s*/i, '');

      const isEmote = (/^<action>\s*/i).test(value);
      if (isEmote) value = value.replace(/^<action>\s*/i, '');

      value = value.replace(/\$who/ig, sender);

      if (tell) {
        bot.reply({channel: tell}, {text: `${sender} wants you to know: ${key} is ${value}`});
        done();
      } else if (isReply) {
        reply(value);
        done();
      } else if (isEmote) {
        bot.api.callAPI('chat.meMessage', {channel, text: value}, (err, _) => {
          if (err) log.error(err);
          done(err);
        });
      } else {
        reply(`${key} ${verb} ${value}`);
        done();
      }
    };

    const update = (key, value) => {
      const lastEdit = `on ${new Date()} by ${sender}`;
      store.setFactoid(team, key, value, lastEdit, err => {
        if (err) {
          log.error(err);
          if (isVerbose) reply("There was an error updating that factoid. Please try again.");
        } else {
          if (isVerbose || isDirect) reply(oneOf(OKAY));
        }
        done(err);
      });
    };

    // Status
    if (isDirect && (msg === 'status')) {
      const bool = x => x ? ':ballot_box_with_check:' : ':white_medium_square:';
      store.countFactoids(team, (err, count) => {
        if (err) log.error(err);
        reply(`\
*Status*
I am memorybot v${VERSION} - https://statico.github.com/memorybot/
I am currently remembering ${count} factoids.
*Settings*
${bool(mbMeta.direct)} \`direct\` - Interactons require direct messages or @-mentions
${bool(mbMeta.ambient)} \`ambient\` - Learn factoids from ambient room chatter
${bool(mbMeta.verbose)} \`verbose\` - Make the bot more chatty with confirmations, greetings, etc.
Tell me "enable setting <name>" or "disable setting <name>" to change the above settings.\
`
        );
        done(err);
      });
      return;

    // Settings
    } else if (isDirect && (/^(enable|disable)\s+setting\s+/i).test(msg)) {
      let result;
      let [action, key] = Array.from(msg.split(/\s+setting\s+/i));
      let value = action === 'enable';
      switch (key) {
        case 'direct':
          result = `interactions with me ${value ? 'now' : 'no longer'} require direct messages or @-mentions`;
          break;
        case 'ambient':
          result = `I ${value ? 'will now' : 'will no longer'} learn factoids without being told explicitly`;
          break;
        case 'verbose':
          result = `I ${value ? 'will now' : 'will no longer'} be extra chatty`;
          break;
      }
      series([
        cb => store.setMetaData(team, key, value, cb),
        cb => store.updateBotMetadata(bot, cb)
      ], err => {
        if (err) {
          log.error(err);
          reply("There was an error updating that setting. Please try again.");
        } else {
          reply(`OK, ${result}.`);
        }
        done(err);
      });
      return;

    // A greeting?
    } else if ((/^(hey|hi|hello|waves)$/i).test(msg)) {
      if (shouldReply || isVerbose) {
        reply(oneOf(GREETINGS).replace(/\$who/ig, sender));
      }
      done();
      return;

    // Addressing the bot?
    } else if (bot.identity && msg.toLowerCase() === `${bot.identity.name.toLowerCase()}?`) {
      reply(oneOf(ACKNOWLEDGEMENTS));
      done();
      return;

    // Getting literal factoids
    } else if (shouldReply && (/^literal\s+/i).test(msg)) {
      let key = msg.replace(/^literal\s+/i, '');
      store.getFactoid(team, key, (err, current) => {
        if (current != null) {
          reply(`${key} ${current}`);
        } else {
          reply(oneOf(I_DONT_KNOW));
        }
        done(err);
      });
      return;

    // Getting regular factoids
    } else if (shouldReply && (/^wh?at\s+(is|are)\s+/i).test(msg)) {
      let key = msg.replace(/^wh?at\s+(is|are)\s+/i, '').replace(/\?+$/, '');
      if (IGNORED_FACTOIDS.includes(key.toLowerCase())) return;
      store.getFactoid(team, key, (err, current) => {
        if (current != null) {
          parseAndReply(key, current); // Calls done()
        } else {
          reply(oneOf(I_DONT_KNOW));
          done();
        }
      });
      return;

    // Getting factoids without an interrogative requires addressing
    } else if (shouldReply && /\?+$/.test(msg)) {
      let key = msg.replace(/\?+$/, '');
      if (IGNORED_FACTOIDS.includes(key.toLowerCase())) return;
      store.getFactoid(team, key, (err, current) => {
        if (current != null) {
          parseAndReply(key, current); // Calls done()
        } else {
          done();
        }
      });
      return;

    // Deleting factoids
    } else if (isDirect && (/^forget\s+/i).test(msg)) {
      let key = msg.replace(/^forget\s+/i, '');
      store.deleteFactoid(team, key, err => {
        if (err) {
          log.error(err);
          reply("There was an error while downloading the list of users. Please try again.");
        } else {
          reply(`OK, I forgot about ${key}`);
        }
        done(err);
      });
      return;

    // Tell users about things
    } else if ((/^tell\s+\S+\s+about\s+/i).test(msg)) {
      bot.api.users.list({}, (err, res) => {
        if (err) {
          log.error(err);
          if (isDirect) { reply("There was an error while downloading the list of users. Please try again."); }
          done(err);
          return;
        }

        msg = msg.replace(/^tell\s+/i, '');
        let [targetName, ...parts] = msg.split(/\s*about\s*/i);
        let key = parts.join(' ');

        let targetID = null;
        for (let {id, name} of res.members) {
          userIdsToNames[id] = name;
          if (name === targetName) {
            targetID = id;
          }
        }

        if (targetID === null) {
          reply(`I don't know who ${targetName} is.`);
          done();
          return;
        }

        store.getFactoid(team, key, (err, value) => {
          if (value == null) {
            reply(oneOf(I_DONT_KNOW));
            done();
            return;
          }

          return bot.api.im.open({user: targetID}, (err, res) => {
            if (err) {
              log.error(err);
              if (shouldReply) reply(`I could not start an IM session with ${targetName}. Please try again.`);
              done(err);
              return;
            }

            let targetChannel = res.channel ? res.channel.id : null;
            parseAndReply(key, value, targetChannel);
            if (shouldReply || isVerbose) {
              reply(`OK, I told ${targetName} about ${key}`);
            }
            done();
            return;
          });
        });

      });
      return;

    // Karma query
    } else if ((/^karma\s+for\s+/i).test(msg)) {
      let key = msg.replace(/^karma\s+for\s+/i, '').replace(/\?+$/, '');
      store.getKarma(team, key, (err, current) => {
        if (!current) current = 0;
        if (err) {
          log.error(err);
          if (isVerbose) reply("There was an error getting the karma. Please try again.");
        } else {
          reply(`${key} has ${current} karma`);
        }
        done(err);
        return;
      });
      return;

    // Karma increment/decrement
    } else if (/\+\+(\s#.+)?$/.test(msg)) {
      if (isDirect) return reply("You cannot secretly change the karma for something!");
      let key = msg.split(/\+\+/)[0];
      store.getKarma(team, key, (err, current) => {
        if (err) {
          log.error(err);
          done(err);
          return;
        }
        let value = Number(current || 0) + 1;
        store.setKarma(team, key, value, err => {
          if (err) {
            log.error(err);
            if (isVerbose) reply("There was an error changing the karma. Please try again.");
          }
          done(err);
          return;
        });
      });
      return;

    // Karma decrement
    } else if (/\-\-(\s#.+)?$/.test(msg)) {
      if (isDirect) return reply("You cannot secretly change the karma for something!");
      let key = msg.split(/\-\-/)[0];
      store.getKarma(team, key, (err, current) => {
        if (err) {
          log.error(err);
          done(err);
          return;
        }
        let value = Number(current || 0) - 1;
        store.setKarma(team, key, value, err => {
          if (err) {
            log.error(err);
            if (isVerbose) reply("There was an error changing the karma. Please try again.");
          }
          done(err);
          return;
        });
      });
      return;

    // Updating factoids
    } else if (shouldLearn && (/\s+(is|are)\s+/i).test(msg)) {
      let [_, key, verb, value] = msg.match(/^(.+?)\s+(is|are)\s+(.*)/i);
      key = key.toLowerCase();
      verb = verb.toLowerCase();

      if (IGNORED_FACTOIDS.includes(key)) return done();

      let isCorrecting = (/no,?\s+/i).test(key);
      if (isCorrecting) { key = key.replace(/no,?\s+/i, ''); }

      let isAppending = (/also,?\s+/i).test(key);
      if (isAppending) { key = key.replace(/also,?\s+/i, ''); }

      if (!isAppending) { isAppending = (/also,?\s+/i).test(value); }
      if (isAppending) { value = value.replace(/also,?\s+/i, ''); }

      store.getFactoid(team, key, (err, current) => {
        if (err) {
          log.error(err);
          done(err);
          return;
        }

        if (current && isCorrecting) {
          update(key, `${verb} ${value}`); // Calls done()
          return;

        } else if (current && isAppending) {
          if (/^\|/.test(value)) {
            value = `${current}${value}`;
          } else {
            value = `${current} or ${value}`;
          }
          update(key, value); // Calls done()
          return;

        } else if (current === value) {
          reply(oneOf("I already know that.", "I've already got it as that."));
          done();
          return;

        } else if (current) {
          current = current.replace(/^(is|are)\s+/i, '');
          reply(`But ${key} ${verb} already ${current}`);
          done();
          return;

        } else {
          update(key, `${verb} ${value}`); // Calls done()
          return;
        }
      });

      return;

    // Getting regular factoids, last chance
    } else {
      if (IGNORED_FACTOIDS.includes(msg.toLowerCase())) {
        done();
        return;
      }
      store.getFactoid(team, msg, (err, value) => {
        if (value != null) {
          parseAndReply(msg, value); // Calls done()
          return;
        }
      });
      return;
    }

  }
}
