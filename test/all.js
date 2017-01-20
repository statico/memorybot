import sqlite3 from 'sqlite3';
import {assert} from 'chai';
import {forEachSeries} from 'artillery-async';

import {MemoryBotEngine} from '../lib/engine';
import {SQLiteStore} from '../lib/store';

const TESTS = [

  {
    title: 'should remember ambient factoids by default',
    script: [
      'alice: foo is bar',
      null,
      'alice: what is foo?',
      'membot: foo is bar'
    ]
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
      callApi: (method, args, cb) => {
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

      forEachSeries(script, (line, cb) => {
        if (line == null) {
          assert.isNull(this.bot.lastReply, "MemoryBot should not have responded.");
          cb();
        } else {
          let [sender, msg] = line.split(': ');
          this.sender = sender;
          if (sender === 'membot') {
            assert.equal(this.bot.lastReply, msg);
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

