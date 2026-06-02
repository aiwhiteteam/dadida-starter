import { Agent, run } from '@openai/agents'
import { z } from 'zod'
import { definePlugin, loadPersona, type DadidaMessage, type DadidaContext, type Classification, type PolicyDecision } from 'dadida'

const MAX_MUTE_DURATION_SECONDS = 604800 // 7 days

interface EscalateTarget {
  channelId: string
  mention?: string
}

interface ModeratorOptions {
  escalateMap?: Record<string, EscalateTarget>
  maxMuteDurationSeconds?: number
}

const moderationSchema = z.object({
  is_violation: z.boolean(),
  action: z.enum(['none', 'warn', 'mute', 'mute_and_escalate']),
  mute_duration_minutes: z.number().optional(),
  reason: z.string(),
})

const moderationAgent = new Agent({
  name: 'moderator',
  instructions: loadPersona('./personas/moderator.md'),
  outputType: moderationSchema,
})

const warningAgent = new Agent({
  name: 'moderator-voice',
  instructions: loadPersona('./personas/moderator.md'),
})

export function moderator(options: ModeratorOptions = {}): ReturnType<typeof definePlugin> {
  const maxMute = options.maxMuteDurationSeconds ?? MAX_MUTE_DURATION_SECONDS

  return definePlugin({
    name: 'moderator',

    async classify(message: DadidaMessage, ctx: DadidaContext): Promise<Classification> {
      const result = await run(moderationAgent, message.content)
      const output = result.finalOutput
      if (!output) return { is_violation: false, action: 'none', reason: '' }
      ctx.logger.info('Moderation result', { messageId: message.id, ...output })
      return output
    },

    async policy(classifications: Record<string, Classification>, message: DadidaMessage): Promise<PolicyDecision> {
      const c = classifications['moderator'] ?? {}
      if (!c.is_violation || c.action === 'none') {
        return { shouldAct: false }
      }

      const muteDuration = c.mute_duration_minutes
        ? Math.min(c.mute_duration_minutes * 60, maxMute)
        : undefined

      return {
        shouldAct: true,
        action: c.action as string,
        data: { reason: c.reason, muteDuration },
      }
    },

    async action(decision: PolicyDecision, message: DadidaMessage, ctx: DadidaContext): Promise<void> {
      if (decision.action === 'warn') {
        const result = await run(warningAgent, `A user just said: "${message.content}"\n\nGive them a brief, in-character warning. Reason: ${decision.data?.reason}`)
        if (result.finalOutput) {
          await ctx.platform.reply(message.channelId, message.id, result.finalOutput)
        }
      }

      if (decision.action === 'mute' || decision.action === 'mute_and_escalate') {
        const duration = (decision.data?.muteDuration as number) ?? maxMute

        try {
          await ctx.platform.mute(message.channelId, message.authorId, duration, decision.data?.reason as string)
        } catch (error) {
          ctx.logger.error('Mute failed, skipping announcement', { userId: message.authorId, error: String(error) })
          return
        }
        ctx.logger.info('Muted user', { userId: message.authorId, duration })

        const durationLabel = duration >= 86400 ? `${Math.round(duration / 86400)} days` : `${Math.round(duration / 60)} minutes`
        const result = await run(warningAgent, `A user just said: "${message.content}"\n\nThey are being muted for ${durationLabel}. Tell them briefly. Reason: ${decision.data?.reason}`)
        if (result.finalOutput) {
          await ctx.platform.reply(message.channelId, message.id, result.finalOutput)
        }

        if (decision.action === 'mute_and_escalate') {
          const target = options.escalateMap?.[message.channelId]
          if (target) {
            const escalateMsg = `${target.mention ? `${target.mention} ` : ''}⚠️ User <@${message.authorId}> needs review.\nReason: ${decision.data?.reason}\nMessage: "${message.content}"`
            await ctx.platform.sendMessage(target.channelId, escalateMsg)
          }
          ctx.logger.info('Escalated to admins', { userId: message.authorId })
        }
      }
    },
  })
}
