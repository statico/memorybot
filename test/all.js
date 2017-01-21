import Random from 'random-js';
import sqlite3 from 'sqlite3';
import winston from 'winston';
import {assert} from 'chai';
import {forEachSeries} from 'artillery-async';

require('winston-memory');

import {MemoryBotEngine} from '../lib/engine';
import {SQLiteStore} from '../lib/store';

const log = winston;
log.remove(winston.transports.Console);
log.add(winston.transports.Memory);

const TESTS = [

  {
    title: 'should get some fun defaults from the start',
    script: `\
      alice: what is Slack?
      membot: Slack is a cool way to talk to your team
      alice: what is the internet?
      membot: the internet is a great source of cat pictures
      alice licks the bot
      membot exudes a foul oil
    `
  },

  {
    title: 'should remember things like the docs',
    script: `\
      alice: The foo is a great place for cat pictures
      ...
      alice: What is the foo?
      membot: the foo is a great place for cat pictures
    `
  },

  {
    title: 'should append things like the docs',
    script: `\
      alice: GIF is pronounced like "gift"
      ...
      alice: GIF is also pronounced like "jiffy"
      ...
      alice: GIF?
      membot: GIF is pronounced like "gift" or pronounced like "jiffy"
    `
  },

  {
    title: 'should replace existing factoids like the docs',
    script: `\
      alice: GIF is pronounced like "gift"
      ...
      alice: no, GIF is pronounced however you want it to be!
      ...
      alice: GIF?
      membot: GIF is pronounced however you want it to be!
    `
  },

  {
    title: 'should tell us if a factoid is already the same',
    script: `\
      alice: foo is bar
      ...
      alice: foo is bar
      membot: I already know that.
      alice: no, foo is bar
      membot: I've already got it as that.
    `
  },

  {
    title: 'should forget things like the docs',
    script: `\
      alice: GIF is pronounced like "gift"
      ...
      alice: @membot forget gif
      membot: OK, I forgot about gif
      alice: What is GIF?
      membot: No idea.
    `
  },

  {
    title: 'should tell people things like the docs',
    script: `\
      alice: he who must not be named is Voldemort
      ...
      bob: who are we talking about?
      ...
      alice: tell bob about he who must not be named
    `,
    after: function() {
      assert.deepEqual(this.bot._replies, [
        { method: 'im.open', args: { user: '1001' } },
        {
          options: { channel: '#im-1001' },
          msg: { text: 'alice wants you to know: he who must not be named is Voldemort' }
        }
      ]);
    }
  },

  {
    title: 'should tell people things like the docs (verbose enabled)',
    script: `\
      alice: @membot enable setting verbose
      membot: OK, I will now be extra chatty.
      alice: he who must not be named is Voldemort
      membot: Understood.
      bob: who are we talking about?
      ...
      alice: tell bob about he who must not be named
    `,
    after: function() {
      assert.deepEqual(this.bot._replies, [
        { method: 'im.open', args: { user: '1001' } },
        {
          options: { channel: '#general' },
          msg: { text: 'OK, I told bob about he who must not be named' }
        },
        {
          options: { channel: '#im-1001' },
          msg: { text: 'alice wants you to know: he who must not be named is Voldemort' }
        }
      ]);
    }
  },

  {
    title: 'should not be able to tell someone who is not a user',
    script: `\
      alice: foo is bar
      ...
      alice: tell quux about foo
      membot: I don't know who quux is.
    `
  },

  {
    title: 'should not be able to tell someone something it doesn\'t know about',
    script: `\
      alice: tell bob about foo
      membot: No idea.
    `
  },

  {
    title: 'should return a random result like the docs',
    script: `\
      alice: Schrodinger's cat is very happy | not happy at all
      ...
      alice: Schrodinger's cat?
      membot: Schrodinger's cat is very happy
      alice: Schrodinger's cat?
      membot: Schrodinger's cat is not happy at all
    `
  },

  {
    title: 'should be able to roll a die',
    script: `\
      alice: roll 1d6 is <reply>1|<reply>2|<reply>3|<reply>4|<reply>5|<reply>6
      ...
      alice: roll 1d6?
      membot: 1
      alice: roll 1d6?
      membot: 6
    `
  },

  {
    title: 'should be able to append a random response',
    script: `\
      alice: foo is bar
      ...
      alice: foo is also |baz
      ...
      alice: foo?
      membot: foo is bar
      alice: foo?
      membot: foo is baz
    `
  },

  {
    title: 'should low a literal factoid like the docs',
    script: `\
      alice: Schrodinger's cat is very happy | not happy at all
      ...
      alice: literal Schrodinger's cat
      membot: Schrodinger's cat is very happy | not happy at all
    `
  },

  {
    title: 'should reply when not knowing about literal factoids',
    script: `\
      alice: literal foo?
      membot: No idea.
    `
  },

  {
    title: 'should hide the subject when replying like the docs',
    script: `\
      alice: hodor is <reply>hodor!
      ...
      alice: hodor?
      membot: hodor!
    `
  },

  {
    title: 'should reply with actions like the docs',
    script: `\
      alice: licks membot is <action> exudes a foul oil
      ...
      alice licks membot
      membot exudes a foul oil
    `
  },

  {
    title: 'should use the senders name in the reply like the docs',
    script: `\
      alice: ice cream is $who's favorite treat
      ...
      alice: ice cream?
      membot: ice cream is alice's favorite treat
    `
  },

  {
    title: 'should change karma like in the docs',
    script: `\
      charlie: kittens++
      ...
      alice: kittens++ # so cute!
      ...
      bob: kittens--
      ...
      alice: karma for kittens?
      membot: kittens has 1 karma
    `
  },

  {
    title: 'should get karma without a question mark',
    script: `\
      alice: kittens++
      ...
      alice: karma for kittens
      membot: kittens has 1 karma
    `
  },

  {
    title: 'should require addressing to learn things when enabled like the docs',
    script: `\
      alice: @membot disable setting ambient
      membot: OK, I will no longer learn factoids without being told explicitly.
      alice: foo is bar
      ...
      alice: what is foo?
      membot: No idea.
    `
  },

  {
    title: 'should require addressing to respond to things when enabled like the docs',
    script: `\
      alice: kittens are super cute
      ...
      alice: @membot enable setting direct
      membot: OK, interactions with me now require direct messages or @-mentions.
      alice: kittens?
      ...
      alice: hmm, nothing happened
      ...
      alice: @membot kittens?
      membot: kittens are super cute
    `
  },

  {
    title: 'should remember ambient factoids by default',
    script: `\
      alice: foo is bar
      ...
      alice: what is foo?
      membot: foo is bar
    `
  },

  {
    title: 'should reply with a greeting when addressed or direct is disabled',
    script: `\
      alice: hello
      membot: Hello, alice
      alice: @membot hello
      membot: Hello, alice
      alice: @membot enable setting direct
      membot: OK, interactions with me now require direct messages or @-mentions.
      alice: hello
      ...
    `
  },

  {
    title: 'should reply when addressed with nothing',
    script: `\
      alice: membot?
      membot: Yes?
    `
  },

  {
    title: 'should ignore certain phrases completely',
    script: `\
      alice: @membot enable setting verbose
      membot: OK, I will now be extra chatty.
      alice: this is foo
      ...
      alice: what is this?
      ...
      alice: what is that?
      ...
      alice: those are foo
      ...
      alice: what are those?
      ...
      alice: what?
      ...
      alice: huh?
      ...
      alice: who?
      ...
    `
  },

  {
    title: 'should reply with default settings',
    script: `\
      alice: @membot status
    `,
    after: function() {
      assert.deepEqual(this.bot._replies, [
        {
          options: { channel: '#general' },
          msg: { text: `\
*Status*
I am memorybot v1.0.5 - https://statico.github.com/memorybot/
I am currently remembering 3 factoids.
*Settings*
:white_medium_square: \`direct\` - Interactons require direct messages or @-mentions
:ballot_box_with_check: \`ambient\` - Learn factoids from ambient room chatter
:white_medium_square: \`verbose\` - Make the bot more chatty with confirmations, greetings, etc.
Tell me "enable setting <name>" or "disable setting <name>" to change the above settings.` }
        }
      ]);
    }
  }

];

