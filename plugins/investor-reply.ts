import { readdirSync } from 'node:fs'
import { Agent, run, tool, webSearchTool } from '@openai/agents'
import { z } from 'zod'
import { definePlugin, loadPersona, loadKnowledge, SqliteMessageStore, type PolicyDecision, type Classification, type DadidaMessage, type DadidaContext } from 'dadida'
import { searchMem0, type Mem0MemoryResult } from '../lib/mem0.js'

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.75')

const personaFiles = readdirSync('./personas/').filter((f) => f.endsWith('.md')).sort()
const instructions = [
  ...personaFiles.map((f) => loadPersona(`./personas/${f}`)),
  loadKnowledge('./knowledge/'),
].join('\n\n')

const DEFAULT_HISTORY_SEARCH_MAX_ATTEMPTS = 3
const MAX_HISTORY_RESULTS_FOR_AGENT = 20
const MAX_FTS_TERM_LENGTH = 64

type UnknownRecord = Record<string, unknown>
type HistorySearchResult = ReturnType<SqliteMessageStore['search']>[number] & {
  authorName?: string
}
type HistoryCandidate = {
  id: string
  source: 'SQLite' | 'Mem0'
  timestamp: number
  text: string
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function parseJsonArgument(value: unknown): unknown {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function isFtsQueryError(error: unknown): boolean {
  return (
    isRecord(error) &&
    error.code === 'SQLITE_ERROR' &&
    typeof error.message === 'string' &&
    (error.message.includes('fts5') || error.message.includes('syntax error'))
  )
}

function getToolCallId(toolCall: unknown): string | undefined {
  if (!isRecord(toolCall)) return undefined

  if (typeof toolCall.callId === 'string') return toolCall.callId
  if (typeof toolCall.id === 'string') return toolCall.id

  return undefined
}

function getToolArguments(toolCall: unknown): unknown {
  if (!isRecord(toolCall)) return undefined
  return parseJsonArgument(toolCall.arguments)
}

function countHistoryResults(result: string): number {
  if (result === 'No messages found.') return 0
  return result.split('\n').filter(Boolean).length
}

function escapeFtsPhrase(term: string): string {
  return `"${term.replaceAll('"', '""')}"`
}

function getQueryTerms(query: string): string[] {
  return [...new Set(
    query
      .trim()
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 0 && term.length <= MAX_FTS_TERM_LENGTH)
  )]
}

function buildRelaxedHistoryQueries(query: string, maxAttempts: number): string[] {
  const terms = getQueryTerms(query)
  if (terms.length === 0) return []

  const quotedTerms = terms.map(escapeFtsPhrase)
  const attempts = [
    query,
    quotedTerms.join(' AND '),
    quotedTerms.join(' OR '),
  ]

  for (let count = terms.length - 1; count >= 1; count--) {
    attempts.push(quotedTerms.slice(0, count).join(' OR '))
  }

  for (const term of quotedTerms) {
    attempts.push(term)
  }

  return [...new Set(attempts)].slice(0, maxAttempts)
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  return value ?? undefined
}

function getMetadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

function getMetadataTimestamp(metadata: Record<string, unknown> | undefined): number | undefined {
  const timestamp = metadata?.timestamp
  if (typeof timestamp === 'number') return timestamp

  const timestampIso = getMetadataString(metadata, 'timestampIso')
  if (timestampIso) {
    const parsed = Date.parse(timestampIso)
    if (!Number.isNaN(parsed)) return parsed
  }

  return undefined
}

function getMem0MessageId(result: Mem0MemoryResult): string | undefined {
  const messageId = result.metadata?.messageId
  return typeof messageId === 'string' ? messageId : undefined
}

function getMem0Timestamp(result: Mem0MemoryResult): number {
  const metadataTimestamp = getMetadataTimestamp(result.metadata)
  if (metadataTimestamp !== undefined) return metadataTimestamp

  const createdAt = result.created_at ? Date.parse(result.created_at) : NaN
  return Number.isNaN(createdAt) ? 0 : createdAt
}

function getMem0Content(result: Mem0MemoryResult): string {
  const contentLine = result.memory
    .split('\n')
    .find((line) => line.startsWith('content: '))

  return (contentLine?.slice('content: '.length) ?? result.memory).replace(/\s+/g, ' ').trim()
}

function toSqliteCandidate(result: HistorySearchResult): HistoryCandidate {
  return {
    id: result.id,
    source: 'SQLite',
    timestamp: result.timestamp,
    text: `[${new Date(result.timestamp).toISOString()}] ${result.authorName ?? ''} <${result.authorId}>: ${result.content}`,
  }
}

function toMem0Candidate(result: Mem0MemoryResult): HistoryCandidate {
  const timestamp = getMem0Timestamp(result)
  const authorName = getMetadataString(result.metadata, 'authorName') ?? ''
  const authorId = getMetadataString(result.metadata, 'authorId') ?? ''
  const score = typeof result.score === 'number' ? ` score=${result.score.toFixed(3)}` : ''

  return {
    id: getMem0MessageId(result) ?? result.id,
    source: 'Mem0',
    timestamp,
    text: `[${new Date(timestamp).toISOString()}] ${authorName} <${authorId}>: ${getMem0Content(result)} [Mem0${score}]`,
  }
}

function formatHybridHistoryResults(sqliteResults: HistorySearchResult[], mem0Results: Mem0MemoryResult[]): string {
  const seenIds = new Set<string>()
  const candidates: HistoryCandidate[] = []

  for (const result of sqliteResults) {
    const candidate = toSqliteCandidate(result)
    seenIds.add(candidate.id)
    candidates.push(candidate)
  }

  for (const result of mem0Results) {
    const candidate = toMem0Candidate(result)
    if (seenIds.has(candidate.id)) continue

    seenIds.add(candidate.id)
    candidates.push(candidate)
  }

  const limited = candidates
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_HISTORY_RESULTS_FOR_AGENT)

  if (limited.length === 0) return 'No messages found.'

  return limited
    .map((candidate) => `${candidate.text} [${candidate.source}]`)
    .join('\n')
}

