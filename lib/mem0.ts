import type { DadidaMessage } from 'dadida'

const MEM0_BASE_URL = process.env.MEM0_BASE_URL ?? 'https://api.mem0.ai'
const MEM0_APP_ID = process.env.MEM0_APP_ID ?? 'dadida-starter'
const MEM0_AGENT_ID = process.env.MEM0_AGENT_ID ?? 'investor-persona'

export interface StoredHistoryMessage {
  id: string
  content: string
  authorId: string
  authorName?: string
  channelId: string
  platform: string
  timestamp: number
}

export interface Mem0SearchOptions {
  query: string
  authorId?: string
  channelId?: string
  limit?: number
}

export interface Mem0MemoryResult {
  id: string
  memory: string
  score?: number
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

interface Mem0SearchResponse {
  results?: Mem0MemoryResult[]
}

export interface Mem0AddResponse {
  message?: string
  status?: string
  event_id?: string
}

function getApiKey(): string | undefined {
  return process.env.MEM0_API_KEY
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toUnixSeconds(timestamp: number): number {
  return Math.floor(timestamp / 1000)
}

function formatMemoryContent(message: StoredHistoryMessage): string {
  return [
    `timestamp: ${new Date(message.timestamp).toISOString()}`,
    `authorName: ${message.authorName ?? ''}`,
    `authorId: ${message.authorId}`,
    `channelId: ${message.channelId}`,
    `content: ${message.content}`,
  ].join('\n')
}

async function mem0Request<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('MEM0_API_KEY is not set')

  const response = await fetch(`${MEM0_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`Mem0 request failed: ${response.status} ${response.statusText} ${text}`)
  }

  return response.json() as Promise<T>
}

export function isMem0Enabled(): boolean {
  return Boolean(getApiKey())
}

export function getMem0TargetKey(): string {
  return [MEM0_BASE_URL, MEM0_APP_ID, MEM0_AGENT_ID].join('|')
}

export function messageToStoredHistoryMessage(message: DadidaMessage): StoredHistoryMessage {
  const messageWithAuthorName = message as DadidaMessage & { authorName?: string }

  return {
    id: message.id,
    content: message.content,
    authorId: message.authorId,
    authorName: messageWithAuthorName.authorName,
    channelId: message.channelId,
    platform: message.platform,
    timestamp: message.timestamp.getTime(),
  }
}

export async function addMessageToMem0(message: StoredHistoryMessage): Promise<Mem0AddResponse | undefined> {
  if (!isMem0Enabled()) return undefined
  if (!message.content.trim()) return undefined

  return mem0Request<Mem0AddResponse>('/v3/memories/add/', {
    app_id: MEM0_APP_ID,
    agent_id: MEM0_AGENT_ID,
    user_id: message.authorId,
    run_id: message.channelId,
    infer: false,
    timestamp: toUnixSeconds(message.timestamp),
    messages: [
      {
        role: 'user',
        content: formatMemoryContent(message),
      },
    ],
    metadata: {
      source: 'discord',
      messageId: message.id,
      authorId: message.authorId,
      authorName: message.authorName ?? '',
      channelId: message.channelId,
      platform: message.platform,
      timestamp: message.timestamp,
      timestampIso: new Date(message.timestamp).toISOString(),
    },
  })
}

export async function searchMem0(options: Mem0SearchOptions): Promise<Mem0MemoryResult[]> {
  if (!isMem0Enabled()) return []

  const filters: Record<string, unknown> = {
    app_id: MEM0_APP_ID,
  }

  if (options.authorId) filters.user_id = options.authorId
  if (options.channelId) filters.run_id = options.channelId

  const response = await mem0Request<Mem0SearchResponse>('/v3/memories/search/', {
    query: options.query,
    filters,
    top_k: options.limit ?? 10,
    rerank: process.env.MEM0_RERANK !== 'false',
  })

  return response.results?.filter(isRecord) as Mem0MemoryResult[] ?? []
}
