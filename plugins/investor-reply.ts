import { Agent, run } from '@openai/agents'
import { definePlugin, loadPersona, loadKnowledge, createHistoryTool, type PolicyDecision, type Classification, type DadidaMessage, type DadidaContext } from 'dadida'

const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || '0.75')

const instructions = [
  loadPersona('./personas/identity.md'),
  loadPersona('./personas/soul.md'),
  '# Knowledge Base',
  loadKnowledge('./knowledge/'),
].join('\n\n')

export function investorReply(): ReturnType<typeof definePlugin> {
  return definePlugin({
    name: 'investor-reply',
    async policy(classification: Classification): Promise<PolicyDecision> {
      const isInvesting = classification.is_investing_related === true
      const confidence = typeof classification.confidence === 'number' ? classification.confidence : 0

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

      const tools = ctx.store ? [createHistoryTool(ctx.store)] : []

      const responderAgent = new Agent({
        name: 'investor-persona',
        model: 'gpt-4.1-mini',
        instructions,
        tools,
      })

      const recentContext = ctx.recentMessages
        .map((m) => `<${m.authorId}>: ${m.content}`)
        .join('\n')

      const reason = ctx.classifications.reason ?? ''
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
