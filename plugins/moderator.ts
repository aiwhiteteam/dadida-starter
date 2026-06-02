import { Agent, run } from '@openai/agents'
import { z } from 'zod'
import { definePlugin, loadPersona, type DadidaMessage, type DadidaContext, type Classification, type PolicyDecision } from 'dadida'

const WARN_THRESHOLD = 2
const MUTE_THRESHOLD = 4
const MUTE_DURATION_SECONDS = 300
const ESCALATE_CHANNEL_ID = process.env.ESCALATE_CHANNEL_ID
const ESCALATE_MENTION = process.env.ESCALATE_MENTION

const warningCounts = new Map<string, number>()

const moderationSchema = z.object({
  is_violation: z.boolean(),
  severity: z.enum(['none', 'low', 'medium', 'high']),
  reason: z.string(),
})

const moderationAgent = new Agent({
  name: 'moderator',
  instructions: loadPersona('./personas/moderator-soul.md'),
  outputType: moderationSchema,
})

const warningAgent = new Agent({
  name: 'moderator-voice',
  instructions: loadPersona('./personas/moderator-soul.md'),
})

export function moderator(): ReturnType<typeof definePlugin> {
  return definePlugin({
    name: 'moderator',

    async classify(message: DadidaMessage, ctx: DadidaContext): Promise<Classification> {
      const result = await run(moderationAgent, message.content)
      const output = result.finalOutput
      if (!output) return { is_violation: false, severity: 'none', reason: '' }
      ctx.logger.info('Moderation result', { messageId: message.id, ...output })
      return output
    },

    async policy(classifications: Record<string, Classification>, message: DadidaMessage): Promise<PolicyDecision> {
      const c = classifications['moderator'] ?? {}
      if (!c.is_violation || c.severity === 'none') {
        return { shouldAct: false }
      }

      const count = (warningCounts.get(message.authorId) ?? 0) + 1
      warningCounts.set(message.authorId, count)

      if (count >= MUTE_THRESHOLD) {
        return { shouldAct: true, action: 'escalate', data: { count, severity: c.severity, reason: c.reason } }
      }
      if (count >= WARN_THRESHOLD) {
        return { shouldAct: true, action: 'mute', data: { count, duration: MUTE_DURATION_SECONDS } }
      }
      return { shouldAct: true, action: 'warn', data: { count } }
    },

    async action(decision: PolicyDecision, message: DadidaMessage, ctx: DadidaContext): Promise<void> {
      if (decision.action === 'warn') {
        const result = await run(warningAgent, `A user just said: "${message.content}"\n\nThis is warning #${decision.data?.count}. Give them a brief, in-character warning.`)
        if (result.finalOutput) {
          await ctx.platform.reply(message.channelId, message.id, result.finalOutput)
        }
      }

      if (decision.action === 'mute') {
        try {
          await ctx.platform.mute(message.channelId, message.authorId, MUTE_DURATION_SECONDS, 'Repeated violations')
        } catch (error) {
          ctx.logger.error('Mute failed, skipping announcement', { userId: message.authorId, error: String(error) })
          return
        }
        ctx.logger.info('Muted user', { userId: message.authorId, duration: MUTE_DURATION_SECONDS })

        const result = await run(warningAgent, `A user just said: "${message.content}"\n\nThis is their ${decision.data?.count}th violation. Tell them they're being muted. Be firm but not hostile.`)
        if (result.finalOutput) {
          await ctx.platform.reply(message.channelId, message.id, result.finalOutput)
        }
      }

      if (decision.action === 'escalate') {
        const escalateMsg = `⚠️ User <@${message.authorId}> needs review.\nViolation #${decision.data?.count} (${decision.data?.severity}): ${decision.data?.reason}\nMessage: "${message.content}"`

        if (ESCALATE_CHANNEL_ID) {
          await ctx.platform.sendMessage(ESCALATE_CHANNEL_ID, escalateMsg)
        } else if (ESCALATE_MENTION) {
          await ctx.platform.reply(message.channelId, message.id, `${ESCALATE_MENTION} ${escalateMsg}`)
        }
        ctx.logger.info('Escalated to admins', { userId: message.authorId })
      }
    },
  })
}