class TestEngine extends MemoryBotEngine {

  constructor(store) {
    super(store);
    this._random = new Random(Random.engines.mt19937().seed(42));
  }

}

class TestStore extends SQLiteStore {

  constructor() {
    super("not used because we'll use in-memory storage");
    this.db = new sqlite3.cached.Database(':memory:');
  }

  getDatabase(_) {
    return this.db;
  }

  destroy() {
    this.db.close();
    this.db = null;
  }

}

// This emulates enough of a Botkit bot for the MemoryBot engine to use.
class FakeBot {

  constructor() {
    this._replies = [];
    this.identity = {name: 'membot'};
    this.team_info = {id: 'T12345678'};
    this.api = {
      callAPI: (method, args, cb) => {
        this._replies.push({method, args});
        cb(null, {});
      },
      users: {
        list: (args, cb) => {
          cb(null, {
            members: [
              {name: 'alice', id: '1000'},
              {name: 'bob', id: '1001'},
              {name: 'charlie', id: '1002'}
            ]
          });
        }
      },
      im: {
        open: (args, cb) => {
          this._replies.push({method: 'im.open', args});
          cb(null, {
            channel: {
              id: '#im-' + args.user
            }
          });
        }
      }
    };

  }

  identifyTeam() {
    return this.team_info.id;
  }

