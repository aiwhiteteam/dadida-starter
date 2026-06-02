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
3. **Invite the bot to your server.** Go to **OAuth2 → URL Generator**.
   - Under **Scopes**, check **only `bot`** (ignore `identify`, `guilds`,
     `applications.commands`, etc. — you don't need them).
   - The moment you check `bot`, a **Bot Permissions** panel appears *below* the
     scopes list. Scroll down to it and check the permissions in the table below.
     (Scopes and Bot Permissions are two separate panels — the permissions checkboxes
     won't show up until `bot` is checked.)
   - These permissions get encoded into the invite URL, so set them *before* inviting.
     Copy the generated URL at the bottom, open it in a browser, and authorize it for
     your server.

   | Permission | Required? | Used for |
   |------------|-----------|----------|
   | `View Channels` | ✅ Yes | Receiving messages |
   | `Send Messages` | ✅ Yes | Replies and escalation messages |
   | `Read Message History` | ✅ Recommended | Conversation context / history tool |
   | `Moderate Members` | 🟡 Only for moderation | Timing out (muting) users |

   > `Moderate Members` is Discord's "timeout" permission, used by the moderator
   > plugin's mute action. To mute, the bot's role must also sit **above** the
   > members it manages (Server Settings → Roles). Skip it if you only want chat replies.
4. **(Optional) Get a channel ID.** In the Discord client, enable
   **Settings → Advanced → Developer Mode**, then right-click a channel → **Copy ID**
   and put it in `LISTEN_CHANNEL_IDS`. Leave it empty to listen to all channels.
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

## Deployment

The bot runs as a **long-lived worker process** (it holds a Discord WebSocket /
gateway connection). There is no HTTP server and no health-check endpoint — the
platform just needs to keep one process alive. Run **exactly one instance**: a
second instance would open a duplicate gateway connection and double-reply.

### Railway

1. Fork this repo
2. Create a Railway project → connect your repo
3. Set environment variables (see `.env.example` — at minimum `DISCORD_TOKEN`
   and `OPENAI_API_KEY`)
4. Railway auto-detects the build + start commands:
   - Build: `npm run build`
   - Start: `npm start`
5. Deploy — Railway runs it as a worker process and monitors process health
   directly (no health check needed).

### Fly.io

A `fly.toml` is included (no `[http_service]` block on purpose — this is a worker,
not a web app).

1. Create/link the app — this reads the bundled `fly.toml`:
   ```bash
   fly launch --no-deploy
   ```
2. Set environment variables as Fly secrets:
   ```bash
   fly secrets set DISCORD_TOKEN=xxx OPENAI_API_KEY=xxx LISTEN_CHANNEL_IDS=xxx
   ```
3. Deploy:
   ```bash
   fly deploy
   ```
4. Pin to a single instance (one gateway connection):
   ```bash
   fly scale count 1
   ```

### Any VPS / Docker host

1. Build the image:
   ```bash
   docker build -t dadida-bot .
   ```
2. Run it as a restarting background container, passing env vars with `-e`:
   ```bash
   docker run -d --restart unless-stopped \
     -e DISCORD_TOKEN=xxx \
     -e OPENAI_API_KEY=xxx \
     -e LISTEN_CHANNEL_IDS=xxx \
     dadida-bot
   ```

> In containers the env vars are injected by the platform / `-e` flags, so no `.env`
> file is needed — `npm start` uses `--env-file-if-exists` and simply skips it.

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
