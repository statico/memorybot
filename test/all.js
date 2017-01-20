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
    title: 'should remember ambient factoids by default',
    script: `\
      alice: foo is bar
      ...
      alice: what is foo?
      membot: foo is bar
    `
  }

];

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
    this._lastReply = null;
    this.identity = {name: 'fakebot'};
    this.team_info = {id: 'T12345678'};
    this.api = {
      callAPI: (method, args, cb) => {
        this._lastReply = {method, args};
        cb();
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
          cb(null, { channel: { id: 'DM-123' } });
        }
      }
    };

  }

  identifyTeam() {
    return this.team_info.id;
  }

  reply(options, msg) {
    this._lastOptions = options;
    this._lastReply = msg.text;
  }

  get lastReply() {
    let ret = this._lastReply;
    this._lastReply = null;
    return ret;
  }

}

describe('MemoryBotEngine', function() {

  beforeEach(function(done) {
    this.sender = 'testuser';
    this.channel = 'PUB-123';
    this.isDirect = false;

    this.bot = new FakeBot();
    this.store = new TestStore();
    this.engine = new MemoryBotEngine(this.store);
    this.store.initialize(this.bot.team_info.id, err => {
      assert.isNull(err);
      this.store.updateBotMetadata(this.bot, done);
    });
  });

  TESTS.forEach(function(test) {
    let {title, script, before} = test;

    it(title, function(done) {
      if (before != null) before.call(this);

      let steps = script.trim().split(/\n/g).map(line => line.trim());
      forEachSeries(steps, (line, cb) => {
        if (line === '...') {
          assert.isNull(this.bot.lastReply, "bot should not have responded.");
          cb();
        } else {
          let [sender, ...msg] = line.split(' ');
          msg = msg.join(' ');
          let isEmote = !/:$/.test(sender);
          this.sender = sender.replace(/:$/, '');
          if (sender === 'membot') {
            let last = this.bot.lastReply;
            if (isEmote) {
              assert.equal(last.method, 'chat.meMessage', "last bot reply should have been an emote");
              assert.equal(last.args.text, msg, "emote should match");
            } else {
              assert.equal(last, msg, "reply should match");
            }
            cb();
          } else {
            this.engine.handleMessage(this.bot, this.sender, this.channel, this.isDirect, msg, cb);
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

