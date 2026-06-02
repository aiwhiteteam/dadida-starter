# Dadida Starter

A ready-to-deploy AI persona bot for Discord, built on [Dadida](https://github.com/aiwhiteteam/dadida).

## Quick Start

```bash
git clone https://github.com/aiwhiteteam/dadida-starter my-bot
cd my-bot
npm install
cp .env.example .env   # fill in your tokens
```

## Connect to Discord

The bot connects over the Discord **Gateway (WebSocket)** — an outbound, long-lived
connection. You don't need a public URL, webhook, or ngrok; it runs fine from your
laptop or any host behind NAT.

1. **Create the bot.** Go to the [Discord Developer Portal](https://discord.com/developers/applications)
   → **New Application** → **Bot** (left sidebar) → **Reset Token**, then copy the
   token into `DISCORD_TOKEN` in your `.env`.
2. **Enable the Message Content Intent (required).** On the same Bot page, under
   **Privileged Gateway Intents**, turn on **MESSAGE CONTENT INTENT**.
   > ⚠️ Without this, incoming message `content` arrives empty and the
   > classifier/responder have nothing to work with.
3. **Invite the bot to your server.** Go to **OAuth2 → URL Generator** → check the
   `bot` scope → under **Bot Permissions** check `Send Messages` and
   `Read Message History` (add `Moderate Members` if you want warn/mute/kick) →
   open the generated URL in a browser and authorize it for your server.
4. **(Optional) Get a channel ID.** In the Discord client, enable
   **Settings → Advanced → Developer Mode**, then right-click a channel → **Copy ID**
   and put it in `GENERAL_CHANNEL_ID`. Leave it empty to listen to all channels.
5. **Run it.** `npm run dev` — the bot is connected once it shows up online in your
   server.

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
