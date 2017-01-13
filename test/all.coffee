sqlite3 = require 'sqlite3'
{assert} = require 'chai'

{MemoryBotEngine} = require '../lib/engine'
{SQLiteStore} = require '../lib/store'

class TestStore extends SQLiteStore

  constructor: ->
    @db = new sqlite3.cached.Database(':memory:')

  getDatabase: (_) ->
    return @db

  destroy: ->
    @db.close()
    @db = null
    return

class FakeBot

  constructor: ->
    @_lastReply = null
    @identity =
      name: 'fakebot'
    @team_info =
      id: 'T12345678'

  identifyTeam: -> @team_info.id

  api:
    callApi: (method, args, cb) ->
      @_lastReply = {method: method, args: args}
      cb()
    users:
      list: (args, cb) ->
        cb null, {
          members: [
            {name: 'alice', id: '1000'}
            {name: 'bob', id: '1001'}
            {name: 'charlie', id: '1002'}
          ]
        }
    im:
      open: (args, cb) ->
        cb null, {
          channel:
            id: 'DM-123'
        }

  reply: (options, msg) ->
    @_lastOptions = options
    @_lastReply = msg.text

  getLastReply: ->
    ret = @_lastReply
    @_lastReply = null
    return ret

# This is a shitty way to test asynchronous code that might not return.
run = (steps) ->
  return (done) ->
    steps.push done
    for fn, i in steps
      setTimeout fn.bind(this), i * 10

describe 'MemoryBotEngine', ->

  beforeEach (done) ->
    @sender = 'testuser'
    @channel = 'PUB-123'
    @isDirect = false
    @say = (msg) => @engine.handleMessage @bot, @sender, @channel, @isDirect, msg
    Object.defineProperty this, 'last', get: => @bot.getLastReply()

    @bot = new FakeBot()
    @store = new TestStore()
    @engine = new MemoryBotEngine(@store)
    @store.initialize @bot.team_info.id, (err) =>
      assert.isNull err
      @store.updateBotMetadata @bot, done

  afterEach (done) ->
    @store.destroy()
    done()

  it 'should remember ambient factoids by default', run [
    -> @say 'foo is bar'
    -> assert.equal @last, null
    -> @say 'what is foo?'
    -> assert.equal @last, 'foo is bar'
  ]
