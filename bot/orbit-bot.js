#!/usr/bin/env node
/**
 * Orbit example bot
 * ------------------
 * A tiny, dependency-light bot for Orbit. It connects to the Orbit gateway,
 * listens for new messages in servers it has been added to, and replies to a
 * few prefix commands. Use it as a starting point for your own bots.
 *
 * Setup:
 *   1. In Orbit → Settings → Developer / Bots, create a bot and copy its TOKEN.
 *   2. Still in Orbit, open a server you manage → Server Settings → Bots →
 *      paste the bot's ID to add it to that server.
 *   3. Run it:
 *        ORBIT_TOKEN="<your bot token>" node bot/orbit-bot.js
 *      (optionally ORBIT_URL=https://orbital.sbs  — that's the default)
 *
 * The token looks like  <botId>.<secret>  — keep it secret. Anyone with it
 * can control your bot. If it leaks, regenerate it in the developer portal.
 */
'use strict';
const { io } = require('socket.io-client');

const BASE = (process.env.ORBIT_URL || 'https://orbital.sbs').replace(/\/+$/, '');
const TOKEN = process.env.ORBIT_TOKEN;
const PREFIX = process.env.ORBIT_PREFIX || '!';

if (!TOKEN || TOKEN.indexOf('.') < 1) {
  console.error('Set ORBIT_TOKEN to your bot token (looks like "<botId>.<secret>").');
  console.error('Create one in Orbit → Settings → Developer / Bots.');
  process.exit(1);
}
const BOT_ID = TOKEN.slice(0, TOKEN.indexOf('.'));

// --- REST helper: call the Orbit API as the bot ------------------------------
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'authorization': 'Bot ' + TOKEN, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
  return data;
}
const send = (channelId, content, extra = {}) =>
  api('POST', `/api/channels/${channelId}/messages`, { content, ...extra });

// --- Commands ----------------------------------------------------------------
// Each handler gets (args, msg) and returns a string (or nothing to stay quiet).
const commands = {
  ping:  () => 'Pong! 🏓',
  hello: (_a, m) => `Hey <@${m.author_id}>! 👋`,
  help:  () => 'Commands: ' + Object.keys(commands).map(c => PREFIX + c).join(', '),
  roll:  (a) => {
    const sides = Math.max(2, Math.min(1000, parseInt(a[0], 10) || 6));
    return `🎲 You rolled a **${1 + Math.floor(Math.random() * sides)}** (d${sides}).`;
  },
  say:   (a) => a.join(' ').slice(0, 300) || '…say what?',
  echo:  (a) => a.join(' ').slice(0, 300) || '(nothing to echo)',
};

// --- Gateway -----------------------------------------------------------------
const socket = io(BASE, {
  transports: ['websocket'],
  auth: { token: TOKEN, bot: true, status: 'online', platform: 'web' },
});

socket.on('connect', () => console.log(`[orbit-bot] connected as ${BOT_ID}`));
socket.on('connect_error', (e) => console.error('[orbit-bot] connect error:', e.message));
socket.on('disconnect', (r) => console.log('[orbit-bot] disconnected:', r));

socket.on('message:new', async (msg) => {
  try {
    if (!msg || msg.author_id === BOT_ID || msg.system) return;     // ignore self & system
    const content = String(msg.content || '').trim();
    if (!content.startsWith(PREFIX)) return;
    const [name, ...args] = content.slice(PREFIX.length).split(/\s+/);
    const handler = commands[name.toLowerCase()];
    if (!handler) return;
    const reply = await handler(args, msg);
    if (reply) await send(msg.channel_id, reply, { reply_to: msg.id, mention_reply: 'false' });
  } catch (e) {
    console.error('[orbit-bot] handler error:', e.message);
  }
});

process.on('SIGINT', () => { console.log('\n[orbit-bot] shutting down'); socket.close(); process.exit(0); });
