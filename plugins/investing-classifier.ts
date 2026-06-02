import { Agent, run } from '@openai/agents'
import { z } from 'zod'
import { definePlugin, loadPersona, type DadidaMessage, type DadidaContext, type Classification } from 'dadida'

const classificationSchema = z.object({
  is_investing_related: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
})

const classifierAgent = new Agent({
  name: 'investing-classifier',
  instructions: loadPersona('./instructions/classifier.md'),
  outputType: classificationSchema,
})

export function investingClassifier(): ReturnType<typeof definePlugin> {
  return definePlugin({
    name: 'investing-classifier',
    async classify(message: DadidaMessage, ctx: DadidaContext): Promise<Classification> {
      const result = await run(classifierAgent, message.content)
      const output = result.finalOutput
      if (!output) {
        ctx.logger.warn('Classifier returned no output', { messageId: message.id })
        return { is_investing_related: false, confidence: 0, reason: 'no output' }
      }
      ctx.logger.info('Classification result', {
        messageId: message.id,
        ...output,
      })
      return output
    },
  })
}
