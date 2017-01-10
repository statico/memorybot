#!/usr/bin/env coffee

Entities = require('html-entities').AllHtmlEntities
winston = require 'winston'

storage = require './storage.coffee'

log = winston

MAX_FACTOID_SIZE = Number(process.env.MAX_FACTOID_SIZE or 2048)

I_DONT_KNOW = [
  "I don't know what that is."
  "I have no idea."
  "No idea."
  "I don't know."
]

OKAY = [
  "OK, got it."
  "I got it."
  "Understood."
  "Gotcha."
  "OK"
]

oneOf = ->
  if Array.isArray arguments[0]
    arr = arguments[0]
  else
    arr = arguments
  return arr[Math.floor(Math.random() * arr.length)]

exports.handleMessage = (bot, sender, channel, isDirect, msg) ->
  team = bot.identifyTeam()

  {mbMeta} = bot
  shouldLearn = isDirect or mbMeta.ambient
  shouldReply = isDirect or not mbMeta.direct
  isVerbose = mbMeta.verbose

  msg = Entities.decode(msg)
  msg = msg.substr(0, MAX_FACTOID_SIZE).trim().replace(/\0/g, '').replace(/\n/g, ' ')

  reply = (text) -> bot.reply {channel: channel}, {text: text}

  parseAndReply = (key, value, tell=null) ->
    value = value.replace(/\\\|/g, '\\&#124;')
    value = oneOf(value.split(/\|/i)).trim()
    value = value.replace(/&#124;/g, '|')

    isReply = (/^<reply>\s*/i).test(value)
    value = value.replace(/^<reply>\s*/i, '') if isReply

    isEmote = (/^<action>\s+/i).test(value)
    value = value.replace(/^<action>\s+/i, '') if isEmote

    value = value.replace(/\$who/ig, sender)

    if tell?
      bot.reply {channel: tell}, {text: "#{sender} wants you to know: #{key} is #{value}"}
    else if isReply
      reply value
    else if isEmote
      bot.api.callAPI 'chat.meMessage', {channel: channel, text: value}, (err, res) ->
        log.error(err) if err
    else
      reply "#{key} is #{value}"

  update = (key, value) ->
    lastEdit = "on #{new Date()} by #{sender}"
    storage.setFactoid team, key, value, lastEdit, (err) ->
      if err
        log.error err
        if isVerbose then reply "There was an error updating that factoid. Please try again."
      else
        if isVerbose then reply oneOf OKAY
      return
    return

  # Status
  if isDirect and msg is 'status'
    bool = (x) -> if x then ':ballot_box_with_check:' else ':white_medium_square:'
    storage.countFactoids team, (err, count) ->
      log.error err if err
      reply """
        *Usage*
        I am currently remembering #{count} factoids.
        *Settings*
        #{bool mbMeta.direct} `direct` - Interactons require direct messages or @-mentions
        #{bool mbMeta.ambient} `ambient` - Learn factoids from ambient room chatter
        #{bool mbMeta.verbose} `verbose` - Make the bot more chatty with confirmations, greetings, etc.
        Tell me "enable setting <name>" or "disable setting <name>" to change the above settings.
      """
    return

  # Getting literal factoids
  else if shouldReply and (/^literal\s+/i).test(msg)
    key = msg.replace(/^literal\s+/i, '')
    storage.getFactoid team, key, (err, current) ->
      if current?
        reply "#{key} is #{current}"
      else
        reply oneOf I_DONT_KNOW
    return

  # Getting regular factoids
  else if shouldReply and ((/^wh?at\s+is\s+/i).test(msg) or /\?+$/.test(msg))
    key = msg.replace(/^wh?at\s+is\s+/i, '').replace(/\?+$/, '').replace(/^the\s+/i, '')
    storage.getFactoid team, key, (err, current) ->
      if not current?
        reply oneOf I_DONT_KNOW
        return
      parseAndReply key, current
    return

  # Updating factoids
  else if shouldLearn and (/\s+is\s+/i).test(msg)
    [key, value] = msg.split /\s+is\s+/i
    key = key.toLowerCase()

    isCorrecting = (/no,?\s+/i).test(key)
    key = key.replace(/no,?\s+/i, '') if isCorrecting

    isAppending = (/also,?\s+/i).test(key)
    key = key.replace(/also,?\s+/i, '') if isAppending

    isAppending or= (/also,?\s+/i).test(value)
    value = value.replace(/also,?\s+/i, '') if isAppending

    storage.getFactoid team, key, (err, current) ->
      if err then return log.error(err)

      if current and isCorrecting
        update key, value

      else if current and isAppending
        if /^|/.test value
          value = "#{current}#{value}"
        else
          value = "#{current} or #{value}"
        update key, value

      else if current == value
        reply oneOf "I already know that.", "I've already got it as that."

      else if current
        reply "But #{key} is already #{current}"

      else
        update key, value

    return

  # Tell users about things
  else if (/^tell\s+\S+\s+about\s+/i).test(msg)
    bot.api.users.list {}, (err, res) ->
      if err
        log.error err
        if isDirect then reply "There was an error while downloading the list of users. Please try again."
        return

      msg = msg.replace(/^tell\s+/i, '')
      [targetName, parts...] = msg.split(/\s*about\s*/i)
      key = parts.join(' ')

      targetID = null
      for {id, name} in res.members
        userIdsToNames[id] = name
        if name is targetName
          targetID = id

      if targetID is null
        reply "I don't know who #{targetName} is."
        return

      storage.getFactoid team, key, (err, value) ->
        if not value?
          reply oneOf I_DONT_KNOW
          return

        bot.api.im.open {user: targetID}, (err, res) ->
          if err
            log.error err
            if shouldReply then reply "I could not start an IM session with #{targetName}. Please try again."
            return

          targetChannel = res.channel?.id
          parseAndReply key, value, targetChannel
          if shouldReply or isVerbose
            reply "OK, I told #{targetName} about #{key}"

      return
    return

  # Karma query
  else if (/^karma\s+for\s+/i).test(msg)
    key = msg.replace(/^karma\s+for\s+/i, '').replace(/\?+$/, '')
    storage.getKarma team, key, (err, current) ->
      current or= 0
      if err
        log.error err
        if isVerbose then reply "There was an error getting the karma. Please try again."
      else
        reply "Karma for #{key} is #{current}"
      return
    return

  # Karma increment/decrement
  else if /\+\+(\s#.+)?$/.test(msg)
    if isDirect then return reply "You cannot secretly change the karma for something!"
    key = msg.split(/\+\+/)[0]
    storage.getKarma team, key, (err, current) ->
      if err then return log.error(err)
      value = Number(current or 0)
      value++
      storage.setKarma team, key, value, (err) ->
        if err
          log.error err
          if isVerbose then reply "There was an error changing the karma. Please try again."
        return
      return
    return

  # Karma decrement
  else if /\-\-(\s#.+)?$/.test(msg)
    if isDirect then return reply "You cannot secretly change the karma for something!"
    key = msg.split(/\-\-/)[0]
    storage.getKarma team, key, (err, current) ->
      if err then return log.error(err)
      value = Number(current or 0)
      value--
      storage.setKarma team, key, value, (err) ->
        if err
          log.error err
          if isVerbose then reply "There was an error changing the karma. Please try again."
        return
      return
    return

  # Getting regular factoids, last chance {{{3
  else
    storage.getFactoid team, msg, (err, value) ->
      if value?
        parseAndReply msg, value
    return

  return
