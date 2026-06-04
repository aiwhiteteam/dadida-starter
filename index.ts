import { mkdirSync } from 'node:fs'
import { createBot, definePlugin, discord, SqliteMessageStore } from 'dadida'
import { investingClassifier } from './plugins/investing-classifier.js'
import { investorReply } from './plugins/investor-reply.js'
import { mem0Store } from './plugins/mem0-store.js'
import { moderator } from './plugins/moderator.js'

// Comma-separate LISTEN_CHANNEL_IDS to listen on multiple channels (e.g. "123,456").
// A single ID still works; empty means listen to all channels.
const channelIds = process.env.LISTEN_CHANNEL_IDS
  ?.split(',')
  .map((id) => id.trim())
  .filter(Boolean)

// Channels that are stored in SQLite but skipped by all plugins (no replies, no moderation).
const storeOnlyIds = new Set(
  process.env.STORE_ONLY_CHANNEL_IDS?.split(',').map((id) => id.trim()).filter(Boolean) ?? []
)

// better-sqlite3 won't create the directory, so ensure it exists first.
mkdirSync('./data', { recursive: true })

// Merge store-only channels into the discord listen list when explicit channels are set.
const allChannelIds = channelIds?.length
  ? [...new Set([...channelIds, ...storeOnlyIds])]
  : undefined

const bot = createBot({
  platform: discord({
    token: process.env.DISCORD_TOKEN!,
    channels: allChannelIds,
  }),
  store: new SqliteMessageStore('./data/messages.db'),
  plugins: [
    definePlugin({
      name: 'store-only-gate',
      async filter(message) {
        if (storeOnlyIds.has(message.channelId)) return false
      },
    }),
    mem0Store(),
    moderator({
      escalationChannelId: process.env.ESCALATION_CHANNEL_ID,
      mention: process.env.ESCALATION_MENTION,
      // maxMuteDurationSeconds: 604800,  // cap: 7 days
    }),
    investingClassifier(),
    investorReply(),
  ],
})

process.on('SIGINT', () => bot.stop())
process.on('SIGTERM', () => bot.stop())

bot.start()
