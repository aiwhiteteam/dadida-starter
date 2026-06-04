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

Deploy to **Railway**, which builds with Nixpacks (no Dockerfile needed):

1. Fork this repo
2. Create a Railway project → connect your repo
3. Set environment variables (see `.env.example` — at minimum `DISCORD_TOKEN`
   and `OPENAI_API_KEY`). Env vars are injected by Railway, so no `.env` file is
   needed — `npm start` uses `--env-file-if-exists` and skips it when absent.
4. Railway auto-detects (Nixpacks) and runs:
   - Build: `npm run build`
   - Start: `npm start`
5. Deploy — Railway runs it as a worker process and monitors process health
   directly (no health check needed).
6. Keep the service at **1 replica** (a second instance would duplicate the
   gateway connection and double-reply).

### Persisting history

The bot stores message history in a SQLite file at `./data/messages.db`, which
powers conversation context and the `search_history` tool. Railway's filesystem is
**ephemeral and wiped on every redeploy** — the bot still runs, it just starts each
deploy with an empty memory. To keep history across restarts, attach a volume:

1. Open the project and select your bot service.
2. Right-click the service → **Attach Volume** (or **Settings → Volumes → Add Volume**).
3. Set the **mount path** to `/app/data` and create it — Railway redeploys with the
   volume attached.
4. Keep the service at **1 replica** (volumes can't attach to multi-replica services).

## Backfill history

By default the bot only records messages it receives **while running**. To load a
channel's existing history into the store (so `recentMessages` and `search_history`
can see it), run the backfill script:

```bash
npm run build
npm run backfill -- <channelId> [--start <ISO>] [--end <ISO>] [--max <n>]
```

- `--start` / `--end` — only messages in this time range (ISO dates, e.g.
  `2025-01-01` or `2025-01-01T00:00:00Z`). Default: from the beginning up to now.
- `--max` — cap how many messages to scan (safety limit).
- Uses `DISCORD_TOKEN` (same bot — needs **Read Message History** + the **Message
  Content Intent**) and writes to the same `./data/messages.db`.

It's **idempotent** (keyed on the Discord message id, so re-running never
duplicates) and each message keeps its **original timestamp**, not the time of the
backfill. Tip: overlap the window with when the bot went live — dedup handles the
overlap, so you get no gaps and no duplicates.

> You pass **ISO dates** for `--start` / `--end`; the script converts them to
> Discord snowflakes internally, so you never compute snowflakes by hand.

### Finding the channel ID (snowflake)

The `<channelId>` is a Discord snowflake. To copy it:

1. Discord → **Settings → Advanced → Developer Mode** (turn on).
2. Right-click the channel in the sidebar → **Copy Channel ID**.

(Same trick on a message → **Copy Message ID** if you ever need a specific
message's snowflake; note its creation time is encoded in the id.)

## Mem0 semantic history

Set `MEM0_API_KEY` in `.env` to enable a parallel Mem0 semantic memory layer:

```bash
MEM0_API_KEY=...
```

When enabled, new Discord messages are written to both SQLite and Mem0. The
`search_history` tool then returns merged candidates from relaxed SQLite keyword
search and Mem0 semantic search. SQLite remains the source of truth for raw
message history.

To backfill existing SQLite history into Mem0:

```bash
npm run build
npm run mem0:backfill -- [--channel <channelId>] [--start <ISO>] [--end <ISO>] [--max <n>] [--batch <n>]
```

- `--channel` — only process SQLite rows from this Discord channel. By default,
  all channels in `./data/messages.db` are processed.
- `--start` / `--end` — only messages in this time range.
- `--max` — cap how many SQLite rows to process.
- `--batch` — SQLite page size, default 100.

Mem0 backfill is idempotent at the script layer. Successful submissions are
recorded in a local `mem0_sync` table inside `./data/messages.db`, scoped by the
Mem0 base URL, app ID, agent ID, and Discord message ID. Re-running the same
range skips rows that were already submitted to the same Mem0 target.
Mem0's add API processes memories asynchronously, so the ledger records accepted
submissions rather than waiting for final memory extraction completion.

Optional Mem0 env vars:

- `MEM0_APP_ID` — default `dadida-starter`.
- `MEM0_AGENT_ID` — default `investor-persona`.
- `MEM0_RERANK=false` — disable Mem0 reranking.
- `MEM0_BASE_URL` — default `https://api.mem0.ai`.

### Running the backfill on Railway

Run it **inside the deployed service** so it writes to the mounted volume — running
it on your laptop would write to your local `./data`, not the Railway volume.

```bash
npm i -g @railway/cli      # once
railway login              # once
railway link               # select your project + service
railway ssh                # shell into the running container
# now inside the container:
npm run backfill -- <channelId> --start 2025-01-01
```

`dist/backfill.js` is already built during the Railway deploy, and `DISCORD_TOKEN`
is already in the service environment, so the command above just works.

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
└── .env.example
```
