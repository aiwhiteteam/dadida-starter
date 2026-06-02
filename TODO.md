# TODO

## Web search for the investor persona

Let the persona fetch real-time data (prices, news) via OpenAI's hosted
web search tool, instead of relying only on the static `knowledge/` files.

`@openai/agents` already exports `webSearchTool`, and `investor-reply.ts`
already passes a `tools` array to the `Agent`, so this is a small change:

```ts
import { Agent, run, webSearchTool } from '@openai/agents'

const tools = [
  webSearchTool(), // hosted web search (runs server-side via Responses API)
  ...(ctx.store ? [createHistoryTool(ctx.store)] : []),
]
```

Notes:
- Requires the Responses API (default for OpenAI models in the SDK) and a
  model that supports hosted search (e.g. `gpt-4.1-mini`).
- Adds cost + latency per reply. Constrain it in the persona instructions
  (e.g. "only search when you need real-time data").
- Options worth tuning: `webSearchTool({ searchContextSize, userLocation })`.
