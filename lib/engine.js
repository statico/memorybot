import Random from 'random-js'
import denodeify from 'denodeify'
import winston from 'winston'
import {AllHtmlEntities as Entities} from 'html-entities'

const log = winston

import {version as VERSION} from '../package.json'

const MAX_FACTOID_SIZE = Number(process.env.MAX_FACTOID_SIZE || 2048)

const I_DONT_KNOW = [
  "I don't know what that is.",
  'I have no idea.',
  'No idea.',
  "I don't know."
]

const OKAY = [
  'OK, got it.',
  'I got it.',
  'Understood.',
  'Gotcha.',
  'OK'
]

const GREETINGS = [
  'Heya, $who!',
  'Hi $who!',
  'Hello, $who',
  'Hello, $who!',
  'Greetings, $who'
]

const ACKNOWLEDGEMENTS = [
  'Yes?',
  'Yep?',
  'Yeah?'
]

const IGNORED_FACTOIDS = [
  'he',
  'help',
  'hers',
  'his',
  'huh',
  'it',
  "it's",
  'its',
  'she',
  'settings',
  'status',
  'that',
  'them',
  'there',
  'these',
  'they',
  'this',
  'those',
  'what',
  'when',
  'where',
  'who',
  'why'
]

export class MemoryBotEngine {

  constructor (store) {
    this.store = store
    this.userIdsToNames = {}
    this._random = new Random()
  }

  oneOf () {
    let arr
    if (Array.isArray(arguments[0])) {
      arr = arguments[0]
    } else {
      arr = arguments
    }
    return this._random.pick(arr)
  }

