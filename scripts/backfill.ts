/**
 * Backfill historical Discord messages into the SQLite store so `recentMessages`
 * and the `search_history` tool can see them.
 *
 * Usage:
 *   npm run build
 *   npm run backfill -- <channelId> [--start <ISO>] [--end <ISO>] [--max <n>]
 *
 * Examples:
 *   npm run backfill -- 123456789
 *   npm run backfill -- 123456789 --start 2025-01-01 --end 2025-03-01
 *
 * Idempotent: messages are stored with INSERT OR IGNORE keyed on the Discord
 * message id, so re-running (or overlapping the live window) never duplicates.
 * Each message keeps its ORIGINAL Discord timestamp, not the backfill time.
 */
import { mkdirSync } from 'node:fs'
import { Client, GatewayIntentBits } from 'discord.js'
import { SqliteMessageStore } from 'dadida'

const args = process.argv.slice(2)
const channelId = args.find((a) => !a.startsWith('--'))

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

if (!channelId) {
  console.error('Usage: npm run backfill -- <channelId> [--start <ISO>] [--end <ISO>] [--max <n>]')
  process.exit(1)
}

const token = process.env.DISCORD_TOKEN
if (!token) {
  console.error('DISCORD_TOKEN is not set')
  process.exit(1)
}

const startMs = flag('start') ? Date.parse(flag('start')!) : 0
const endMs = Math.min(flag('end') ? Date.parse(flag('end')!) : Date.now(), Date.now())
const max = flag('max') ? parseInt(flag('max')!, 10) : Infinity

if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
  console.error('--start / --end must be ISO dates, e.g. 2025-01-01 or 2025-01-01T00:00:00Z')
  process.exit(1)
}

// Discord snowflake encodes creation time: id = (unixMs - DISCORD_EPOCH) << 22.
// So a timestamp maps to a synthetic id we can use as a before/after cursor.
const DISCORD_EPOCH = 1420070400000n
const toSnowflake = (ms: number) => ((BigInt(ms) - DISCORD_EPOCH) << 22n).toString()

mkdirSync('./data', { recursive: true })
const store = new SqliteMessageStore('./data/messages.db')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`)
  console.log(
    `Backfilling channel ${channelId} from ${new Date(startMs).toISOString()} to ${new Date(endMs).toISOString()}`,
  )

  const channel = await client.channels.fetch(channelId).catch(() => null)
  if (!channel || !channel.isTextBased() || !('messages' in channel)) {
    console.error('Channel not found, not text-based, or the bot has no access to it.')
    store.close()
    await client.destroy()
    process.exit(1)
  }

  // Page backwards from `end` until we cross `start`.
  let before: string | undefined = toSnowflake(endMs)
  let scanned = 0
  let stored = 0

  while (scanned < max) {
    const limit = Math.min(100, max - scanned)
    const batch = await channel.messages.fetch({ limit, before })
    if (batch.size === 0) break

    let reachedStart = false
    for (const msg of batch.values()) {
      scanned++
      if (msg.createdTimestamp < startMs) {
        reachedStart = true
        continue
      }
      if (msg.createdTimestamp > endMs) continue
      if (msg.author.bot || !msg.content.trim()) continue

      store.store({
        id: msg.id,
        content: msg.content,
        authorId: msg.author.id,
        authorIsBot: msg.author.bot,
        channelId: msg.channelId,
        platform: 'discord',
        timestamp: msg.createdAt, // original message time, not "now"
        raw: msg,
      })
      stored++
    }

    process.stdout.write(`\rscanned ${scanned}, stored ${stored}...`)
    before = batch.last()?.id
    if (reachedStart || batch.size < limit) break
  }

  console.log(`\nDone. Scanned ${scanned} message(s), stored ${stored}.`)
  store.close()
  await client.destroy()
  process.exit(0)
})

client.login(token)
