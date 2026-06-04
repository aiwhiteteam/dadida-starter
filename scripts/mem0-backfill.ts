/**
 * Backfill existing SQLite message history into Mem0.
 *
 * Usage:
 *   npm run build
 *   npm run mem0:backfill -- [--channel <channelId>] [--start <ISO>] [--end <ISO>] [--max <n>] [--batch <n>]
 *
 * Requires:
 *   MEM0_API_KEY in .env
 */
import Database from 'better-sqlite3'
import { SqliteMessageStore } from 'dadida'
import { addMessageToMem0, getMem0TargetKey, isMem0Enabled, type StoredHistoryMessage } from '../lib/mem0.js'

const args = process.argv.slice(2)

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}

if (!isMem0Enabled()) {
  console.error('MEM0_API_KEY is not set')
  process.exit(1)
}

const startMs = flag('start') ? Date.parse(flag('start')!) : 0
const endMs = Math.min(flag('end') ? Date.parse(flag('end')!) : Date.now(), Date.now())
const max = flag('max') ? parseInt(flag('max')!, 10) : Infinity
const batchSize = Math.min(flag('batch') ? parseInt(flag('batch')!, 10) : 100, 1000)
const channelId = flag('channel') ?? flag('channelId')

if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
  console.error('--start / --end must be ISO dates, e.g. 2025-01-01 or 2025-01-01T00:00:00Z')
  process.exit(1)
}

if (Number.isNaN(max) || Number.isNaN(batchSize) || batchSize <= 0) {
  console.error('--max and --batch must be positive numbers')
  process.exit(1)
}

const dbPath = './data/messages.db'
const targetKey = getMem0TargetKey()
const store = new SqliteMessageStore(dbPath)
const syncDb = new Database(dbPath)
syncDb.pragma('busy_timeout = 5000')
syncDb.exec(`
  CREATE TABLE IF NOT EXISTS mem0_sync (
    target_key TEXT NOT NULL,
    message_id TEXT NOT NULL,
    event_id TEXT,
    status TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    synced_at INTEGER NOT NULL,
    PRIMARY KEY (target_key, message_id)
  );

  CREATE INDEX IF NOT EXISTS idx_mem0_sync_channel_time
    ON mem0_sync(target_key, channel_id, timestamp DESC);
`)

const findSyncedMessage = syncDb
  .prepare('SELECT 1 FROM mem0_sync WHERE target_key = ? AND message_id = ?')
  .pluck()
const markSyncedMessage = syncDb.prepare(`
  INSERT INTO mem0_sync (
    target_key,
    message_id,
    event_id,
    status,
    channel_id,
    author_id,
    timestamp,
    synced_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(target_key, message_id) DO UPDATE SET
    event_id = excluded.event_id,
    status = excluded.status,
    channel_id = excluded.channel_id,
    author_id = excluded.author_id,
    timestamp = excluded.timestamp,
    synced_at = excluded.synced_at
`)

let before = endMs + 1
let scanned = 0
let submitted = 0
let skipped = 0
let failed = 0

try {
  while (scanned < max) {
    const limit = Math.min(batchSize, max - scanned)
    const rows = store.search({ channelId, before, after: startMs, limit }) as StoredHistoryMessage[]
    if (rows.length === 0) break

    for (const row of rows) {
      scanned++

      if (findSyncedMessage.get(targetKey, row.id)) {
        skipped++
        process.stdout.write(`\rscanned ${scanned}, submitted ${submitted}, skipped ${skipped}, failed ${failed}...`)
        if (scanned >= max) break
        continue
      }

      try {
        const response = await addMessageToMem0(row)
        if (response) {
          markSyncedMessage.run(
            targetKey,
            row.id,
            response.event_id ?? null,
            response.status ?? 'SUBMITTED',
            row.channelId,
            row.authorId,
            row.timestamp,
            Date.now(),
          )
          submitted++
        } else {
          skipped++
        }
      } catch (error) {
        failed++
        process.stderr.write(`\nfailed message ${row.id}: ${String(error)}\n`)
      }

      process.stdout.write(`\rscanned ${scanned}, submitted ${submitted}, skipped ${skipped}, failed ${failed}...`)
      if (scanned >= max) break
    }

    const oldest = rows[rows.length - 1]
    before = oldest.timestamp
    if (rows.length < limit) break
  }
} finally {
  store.close()
  syncDb.close()
}

console.log(`\nDone. Scanned ${scanned}, submitted ${submitted}, skipped ${skipped}, failed ${failed}.`)
