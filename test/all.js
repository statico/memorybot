import sqlite3 from 'sqlite3';
import {assert} from 'chai';
import {forEachSeries} from 'artillery-async';

import {MemoryBotEngine} from '../lib/engine';
import {SQLiteStore} from '../lib/store';

class TestStore extends SQLiteStore {

  constructor() {
    super('/tmp/unused');
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

class FakeBot {

  constructor() {
    this.identity = {name: 'fakebot'};
    this.team_info = {id: 'T12345678'};
    this._lastReply = null;
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

  getLastReply() {
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

    this.run = (done, script) =>
      forEachSeries(script, (line, cb) => {
        if (line === null) {
          assert.isNull(this.bot.getLastReply());
          cb();
        } else {
          let [sender, msg] = line.split(': ');
          this.sender = sender;
          if (sender === 'membot') {
            assert.equal(this.bot.getLastReply(), msg);
            cb();
          } else {
            this.engine.handleMessage(this.bot, this.sender, this.channel, this.isDirect, msg, cb);
          }
        }
      }, done);
  });

  afterEach(function(done) {
    this.store.destroy();
    return done();
  });

  it('should remember ambient factoids by default', function(done) { return this.run(done, [
    'alice: foo is bar',
    null,
    'alice: what is foo?',
    'membot: foo is bar'
  ]);});

});
