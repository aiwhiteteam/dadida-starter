# Dadida Starter

A ready-to-deploy AI persona bot for Discord, built on [Dadida](https://github.com/aiwhiteteam/dadida).

## Quick Start

```bash
git clone https://github.com/aiwhiteteam/dadida-starter my-bot
cd my-bot
npm install
cp .env.example .env   # fill in your tokens
```

## Development

```bash
npm run dev
```

## Production

```bash
npm run build
npm start
```

## Deploy to Railway

1. Fork this repo
2. Create a Railway project → connect your repo
3. Set environment variables (see `.env.example`)
4. Railway auto-detects `npm run build` + `npm start`

## Deploy to Fly.io

```bash
fly launch
fly secrets set DISCORD_TOKEN=xxx OPENAI_API_KEY=xxx GENERAL_CHANNEL_ID=xxx
fly deploy
```

## Customize

- **`personas/identity.md`** — who your persona is (name, role, vibe)
- **`personas/soul.md`** — how your persona behaves (voice, style, boundaries)
- **`knowledge/`** — domain knowledge your persona can reference
- **`plugins/`** — classifier, responder, moderator logic

## Structure

```
├── index.ts                 ← entry point
├── plugins/
│   ├── investing-classifier.ts   ← what topics to engage with
│   ├── investor-reply.ts         ← persona response logic
│   └── moderator.ts              ← warn / mute / escalate
├── personas/
│   ├── identity.md           ← the business card
│   ├── soul.md               ← the personality
│   └── moderator-soul.md     ← moderator personality
├── knowledge/
│   ├── trading-rules.md
│   └── current-views.md
├── Dockerfile
└── .env.example
```
