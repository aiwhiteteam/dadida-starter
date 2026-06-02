# TODO

## Done

- **Web search for the investor persona** — `investor-reply.ts` now passes
  `webSearchTool()` to the responder agent, with usage rules in `personas/soul.md`
  (search only for fresh/time-sensitive facts).
- **Multiple channels** — `LISTEN_CHANNEL_IDS` accepts a comma-separated list
  (`123,456`); `index.ts` splits it into the platform `channels` array.

## Ideas

- Per-channel persona or threshold overrides.
- Tune `webSearchTool({ searchContextSize, userLocation })` for cost/latency.
