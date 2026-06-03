import { Agent, run, tool } from '@openai/agents'
import { z } from 'zod'
import { definePlugin, loadPersona, type DadidaMessage, type DadidaContext, type Classification, type PolicyDecision } from 'dadida'

const MAX_MUTE_DURATION_SECONDS = 604800 // 7 days

interface ModeratorOptions {
  escalationChannelId?: string
  mention?: string
  maxMuteDurationSeconds?: number
}

const moderationSchema = z.object({
  is_violation: z.boolean(),
  action: z.enum(['none', 'warn', 'mute', 'mute_and_escalate']),
  mute_duration_minutes: z.number().optional(),
  reason: z.string(),
})

const moderatorPersona = loadPersona('./instructions/moderator.md')

const moderationAgent = new Agent({
  name: 'moderator',
  model: process.env.MODEL_ID,
  instructions: moderatorPersona,
  outputType: moderationSchema,
})

const warningAgent = new Agent({
  name: 'moderator-voice',
  model: process.env.MODEL_ID,
  instructions: moderatorPersona,
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

        const deleteMessageTool = tool({
          name: 'delete_message',
          description: 'Permanently remove the offending message from the channel.',
          parameters: z.object({}),
          execute: async () => {
            await ctx.platform.deleteMessage(message.channelId, message.id)
            return 'Message deleted.'
          },
        })

        const muteResponseAgent = new Agent({
          name: 'moderator-voice',
          model: process.env.MODEL_ID,
          instructions: moderatorPersona,
          tools: [deleteMessageTool],
        })

        const result = await run(
          muteResponseAgent,
          `A user just said: "${message.content}"\n\nThey are being muted for ${durationLabel}. Reason: ${decision.data?.reason}\n\nWrite a brief in-character warning, then call delete_message to remove their message.`
        )
        if (result.finalOutput) {
          await ctx.platform.sendMessage(message.channelId, result.finalOutput)
        }

        if (decision.action === 'mute_and_escalate') {
          if (options.escalationChannelId) {
            const escalateMsg = `${options.mention ? `${options.mention} ` : ''}⚠️ User <@${message.authorId}> needs review.\nReason: ${decision.data?.reason}\nMessage: "${message.content}"`
            await ctx.platform.sendMessage(options.escalationChannelId, escalateMsg)
          }
          ctx.logger.info('Escalated to admins', { userId: message.authorId })
        }
      }
    },
  })
}