  reply(options, msg) {
    this._replies.push({options, msg});
  }

}

describe('MemoryBotEngine', function() {

  beforeEach(function(done) {
    this.sender = 'testuser';
    this.channel = '#general';
    this.isDirect = false;

    this.bot = new FakeBot();
    this.store = new TestStore();
    this.engine = new TestEngine(this.store);
    this.store.initialize(this.bot.team_info.id, err => {
      assert.isNull(err);
      this.store.updateBotMetadata(this.bot, done);
    });
  });

  TESTS.forEach(function(test) {
    let {title, script, before, after} = test;

    it(title, function(done) {
      if (before != null) before.call(this);

      let steps = script.trim().split(/\n/g).map(line => line.trim());
      forEachSeries(steps, (line, cb) => {

        if (line === '...') {
          let last = this.bot._replies.shift();
          assert.isUndefined(last, "bot should not have responded.");
          cb();

        } else {
          let [sender, ...msg] = line.split(' ');
          msg = msg.join(' ');

          this.isDirect = /^@membot\s+/.test(msg);
          msg = msg.replace(/^@membot\s+/, '');

          let isEmote = !/:$/.test(sender);
          this.sender = sender = sender.replace(/:$/, '');

          if (sender === 'membot') {
            assert.isAtLeast(this.bot._replies.length, 1, `number of bot replies after "${msg}"`);
            let last = this.bot._replies.shift();

            if (isEmote) {
              assert.equal(last.method, 'chat.meMessage', "last bot reply should have been an emote");
              assert.equal(last.args.text, msg, "bot emote");

            } else {
              assert.equal(last.msg.text, msg, "bot reply");
            }
            this.bot.lastReply = null;
            cb();

          } else {
            this.engine.handleMessage(this.bot, this.sender, this.channel, this.isDirect, msg, (err) => {
              cb(err);
            });
          }
        }

      }, (err) => {
        if (after != null) after.call(this);
        done(err);
      });

    });

  });

  afterEach(function(done) {
    this.store.destroy();
    return done();
  });

});

