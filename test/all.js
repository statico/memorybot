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
      alice: tell bob about he who must not be named
    `
    // TODO [DM-123] OK, I told bob about he who must not be named
  },

  {
    title: 'should remember ambient factoids by default',
    script: `\
      alice: foo is bar
      ...
      alice: what is foo?
      membot: foo is bar
    `
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
    this.identity = {name: 'fakebot'};
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
          this.api.callAPI('im.open', args, cb);
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
    this.channel = 'PUB-123';
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
          assert.isUndefined(this.bot._replies.shift(), "bot should not have responded.");
          cb();

        } else {
          let [sender, ...msg] = line.split(' ');
          msg = msg.join(' ');

          this.isDirect = /^@membot\s+/.test(msg);
          msg = msg.replace(/^@membot\s+/, '');

          let isEmote = !/:$/.test(sender);
          this.sender = sender = sender.replace(/:$/, '');

          if (sender === 'membot') {
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

      }, done);

    });

  });

  afterEach(function(done) {
    this.store.destroy();
    return done();
  });

});

