import { definePlugin, type DadidaContext, type DadidaMessage } from 'dadida'
import { addMessageToMem0, isMem0Enabled, messageToStoredHistoryMessage } from '../lib/mem0.js'

export function mem0Store(): ReturnType<typeof definePlugin> {
  return definePlugin({
    name: 'mem0-store',
    async filter(message: DadidaMessage, ctx: DadidaContext): Promise<void> {
      if (!isMem0Enabled()) return

      try {
        await addMessageToMem0(messageToStoredHistoryMessage(message))
      } catch (error) {
        ctx.logger.warn('Mem0 store failed', {
          messageId: message.id,
          error: String(error),
        })
      }
    },
  })
}