  async handleMessage (bot, sender, channel, isDirect, msg) {
    // Ignore ourself.
    if (sender === bot.identity.id || sender === bot.identity.name) return

    const {mbMeta} = bot
    const team = bot.identifyTeam()
    const shouldLearn = isDirect || mbMeta.ambient // Should we be learning factoids?
    const shouldReply = isDirect || !mbMeta.direct // Should we reply to this?
    const isVerbose = mbMeta.verbose // TODO: Combine with shouldLearn

    // Sometimes Slack sends HTML entities.
    msg = Entities.decode(msg)

    // Basic input sanitization.
    msg = msg.substr(0, MAX_FACTOID_SIZE).trim().replace(/\0/g, '').replace(/\n/g, ' ')

    // Simple reply helper.
    const reply = text => bot.reply({channel}, {text})

    // Used to parse a factoid's contents and reply with it.
    const parseAndReply = async (key, value, tell = null) => {
      // Factoids are stored as { key: "foo", value: "is bar" }
      let [, verb, rest] = Array.from(value.match(/^(is|are)\s+(.*)/i))
      value = rest

      // Split on |, but don't split on \|. Use an HTML entity as a separator.
      value = value.replace(/\\\|/g, '\\&#124;')
      value = this.oneOf(value.split(/\|/i)).trim()
      value = value.replace(/&#124;/g, '|')

      const isReply = (/^<reply>\s*/i).test(value)
      if (isReply) value = value.replace(/^<reply>\s*/i, '')

      const isEmote = (/^<action>\s*/i).test(value)
      if (isEmote) value = value.replace(/^<action>\s*/i, '')

      value = value.replace(/\$who/ig, sender)

      if (tell) {
        bot.reply({channel: tell}, {text: `${sender} wants you to know: ${key} is ${value}`})
      } else if (isReply) {
        if (value && value !== '') reply(value)
      } else if (isEmote) {
        await denodeify(bot.api.callAPI.bind(bot.api))('chat.meMessage', {channel, text: value})
      } else {
        reply(`${key} ${verb} ${value}`)
      }
    }

    // Used to update a factoid and reply.
    const update = async (key, value) => {
      // Escape Slack @-groups. (When a user types '@here' we get '<!here|@here>'.)
      value = value.replace(/<!(\w+)\|@\w+>/ig, (_, x) => '`@' + x + '`')

      const lastEdit = `on ${new Date()} by ${sender}`
      await this.store.setFactoid(team, key, value, lastEdit)
      if (isVerbose || isDirect) reply(this.oneOf(OKAY))
    }

    // Status
    if (isDirect && (/^(?:status|settings)\??/ig).test(msg)) {
      const bool = x => x ? ':ballot_box_with_check:' : ':white_medium_square:'
      let count = await this.store.countFactoids(team)
      reply(`\
*Status*
I am memorybot v${VERSION} - https://statico.github.com/memorybot/
I am currently remembering ${count} factoids.
*Settings*
${bool(mbMeta.direct)} \`direct\` - Interactons require direct messages or @-mentions
${bool(mbMeta.ambient)} \`ambient\` - Learn factoids from ambient room chatter
${bool(mbMeta.verbose)} \`verbose\` - Make the bot more chatty with confirmations, greetings, etc.
Tell me "enable setting <name>" or "disable setting <name>" to change the above settings.\
`)
      return

    // Help
    } else if (isDirect && (/^help\??/ig).test(msg)) {
      reply(`Hi alice, I'm a MemoryBot. I remember things and then recall them later when asked. Check out my home page for more information: https://statico.github.io/memorybot/ -- You can also leave feedback or file bugs on my GitHub issues page: https://github.com/statico/memorybot/issues`)
      return

    // Settings
    } else if (isDirect && (/^(enable|disable)\s+setting\s+/i).test(msg)) {
      let [action, key] = msg.split(/\s+setting\s+/i)
      let value = (action === 'enable')

      let result
      switch (key) {
        case 'direct':
          result = `interactions with me ${value ? 'now' : 'no longer'} require direct messages or @-mentions`
          break
        case 'ambient':
          result = `I ${value ? 'will now' : 'will no longer'} learn factoids without being told explicitly`
          break
        case 'verbose':
          result = `I ${value ? 'will now' : 'will no longer'} be extra chatty`
          break
      }

      await this.store.setMetaData(team, key, value)
      await this.store.updateBotMetadata(bot)
      reply(`OK, ${result}.`)
      return

    // A greeting?
    } else if ((/^(hey|hi|hello|waves)$/i).test(msg)) {
      if (shouldReply || isVerbose) reply(this.oneOf(GREETINGS).replace(/\$who/ig, sender))
      return

    // Addressing the bot?
    } else if (bot.identity && msg.toLowerCase() === `${bot.identity.name.toLowerCase()}?`) {
      reply(this.oneOf(ACKNOWLEDGEMENTS))
      return

    // Getting literal factoids
    } else if (shouldReply && (/^literal\s+/i).test(msg)) {
      let key = msg.replace(/^literal\s+/i, '')
      let current = await this.store.getFactoid(team, key)
      if (current != null) {
        reply(`${key} ${current}`)
      } else {
        reply(this.oneOf(I_DONT_KNOW))
      }
      return

    // Getting regular factoids
    } else if (shouldReply && (/^wh?at\s+(is|are)\s+/i).test(msg)) {
      let key = msg.replace(/^wh?at\s+(is|are)\s+/i, '').replace(/\?+$/, '')
      if (IGNORED_FACTOIDS.includes(key.toLowerCase())) return
      let current = await this.store.getFactoid(team, key)
      if (current != null) {
        await parseAndReply(key, current)
      } else {
        reply(this.oneOf(I_DONT_KNOW))
      }
      return

    // Deleting factoids
    } else if (isDirect && (/^forget\s+/i).test(msg)) {
      let key = msg.replace(/^forget\s+/i, '')
      await this.store.deleteFactoid(team, key)
      reply(`OK, I forgot about ${key}`)
      return

    // Tell users about things
    } else if ((/^tell\s+\S+\s+about\s+/i).test(msg)) {
      let res = null
      try {
        res = await denodeify(bot.api.users.list.bind(bot.api.users))({})
      } catch (err) {
        log.error(err)
        reply('There was an error while downloading the list of users. Please try again.')
        return
      }

      msg = msg.replace(/^tell\s+/i, '')
      let [targetName, ...parts] = msg.split(/\s*about\s*/i)
      let key = parts.join(' ')

      let match = targetName.match(/^<@(\w+)>$/)
      let targetID = match ? match[1] : null
      if (!targetID) {
        for (let {id, name} of res.members) {
          this.userIdsToNames[id] = name
          if (name === targetName) {
            targetID = id
          }
        }
      }

      if (targetID === null) {
        reply(`I don't know who ${targetName} is.`)
        return
      }

      let value = await this.store.getFactoid(team, key)
      if (value == null) {
        reply(this.oneOf(I_DONT_KNOW))
        return
      }

      try {
        res = await denodeify(bot.api.im.open.bind(bot.api.im))({user: targetID})
      } catch (err) {
        log.error(err)
        reply(`I could not start an IM session with ${targetName}. Please try again.`)
        return
      }

      let targetChannel = res.channel ? res.channel.id : null
      if (isVerbose) reply(`OK, I told ${targetName} about ${key}`)
      await parseAndReply(key, value, targetChannel)
      return

    // Karma query
    } else if ((/^karma\s+(for\s+)?/i).test(msg)) {
      let key = msg.replace(/^karma\s+(for\s+)?/i, '').replace(/\?+$/, '')
      let current = await this.store.getKarma(team, key)
      if (!current) current = 0
      reply(`${key} has ${current} karma`)
      return

    // Karma increment
    } else if (/\+\+(\s#.+)?$/.test(msg)) {
      if (isDirect) return reply('You cannot secretly change the karma for something!')
      let key = msg.split(/\+\+/)[0]
      let current = await this.store.getKarma(team, key)
      let value = Number(current || 0) + 1
      await this.store.setKarma(team, key, value)
      return

    // Karma decrement
    } else if (/--(\s#.+)?$/.test(msg)) {
      if (isDirect) return reply('You cannot secretly change the karma for something!')
      let key = msg.split(/--/)[0]
      let current = await this.store.getKarma(team, key)
      let value = Number(current || 0) - 1
      await this.store.setKarma(team, key, value)
      return

    // Updating factoids
    } else if (shouldLearn && (/\s+(is|are)\s+/i).test(msg)) {
      let [, key, verb, value] = msg.match(/^(.+?)\s+(is|are)\s+(.*)/i)
      key = key.toLowerCase()
      verb = verb.toLowerCase()

      if (IGNORED_FACTOIDS.includes(key)) return

      let isCorrecting = (/no,?\s+/i).test(key)
      if (isCorrecting) { key = key.replace(/no,?\s+/i, '') }

      let isAppending = (/also,?\s+/i).test(key)
      if (isAppending) { key = key.replace(/also,?\s+/i, '') }

      if (!isAppending) { isAppending = (/also,?\s+/i).test(value) }
      if (isAppending) { value = value.replace(/also,?\s+/i, '') }

      key = key.replace(/^but,?\s+/, '')

      let current = await this.store.getFactoid(team, key)

      if (current && current.replace(/^(is|are)\s+/i, '') === value) {
        reply(this.oneOf('I already know that.', "I've already got it as that."))
      } else if (current && isCorrecting) {
        await update(key, `${verb} ${value}`)
      } else if (current && isAppending) {
        if (/^\|/.test(value)) {
          value = `${current}${value}`
        } else {
          value = `${current} or ${value}`
        }
        await update(key, value)
      } else if (current) {
        current = current.replace(/^(is|are)\s+/i, '')
        reply(`But ${key} ${verb} already ${current}`)
      } else {
        await update(key, `${verb} ${value}`)
      }
      return

    // Getting factoids without an interrogative requires addressing
    } else if (shouldReply && /\?+$/.test(msg)) {
      let key = msg.replace(/\?+$/, '')
      if (IGNORED_FACTOIDS.includes(key.toLowerCase())) return
      let current = await this.store.getFactoid(team, key)
      if (current != null) await parseAndReply(key, current)
      return

    // Getting regular factoids, last chance
    } else {
      if (IGNORED_FACTOIDS.includes(msg.toLowerCase())) return
      let value = await this.store.getFactoid(team, msg)
      if (value != null) await parseAndReply(msg, value)
      return
    }
  }
}
