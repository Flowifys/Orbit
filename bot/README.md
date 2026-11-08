# Orbit Bots

Build bots for Orbit the same way you would for other chat apps: create a bot
account, get a token, connect to the gateway, and respond to events.

## 1. Create a bot

In Orbit, open **Settings → Developer / Bots → New Bot**. Give it a name and
you'll get a **token** (shown once) and a **Bot ID**.

- The **token** looks like `<botId>.<secret>` — keep it secret. Anyone with it
  can act as your bot. Lost it or leaked it? Regenerate it (the old one dies).
- The **Bot ID** is public — it's how you add the bot to servers.

## 2. Add the bot to a server

In a server you manage, open **Server Settings → Bots**, paste the **Bot ID**,
and add it. (You need the *Manage Server* permission.) The bot shows up in the
member list with a **BOT** tag, and gets the `@everyone` role's permissions —
give it more by assigning it roles like any member.

## 3. Run the example bot

```bash
npm install socket.io-client          # only dependency
ORBIT_TOKEN="<your bot token>" node bot/orbit-bot.js
```

Then in any channel the bot can see:

```
!ping            → Pong! 🏓
!hello           → Hey @you! 👋
!roll 20         → 🎲 You rolled a 14 (d20).
!say hello world → hello world
!help            → lists commands
```

Change the command prefix with `ORBIT_PREFIX="?"` and the server with
`ORBIT_URL="https://orbital.sbs"` (that's the default).

## How it works

A bot authenticates with `Authorization: Bot <token>` instead of a login
session. It has two surfaces:

### Gateway (real-time events) — Socket.IO

Connect to the Orbit origin with the token in the handshake:

```js
const { io } = require('socket.io-client');
const socket = io('https://orbital.sbs', {
  transports: ['websocket'],
  auth: { token: process.env.ORBIT_TOKEN, bot: true },
});
socket.on('message:new', (msg) => { /* react to messages */ });
```

The bot receives the same realtime events as a member of the servers it's in:
`message:new`, `message:update`, `message:delete`, `server:refresh`, and more.

### REST (actions) — HTTP

Call the normal Orbit API with the `Bot` auth scheme. Everything is subject to
the bot's permissions, exactly like a human member:

```js
await fetch(`https://orbital.sbs/api/channels/${channelId}/messages`, {
  method: 'POST',
  headers: { authorization: 'Bot ' + token, 'content-type': 'application/json' },
  body: JSON.stringify({ content: 'Hello from my bot!' }),
});
```

Useful endpoints:

| Method & path | Does |
|---|---|
| `POST /api/channels/:id/messages` | Send a message (`content`, `reply_to`, `gif`, …) |
| `GET /api/channels/:id/messages` | Read recent messages |
| `GET /api/servers/:id` | Server + channels the bot can see |
| `PATCH /api/messages/:id` | Edit one of the bot's messages |
| `DELETE /api/messages/:id` | Delete a message (needs Manage Messages) |

## Managing bots via the API

These are called by **you** (a human session), not the bot:

| Method & path | Does |
|---|---|
| `POST /api/bots` `{name}` | Create a bot → returns `{bot, token}` (token shown once) |
| `GET /api/bots` | List your bots |
| `POST /api/bots/:id/regenerate` | New token, old one invalidated |
| `PATCH /api/bots/:id` | Rename / set bio / accent |
| `DELETE /api/bots/:id` | Delete the bot everywhere |
| `POST /api/servers/:id/bots` `{bot_id}` | Add a bot to a server |
| `DELETE /api/servers/:id/bots/:bot_id` | Remove a bot from a server |

## Notes & limits

- Up to **10 bots** per account, and up to **20 bots** per server.
- Bots can't log in, change account/security settings, or create other bots.
- Bots are rate-limited on sending just like people — don't spam.
- A bot only sees and acts in servers it has been added to.