function dedupeMem0Results(results: Mem0MemoryResult[], existingMessageIds: Set<string>, limit: number): Mem0MemoryResult[] {
  const seenMem0Ids = new Set<string>()
  const deduped: Mem0MemoryResult[] = []

  for (const result of results) {
    const messageId = getMem0MessageId(result)
    if (messageId && existingMessageIds.has(messageId)) continue
    if (seenMem0Ids.has(result.id)) continue

    seenMem0Ids.add(result.id)
    deduped.push(result)
    if (deduped.length >= limit) break
  }

  return deduped
}

function createRelaxedHistoryTool(store: SqliteMessageStore, ctx: DadidaContext, message: DadidaMessage) {
  return tool({
    name: 'search_history',
    description: 'Search message history in this community. Results include ISO timestamps and are returned newest first. Use this to find past discussions, prior trades, what a user said, and the latest relevant record on a topic. This tool combines relaxed SQLite keyword search with Mem0 semantic search when MEM0_API_KEY is configured, then returns merged candidates for relevance review.',
    parameters: z.object({
      query: z.string().optional().nullable().describe('Full-text search query (keywords)'),
      authorId: z.string().optional().nullable().describe('Filter by user ID'),
      channelId: z.string().optional().nullable().describe('Filter by channel ID'),
      limit: z.number().optional().nullable().describe(
        'Max results, default 20 and hard-capped at 20. Results are returned newest first by timestamp DESC.'
      ),
      maxAttempts: z.number().optional().nullable().describe('Maximum SQLite relaxed query attempts, default 3. Stops immediately when a SQLite attempt returns results.'),
    }),
    execute: async (params) => {
      const requestedLimit = params.limit ?? MAX_HISTORY_RESULTS_FOR_AGENT
      const limit = Math.min(MAX_HISTORY_RESULTS_FOR_AGENT, Math.max(1, requestedLimit))
      const maxAttempts = Math.min(DEFAULT_HISTORY_SEARCH_MAX_ATTEMPTS, Math.max(1, params.maxAttempts ?? DEFAULT_HISTORY_SEARCH_MAX_ATTEMPTS))
      const queryAttempts = params.query
        ? buildRelaxedHistoryQueries(params.query, maxAttempts)
        : [undefined]

      let sqliteResults: HistorySearchResult[] = []

      for (const [index, query] of queryAttempts.entries()) {
        let results: HistorySearchResult[]

        try {
          results = store.search({
            query,
            authorId: normalizeOptionalString(params.authorId),
            channelId: normalizeOptionalString(params.channelId),
            limit,
          }) as HistorySearchResult[]
        } catch (error) {
          if (!isFtsQueryError(error)) throw error

          ctx.logger.warn('search_history attempt failed', {
            messageId: message.id,
            attempt: index + 1,
            maxAttempts: queryAttempts.length,
            query,
            error: String(error),
          })
          continue
        }

        ctx.logger.info('search_history attempt result', {
          messageId: message.id,
          attempt: index + 1,
          maxAttempts: queryAttempts.length,
          query,
          resultCount: results.length,
        })

        if (results.length > 0) {
          sqliteResults = results
          break
        }
      }

      let mem0Results: Mem0MemoryResult[] = []

      if (params.query) {
        try {
          const existingMessageIds = new Set(sqliteResults.map((result) => result.id))
          const rawMem0Results = await searchMem0({
            query: params.query,
            authorId: normalizeOptionalString(params.authorId),
            channelId: normalizeOptionalString(params.channelId),
            limit,
          })
          mem0Results = dedupeMem0Results(rawMem0Results, existingMessageIds, limit)

          ctx.logger.info('search_history mem0 result', {
            messageId: message.id,
            query: params.query,
            resultCount: rawMem0Results.length,
            dedupedResultCount: mem0Results.length,
          })
        } catch (error) {
          ctx.logger.warn('search_history mem0 failed', {
            messageId: message.id,
            query: params.query,
            error: String(error),
          })
        }
      }

      return formatHybridHistoryResults(sqliteResults, mem0Results)
    },
  })
}

