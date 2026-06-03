import { readdirSync } from 'node:fs'
import { Agent, run, webSearchTool } from '@openai/agents'
import { definePlugin, loadPersona, loadKnowledge, createHistoryTool, SqliteMessageStore, type PolicyDecision, type Classification, type DadidaMessage, type DadidaContext } from 'dadida'

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.75')

const personaFiles = readdirSync('./personas/').filter((f) => f.endsWith('.md')).sort()
const instructions = [
  ...personaFiles.map((f) => loadPersona(`./personas/${f}`)),
  loadKnowledge('./knowledge/'),
].join('\n\n')

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
        ...(store ? [createHistoryTool(store)] : []),
      ]

      const responderAgent = new Agent({
        name: 'investor-persona',
        model: process.env.MODEL_ID,
        instructions,
        tools,
      })

      const recentContext = ctx.recentMessages
        .map((m) => `${m.authorName} <${m.authorId}>: ${m.content}`)
        .join('\n')

      const reason = (ctx.classifications['investing-classifier']?.reason as string) ?? ''
      const input = [
        recentContext ? `# Recent conversation\n${recentContext}` : '',
        `[Classification: ${reason}]`,
        `User message: ${message.content}`,
      ].filter(Boolean).join('\n\n')

      const result = await run(responderAgent, input)
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
