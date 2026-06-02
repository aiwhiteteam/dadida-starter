import { mkdirSync } from 'node:fs'
import { createBot, discord, SqliteMessageStore } from 'dadida'
import { investingClassifier } from './plugins/investing-classifier.js'
import { investorReply } from './plugins/investor-reply.js'
import { moderator } from './plugins/moderator.js'

// Comma-separate LISTEN_CHANNEL_IDS to listen on multiple channels (e.g. "123,456").
// A single ID still works; empty means listen to all channels.
const channelIds = process.env.LISTEN_CHANNEL_IDS
  ?.split(',')
  .map((id) => id.trim())
  .filter(Boolean)

// better-sqlite3 won't create the directory, so ensure it exists first.
mkdirSync('./data', { recursive: true })

const bot = createBot({
  platform: discord({
    token: process.env.DISCORD_TOKEN!,
    channels: channelIds?.length ? channelIds : undefined,
  }),
  store: new SqliteMessageStore('./data/messages.db'),
  plugins: [
    moderator(),
    investingClassifier(),
    investorReply(),
  ],
})

process.on('SIGINT', () => bot.stop())
process.on('SIGTERM', () => bot.stop())

bot.start()