function logSearchHistoryUse(agent: Agent, message: DadidaMessage, ctx: DadidaContext): void {
  agent.on('agent_tool_start', (_runContext, tool, details) => {
    if (tool.name !== 'search_history') return

    ctx.logger.info('Agent selected search_history tool', {
      messageId: message.id,
      toolName: tool.name,
      toolCallId: getToolCallId(details.toolCall),
      toolArguments: getToolArguments(details.toolCall),
    })
  })

  agent.on('agent_tool_end', (_runContext, tool, result, details) => {
    if (tool.name !== 'search_history') return

    ctx.logger.info('Agent search_history result', {
      messageId: message.id,
      toolName: tool.name,
      toolCallId: getToolCallId(details.toolCall),
      resultCount: countHistoryResults(result),
      result,
    })
  })
}

function logWebSearchUse(result: { newItems: unknown[] }, message: DadidaMessage, ctx: DadidaContext): void {
  for (const item of result.newItems) {
    if (!isRecord(item) || item.type !== 'tool_call_item') continue

    const rawItem = item.rawItem
    if (!isRecord(rawItem) || rawItem.type !== 'hosted_tool_call') continue

    const providerData = isRecord(rawItem.providerData) ? rawItem.providerData : {}
    const providerType = typeof providerData.type === 'string' ? providerData.type : undefined
    const toolName = typeof rawItem.name === 'string' ? rawItem.name : undefined
    const isWebSearch =
      providerType === 'web_search_call' ||
      providerType === 'web_search' ||
      toolName === 'web_search_call' ||
      toolName === 'web_search'

    if (!isWebSearch) continue

    ctx.logger.info('Agent selected web_search tool', {
      messageId: message.id,
      toolName: toolName ?? 'web_search',
      toolCallId: getToolCallId(rawItem),
      status: typeof rawItem.status === 'string' ? rawItem.status : undefined,
      action: providerData.action,
      toolArguments: parseJsonArgument(rawItem.arguments),
    })
  }
}

export function investorReply(): ReturnType<typeof definePlugin> {
  return definePlugin({
    name: 'investor-reply',
    async policy(classifications: Record<string, Classification>): Promise<PolicyDecision> {
      const c = classifications['investing-classifier'] ?? {}
      const isInvesting = c.is_investing_related === true
      const confidence = typeof c.confidence === 'number' ? c.confidence : 0

      if (!isInvesting || confidence < CONFIDENCE_THRESHOLD) {
        return { shouldAct: false }
      }

      return {
        shouldAct: true,
        action: 'reply',
      }
    },

    async action(decision: PolicyDecision, message: DadidaMessage, ctx: DadidaContext): Promise<void> {
      if (decision.action !== 'reply') return

      const store = ctx.get<SqliteMessageStore>('store')
      const tools = [
        webSearchTool(),
        ...(store ? [createRelaxedHistoryTool(store, ctx, message)] : []),
      ]

      const responderAgent = new Agent({
        name: 'investor-persona',
        model: process.env.MODEL_ID,
        instructions,
        tools,
      })
      logSearchHistoryUse(responderAgent, message, ctx)

      const recentContext = ctx.recentMessages
        .slice(-MAX_HISTORY_RESULTS_FOR_AGENT)
        .map((m) => `${m.authorName} <${m.authorId}>: ${m.content}`)
        .join('\n')

      const reason = (ctx.classifications['investing-classifier']?.reason as string) ?? ''
      const input = [
        recentContext ? `# Recent conversation\n${recentContext}` : '',
        `[Classification: ${reason}]`,
        `User message: ${message.content}`,
      ].filter(Boolean).join('\n\n')

      const result = await run(responderAgent, input)
      logWebSearchUse(result, message, ctx)

      const replyText = result.finalOutput
      if (!replyText) {
        ctx.logger.warn('Responder returned no output', { messageId: message.id })
        return
      }

      await ctx.platform.reply(message.channelId, message.id, replyText)
      ctx.logger.info('Replied to message', {
        messageId: message.id,
        reply: replyText,
      })
    },
  })
}
