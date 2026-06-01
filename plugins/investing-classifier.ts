import { Agent, run } from '@openai/agents'
import { z } from 'zod'
import { definePlugin, type DadidaMessage, type DadidaContext, type Classification } from 'dadida'

const classificationSchema = z.object({
  is_investing_related: z.boolean(),
  confidence: z.number(),
  reason: z.string(),
})

const classifierAgent = new Agent({
  name: 'investing-classifier',
  instructions: `You are a strict classifier for a Discord community.

Your task is to determine whether a user's message is related to trading and investment.

Trading & investment topics include:
- stocks, equities, options, futures, derivatives
- crypto trading, DeFi, token analysis
- technical analysis, chart patterns, indicators
- fundamental analysis, valuations, P/E ratios, earnings
- portfolio strategy, asset allocation, risk management
- market commentary, bull/bear sentiment
- ETFs, index funds, sector rotation
- IPOs, SPACs, M&A from an investment angle
- real estate investing, REITs
- macro trends that impact trading decisions

NOT trading & investment (ignore these):
- personal budgeting, saving tips
- banking, credit cards, loans, mortgages
- insurance, accounting, taxes
- general business news without a trading angle
- career or salary questions

The message may be in English, Chinese, or mixed English and Chinese.

Return only your classification. Do not write a reply to the user.`,
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
