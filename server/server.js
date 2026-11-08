// Orbit server: REST API + Socket.IO realtime + SQLite storage + WebRTC signaling.
// Run standalone with `node server/server.js`, or embed with require('./server').start({...}).
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server: IOServer } = require('socket.io');
const { DatabaseSync } = require('node:sqlite');

// ---------- permissions ----------
const P = {
  ADMIN: 1, MANAGE_SERVER: 2, MANAGE_CHANNELS: 4, MANAGE_ROLES: 8, KICK: 16, BAN: 32,
  MANAGE_MESSAGES: 64, CREATE_INVITE: 128, SEND: 256, CONNECT: 512, ATTACH: 1024, MENTION_EVERYONE: 2048,
};
const ALL = Object.values(P).reduce((a, b) => a | b, 0);
const DEFAULT_PERMS = P.SEND | P.CONNECT | P.ATTACH | P.CREATE_INVITE;
const enc = encodeURIComponent;
const CONNECTION_TYPES = {
  spotify: (n) => 'https://open.spotify.com/user/' + enc(n),
  github: (n) => 'https://github.com/' + enc(n), steam: (n) => 'https://steamcommunity.com/id/' + enc(n),
  youtube: (n) => 'https://youtube.com/@' + enc(n), twitch: (n) => 'https://twitch.tv/' + enc(n),
  x: (n) => 'https://x.com/' + enc(n), instagram: (n) => 'https://instagram.com/' + enc(n),
  tiktok: (n) => 'https://tiktok.com/@' + enc(n), reddit: (n) => 'https://reddit.com/user/' + enc(n),
  xbox: (n) => 'https://www.xbox.com/play/user/' + enc(n), playstation: (n) => 'https://psnprofiles.com/' + enc(n),
  roblox: (n) => 'https://www.roblox.com/search/users?keyword=' + enc(n),
};

const VERSION = '1.18.1';
const STAFF = new Set((process.env.STAFF_USERS || '..,__').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const GROUP_MAX = 35;
// OG badge: everyone who signed up before this date gets it automatically (staff can also give it to anyone)
const OG_CUTOFF = Date.parse(process.env.OG_CUTOFF || '2026-12-01T00:00:00-07:00') || Date.parse('2026-12-01T07:00:00Z');
const GRANTABLE_BADGES = ['og', 'trusted'];
const uid = () => crypto.randomBytes(9).toString('base64url');
const all0 = (db, sql) => db.prepare(sql).all();
const now = () => Date.now();

function start(opts = {}) {
  const port = Number(opts.port ?? process.env.PORT ?? 3000);
  const dataDir = opts.dataDir || process.env.ORBIT_DATA || path.join(__dirname, '..', 'data');
  const publicDir = opts.publicDir || path.join(__dirname, '..', 'public');
  const uploadDir = path.join(dataDir, 'uploads');
  const maxUpload = Number(opts.maxUploadMB ?? process.env.MAX_UPLOAD_MB ?? 50) * 1024 * 1024;
  fs.mkdirSync(uploadDir, { recursive: true });
  const log = opts.log || ((...a) => console.log('[orbit]', ...a));

  // config: jwt secret + smtp
  const cfgPath = path.join(dataDir, 'config.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch {}
  if (!cfg.jwtSecret) { cfg.jwtSecret = crypto.randomBytes(32).toString('hex'); }
  cfg.smtp = cfg.smtp || {};
  const smtp = {
    host: process.env.SMTP_HOST || opts.smtp?.host || cfg.smtp.host || '',
    port: Number(process.env.SMTP_PORT || opts.smtp?.port || cfg.smtp.port || 587),
    user: process.env.SMTP_USER || opts.smtp?.user || cfg.smtp.user || '',
    pass: process.env.SMTP_PASS || opts.smtp?.pass || cfg.smtp.pass || '',
    from: process.env.SMTP_FROM || opts.smtp?.from || cfg.smtp.from || '',
  };
  if (!fs.existsSync(cfgPath)) cfg.smtp = { host: '', port: 587, user: '', pass: '', from: '' };
  if (cfg.spotifyClientId === undefined) cfg.spotifyClientId = '';
  const SPOTIFY_ID = process.env.SPOTIFY_CLIENT_ID || opts.spotifyClientId || cfg.spotifyClientId || '';
  const GIPHY_KEY = process.env.GIPHY_KEY || cfg.giphyKey || '';
  const PUBLIC_URL = (process.env.PUBLIC_URL || opts.publicUrl || cfg.publicUrl || '').replace(/\/$/, '');
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const SECRET = process.env.JWT_SECRET || cfg.jwtSecret;
  const emailEnabled = !!smtp.host;
  let mailer = null;
  if (emailEnabled) {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({ host: smtp.host, port: smtp.port, secure: smtp.port === 465, auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined });
  }
  async function sendCode(email, code, purpose) {
    const subject = purpose === 'reset' ? 'Your Orbit password reset code' : 'Your Orbit verification code';
    if (!mailer) { log(`${subject} for ${email}: ${code}`); return; }
    await mailer.sendMail({ from: smtp.from || smtp.user, to: email, subject,
      text: `Your code is ${code}. It expires in 15 minutes.`,
      html: `<div style="font-family:sans-serif"><h2>Orbit</h2><p>Your code is</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p><p>It expires in 15 minutes.</p></div>` });
  }

  const activities = new Map(); // userId -> current activity (e.g. Spotify)
  // ---------- database ----------
  const db = new DatabaseSync(path.join(dataDir, 'orbit.db'));
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, email TEXT UNIQUE COLLATE NOCASE, username TEXT UNIQUE COLLATE NOCASE,
      display_name TEXT, pass TEXT, avatar TEXT, banner TEXT, bio TEXT DEFAULT '', accent TEXT DEFAULT '#7c5cff',
      status_text TEXT DEFAULT '', verified INTEGER DEFAULT 0, created INTEGER);
    CREATE TABLE IF NOT EXISTS codes(email TEXT, code TEXT, purpose TEXT, expires INTEGER);
    CREATE TABLE IF NOT EXISTS servers(id TEXT PRIMARY KEY, name TEXT, icon TEXT, banner TEXT, description TEXT DEFAULT '', owner_id TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS members(server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      nick TEXT, joined INTEGER, PRIMARY KEY(server_id,user_id));
    CREATE TABLE IF NOT EXISTS roles(id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, name TEXT, color TEXT,
      perms INTEGER, position INTEGER, hoist INTEGER DEFAULT 1, is_default INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS member_roles(server_id TEXT, user_id TEXT, role_id TEXT REFERENCES roles(id) ON DELETE CASCADE, PRIMARY KEY(server_id,user_id,role_id));
    CREATE TABLE IF NOT EXISTS bans(server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, user_id TEXT, reason TEXT, created INTEGER, PRIMARY KEY(server_id,user_id));
    CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, type TEXT, name TEXT,
      topic TEXT DEFAULT '', position INTEGER DEFAULT 0, private INTEGER DEFAULT 0, allowed_roles TEXT DEFAULT '[]', created INTEGER);
    CREATE TABLE IF NOT EXISTS dm_members(channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE, user_id TEXT, PRIMARY KEY(channel_id,user_id));
    CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, channel_id TEXT REFERENCES channels(id) ON DELETE CASCADE,
      author_id TEXT, content TEXT, reply_to INTEGER, thread_id INTEGER, attachments TEXT DEFAULT '[]', mentions TEXT DEFAULT '[]',
      mention_everyone INTEGER DEFAULT 0, edited INTEGER, created INTEGER, system INTEGER DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_msg_chan ON messages(channel_id, thread_id, id);
    CREATE TABLE IF NOT EXISTS reactions(message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT, emoji TEXT, PRIMARY KEY(message_id,user_id,emoji));
    CREATE TABLE IF NOT EXISTS invites(code TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, creator TEXT, uses INTEGER DEFAULT 0, created INTEGER);
    CREATE TABLE IF NOT EXISTS reads(user_id TEXT, channel_id TEXT, last_id INTEGER, PRIMARY KEY(user_id,channel_id));
    CREATE TABLE IF NOT EXISTS friends(a TEXT, b TEXT, status TEXT, requester TEXT, created INTEGER, PRIMARY KEY(a,b));
    CREATE TABLE IF NOT EXISTS blocks(blocker TEXT, blocked TEXT, created INTEGER, PRIMARY KEY(blocker,blocked));
    CREATE TABLE IF NOT EXISTS friend_notes(user_id TEXT, target_id TEXT, note TEXT, updated INTEGER, PRIMARY KEY(user_id,target_id));
    CREATE TABLE IF NOT EXISTS invisible_to(user_id TEXT, target_id TEXT, PRIMARY KEY(user_id,target_id));
    CREATE TABLE IF NOT EXISTS dm_receipts(channel_id TEXT, user_id TEXT, last_read INTEGER, updated INTEGER, PRIMARY KEY(channel_id,user_id));
    CREATE TABLE IF NOT EXISTS bookmark_folders(id TEXT PRIMARY KEY, user_id TEXT, name TEXT, color TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS bookmarks(id TEXT PRIMARY KEY, user_id TEXT, message_id INTEGER, channel_id TEXT, folder_id TEXT, label TEXT, created INTEGER);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id, created);
    CREATE TABLE IF NOT EXISTS voice_passes(id TEXT PRIMARY KEY, channel_id TEXT, user_id TEXT, granted_by TEXT, expires INTEGER, created INTEGER);
    CREATE INDEX IF NOT EXISTS idx_voicepass ON voice_passes(channel_id, user_id);
  `);
  const userCols = all0(db, "PRAGMA table_info(users)").map(c => c.name);
  const chanCols = all0(db, "PRAGMA table_info(channels)").map(c => c.name);
  [['is_group', 'INTEGER DEFAULT 0'], ['gc_owner', 'TEXT'], ['gc_icon', 'TEXT']].forEach(([c, t]) => { if (!chanCols.includes(c)) db.exec(`ALTER TABLE channels ADD COLUMN ${c} ${t}`); });
  [['pronouns', "TEXT DEFAULT ''"], ['theme_primary', 'TEXT'], ['theme_accent', 'TEXT'], ['name_color', 'TEXT'], ['name_color2', 'TEXT'],
   ['avatar_crop', 'TEXT'], ['banner_crop', 'TEXT'], ['links', "TEXT DEFAULT '[]'"], ['connections', "TEXT DEFAULT '[]'"], ['spotify', 'TEXT'],
   ['effect', "TEXT DEFAULT ''"], ['banner_color', 'TEXT'], ['badges', "TEXT DEFAULT '[]'"], ['tokens_after', 'INTEGER'],
   ['read_receipts', 'INTEGER DEFAULT 1'], ['block_mode', "TEXT DEFAULT 'standard'"]].forEach(([c, t]) => { if (!userCols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`); });
  // 1.10: pins, link embeds, polls, slowmode, timeouts, custom emojis (additive only — never drops data)
  const msgCols = all0(db, "PRAGMA table_info(messages)").map(c => c.name);
  [['pinned', 'INTEGER DEFAULT 0'], ['embeds', "TEXT DEFAULT '[]'"], ['poll', 'TEXT']].forEach(([c, t]) => { if (!msgCols.includes(c)) db.exec(`ALTER TABLE messages ADD COLUMN ${c} ${t}`); });
  if (!chanCols.includes('slowmode')) db.exec('ALTER TABLE channels ADD COLUMN slowmode INTEGER DEFAULT 0');
  // 1.15: channel categories (type 'category', channels point at one with parent_id), stickers
  const addedCategories = !chanCols.includes('parent_id');
  if (addedCategories) db.exec('ALTER TABLE channels ADD COLUMN parent_id TEXT');
  if (!msgCols.includes('sticker')) db.exec('ALTER TABLE messages ADD COLUMN sticker TEXT');
  if (!msgCols.includes('title')) db.exec('ALTER TABLE messages ADD COLUMN title TEXT');   // forum post titles
  // 1.15: sessions (one per logged-in device) so you can see and log out devices
  db.exec(`CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, created INTEGER, last_seen INTEGER, ua TEXT, client TEXT, ip TEXT);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);`);
  db.exec(`CREATE TABLE IF NOT EXISTS stickers(id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, name TEXT, url TEXT, creator TEXT, created INTEGER);`);
  if (addedCategories) {
    // existing servers keep their look: "Text Channels" and "Voice Channels" become real categories
    const servers = db.prepare('SELECT id FROM servers').all();
    const ins = db.prepare(`INSERT INTO channels(id,server_id,type,name,position,created) VALUES(?,?,'category',?,?,?)`);
    const setParent = db.prepare('UPDATE channels SET parent_id=? WHERE server_id=? AND type=?');
    db.exec('BEGIN');
    try {
      for (const { id: sid } of servers) {
        const t = crypto.randomBytes(9).toString('base64url'), v = crypto.randomBytes(9).toString('base64url');
        ins.run(t, sid, 'Text Channels', -2, Date.now()); ins.run(v, sid, 'Voice Channels', -1, Date.now());
        setParent.run(t, sid, 'text'); setParent.run(v, sid, 'voice');
      }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  const memCols = all0(db, "PRAGMA table_info(members)").map(c => c.name);
  if (!memCols.includes('timeout_until')) db.exec('ALTER TABLE members ADD COLUMN timeout_until INTEGER');
  db.exec(`CREATE TABLE IF NOT EXISTS emojis(id TEXT PRIMARY KEY, server_id TEXT REFERENCES servers(id) ON DELETE CASCADE, name TEXT, url TEXT, creator TEXT, created INTEGER);
    CREATE TABLE IF NOT EXISTS poll_votes(message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE, user_id TEXT, opt INTEGER, PRIMARY KEY(message_id,user_id,opt));
    CREATE INDEX IF NOT EXISTS idx_msg_pins ON messages(channel_id, pinned);`);
  const backupDir = path.join(dataDir, 'backups');
  function makeBackup(file) { fs.mkdirSync(backupDir, { recursive: true }); try { fs.unlinkSync(file); } catch {} db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); return file; }
  function dailyBackup() {
    try {
      const day = new Date().toISOString().slice(0, 10), file = path.join(backupDir, `orbit-${day}.db`);
      if (!fs.existsSync(file)) { makeBackup(file); log('Backup saved:', path.basename(file)); }
      const old = fs.readdirSync(backupDir).filter(f => /^orbit-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -7);
      old.forEach(f => fs.unlink(path.join(backupDir, f), () => {}));
    } catch (e) { log('Backup failed:', e.message); }
  }
  setTimeout(function loop() { dailyBackup(); setTimeout(loop, 6 * 3600e3).unref?.(); }, 15000).unref?.();
  const q = (sql) => db.prepare(sql);
  const one = (sql, ...a) => q(sql).get(...a);
  const all = (sql, ...a) => q(sql).all(...a);
  const run = (sql, ...a) => q(sql).run(...a);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // ---------- helpers ----------
  const likeEsc = (v) => String(v).replace(/[\\%_]/g, '\\$&');
  const pj = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const publicUser = (u) => u && ({ id: u.id, username: u.username, display_name: u.display_name || u.username, avatar: u.avatar,
    banner: u.banner, bio: u.bio, accent: u.accent, status_text: u.status_text, created: u.created, pronouns: u.pronouns || '',
    theme_primary: u.theme_primary || null, theme_accent: u.theme_accent || null, name_color: u.name_color || null, name_color2: u.name_color2 || null,
    avatar_crop: pj(u.avatar_crop, null), banner_crop: pj(u.banner_crop, null), links: pj(u.links, []), connections: pj(u.connections, []),
    effect: u.effect || '', banner_color: u.banner_color || null, activity: activities.get(u.id) || null, staff: STAFF.has((u.username || '').toLowerCase()), badges: badgeList(u) });
  function badgeList(u) {
    const raw = pj(u.badges, []);
    const set = new Set(raw.filter(b => GRANTABLE_BADGES.includes(b)));
    if (u.created && u.created < OG_CUTOFF && !raw.includes('-og')) set.add('og');   // '-og' = staff removed the automatic OG badge
    return [...set];
  }
  const getUser = (id) => publicUser(one('SELECT * FROM users WHERE id=?', id));
  const nameOf = (id) => getUser(id)?.display_name || getUser(id)?.username || 'Someone';
  const pair = (x, y) => (x < y ? [x, y] : [y, x]);
  const relRow = (x, y) => { const [a, b] = pair(x, y); return one('SELECT * FROM friends WHERE a=? AND b=?', a, b); };
  const isBlocked = (blocker, blocked) => !!one('SELECT 1 FROM blocks WHERE blocker=? AND blocked=?', blocker, blocked);
  const eitherBlocks = (x, y) => isBlocked(x, y) || isBlocked(y, x);
  function relTo(me, other) {
    if (me === other) return 'self';
    if (isBlocked(me, other)) return 'blocked';
    if (isBlocked(other, me)) return 'blocked_by';
    const r = relRow(me, other);
    if (!r) return 'none';
    if (r.status === 'accepted') return 'friend';
    return r.requester === me ? 'outgoing' : 'incoming';
  }
  function friendIds(uidv) {
    return all('SELECT a, b FROM friends WHERE status=? AND (a=? OR b=?)', 'accepted', uidv, uidv).map(r => r.a === uidv ? r.b : r.a);
  }
  function friendsPayload(uidv) {
    const rows = all('SELECT * FROM friends WHERE a=? OR b=?', uidv, uidv);
    const friends = [], incoming = [], outgoing = [];
    for (const r of rows) { const other = r.a === uidv ? r.b : r.a; const u = getUser(other); if (!u) continue;
      if (r.status === 'accepted') friends.push(u);
      else if (r.requester === uidv) outgoing.push(u);
      else incoming.push(u); }
    const blocked = all('SELECT blocked FROM blocks WHERE blocker=?', uidv).map(r => getUser(r.blocked)).filter(Boolean);
    return { friends, incoming, outgoing, blocked };
  }
  function pushFriends(uidv) { io.to('u:' + uidv).emit('friends:refresh', friendsPayload(uidv)); }
  const bookmarkFolders = (uidv) => all('SELECT id, name, color, created FROM bookmark_folders WHERE user_id=? ORDER BY created', uidv);
  function chanLabel(ch, uidv) {
    if (!ch) return '';
    if (ch.type === 'dm' && !ch.is_group) { const other = all('SELECT user_id FROM dm_members WHERE channel_id=?', ch.id).map(r => r.user_id).find(x => x !== uidv); return '@' + (nameOf(other) || 'Direct message'); }
    if (ch.is_group) return groupName(ch, uidv, all('SELECT user_id FROM dm_members WHERE channel_id=?', ch.id).map(r => r.user_id));
    const srv = one('SELECT name FROM servers WHERE id=?', ch.server_id);
    return '#' + (ch.name || 'channel') + (srv ? ' · ' + srv.name : '');
  }
  // Privacy: a user can appear offline to specific people (invisible_to), or go "strict" with blocked users.
  const invisibleTo = (uidv, viewer) => uidv !== viewer && !!one('SELECT 1 FROM invisible_to WHERE user_id=? AND target_id=?', uidv, viewer);
  const strictBlocks = (blocker, blocked) => isBlocked(blocker, blocked) && one('SELECT block_mode FROM users WHERE id=?', blocker)?.block_mode === 'strict';
  // status of `uidv` as `viewer` should see it: hidden if invisible-to them, or if uidv strict-blocks them
  function statusFor(uidv, viewer) {
    let st = online.get(uidv)?.status || 'offline';
    if (st === 'invisible') st = 'offline';
    if (st !== 'offline' && (invisibleTo(uidv, viewer) || strictBlocks(uidv, viewer))) st = 'offline';
    return st;
  }
  const isMember = (sid, uidv) => !!one('SELECT 1 FROM members WHERE server_id=? AND user_id=?', sid, uidv);
  function permsOf(sid, uidv) {
    const s = one('SELECT owner_id FROM servers WHERE id=?', sid);
    if (!s) return 0;
    if (s.owner_id === uidv) return ALL;
    if (!isMember(sid, uidv)) return 0;
    const rows = all(`SELECT r.perms FROM roles r WHERE r.server_id=? AND (r.is_default=1 OR r.id IN (SELECT role_id FROM member_roles WHERE server_id=? AND user_id=?))`, sid, sid, uidv);
    let p = rows.reduce((a, r) => a | r.perms, 0);
    if (p & P.ADMIN) p = ALL;
    return p;
  }
  const has = (sid, uidv, perm) => (permsOf(sid, uidv) & perm) === perm;
  const timedOutUntil = (sid, uidv) => { const r = sid && one('SELECT timeout_until t FROM members WHERE server_id=? AND user_id=?', sid, uidv); return r && r.t > now() ? r.t : 0; };
  const memberRoleIds = (sid, uidv) => all('SELECT role_id FROM member_roles WHERE server_id=? AND user_id=?', sid, uidv).map(r => r.role_id);
  function canView(ch, uidv) {
    if (!ch) return false;
    if (ch.type === 'dm') return !!one('SELECT 1 FROM dm_members WHERE channel_id=? AND user_id=?', ch.id, uidv);
    if (!isMember(ch.server_id, uidv)) return false;
    if (!ch.private) return true;
    if (has(ch.server_id, uidv, P.ADMIN)) return true;
    const allowed = JSON.parse(ch.allowed_roles || '[]');
    return memberRoleIds(ch.server_id, uidv).some(r => allowed.includes(r));
  }
  function viewersOf(ch) {
    if (ch.type === 'dm') return all('SELECT user_id FROM dm_members WHERE channel_id=?', ch.id).map(r => r.user_id);
    const ids = all('SELECT user_id FROM members WHERE server_id=?', ch.server_id).map(r => r.user_id);
    return ch.private ? ids.filter(i => canView(ch, i)) : ids;
  }
  const chanRow = (id) => one('SELECT * FROM channels WHERE id=?', id);
  function fmtChannel(c) { return { ...c, private: !!c.private, allowed_roles: JSON.parse(c.allowed_roles || '[]') }; }
  function fmtMessages(rows) {
    if (!rows.length) return [];
    const ids = rows.map(r => r.id);
    const ph = ids.map(() => '?').join(',');
    const reacts = all(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${ph})`, ...ids);
    const replyIds = [...new Set(rows.map(r => r.reply_to).filter(Boolean))];
    const replies = replyIds.length ? all(`SELECT id, author_id, content, attachments FROM messages WHERE id IN (${replyIds.map(() => '?').join(',')})`, ...replyIds) : [];
    const threadCounts = all(`SELECT thread_id, COUNT(*) c, MAX(created) last FROM messages WHERE thread_id IN (${ph}) GROUP BY thread_id`, ...ids);
    const pollIds = rows.filter(r => r.poll).map(r => r.id);
    const votes = pollIds.length ? all(`SELECT message_id, user_id, opt FROM poll_votes WHERE message_id IN (${pollIds.map(() => '?').join(',')})`, ...pollIds) : [];
    const pollOf = (r) => { const p = pj(r.poll, null); if (!p) return null;
      return { ...p, voters: p.answers.map((_, i) => votes.filter(v => v.message_id === r.id && v.opt === i).map(v => v.user_id)) }; };
    return rows.map(r => {
      const rx = {};
      reacts.filter(x => x.message_id === r.id).forEach(x => (rx[x.emoji] = rx[x.emoji] || []).push(x.user_id));
      const rep = replies.find(x => x.id === r.reply_to);
      const tc = threadCounts.find(x => x.thread_id === r.id);
      return { id: r.id, channel_id: r.channel_id, author_id: r.author_id, content: r.content, reply_to: r.reply_to, thread_id: r.thread_id,
        attachments: JSON.parse(r.attachments || '[]'), mentions: JSON.parse(r.mentions || '[]'), mention_everyone: !!r.mention_everyone,
        edited: r.edited, created: r.created, system: !!r.system, reactions: rx,
        reply: rep ? { id: rep.id, author_id: rep.author_id, content: rep.content.slice(0, 200), has_attachments: rep.attachments !== '[]' } : (r.reply_to ? { id: r.reply_to, deleted: true } : null),
        thread: tc ? { count: tc.c, last: tc.last } : null, pinned: r.pinned || 0, embeds: pj(r.embeds, []).map(e => e && ({ ...e, image: proxied(e.image) })), poll: pollOf(r), sticker: pj(r.sticker, null), title: r.title || null };
    });
  }
  const msgById = (id) => fmtMessages(all('SELECT * FROM messages WHERE id=?', id))[0];

  function serverPayload(sid, uidv) {
    const s = one('SELECT * FROM servers WHERE id=?', sid);
    if (!s) return null;
    const channels = all('SELECT * FROM channels WHERE server_id=? ORDER BY position, created', sid).filter(c => canView(c, uidv)).map(fmtChannel);
    const roles = all('SELECT * FROM roles WHERE server_id=? ORDER BY position DESC', sid).map(r => ({ ...r, hoist: !!r.hoist, is_default: !!r.is_default }));
    const mrs = all('SELECT user_id, role_id FROM member_roles WHERE server_id=?', sid);
    const members = all('SELECT m.user_id, m.nick, m.joined, m.timeout_until AS t_until, u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.server_id=?', sid)
      .map(m => ({ ...publicUser(m), nick: m.nick, joined: m.joined, roles: mrs.filter(x => x.user_id === m.user_id).map(x => x.role_id), timeout_until: m.t_until > now() ? m.t_until : null }));
    const emojis = all('SELECT id, name, url FROM emojis WHERE server_id=? ORDER BY created', sid);
    const stickers = all('SELECT id, name, url FROM stickers WHERE server_id=? ORDER BY created', sid);
    return { id: s.id, name: s.name, icon: s.icon, banner: s.banner, description: s.description, owner_id: s.owner_id,
      channels, roles, members, emojis, stickers, my_perms: permsOf(sid, uidv) };
  }
  function serverSummary(s) { return { id: s.id, name: s.name, icon: s.icon, owner_id: s.owner_id }; }
  function groupName(c, uidv, members) {
    if (c.name) return c.name;
    const others = members.filter(id => id !== uidv).map(id => getUser(id)?.display_name).filter(Boolean);
    return others.length ? others.join(', ') : 'Group chat';
  }
  function dmEntry(c, uidv) {
    const memberIds = all('SELECT user_id FROM dm_members WHERE channel_id=?', c.id).map(r => r.user_id);
    const last = one('SELECT MAX(id) id, MAX(created) t FROM messages WHERE channel_id=?', c.id);
    const base = { id: c.id, last_id: last?.id || 0, last_at: last?.t || c.created };
    if (c.is_group) return { ...base, type: 'group', name: groupName(c, uidv, memberIds), icon: c.gc_icon || null, owner: c.gc_owner,
      members: memberIds.map(getUser).filter(Boolean), member_count: memberIds.length };
    const other = memberIds.find(id => id !== uidv) || uidv;
    return { ...base, type: 'dm', user: getUser(other) };
  }
  function dmList(uidv) {
    return all(`SELECT c.* FROM channels c JOIN dm_members d ON d.channel_id=c.id WHERE c.type='dm' AND d.user_id=?`, uidv)
      .map(c => dmEntry(c, uidv)).sort((a, b) => b.last_at - a.last_at);
  }
  function unreadFor(uidv) {
    // per visible channel: unread count + mention count since last read
    const out = {};
    const servers = all('SELECT server_id FROM members WHERE user_id=?', uidv).map(r => r.server_id);
    const chans = [];
    servers.forEach(sid => all(`SELECT * FROM channels WHERE server_id=? AND type IN ('text','forum')`, sid).forEach(c => canView(c, uidv) && chans.push(c)));
    all(`SELECT c.* FROM channels c JOIN dm_members d ON d.channel_id=c.id WHERE d.user_id=?`, uidv).forEach(c => chans.push(c));
    for (const c of chans) {
      const r = one('SELECT last_id FROM reads WHERE user_id=? AND channel_id=?', uidv, c.id);
      const last = r ? r.last_id : 0;
      const rows = all('SELECT mentions, mention_everyone, author_id FROM messages WHERE channel_id=? AND id>? AND thread_id IS NULL AND author_id<>?', c.id, last, uidv);
      if (!rows.length) continue;
      const mentions = rows.filter(m => m.mention_everyone || JSON.parse(m.mentions).includes(uidv)).length + (c.type === 'dm' ? rows.length : 0);
      out[c.id] = { count: rows.length, mentions, server_id: c.server_id };
    }
    return out;
  }

  // ---------- express ----------
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE'); if (req.method === 'OPTIONS') return res.end(); next(); });
  app.use('/uploads', express.static(uploadDir, { maxAge: '365d', immutable: true, setHeaders: (res, p) => {
    if (!/\.(png|jpe?g|gif|webp|mp4|webm|mov|mp3|ogg|wav|m4a)$/i.test(p)) res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff'); } }));
  app.use(express.static(publicDir, { setHeaders: (res, p) => { if (/\.(html|js|css)$/.test(p)) res.setHeader('Cache-Control', 'no-cache, must-revalidate'); } }));

  const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => { const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10); cb(null, uid() + uid() + ext); },
  });
  const upload = multer({ storage, limits: { fileSize: maxUpload, files: 10 } });
  const imageOnly = multer({ storage, limits: { fileSize: 15 * 1024 * 1024 }, fileFilter: (req, f, cb) => cb(null, /^image\//.test(f.mimetype)) });

  const wrap = (fn) => (req, res) => { try { const r = fn(req, res); if (r && r.catch) r.catch(e => fail(res, e)); } catch (e) { fail(res, e); } };
  function fail(res, e) { if (e && e.status) return res.status(e.status).json({ error: e.message }); log('error', e); res.status(500).json({ error: 'Server error' }); }
  const err = (status, message) => Object.assign(new Error(message), { status });
  // A token carries a session id (sid). Logging a device out deletes its session, which makes its token stop working.
  // Tokens from before sessions existed (no sid) keep working; /api/me hands those devices a new token with a session.
  const clientIp = (req) => { const xf = String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean); return (xf.length ? xf[xf.length - 1] : String(req.socket?.remoteAddress || '')).slice(0, 64); };
  // simple in-memory rate limits (reset when the server restarts, which is fine for this)
  const buckets = new Map();
  function hit(key, max, windowMs) { const t = now(); let b = buckets.get(key); if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); } b.n++; return b.n > max ? b.reset - t : 0; }
  function peekOver(key, max) { const b = buckets.get(key); return b && b.reset > now() && b.n >= max ? b.reset - now() : 0; }
  const waitText = (ms) => { const s2 = Math.ceil(ms / 1000); return s2 > 90 ? `${Math.ceil(s2 / 60)} minutes` : `${s2} seconds`; };
  function limit(key, max, windowMs, what) { const w = hit(key, max, windowMs); if (w) throw err(429, `${what} Try again in ${waitText(w)}.`); }
  setInterval(() => { const t = now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 10 * 60e3).unref?.();
  function newSession(uidv, req) {
    const sid = uid();
    const client = ['desktop', 'app', 'web'].includes(req.body?.client || req.headers['x-orbit-client']) ? (req.body?.client || req.headers['x-orbit-client']) : 'web';
    run('INSERT INTO sessions VALUES(?,?,?,?,?,?,?)', sid, uidv, now(), now(), String(req.headers['user-agent'] || '').slice(0, 300), client, clientIp(req));
    return sid;
  }
  function checkToken(t) {
    const p = jwt.verify(t, SECRET);
    const u = one('SELECT * FROM users WHERE id=?', p.id); if (!u) throw 0;
    if (p.sid && !one('SELECT 1 FROM sessions WHERE id=? AND user_id=?', p.sid, u.id)) throw 0;   // this device was logged out
    if (!p.sid && u.tokens_after) { const issued = (p.iat || 0) > 1e12 ? p.iat : (p.iat || 0) * 1000; if (issued < u.tokens_after) throw 0; }   // old-style login revoked
    return { u, sid: p.sid || null };
  }
  const seenAt = new Map();
  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    let r; try { r = checkToken(t); } catch { return res.status(401).json({ error: 'Not logged in' }); }
    req.user = r.u; req.sid = r.sid;
    if (r.sid && (seenAt.get(r.sid) || 0) < now() - 60e3) { seenAt.set(r.sid, now()); run('UPDATE sessions SET last_seen=?, ip=? WHERE id=?', now(), clientIp(req), r.sid); }
    next();
  }
  const token = (u, req) => jwt.sign({ id: u.id, sid: newSession(u.id, req) }, SECRET, { expiresIn: '60d' });
  const fileUrl = (f) => '/uploads/' + f.filename;

  // ----- auth -----
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const userRe = /^[a-zA-Z0-9_.]{2,32}$/;
  function newCode(email, purpose) {
    const code = String(crypto.randomInt(100000, 999999));
    run('DELETE FROM codes WHERE email=? AND purpose=?', email, purpose);
    run('INSERT INTO codes VALUES(?,?,?,?)', email, code, purpose, now() + 15 * 60e3);
    return code;
  }
  function checkCode(email, code, purpose) {
    const c = one('SELECT * FROM codes WHERE email=? COLLATE NOCASE AND purpose=? AND code=?', email, purpose, String(code || '').trim());
    if (!c || c.expires < now()) throw err(400, 'That code is wrong or expired');
    run('DELETE FROM codes WHERE email=? AND purpose=?', email, purpose);
  }
  app.get('/api/info', (req, res) => res.json({ name: 'Orbit', version: VERSION, email_verification: emailEnabled, max_upload_mb: maxUpload / 1048576, spotify: !!SPOTIFY_ID, gif: !!GIPHY_KEY }));
  app.post('/api/auth/register', wrap(async (req, res) => {
    const { email, username, password, display_name } = req.body || {};
    limit('reg:' + clientIp(req), 5, 3600e3, 'Too many new accounts from your network.');
    if (!emailRe.test(email || '')) throw err(400, 'Enter a valid email');
    if (!userRe.test(username || '')) throw err(400, 'Username must be 2–32 letters, numbers, _ or .');
    if (!password || password.length < 6) throw err(400, 'Password must be at least 6 characters');
    if (one('SELECT 1 FROM users WHERE email=?', email)) throw err(409, 'That email is already registered');
    if (one('SELECT 1 FROM users WHERE username=?', username)) throw err(409, 'That username is taken');
    const u = { id: uid(), email, username, display_name: (display_name || username).slice(0, 32), pass: bcrypt.hashSync(password, 10), created: now() };
    const colors = ['#7c5cff', '#3fb871', '#f0883e', '#e5534b', '#2bb5a8', '#d4a72c', '#c96dd8', '#5b8def'];
    run('INSERT INTO users(id,email,username,display_name,pass,accent,verified,created) VALUES(?,?,?,?,?,?,?,?)', u.id, email, username, u.display_name, u.pass,
      colors[crypto.randomInt(colors.length)], emailEnabled ? 0 : 1, u.created);
    if (emailEnabled) { await sendCode(email, newCode(email, 'verify'), 'verify'); return res.json({ needs_verification: true, email }); }
    res.json({ token: token(u, req) });
  }));
  app.post('/api/auth/verify', wrap((req, res) => {
    const { email, code } = req.body || {};
    limit('code:' + String(email || '').toLowerCase(), 10, 15 * 60e3, 'Too many code attempts.');
    checkCode(email, code, 'verify');
    const u = one('SELECT * FROM users WHERE email=?', email);
    if (!u) throw err(404, 'Account not found');
    run('UPDATE users SET verified=1 WHERE id=?', u.id);
    res.json({ token: token(u, req) });
  }));
  app.post('/api/auth/resend', wrap(async (req, res) => {
    limit('mail:' + String(req.body?.email || '').toLowerCase(), 3, 15 * 60e3, 'Too many emails sent.'); limit('mailip:' + clientIp(req), 10, 3600e3, 'Too many emails sent.');
    const u = one('SELECT * FROM users WHERE email=?', req.body?.email || '');
    if (u && !u.verified) await sendCode(u.email, newCode(u.email, 'verify'), 'verify');
    res.json({ ok: true });
  }));
  app.post('/api/auth/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    // slow down password guessing: 8 wrong tries per account and 30 per network, per 15 minutes
    const acctKey = 'fail:' + String(email || '').toLowerCase(), ipKey = 'failip:' + clientIp(req);
    const wait = peekOver(acctKey, 8) || peekOver(ipKey, 30);
    if (wait) throw err(429, `Too many wrong passwords. Try again in ${waitText(wait)}.`);
    const u = one('SELECT * FROM users WHERE email=? OR username=?', email || '', email || '');
    if (!u || !bcrypt.compareSync(password || '', u.pass)) { hit(acctKey, 8, 15 * 60e3); hit(ipKey, 30, 15 * 60e3); throw err(401, 'Wrong email or password'); }
    buckets.delete(acctKey);
    if (!u.verified && emailEnabled) { await sendCode(u.email, newCode(u.email, 'verify'), 'verify'); return res.json({ needs_verification: true, email: u.email }); }
    res.json({ token: token(u, req) });
  }));
  app.post('/api/auth/forgot', wrap(async (req, res) => {
    limit('mail:' + String(req.body?.email || '').toLowerCase(), 3, 15 * 60e3, 'Too many emails sent.'); limit('mailip:' + clientIp(req), 10, 3600e3, 'Too many emails sent.');
    const u = one('SELECT * FROM users WHERE email=?', req.body?.email || '');
    if (u) await sendCode(u.email, newCode(u.email, 'reset'), 'reset');
    res.json({ ok: true, email_enabled: emailEnabled });
  }));
  app.post('/api/auth/reset', wrap((req, res) => {
    const { email, code, password } = req.body || {};
    limit('code:' + String(email || '').toLowerCase(), 10, 15 * 60e3, 'Too many code attempts.');
    if (!password || password.length < 6) throw err(400, 'Password must be at least 6 characters');
    checkCode(email, code, 'reset');
    const u = one('SELECT * FROM users WHERE email=?', email);
    if (!u) throw err(404, 'Account not found');
    run('UPDATE users SET pass=?, verified=1 WHERE id=?', bcrypt.hashSync(password, 10), u.id);
    all('SELECT id FROM sessions WHERE user_id=?', u.id).forEach(x => endSession(x.id));   // reset = log out everywhere else
    revokeLegacy(u.id);
    res.json({ token: token(u, req) });
  }));

  // ----- me / users -----
  app.get('/api/me', auth, wrap((req, res) => {
    const me = { ...publicUser(req.user), email: req.user.email,
      read_receipts: req.user.read_receipts == null ? 1 : req.user.read_receipts, block_mode: req.user.block_mode || 'standard',
      invisible_to: all('SELECT target_id FROM invisible_to WHERE user_id=?', req.user.id).map(r => r.target_id) };
    const servers = all('SELECT s.* FROM servers s JOIN members m ON m.server_id=s.id WHERE m.user_id=? ORDER BY m.joined', req.user.id).map(serverSummary);
    const upgrade = req.sid ? undefined : token(req.user, req);   // older login without a session: give this device one
    res.json({ session_token: upgrade, me, servers, dms: dmList(req.user.id), unread: unreadFor(req.user.id), presence: presenceSnapshot(req.user.id), voice: voiceSnapshot(req.user.id), activities: Object.fromEntries(activities), friends: friendsPayload(req.user.id), bookmarkFolders: bookmarkFolders(req.user.id) });
  }));
  // ICE servers for voice/video. Add a TURN relay in Render -> Environment so calls work on strict networks:
  //   TURN_URLS + TURN_USERNAME + TURN_CREDENTIAL   (any TURN provider)
  //   or CF_TURN_KEY_ID + CF_TURN_API_TOKEN          (Cloudflare Realtime TURN, free tier)
  //   or METERED_DOMAIN + METERED_API_KEY            (Metered.ca)
  let iceCache = null;
  async function iceServers() {
    const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const E = process.env;
    if (E.TURN_URLS && E.TURN_USERNAME && E.TURN_CREDENTIAL) list.push({ urls: E.TURN_URLS.split(',').map(x => x.trim()).filter(Boolean), username: E.TURN_USERNAME, credential: E.TURN_CREDENTIAL });
    if (iceCache && iceCache.at > now() - 6 * 3600e3) return [...list, ...iceCache.servers];
    let extra = [];
    try {
      if (E.CF_TURN_KEY_ID && E.CF_TURN_API_TOKEN) {
        const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(E.CF_TURN_KEY_ID)}/credentials/generate`, { method: 'POST', headers: { Authorization: 'Bearer ' + E.CF_TURN_API_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }), signal: AbortSignal.timeout(5000) });
        const j = await r.json(); const s2 = j.iceServers; if (s2) extra = Array.isArray(s2) ? s2 : [s2];
      } else if (E.METERED_DOMAIN && E.METERED_API_KEY) {
        const r = await fetch(`https://${E.METERED_DOMAIN}/api/v1/turn/credentials?apiKey=${encodeURIComponent(E.METERED_API_KEY)}`, { signal: AbortSignal.timeout(5000) });
        const j = await r.json(); if (Array.isArray(j)) extra = j;
      }
    } catch (e) { log('TURN credentials failed:', e.message); }
    if (extra.length) iceCache = { servers: extra, at: now() };
    return [...list, ...extra];
  }
  app.get('/api/ice', auth, wrap(async (req, res) => { res.json({ iceServers: await iceServers() }); }));
  // devices you're logged in on
  app.get('/api/sessions', auth, wrap((req, res) => {
    res.json(all('SELECT id, created, last_seen, ua, client, ip FROM sessions WHERE user_id=? ORDER BY last_seen DESC', req.user.id)
      .map(x => ({ ...x, ip: undefined, current: x.id === req.sid })));
  }));
  // old-style logins (before Devices existed) have no session to delete, so revoking "everything else" also bumps this
  const revokeLegacy = (uidv) => run('UPDATE users SET tokens_after=? WHERE id=?', now(), uidv);
  setTimeout(function pruneSessions() { run('DELETE FROM sessions WHERE last_seen<?', now() - 61 * 864e5); setTimeout(pruneSessions, 12 * 3600e3).unref?.(); }, 5000).unref?.();
  function endSession(sid) { run('DELETE FROM sessions WHERE id=?', sid); seenAt.delete(sid); io.in('sess:' + sid).disconnectSockets(true); }
  app.delete('/api/sessions/:id', auth, wrap((req, res) => {
    const x = one('SELECT id FROM sessions WHERE id=? AND user_id=?', req.params.id, req.user.id);
    if (!x) throw err(404, 'That device is already logged out');
    endSession(x.id); res.json({ ok: true });
  }));
  app.delete('/api/sessions', auth, wrap((req, res) => {   // log out every other device
    const rows = all('SELECT id FROM sessions WHERE user_id=? AND id<>?', req.user.id, req.sid || '');
    rows.forEach(x => endSession(x.id)); revokeLegacy(req.user.id); res.json({ ok: true, count: rows.length });
  }));
  app.post('/api/logout', auth, wrap((req, res) => { if (req.sid) endSession(req.sid); res.json({ ok: true }); }));
  app.patch('/api/me', auth, wrap((req, res) => {
    const b = req.body || {};
    const u = req.user;
    if (b.username !== undefined && b.username !== u.username) {
      if (!userRe.test(b.username)) throw err(400, 'Username must be 2–32 letters, numbers, _ or .');
      if (one('SELECT 1 FROM users WHERE username=? AND id<>?', b.username, u.id)) throw err(409, 'That username is taken');
    }
    if (b.new_password) {
      if (!bcrypt.compareSync(b.current_password || '', u.pass)) throw err(400, 'Current password is wrong');
      if (b.new_password.length < 6) throw err(400, 'Password must be at least 6 characters');
      run('UPDATE users SET pass=? WHERE id=?', bcrypt.hashSync(b.new_password, 10), u.id);
      all('SELECT id FROM sessions WHERE user_id=? AND id<>?', u.id, req.sid || '').forEach(x => endSession(x.id));   // changing your password logs out your other devices
      revokeLegacy(u.id);
    }
    const f = (k, max) => (b[k] !== undefined ? String(b[k]).slice(0, max) : u[k]);
    const accent = /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : u.accent;
    run('UPDATE users SET username=?, display_name=?, bio=?, accent=?, status_text=? WHERE id=?',
      f('username', 32), f('display_name', 32) || u.username, f('bio', 400), accent, f('status_text', 80), u.id);
    const hex = (v) => (v === null || v === '' ? null : /^#[0-9a-f]{6}$/i.test(v || '') ? v : undefined);
    for (const k of ['theme_primary', 'theme_accent', 'name_color', 'name_color2', 'banner_color']) {
      if (b[k] !== undefined) { const v = hex(b[k]); if (v !== undefined) run(`UPDATE users SET ${k}=? WHERE id=?`, v, u.id); }
    }
    if (b.pronouns !== undefined) run('UPDATE users SET pronouns=? WHERE id=?', String(b.pronouns).slice(0, 40), u.id);
    if (b.effect !== undefined && ['', 'stars', 'aurora', 'glow'].includes(b.effect)) run('UPDATE users SET effect=? WHERE id=?', b.effect, u.id);
    const cleanCrop = (c) => c && typeof c === 'object' ? JSON.stringify({ z: Math.min(4, Math.max(1, Number(c.z) || 1)), x: Math.min(100, Math.max(0, Number(c.x) || 50)), y: Math.min(100, Math.max(0, Number(c.y) || 50)) }) : null;
    if (b.avatar_crop !== undefined) run('UPDATE users SET avatar_crop=? WHERE id=?', cleanCrop(b.avatar_crop), u.id);
    if (b.banner_crop !== undefined) run('UPDATE users SET banner_crop=? WHERE id=?', cleanCrop(b.banner_crop), u.id);
    const okUrl = (x) => { try { const l = new URL(String(x)); return /^https?:$/.test(l.protocol) ? l.href.slice(0, 300) : null; } catch { return null; } };
    if (Array.isArray(b.links)) run('UPDATE users SET links=? WHERE id=?', JSON.stringify(b.links.slice(0, 6).map(l => ({ label: String(l.label || '').slice(0, 40), url: okUrl(l.url) })).filter(l => l.url)), u.id);
    if (Array.isArray(b.connections)) {
      const keep = pj(u.connections, []).filter(c => c.verified);
      const manual = b.connections.filter(c => CONNECTION_TYPES[c.type] && c.type !== 'spotify').slice(0, 12).map(c => {
        const name = String(c.name || '').trim().replace(/^@/, '').slice(0, 60);
        return name ? { type: c.type, name, url: CONNECTION_TYPES[c.type](name), verified: false } : null; }).filter(Boolean);
      run('UPDATE users SET connections=? WHERE id=?', JSON.stringify([...keep, ...manual]), u.id);
    }
    if (b.avatar === null) run('UPDATE users SET avatar=NULL, avatar_crop=NULL WHERE id=?', u.id);
    if (b.banner === null) run('UPDATE users SET banner=NULL, banner_crop=NULL WHERE id=?', u.id);
    broadcastUser(u.id);
    res.json(getUser(u.id));
  }));
  app.post('/api/me/:kind', auth, imageOnly.single('file'), wrap((req, res) => {
    if (!['avatar', 'banner'].includes(req.params.kind)) throw err(404, 'Not found');
    if (!req.file) throw err(400, 'Upload an image (PNG, JPG, GIF or WebP)');
    run(`UPDATE users SET ${req.params.kind}=?, ${req.params.kind}_crop=? WHERE id=?`, fileUrl(req.file), req.body?.crop ? (() => { try { const c = JSON.parse(req.body.crop); return JSON.stringify({ z: Math.min(4, Math.max(1, +c.z || 1)), x: Math.min(100, Math.max(0, +c.x)), y: Math.min(100, Math.max(0, +c.y)) }); } catch { return null; } })() : null, req.user.id);
    broadcastUser(req.user.id);
    res.json(getUser(req.user.id));
  }));
  // staff: download a fresh copy of the whole database (keep it somewhere safe, off Render)
  app.get('/api/admin/backup', auth, wrap((req, res) => {
    if (!STAFF.has((req.user.username || '').toLowerCase())) throw err(403, 'Only Orbit staff can download backups');
    limit('backup:' + req.user.id, 5, 3600e3, 'Too many backups.');
    const file = makeBackup(path.join(backupDir, 'download-latest.db'));
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="orbit-backup-${new Date().toISOString().slice(0, 10)}.db"`);
    res.sendFile(file);
  }));
  // staff give / take away badges. Body: { badge: 'og' | 'trusted', on: true | false }
  app.put('/api/users/:id/badges', auth, wrap((req, res) => {
    if (!STAFF.has((req.user.username || '').toLowerCase())) throw err(403, 'Only Orbit staff can give badges');
    const target = one('SELECT * FROM users WHERE id=?', req.params.id); if (!target) throw err(404, 'User not found');
    const badge = String(req.body?.badge || ''); if (!GRANTABLE_BADGES.includes(badge)) throw err(400, 'Unknown badge');
    const set = new Set(pj(target.badges, []));
    if (req.body?.on) { set.add(badge); set.delete('-' + badge); } else { set.delete(badge); if (badge === 'og') set.add('-og'); }
    run('UPDATE users SET badges=? WHERE id=?', JSON.stringify([...set]), target.id);
    broadcastUser(target.id);
    res.json(getUser(target.id));
  }));
  app.get('/api/users/:id', auth, wrap((req, res) => {
    const u = getUser(req.params.id);
    if (!u) throw err(404, 'User not found');
    const mutual = all(`SELECT s.id, s.name, s.icon FROM servers s WHERE s.id IN (SELECT server_id FROM members WHERE user_id=?) AND s.id IN (SELECT server_id FROM members WHERE user_id=?)`, req.user.id, u.id);
    const mine = new Set(friendIds(req.user.id));
    const mutual_friends = u.id === req.user.id ? [] : friendIds(u.id).filter(f => mine.has(f) && f !== req.user.id);
    res.json({ ...u, mutual_servers: mutual, mutual_friends, relationship: relTo(req.user.id, u.id) });
  }));


  // ----- connections: Spotify (Authorization Code + PKCE, no client secret needed) -----
  const pkce = new Map(); // state -> {uid, verifier, redirect, expires}
  const baseUrl = (req) => PUBLIC_URL || `${(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  app.get('/api/connections/spotify/start', auth, wrap((req, res) => {
    if (!SPOTIFY_ID) throw err(400, 'Spotify isn’t set up on this Orbit server yet. The server owner needs to add a Spotify Client ID (see README).');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('hex');
    const redirect = baseUrl(req) + '/api/connections/spotify/callback';
    pkce.set(state, { uid: req.user.id, verifier, redirect, expires: now() + 10 * 60e3 });
    const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: SPOTIFY_ID, response_type: 'code', redirect_uri: redirect,
      code_challenge_method: 'S256', code_challenge: challenge, state, scope: 'user-read-currently-playing user-read-playback-state' });
    res.json({ url, redirect });
  }));
  const donePage = (res, ok, msg) => res.type('html').send(`<!DOCTYPE html><meta name=viewport content="width=device-width"><title>Orbit</title><body style="font-family:system-ui;background:#141127;color:#ece9ff;display:grid;place-items:center;height:100vh;margin:0;text-align:center"><div><h1 style="font-weight:700">${ok ? 'Spotify connected' : 'Couldn’t connect Spotify'}</h1><p style="color:#9a95c2">${msg}</p></div></body>`);
  app.get('/api/connections/spotify/callback', wrap(async (req, res) => {
    const st = pkce.get(String(req.query.state || '')); pkce.delete(String(req.query.state || ''));
    if (!st || st.expires < now()) return donePage(res, false, 'The link expired. Try connecting again from Orbit.');
    if (req.query.error) return donePage(res, false, 'You cancelled the connection. You can close this window.');
    const tok = await spotifyToken({ grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: st.redirect, client_id: SPOTIFY_ID, code_verifier: st.verifier });
    if (!tok.access_token) return donePage(res, false, 'Spotify didn’t accept the request. Check the app’s Redirect URI in the Spotify dashboard.');
    const meR = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: 'Bearer ' + tok.access_token } });
    const me = meR.ok ? await meR.json() : {};
    run('UPDATE users SET spotify=? WHERE id=?', JSON.stringify({ access: tok.access_token, refresh: tok.refresh_token, expires: now() + tok.expires_in * 1000 }), st.uid);
    const u = one('SELECT connections FROM users WHERE id=?', st.uid);
    const conns = pj(u.connections, []).filter(c => c.type !== 'spotify');
    conns.unshift({ type: 'spotify', name: me.display_name || me.id || 'Spotify', url: me.external_urls?.spotify || null, verified: true });
    run('UPDATE users SET connections=? WHERE id=?', JSON.stringify(conns), st.uid);
    broadcastUser(st.uid);
    pollSpotify(st.uid).catch(() => {});
    donePage(res, true, 'You can close this window and go back to Orbit. What you’re listening to now shows on your profile.');
  }));
  app.delete('/api/connections/spotify', auth, wrap((req, res) => {
    const conns = pj(req.user.connections, []).filter(c => c.type !== 'spotify');
    run('UPDATE users SET spotify=NULL, connections=? WHERE id=?', JSON.stringify(conns), req.user.id);
    setActivity(req.user.id, null); broadcastUser(req.user.id);
    res.json({ ok: true });
  }));
  async function spotifyToken(params) {
    const r = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
    return r.json().catch(() => ({}));
  }
  async function pollSpotify(uidv) {
    const row = one('SELECT spotify FROM users WHERE id=?', uidv);
    let t = pj(row?.spotify, null); if (!t) return setActivity(uidv, null);
    if (t.expires < now() + 30e3) {
      const n = await spotifyToken({ grant_type: 'refresh_token', refresh_token: t.refresh, client_id: SPOTIFY_ID });
      if (!n.access_token) { if (n.error === 'invalid_grant') run('UPDATE users SET spotify=NULL WHERE id=?', uidv); return setActivity(uidv, null); }
      t = { access: n.access_token, refresh: n.refresh_token || t.refresh, expires: now() + n.expires_in * 1000 };
      run('UPDATE users SET spotify=? WHERE id=?', JSON.stringify(t), uidv);
    }
    const r = await fetch('https://api.spotify.com/v1/me/player/currently-playing?additional_types=episode', { headers: { Authorization: 'Bearer ' + t.access } });
    if (r.status === 204 || !r.ok) return setActivity(uidv, null);
    const d = await r.json();
    const it = d.item;
    if (!it || !d.is_playing) return setActivity(uidv, null);
    const isEp = it.type === 'episode';
    setActivity(uidv, { type: 'listening', name: 'Spotify', title: it.name, artist: isEp ? it.show?.name : (it.artists || []).map(a => a.name).join(', '),
      album: isEp ? it.show?.name : it.album?.name, art: (isEp ? it.images : it.album?.images)?.[1]?.url || (isEp ? it.images : it.album?.images)?.[0]?.url || null,
      url: it.external_urls?.spotify || null, start: now() - (d.progress_ms || 0), end: now() - (d.progress_ms || 0) + (it.duration_ms || 0) });
  }
  function setActivity(uidv, a) {
    const prev = activities.get(uidv) || null;
    const same = (!a && !prev) || (a && prev && a.title === prev.title && a.artist === prev.artist && Math.abs(a.start - prev.start) < 4000);
    if (a) activities.set(uidv, a); else activities.delete(uidv);
    if (!same) audienceOf(uidv).forEach(x => io.to('u:' + x).emit('activity', { user_id: uidv, activity: a }));
  }
  if (SPOTIFY_ID) setInterval(() => { for (const uidv of online.keys()) pollSpotify(uidv).catch(() => {}); }, 12000);

  // ----- servers -----
  function createChannel(sid, type, name, extra = {}) {
    const id = uid();
    const pos = (one('SELECT MAX(position) p FROM channels WHERE server_id=?', sid)?.p ?? -1) + 1;
    run('INSERT INTO channels(id,server_id,type,name,topic,position,private,allowed_roles,created,parent_id) VALUES(?,?,?,?,?,?,?,?,?,?)', id, sid, type, name,
      extra.topic || '', pos, extra.private ? 1 : 0, JSON.stringify(extra.allowed_roles || []), now(), extra.parent_id || null);
    return id;
  }
  const cleanChanName = (n, type) => { const s = String(n || '').trim().slice(0, 40); return type === 'voice' || type === 'category' ? s : s.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, ''); };
  app.post('/api/servers', auth, wrap((req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    if (!name) throw err(400, 'Give your server a name');
    const sid = uid();
    tx(() => {
      run('INSERT INTO servers(id,name,owner_id,created) VALUES(?,?,?,?)', sid, name, req.user.id, now());
      run('INSERT INTO members(server_id,user_id,nick,joined) VALUES(?,?,?,?)', sid, req.user.id, null, now());
      run('INSERT INTO roles(id,server_id,name,color,perms,position,hoist,is_default) VALUES(?,?,?,?,?,?,?,1)', uid(), sid, '@everyone', '', DEFAULT_PERMS, 0, 0);
      const tc = createChannel(sid, 'category', 'Text Channels'), vc = createChannel(sid, 'category', 'Voice Channels');
      createChannel(sid, 'text', 'general', { parent_id: tc });
      createChannel(sid, 'text', 'media', { parent_id: tc });
      createChannel(sid, 'voice', 'General', { parent_id: vc });
      createChannel(sid, 'voice', 'Gaming', { parent_id: vc });
    });
    joinRooms(req.user.id, sid);
    res.json(serverPayload(sid, req.user.id));
  }));
  app.get('/api/servers/:id', auth, wrap((req, res) => {
    if (!isMember(req.params.id, req.user.id)) throw err(403, 'You are not in this server');
    res.json(serverPayload(req.params.id, req.user.id));
  }));
  app.patch('/api/servers/:id', auth, wrap((req, res) => {
    const sid = req.params.id;
    if (!has(sid, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
    const s = one('SELECT * FROM servers WHERE id=?', sid);
    const b = req.body || {};
    run('UPDATE servers SET name=?, description=? WHERE id=?', String(b.name ?? s.name).trim().slice(0, 50) || s.name, String(b.description ?? s.description).slice(0, 300), sid);
    if (b.icon === null) run('UPDATE servers SET icon=NULL WHERE id=?', sid);
    if (b.banner === null) run('UPDATE servers SET banner=NULL WHERE id=?', sid);
    refreshServer(sid);
    res.json({ ok: true });
  }));
  app.post('/api/servers/:id/image/:kind', auth, imageOnly.single('file'), wrap((req, res) => {
    if (!['icon', 'banner'].includes(req.params.kind)) throw err(404, 'Not found');
    if (!has(req.params.id, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
    if (!req.file) throw err(400, 'Upload an image');
    run(`UPDATE servers SET ${req.params.kind}=? WHERE id=?`, fileUrl(req.file), req.params.id);
    refreshServer(req.params.id);
    res.json({ ok: true });
  }));
  app.delete('/api/servers/:id', auth, wrap((req, res) => {
    const s = one('SELECT * FROM servers WHERE id=?', req.params.id);
    if (!s || s.owner_id !== req.user.id) throw err(403, 'Only the owner can delete the server');
    const ids = all('SELECT user_id FROM members WHERE server_id=?', s.id).map(r => r.user_id);
    run('DELETE FROM servers WHERE id=?', s.id);
    ids.forEach(i => io.to('u:' + i).emit('server:removed', { server_id: s.id, reason: 'deleted' }));
    io.in('s:' + s.id).socketsLeave('s:' + s.id);
    res.json({ ok: true });
  }));
  app.post('/api/servers/:id/leave', auth, wrap((req, res) => {
    const s = one('SELECT * FROM servers WHERE id=?', req.params.id);
    if (!s) throw err(404, 'Not found');
    if (s.owner_id === req.user.id) throw err(400, 'Transfer ownership or delete the server instead');
    removeMember(s.id, req.user.id, 'left');
    res.json({ ok: true });
  }));
  app.post('/api/servers/:id/transfer', auth, wrap((req, res) => {
    const s = one('SELECT * FROM servers WHERE id=?', req.params.id);
    if (!s || s.owner_id !== req.user.id) throw err(403, 'Only the owner can do that');
    if (!isMember(s.id, req.body?.user_id)) throw err(400, 'That user is not a member');
    run('UPDATE servers SET owner_id=? WHERE id=?', req.body.user_id, s.id);
    refreshServer(s.id);
    res.json({ ok: true });
  }));
  function removeMember(sid, uidv, reason) {
    run('DELETE FROM member_roles WHERE server_id=? AND user_id=?', sid, uidv);
    run('DELETE FROM members WHERE server_id=? AND user_id=?', sid, uidv);
    io.to('u:' + uidv).emit('server:removed', { server_id: sid, reason });
    io.in('u:' + uidv).socketsLeave('s:' + sid);
    // drop from any voice channel in that server
    for (const [cid, room] of voice) { const ch = chanRow(cid); if (ch && ch.server_id === sid && room.has(uidv)) leaveVoice(uidv); }
    systemMessage(sid, `${getUser(uidv)?.display_name || 'Someone'} ${reason === 'left' ? 'left the server' : reason === 'banned' ? 'was banned' : 'was kicked'}.`);
    refreshServer(sid);
  }
  function systemMessage(sid, text) {
    const ch = one(`SELECT * FROM channels WHERE server_id=? AND type='text' AND private=0 ORDER BY position LIMIT 1`, sid);
    if (!ch) return;
    const r = run('INSERT INTO messages(channel_id,author_id,content,created,system) VALUES(?,?,?,?,1)', ch.id, null, text, now());
    emitToChannel(ch, 'message:new', msgById(Number(r.lastInsertRowid)));
  }

  // ----- invites -----
  app.post('/api/servers/:id/invites', auth, wrap((req, res) => {
    if (!has(req.params.id, req.user.id, P.CREATE_INVITE)) throw err(403, 'Missing permission');
    const existing = one('SELECT code FROM invites WHERE server_id=? AND creator=?', req.params.id, req.user.id);
    if (existing) return res.json({ code: existing.code });
    const code = crypto.randomBytes(5).toString('base64url');
    run('INSERT INTO invites(code,server_id,creator,created) VALUES(?,?,?,?)', code, req.params.id, req.user.id, now());
    res.json({ code });
  }));
  app.get('/api/servers/:id/invites', auth, wrap((req, res) => {
    if (!has(req.params.id, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
    res.json(all('SELECT * FROM invites WHERE server_id=? ORDER BY created DESC', req.params.id).map(i => ({ ...i, creator: getUser(i.creator) })));
  }));
  app.delete('/api/invites/:code', auth, wrap((req, res) => {
    const i = one('SELECT * FROM invites WHERE code=?', req.params.code);
    if (!i || !has(i.server_id, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
    run('DELETE FROM invites WHERE code=?', i.code);
    res.json({ ok: true });
  }));
  const parseCode = (c) => String(c || '').trim().split('/').pop().replace(/[^A-Za-z0-9_-]/g, '');
  app.get('/api/invites/:code', wrap((req, res) => {
    const i = one('SELECT * FROM invites WHERE code=?', parseCode(req.params.code));
    if (!i) throw err(404, 'This invite is invalid or has expired');
    const s = one('SELECT * FROM servers WHERE id=?', i.server_id);
    const count = one('SELECT COUNT(*) c FROM members WHERE server_id=?', s.id).c;
    res.json({ code: i.code, server: { ...serverSummary(s), banner: s.banner, description: s.description, members: count, online: [...online.keys()].filter(u => isMember(s.id, u)).length } });
  }));
  app.post('/api/invites/:code', auth, wrap((req, res) => {
    const i = one('SELECT * FROM invites WHERE code=?', parseCode(req.params.code));
    if (!i) throw err(404, 'This invite is invalid or has expired');
    if (one('SELECT 1 FROM bans WHERE server_id=? AND user_id=?', i.server_id, req.user.id)) throw err(403, 'You are banned from this server');
    if (!isMember(i.server_id, req.user.id)) {
      run('INSERT INTO members(server_id,user_id,nick,joined) VALUES(?,?,?,?)', i.server_id, req.user.id, null, now());
      run('UPDATE invites SET uses=uses+1 WHERE code=?', i.code);
      joinRooms(req.user.id, i.server_id);
      broadcastPresence(req.user.id);
      systemMessage(i.server_id, `${req.user.display_name || req.user.username} joined the server. Say hi! 👋`);
      refreshServer(i.server_id);
    }
    res.json(serverPayload(i.server_id, req.user.id));
  }));

  // ----- channels -----
  app.post('/api/servers/:id/channels', auth, wrap((req, res) => {
    const sid = req.params.id;
    if (!has(sid, req.user.id, P.MANAGE_CHANNELS)) throw err(403, 'Missing permission');
    const type = ['voice', 'category', 'forum'].includes(req.body?.type) ? req.body.type : 'text';
    const parent = type !== 'category' && req.body?.parent_id ? one(`SELECT id FROM channels WHERE id=? AND server_id=? AND type='category'`, String(req.body.parent_id), sid) : null;
    const name = cleanChanName(req.body?.name, type);
    if (!name) throw err(400, 'Give the channel a name');
    const id = createChannel(sid, type, name, { topic: String(req.body?.topic || '').slice(0, 300), private: !!req.body?.private, allowed_roles: Array.isArray(req.body?.allowed_roles) ? req.body.allowed_roles : [], parent_id: parent?.id });
    refreshServer(sid);
    res.json(fmtChannel(chanRow(id)));
  }));
  app.patch('/api/channels/:id', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || ch.type === 'dm' || !has(ch.server_id, req.user.id, P.MANAGE_CHANNELS)) throw err(403, 'Missing permission');
    const b = req.body || {};
    if (b.parent_id !== undefined && ch.type !== 'category') {
      const parent = b.parent_id ? one(`SELECT id FROM channels WHERE id=? AND server_id=? AND type='category'`, String(b.parent_id), ch.server_id) : null;
      if (b.parent_id && !parent) throw err(400, 'That category doesn’t exist');
      run('UPDATE channels SET parent_id=? WHERE id=?', parent?.id || null, ch.id);
    }
    if (b.slowmode !== undefined) run('UPDATE channels SET slowmode=? WHERE id=?', Math.max(0, Math.min(21600, Math.floor(Number(b.slowmode) || 0))), ch.id);
    run('UPDATE channels SET name=?, topic=?, private=?, allowed_roles=?, position=? WHERE id=?',
      b.name !== undefined ? (cleanChanName(b.name, ch.type) || ch.name) : ch.name, b.topic !== undefined ? String(b.topic).slice(0, 300) : ch.topic,
      b.private !== undefined ? (b.private ? 1 : 0) : ch.private, b.allowed_roles !== undefined ? JSON.stringify(b.allowed_roles) : ch.allowed_roles,
      b.position !== undefined ? Number(b.position) : ch.position, ch.id);
    refreshServer(ch.server_id);
    res.json(fmtChannel(chanRow(ch.id)));
  }));
  app.delete('/api/channels/:id', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || ch.type === 'dm' || !has(ch.server_id, req.user.id, P.MANAGE_CHANNELS)) throw err(403, 'Missing permission');
    const room = voice.get(ch.id);
    if (room) [...room.keys()].forEach(leaveVoice);
    if (ch.type === 'category') run('UPDATE channels SET parent_id=NULL WHERE parent_id=?', ch.id);
    run('DELETE FROM channels WHERE id=?', ch.id);
    refreshServer(ch.server_id);
    res.json({ ok: true });
  }));
  // drag & drop: save the whole channel order in one go. Body: [{ id, position, parent_id }]
  app.put('/api/servers/:id/channels/order', auth, wrap((req, res) => {
    const sid = req.params.id;
    if (!has(sid, req.user.id, P.MANAGE_CHANNELS)) throw err(403, 'Missing permission');
    const list = Array.isArray(req.body) ? req.body.slice(0, 500) : [];
    const mine = new Map(all('SELECT id, type FROM channels WHERE server_id=?', sid).map(c => [c.id, c.type]));
    tx(() => list.forEach(({ id, position, parent_id }) => {
      if (!mine.has(id)) return;
      const isCat = mine.get(id) === 'category';
      const parent = !isCat && parent_id && mine.get(parent_id) === 'category' ? parent_id : null;
      run('UPDATE channels SET position=?, parent_id=? WHERE id=?', Math.round(Number(position) || 0), isCat ? null : parent, id);
    }));
    refreshServer(sid);
    res.json({ ok: true });
  }));

  // ----- roles & members -----
  app.post('/api/servers/:id/roles', auth, wrap((req, res) => {
    const sid = req.params.id;
    if (!has(sid, req.user.id, P.MANAGE_ROLES)) throw err(403, 'Missing permission');
    const pos = (one('SELECT MAX(position) p FROM roles WHERE server_id=?', sid)?.p ?? 0) + 1;
    const id = uid();
    run('INSERT INTO roles(id,server_id,name,color,perms,position,hoist) VALUES(?,?,?,?,?,?,1)', id, sid, String(req.body?.name || 'new role').slice(0, 32), req.body?.color || '#99aab5', DEFAULT_PERMS, pos);
    refreshServer(sid);
    res.json(one('SELECT * FROM roles WHERE id=?', id));
  }));
  app.patch('/api/roles/:id', auth, wrap((req, res) => {
    const r = one('SELECT * FROM roles WHERE id=?', req.params.id);
    if (!r || !has(r.server_id, req.user.id, P.MANAGE_ROLES)) throw err(403, 'Missing permission');
    const b = req.body || {};
    let perms = b.perms !== undefined ? Number(b.perms) & ALL : r.perms;
    if ((perms & P.ADMIN) && !has(r.server_id, req.user.id, P.ADMIN)) throw err(403, 'Only admins can grant Administrator');
    run('UPDATE roles SET name=?, color=?, perms=?, hoist=?, position=? WHERE id=?', r.is_default ? '@everyone' : String(b.name ?? r.name).slice(0, 32),
      /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : r.color, perms, b.hoist !== undefined ? (b.hoist ? 1 : 0) : r.hoist, b.position ?? r.position, r.id);
    refreshServer(r.server_id);
    res.json({ ok: true });
  }));
  app.delete('/api/roles/:id', auth, wrap((req, res) => {
    const r = one('SELECT * FROM roles WHERE id=?', req.params.id);
    if (!r || r.is_default || !has(r.server_id, req.user.id, P.MANAGE_ROLES)) throw err(403, 'Missing permission');
    run('DELETE FROM roles WHERE id=?', r.id);
    refreshServer(r.server_id);
    res.json({ ok: true });
  }));
  app.put('/api/servers/:id/members/:uid', auth, wrap((req, res) => {
    const sid = req.params.id, target = req.params.uid, b = req.body || {};
    if (!isMember(sid, target)) throw err(404, 'Not a member');
    if (b.roles !== undefined) {
      if (!has(sid, req.user.id, P.MANAGE_ROLES)) throw err(403, 'Missing permission');
      const valid = all('SELECT id FROM roles WHERE server_id=? AND is_default=0', sid).map(r => r.id);
      tx(() => {
        run('DELETE FROM member_roles WHERE server_id=? AND user_id=?', sid, target);
        b.roles.filter(r => valid.includes(r)).forEach(r => run('INSERT INTO member_roles VALUES(?,?,?)', sid, target, r));
      });
    }
    if (b.nick !== undefined) {
      if (target !== req.user.id && !has(sid, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
      run('UPDATE members SET nick=? WHERE server_id=? AND user_id=?', String(b.nick || '').slice(0, 32) || null, sid, target);
    }
    refreshServer(sid);
    res.json({ ok: true });
  }));
  function outranks(sid, actor, target) {
    const s = one('SELECT owner_id FROM servers WHERE id=?', sid);
    if (target === s.owner_id) return false;
    if (actor === s.owner_id) return true;
    const top = (u) => Math.max(0, ...all(`SELECT r.position FROM roles r JOIN member_roles m ON m.role_id=r.id WHERE m.server_id=? AND m.user_id=?`, sid, u).map(r => r.position));
    return top(actor) > top(target);
  }
  app.post('/api/servers/:id/kick/:uid', auth, wrap((req, res) => {
    const sid = req.params.id, t = req.params.uid;
    if (!has(sid, req.user.id, P.KICK) || !outranks(sid, req.user.id, t)) throw err(403, 'You can’t kick this member');
    removeMember(sid, t, 'kicked');
    res.json({ ok: true });
  }));
  app.post('/api/servers/:id/ban/:uid', auth, wrap((req, res) => {
    const sid = req.params.id, t = req.params.uid;
    if (!has(sid, req.user.id, P.BAN) || !outranks(sid, req.user.id, t)) throw err(403, 'You can’t ban this member');
    run('INSERT OR REPLACE INTO bans VALUES(?,?,?,?)', sid, t, String(req.body?.reason || '').slice(0, 200), now());
    if (req.body?.delete_messages) {
      const chans = all('SELECT id FROM channels WHERE server_id=?', sid).map(c => c.id);
      chans.forEach(c => { all('SELECT id FROM messages WHERE channel_id=? AND author_id=? AND created>?', c, t, now() - 86400e3).forEach(m => deleteMessage(m.id)); });
    }
    if (isMember(sid, t)) removeMember(sid, t, 'banned');
    res.json({ ok: true });
  }));
  app.get('/api/servers/:id/bans', auth, wrap((req, res) => {
    if (!has(req.params.id, req.user.id, P.BAN)) throw err(403, 'Missing permission');
    res.json(all('SELECT * FROM bans WHERE server_id=?', req.params.id).map(b => ({ ...b, user: getUser(b.user_id) })));
  }));
  app.delete('/api/servers/:id/bans/:uid', auth, wrap((req, res) => {
    if (!has(req.params.id, req.user.id, P.BAN)) throw err(403, 'Missing permission');
    run('DELETE FROM bans WHERE server_id=? AND user_id=?', req.params.id, req.params.uid);
    res.json({ ok: true });
  }));

  // ----- DMs -----
  app.post('/api/dms', auth, wrap((req, res) => {
    const other = req.body?.user_id;
    if (!other || !getUser(other)) throw err(404, 'User not found');
    if (other !== req.user.id && eitherBlocks(req.user.id, other)) throw err(403, 'You can’t message this person.');
    let ch = one(`SELECT c.* FROM channels c WHERE c.type='dm' AND c.is_group=0 AND c.id IN (SELECT channel_id FROM dm_members WHERE user_id=?) AND c.id IN (SELECT channel_id FROM dm_members WHERE user_id=?)
      AND (SELECT COUNT(*) FROM dm_members WHERE channel_id=c.id)=?`, req.user.id, other, other === req.user.id ? 1 : 2);
    if (!ch) {
      const id = uid();
      tx(() => {
        run(`INSERT INTO channels(id,server_id,type,name,created) VALUES(?,NULL,'dm','',?)`, id, now());
        run('INSERT INTO dm_members VALUES(?,?)', id, req.user.id);
        if (other !== req.user.id) run('INSERT INTO dm_members VALUES(?,?)', id, other);
      });
      ch = chanRow(id);
    }
    res.json(dmEntry(chanRow(ch.id), req.user.id));
  }));

  function gcSystem(cid, text) {
    const r = run('INSERT INTO messages(channel_id,author_id,content,created,system) VALUES(?,?,?,?,1)', cid, null, text, now());
    emitToChannel(chanRow(cid), 'message:new', msgById(Number(r.lastInsertRowid)));
  }
  function pushDm(cid) {
    const ch = chanRow(cid);
    all('SELECT user_id FROM dm_members WHERE channel_id=?', cid).forEach(r => io.to('u:' + r.user_id).emit('dm:update', dmEntry(ch, r.user_id)));
  }
  // create a group chat (or a 1-1 DM when only one other person is chosen)
  app.post('/api/groups', auth, wrap((req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.members) ? req.body.members : []).filter(x => x && x !== req.user.id && getUser(x)))];
    if (!ids.length) throw err(400, 'Pick at least one person');
    if (ids.length + 1 > GROUP_MAX) throw err(400, `Group chats can have up to ${GROUP_MAX} people`);
    if (ids.length === 1) {
      // fall back to a normal DM
      let ch = one(`SELECT c.* FROM channels c WHERE c.type='dm' AND c.is_group=0 AND c.id IN (SELECT channel_id FROM dm_members WHERE user_id=?) AND c.id IN (SELECT channel_id FROM dm_members WHERE user_id=?) AND (SELECT COUNT(*) FROM dm_members WHERE channel_id=c.id)=2`, req.user.id, ids[0]);
      if (!ch) { const id = uid(); tx(() => { run(`INSERT INTO channels(id,server_id,type,name,created) VALUES(?,NULL,'dm','',?)`, id, now()); run('INSERT INTO dm_members VALUES(?,?)', id, req.user.id); run('INSERT INTO dm_members VALUES(?,?)', id, ids[0]); }); ch = chanRow(id); }
      return res.json(dmEntry(chanRow(ch.id), req.user.id));
    }
    const id = uid();
    tx(() => {
      run(`INSERT INTO channels(id,server_id,type,name,is_group,gc_owner,created) VALUES(?,NULL,'dm','',1,?,?)`, id, req.user.id, now());
      run('INSERT INTO dm_members VALUES(?,?)', id, req.user.id);
      ids.forEach(u => run('INSERT INTO dm_members VALUES(?,?)', id, u));
    });
    gcSystem(id, `${req.user.display_name || req.user.username} started a group chat.`);
    pushDm(id);
    res.json(dmEntry(chanRow(id), req.user.id));
  }));
  const isGroupMember = (cid, uidv) => !!one('SELECT 1 FROM dm_members WHERE channel_id=? AND user_id=?', cid, uidv);
  app.post('/api/channels/:id/recipients', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || !ch.is_group || !isGroupMember(ch.id, req.user.id)) throw err(403, 'No access');
    const target = req.body?.user_id;
    if (!getUser(target)) throw err(404, 'User not found');
    if (isGroupMember(ch.id, target)) throw err(400, 'They are already in this group');
    const count = one('SELECT COUNT(*) c FROM dm_members WHERE channel_id=?', ch.id).c;
    if (count >= GROUP_MAX) throw err(400, `Group chats can have up to ${GROUP_MAX} people`);
    run('INSERT INTO dm_members VALUES(?,?)', ch.id, target);
    io.to('u:' + target).emit('dm:update', dmEntry(chanRow(ch.id), target));
    gcSystem(ch.id, `${nameOf(req.user.id)} added ${nameOf(target)}.`);
    pushDm(ch.id);
    res.json({ ok: true });
  }));
  app.delete('/api/channels/:id/recipients/:uid', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    const target = req.params.uid;
    if (!ch || !ch.is_group) throw err(404, 'Not found');
    const self = target === req.user.id;
    if (!self && ch.gc_owner !== req.user.id) throw err(403, 'Only the group owner can remove people');
    if (!isGroupMember(ch.id, target)) throw err(404, 'Not in this group');
    run('DELETE FROM dm_members WHERE channel_id=? AND user_id=?', ch.id, target);
    io.to('u:' + target).emit('server:removed', { channel_id: ch.id, group: true });
    io.in('u:' + target).socketsLeave('dm:' + ch.id);
    for (const [cid, room] of voice) if (cid === ch.id && room.has(target)) leaveVoice(target);
    const remaining = all('SELECT user_id FROM dm_members WHERE channel_id=?', ch.id).map(r => r.user_id);
    if (!remaining.length) { run('DELETE FROM channels WHERE id=?', ch.id); return res.json({ ok: true }); }
    if (self && ch.gc_owner === target) run('UPDATE channels SET gc_owner=? WHERE id=?', remaining[0], ch.id);
    gcSystem(ch.id, self ? `${nameOf(target)} left the group.` : `${nameOf(req.user.id)} removed ${nameOf(target)}.`);
    pushDm(ch.id);
    res.json({ ok: true });
  }));
  app.patch('/api/groups/:id', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || !ch.is_group || !isGroupMember(ch.id, req.user.id)) throw err(403, 'No access');
    if (req.body?.owner !== undefined) {
      // hand the group to someone else (owner only)
      const to = String(req.body.owner);
      if (ch.gc_owner !== req.user.id) throw err(403, 'Only the group owner can do that');
      if (!isGroupMember(ch.id, to) || to === req.user.id) throw err(400, 'Pick someone in this group');
      run('UPDATE channels SET gc_owner=? WHERE id=?', to, ch.id);
      gcSystem(ch.id, `${nameOf(req.user.id)} made ${nameOf(to)} the group owner.`);
      pushDm(ch.id);
      return res.json({ ok: true });
    }
    const name = String(req.body?.name ?? ch.name).slice(0, 60);
    run('UPDATE channels SET name=? WHERE id=?', name, ch.id);
    gcSystem(ch.id, `${nameOf(req.user.id)} named the group ${name || 'Group chat'}.`);
    pushDm(ch.id);
    res.json({ ok: true });
  }));
  app.post('/api/groups/:id/icon', auth, imageOnly.single('file'), wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || !ch.is_group || !isGroupMember(ch.id, req.user.id)) throw err(403, 'No access');
    if (!req.file) throw err(400, 'Upload an image');
    run('UPDATE channels SET gc_icon=? WHERE id=?', fileUrl(req.file), ch.id);
    pushDm(ch.id);
    res.json({ ok: true });
  }));

  // ----- GIFs (Giphy proxy; key stays server-side) -----
  app.get('/api/gifs', auth, wrap(async (req, res) => {
    if (!GIPHY_KEY) throw err(400, 'GIFs aren’t set up on this server.');
    const q = String(req.query.q || '').trim().slice(0, 100);
    const offset = Math.min(Number(req.query.offset) || 0, 200);
    const base = q ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending';
    const params = new URLSearchParams({ api_key: GIPHY_KEY, limit: '24', offset: String(offset), rating: 'pg-13', bundle: 'messaging_non_clips' });
    if (q) params.set('q', q);
    let data;
    try { const r = await fetch(base + '?' + params); data = await r.json(); } catch { throw err(502, 'Couldn’t reach Giphy.'); }
    const gifs = (data.data || []).map(g => {
      const im = g.images || {};
      const full = im.downsized_medium || im.original || {};
      const prev = im.fixed_width_small || im.fixed_width || full;
      return { id: g.id, url: full.url, preview: prev.url, w: Number(prev.width) || 200, h: Number(prev.height) || 200, title: g.title || 'GIF' };
    }).filter(g => g.url);
    res.json({ gifs });
  }));

  // ----- friends -----
  app.get('/api/friends', auth, wrap((req, res) => res.json(friendsPayload(req.user.id))));
  app.post('/api/friends', auth, wrap((req, res) => {
    const q = String(req.body?.username || '').trim().replace(/^@/, '');
    if (!q) throw err(400, 'Enter a username');
    const target = one('SELECT * FROM users WHERE username=? COLLATE NOCASE', q);
    if (!target) throw err(404, `No one here goes by "${q}".`);
    if (target.id === req.user.id) throw err(400, 'You can’t add yourself.');
    if (eitherBlocks(req.user.id, target.id)) throw err(403, 'You can’t add this person.');
    const [a, b] = pair(req.user.id, target.id);
    const existing = one('SELECT * FROM friends WHERE a=? AND b=?', a, b);
    if (existing) {
      if (existing.status === 'accepted') throw err(400, 'You’re already friends.');
      if (existing.requester === req.user.id) throw err(400, 'You already sent them a request.');
      // they already requested you -> accept
      run('UPDATE friends SET status=? WHERE a=? AND b=?', 'accepted', a, b);
      [req.user.id, target.id].forEach(pushFriends);
      broadcastUser(req.user.id); broadcastUser(target.id);
      broadcastPresence(req.user.id); broadcastPresence(target.id);
      return res.json({ status: 'friend' });
    }
    run('INSERT INTO friends(a,b,status,requester,created) VALUES(?,?,?,?,?)', a, b, 'pending', req.user.id, now());
    [req.user.id, target.id].forEach(pushFriends);
    io.to('u:' + target.id).emit('friends:request', { from: getUser(req.user.id) });
    res.json({ status: 'outgoing' });
  }));
  app.post('/api/friends/:uid/accept', auth, wrap((req, res) => {
    const [a, b] = pair(req.user.id, req.params.uid);
    const r = one('SELECT * FROM friends WHERE a=? AND b=? AND status=?', a, b, 'pending');
    if (!r || r.requester === req.user.id) throw err(404, 'No pending request from them.');
    run('UPDATE friends SET status=? WHERE a=? AND b=?', 'accepted', a, b);
    [req.user.id, req.params.uid].forEach(pushFriends);
    broadcastUser(req.user.id); broadcastUser(req.params.uid);
    broadcastPresence(req.user.id); broadcastPresence(req.params.uid);
    io.to('u:' + req.params.uid).emit('friends:accepted', { user: getUser(req.user.id) });
    res.json({ ok: true });
  }));
  app.delete('/api/friends/:uid', auth, wrap((req, res) => {
    // removes a friend, cancels an outgoing request, or declines an incoming one
    const [a, b] = pair(req.user.id, req.params.uid);
    run('DELETE FROM friends WHERE a=? AND b=?', a, b);
    [req.user.id, req.params.uid].forEach(pushFriends);
    res.json({ ok: true });
  }));
  app.post('/api/friends/:uid/block', auth, wrap((req, res) => {
    const target = req.params.uid;
    if (target === req.user.id || !getUser(target)) throw err(400, 'Can’t block that.');
    const [a, b] = pair(req.user.id, target);
    run('DELETE FROM friends WHERE a=? AND b=?', a, b);
    run('INSERT OR REPLACE INTO blocks VALUES(?,?,?)', req.user.id, target, now());
    [req.user.id, target].forEach(pushFriends);
    res.json({ ok: true });
  }));
  app.delete('/api/friends/:uid/block', auth, wrap((req, res) => {
    run('DELETE FROM blocks WHERE blocker=? AND blocked=?', req.user.id, req.params.uid);
    pushFriends(req.user.id);
    res.json({ ok: true });
  }));

  // ----- privacy settings: read receipts, strict blocking, invisible-to-specific-people -----
  app.patch('/api/me/privacy', auth, wrap((req, res) => {
    const b = req.body || {};
    if (b.read_receipts !== undefined) run('UPDATE users SET read_receipts=? WHERE id=?', b.read_receipts ? 1 : 0, req.user.id);
    if (b.block_mode !== undefined && ['standard', 'strict'].includes(b.block_mode)) run('UPDATE users SET block_mode=? WHERE id=?', b.block_mode, req.user.id);
    if (Array.isArray(b.invisible_to)) {
      const fset = new Set(friendIds(req.user.id));
      const wanted = [...new Set(b.invisible_to.filter(x => fset.has(x)))];
      run('DELETE FROM invisible_to WHERE user_id=?', req.user.id);
      const ins = db.prepare('INSERT OR IGNORE INTO invisible_to(user_id,target_id) VALUES(?,?)');
      wanted.forEach(t => ins.run(req.user.id, t));
      // anyone whose view of me changed needs a fresh presence ping
      broadcastPresence(req.user.id);
    }
    const u = one('SELECT read_receipts, block_mode FROM users WHERE id=?', req.user.id);
    res.json({ read_receipts: u.read_receipts == null ? 1 : u.read_receipts, block_mode: u.block_mode || 'standard',
      invisible_to: all('SELECT target_id FROM invisible_to WHERE user_id=?', req.user.id).map(r => r.target_id) });
  }));

  // ----- personal notes on friends (private to the author) -----
  app.get('/api/notes/:uid', auth, wrap((req, res) => {
    const r = one('SELECT note, updated FROM friend_notes WHERE user_id=? AND target_id=?', req.user.id, req.params.uid);
    res.json({ note: r?.note || '', updated: r?.updated || 0 });
  }));
  app.put('/api/notes/:uid', auth, wrap((req, res) => {
    const note = String(req.body?.note ?? '').slice(0, 2000);
    if (!note.trim()) run('DELETE FROM friend_notes WHERE user_id=? AND target_id=?', req.user.id, req.params.uid);
    else run('INSERT OR REPLACE INTO friend_notes(user_id,target_id,note,updated) VALUES(?,?,?,?)', req.user.id, req.params.uid, note, now());
    res.json({ ok: true, note });
  }));

  // ----- message bookmarks with folders + searchable labels -----
  app.get('/api/bookmarks', auth, wrap((req, res) => {
    const rows = all('SELECT * FROM bookmarks WHERE user_id=? ORDER BY created DESC', req.user.id);
    const items = rows.map(r => {
      const m = one('SELECT * FROM messages WHERE id=?', r.message_id);
      const ch = m ? chanRow(m.channel_id) : null;
      const viewable = m && ch && canView(ch, req.user.id);
      return { id: r.id, folder_id: r.folder_id || null, label: r.label || '', created: r.created,
        message_id: r.message_id, channel_id: r.channel_id, missing: !viewable,
        author: viewable ? getUser(m.author_id) : null,
        content: viewable ? (m.content || '') : '', at: viewable ? m.created : 0,
        where: ch ? chanLabel(ch, req.user.id) : '' };
    });
    res.json({ folders: bookmarkFolders(req.user.id), items });
  }));
  app.post('/api/bookmarks', auth, wrap((req, res) => {
    const mid = Number(req.body?.message_id);
    const m = one('SELECT * FROM messages WHERE id=?', mid);
    if (!m) throw err(404, 'Message not found');
    const ch = chanRow(m.channel_id);
    if (!canView(ch, req.user.id)) throw err(403, 'No access');
    const existing = one('SELECT id FROM bookmarks WHERE user_id=? AND message_id=?', req.user.id, mid);
    const folder = req.body.folder_id ? one('SELECT id FROM bookmark_folders WHERE id=? AND user_id=?', req.body.folder_id, req.user.id)?.id || null : null;
    const label = String(req.body.label || '').slice(0, 80);
    if (existing) { run('UPDATE bookmarks SET folder_id=?, label=? WHERE id=?', folder, label, existing.id); return res.json({ ok: true, id: existing.id }); }
    const id = uid();
    run('INSERT INTO bookmarks(id,user_id,message_id,channel_id,folder_id,label,created) VALUES(?,?,?,?,?,?,?)', id, req.user.id, mid, m.channel_id, folder, label, now());
    res.json({ ok: true, id });
  }));
  app.patch('/api/bookmarks/:id', auth, wrap((req, res) => {
    const bm = one('SELECT * FROM bookmarks WHERE id=? AND user_id=?', req.params.id, req.user.id);
    if (!bm) throw err(404, 'Not found');
    const folder = req.body?.folder_id ? one('SELECT id FROM bookmark_folders WHERE id=? AND user_id=?', req.body.folder_id, req.user.id)?.id || null : null;
    const label = req.body?.label !== undefined ? String(req.body.label).slice(0, 80) : bm.label;
    run('UPDATE bookmarks SET folder_id=?, label=? WHERE id=?', req.body?.folder_id !== undefined ? folder : bm.folder_id, label, bm.id);
    res.json({ ok: true });
  }));
  app.delete('/api/bookmarks/:id', auth, wrap((req, res) => {
    run('DELETE FROM bookmarks WHERE id=? AND user_id=?', req.params.id, req.user.id); res.json({ ok: true });
  }));
  app.post('/api/bookmark-folders', auth, wrap((req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 40);
    if (!name) throw err(400, 'Name required');
    if (all('SELECT 1 FROM bookmark_folders WHERE user_id=?', req.user.id).length >= 50) throw err(400, 'Too many folders');
    const color = /^#[0-9a-f]{6}$/i.test(req.body?.color || '') ? req.body.color : '#7c5cff';
    const id = uid();
    run('INSERT INTO bookmark_folders(id,user_id,name,color,created) VALUES(?,?,?,?,?)', id, req.user.id, name, color, now());
    res.json({ id, name, color });
  }));
  app.patch('/api/bookmark-folders/:id', auth, wrap((req, res) => {
    const f = one('SELECT * FROM bookmark_folders WHERE id=? AND user_id=?', req.params.id, req.user.id);
    if (!f) throw err(404, 'Not found');
    const name = req.body?.name !== undefined ? String(req.body.name).trim().slice(0, 40) || f.name : f.name;
    const color = /^#[0-9a-f]{6}$/i.test(req.body?.color || '') ? req.body.color : f.color;
    run('UPDATE bookmark_folders SET name=?, color=? WHERE id=?', name, color, f.id);
    res.json({ ok: true });
  }));
  app.delete('/api/bookmark-folders/:id', auth, wrap((req, res) => {
    run('UPDATE bookmarks SET folder_id=NULL WHERE user_id=? AND folder_id=?', req.user.id, req.params.id);
    run('DELETE FROM bookmark_folders WHERE id=? AND user_id=?', req.params.id, req.user.id);
    res.json({ ok: true });
  }));

  // ----- temporary voice channel passes (time-limited access to a voice channel) -----
  app.post('/api/channels/:id/voicepass', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || ch.type !== 'voice') throw err(404, 'Not a voice channel');
    if (!has(ch.server_id, req.user.id, P.MANAGE_CHANNELS)) throw err(403, 'You can’t manage this channel');
    const target = getUser(req.body?.user);
    if (!target) throw err(404, 'User not found');
    const minutes = Math.min(1440, Math.max(5, Number(req.body?.minutes) || 60));
    const expires = now() + minutes * 60e3;
    const id = uid();
    run('DELETE FROM voice_passes WHERE channel_id=? AND user_id=?', ch.id, target.id);
    run('INSERT INTO voice_passes(id,channel_id,user_id,granted_by,expires,created) VALUES(?,?,?,?,?,?)', id, ch.id, target.id, req.user.id, expires, now());
    io.to('u:' + target.id).emit('voicepass', { channel_id: ch.id, server_id: ch.server_id, name: ch.name, expires, by: getUser(req.user.id) });
    res.json({ ok: true, expires });
  }));
  app.delete('/api/channels/:id/voicepass/:uid', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || !has(ch.server_id, req.user.id, P.MANAGE_CHANNELS)) throw err(403, 'No access');
    run('DELETE FROM voice_passes WHERE channel_id=? AND user_id=?', ch.id, req.params.uid);
    res.json({ ok: true });
  }));
  const hasVoicePass = (cid, uidv) => !!one('SELECT 1 FROM voice_passes WHERE channel_id=? AND user_id=? AND expires>?', cid, uidv, now());

  // ----- link previews (embeds) -----
  // Fetches the page the link points to and reads its title/description/image. Refuses private,
  // local and cloud-metadata addresses (checked at connect time, so DNS tricks can't sneak past).
  const dnsMod = require('dns'); const net = require('net'); const httpMod = require('http'); const httpsMod = require('https');
  function privateIp(ip) {
    if (opts.testAllowPrivateLinks === true) return false;   // only settable from code, for local tests
    if (net.isIPv6(ip)) {
      const v = ip.toLowerCase();
      if (v.startsWith('::ffff:')) return privateIp(v.slice(7));
      return v === '::' || v === '::1' || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith('ff') || v.startsWith('64:ff9b') || v.startsWith('2001:db8');
    }
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  function safeLookup(host, opts, cb) {
    dnsMod.lookup(host, { ...opts, all: true }, (e, addrs) => {
      if (e) return cb(e);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: opts.family || 4 }];
      if (!list.length || list.some(x => privateIp(x.address))) return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
      opts.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
    });
  }
  function fetchLimited(url, max = 600 * 1024, hops = 0, wantImage = false) {
    return new Promise((resolve, reject) => {
      let u; try { u = new URL(url); } catch { return reject(new Error('bad url')); }
      if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443', '8080', '8443'].includes(u.port))) return reject(new Error('bad url'));
      if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && privateIp(u.hostname.replace(/^\[|\]$/g, ''))) return reject(new Error('blocked'));
      const mod = u.protocol === 'https:' ? httpsMod : httpMod;
      const rq = mod.get(u, { lookup: safeLookup, timeout: 5000, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitLinkPreview/1.0)', Accept: 'text/html,application/xhtml+xml,image/*;q=0.8,*/*;q=0.5', 'Accept-Language': 'en' } }, (r) => {
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); if (hops >= 4) return reject(new Error('too many redirects')); return resolve(fetchLimited(new URL(r.headers.location, u).href, max, hops + 1, wantImage)); }
        if (r.statusCode !== 200) { r.resume(); return reject(new Error('status ' + r.statusCode)); }
        const type = String(r.headers['content-type'] || '');
        if (wantImage) {
          if (!/^image\/(png|jpe?g|gif|webp|avif)/i.test(type)) { r.destroy(); return reject(new Error('not an image')); }   // never SVG (it can run scripts)
          let size = 0; const chunks = [];
          r.on('data', (c) => { size += c.length; if (size > max) { r.destroy(new Error('too big')); return; } chunks.push(c); });
          r.on('end', () => resolve({ url: u.href, type, buf: Buffer.concat(chunks) }));
          r.on('error', reject); return;
        }
        if (/^image\//.test(type)) { r.destroy(); return resolve({ url: u.href, type, body: '' }); }
        if (!/html/.test(type)) { r.destroy(); return reject(new Error('not html')); }
        let size = 0; const chunks = [];
        r.on('data', (c) => { size += c.length; chunks.push(c); if (size > max) r.destroy(); });
        r.on('close', () => resolve({ url: u.href, type, body: Buffer.concat(chunks).toString('utf8') }));
        r.on('error', reject);
      });
      rq.on('timeout', () => rq.destroy(new Error('timeout')));
      rq.on('error', reject);
    });
  }
  const decodeEnt = (t) => String(t || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase(); if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>'; if (k === 'quot') return '"'; if (k === 'apos' || k === '#39') return "'"; if (k === 'nbsp') return ' ';
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }).replace(/\s+/g, ' ').trim();
  function parseMeta(html, base) {
    const head = html.slice(0, 200000); const meta = {};
    for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
      const attr = (n) => { const m = tag.match(new RegExp(`\\b${n}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')); return m ? (m[2] ?? m[3] ?? m[4]) : null; };
      const key = (attr('property') || attr('name') || attr('itemprop') || '').toLowerCase(); const val = attr('content');
      if (key && val != null && !(key in meta)) meta[key] = decodeEnt(val);
    }
    const title = meta['og:title'] || meta['twitter:title'] || decodeEnt((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
    let image = meta['og:image:secure_url'] || meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || null;
    try { if (image) { image = new URL(image, base).href; if (!/^https?:/.test(image)) image = null; } } catch { image = null; }
    const color = /^#[0-9a-f]{6}$/i.test(meta['theme-color'] || '') ? meta['theme-color'] : null;
    return { title: (title || '').slice(0, 256), description: (meta['og:description'] || meta['twitter:description'] || meta['description'] || '').slice(0, 350),
      site: (meta['og:site_name'] || '').slice(0, 100), image, color, large: meta['twitter:card'] === 'summary_large_image' };
  }
  // links in a message (skipping ones wrapped in <...>, which means "no preview", like Discord)
  function linksIn(content) {
    const out = [];
    for (const m of String(content || '').matchAll(/(<)?(https?:\/\/[^\s<>]+[^\s<>.,:;"')\]!?])(>)?/g)) { if (m[1] && m[3]) continue; if (!out.includes(m[2])) out.push(m[2]); }
    return out.slice(0, 3);
  }
  // link preview images are loaded through Orbit, so other websites never see who is viewing the message.
  // The URL is signed so this can't be used as an open proxy.
  const proxySig = (u) => crypto.createHmac('sha256', SECRET).update('img:' + u).digest('base64url').slice(0, 22);
  const proxied = (u) => (u && /^https?:\/\//.test(u) ? `/embed-img?u=${encodeURIComponent(Buffer.from(u).toString('base64url'))}&s=${proxySig(u)}` : u);
  const imgCache = new Map();
  app.get('/embed-img', wrap(async (req, res) => {
    let u = ''; try { u = Buffer.from(String(req.query.u || ''), 'base64url').toString('utf8'); } catch {}
    if (!u || String(req.query.s || '') !== proxySig(u)) return res.status(403).end();
    let hit2 = imgCache.get(u);
    if (!hit2 || hit2.at < now() - 3600e3) {
      try { const r = await fetchLimited(u, 8 * 1024 * 1024, 0, true); hit2 = { type: r.type, buf: r.buf, at: now() }; }
      catch { return res.status(404).end(); }
      imgCache.set(u, hit2); let total = 0; for (const [k, v] of [...imgCache].reverse()) { total += v.buf.length; if (total > 60e6) imgCache.delete(k); }
    }
    res.setHeader('Content-Type', hit2.type); res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.end(hit2.buf);
  }));
  const embedCache = new Map();
  async function embedFor(url) {
    const hit = embedCache.get(url); if (hit && hit.at > now() - 30 * 60e3) return hit.e;
    let e = null;
    try {
      const r = await fetchLimited(url);
      if (/^image\//.test(r.type)) e = { type: 'image', url, image: r.url };
      else { const m = parseMeta(r.body, r.url); if (m.title || m.description || m.image) e = { type: 'link', url, host: new URL(r.url).hostname.replace(/^www\./, ''), ...m }; }
    } catch {}
    embedCache.set(url, { e, at: now() }); if (embedCache.size > 500) embedCache.delete(embedCache.keys().next().value);
    return e;
  }
  function unfurlLater(id, content, authorId) {
    if (authorId && hit('unfurl:' + authorId, 20, 60e3)) return;   // someone spamming links: skip previews for a minute
    const urls = linksIn(content).filter(u => !/^https:\/\/(media[0-9]?\.giphy\.com|i\.giphy\.com)\//.test(u));
    if (!urls.length) return;
    Promise.all(urls.map(embedFor)).then(list => {
      const embeds = list.filter(Boolean); if (!embeds.length) return;
      const m = one('SELECT id, channel_id, content FROM messages WHERE id=?', id);
      if (!m || linksIn(m.content).join() !== linksIn(content).join()) return;   // deleted or edited meanwhile
      run('UPDATE messages SET embeds=? WHERE id=?', JSON.stringify(embeds), id);
      emitToChannel(chanRow(m.channel_id), 'message:update', msgById(id));
    }).catch(() => {});
  }
  // remove one preview from your own message (the X on an embed)
  app.delete('/api/messages/:id/embeds', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id); const ch = m && chanRow(m.channel_id);
    if (!m) throw err(404, 'Not found');
    if (m.author_id !== req.user.id && !(ch.type !== 'dm' && has(ch.server_id, req.user.id, P.MANAGE_MESSAGES))) throw err(403, 'Missing permission');
    run(`UPDATE messages SET embeds='[]' WHERE id=?`, m.id);
    emitToChannel(ch, 'message:update', msgById(m.id));
    res.json({ ok: true });
  }));

  // ----- messages -----
  function mentionsIn(content, ch, author) {
    const names = [...String(content).matchAll(/@([\w.]{2,32})/g)].map(m => m[1].toLowerCase());
    let everyone = false;
    if (names.some(n => n === 'everyone' || n === 'here')) everyone = ch.type === 'dm' || has(ch.server_id, author, P.MENTION_EVERYONE);
    const viewers = viewersOf(ch);
    const ids = names.length ? viewers.filter(v => { const u = one('SELECT username FROM users WHERE id=?', v); return u && names.includes(u.username.toLowerCase()); }) : [];
    return { ids, everyone };
  }
  app.get('/api/channels/:id/messages', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!canView(ch, req.user.id)) throw err(403, 'No access');
    const before = Number(req.query.before) || 9e15;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const thread = req.query.thread ? Number(req.query.thread) : null;
    if (ch.type === 'forum' && !thread && req.query.sort === 'active') {
      // forum posts, most recently active first (a new reply bumps an old post back to the top)
      const offset = Math.max(0, Number(req.query.offset) || 0);
      const posts = all(`SELECT m.*, COALESCE((SELECT MAX(r.created) FROM messages r WHERE r.thread_id=m.id), m.created) AS act FROM messages m
        WHERE m.channel_id=? AND m.thread_id IS NULL AND m.system=0 ORDER BY act DESC LIMIT ? OFFSET ?`, ch.id, limit, offset);
      return res.json(fmtMessages(posts));
    }
    const rows = thread
      ? all('SELECT * FROM messages WHERE channel_id=? AND thread_id=? AND id<? ORDER BY id DESC LIMIT ?', ch.id, thread, before, limit)
      : all('SELECT * FROM messages WHERE channel_id=? AND thread_id IS NULL AND id<? ORDER BY id DESC LIMIT ?', ch.id, before, limit);
    res.json(fmtMessages(rows.reverse()));
  }));
  app.get('/api/channels/:id/search', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!canView(ch, req.user.id)) throw err(403, 'No access');
    const term = String(req.query.q || '').trim();
    if (!term) return res.json([]);
    res.json(fmtMessages(all(`SELECT * FROM messages WHERE channel_id=? AND content LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT 50`, ch.id, '%' + term.replace(/[%_\\]/g, '\\$&') + '%')));
  }));
  app.get('/api/messages/:id', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id);
    if (!m || !canView(chanRow(m.channel_id), req.user.id)) throw err(404, 'Not found');
    res.json(msgById(m.id));
  }));
  app.post('/api/channels/:id/messages', auth, upload.array('files', 10), wrap((req, res) => {
    const ch = chanRow(req.params.id);
    const cleanup = () => (req.files || []).forEach(f => fs.unlink(f.path, () => {}));
    if (!canView(ch, req.user.id) || !['text', 'dm', 'forum'].includes(ch.type)) { cleanup(); throw err(403, 'No access'); }
    if (hit('send:' + req.user.id, 25, 10e3)) { cleanup(); throw err(429, 'You’re sending messages too fast. Slow down a little.'); }
    if (ch.type !== 'dm' && !has(ch.server_id, req.user.id, P.SEND)) { cleanup(); throw err(403, 'You can’t send messages here'); }
    if (req.files?.length && ch.type !== 'dm' && !has(ch.server_id, req.user.id, P.ATTACH)) { cleanup(); throw err(403, 'You can’t attach files here'); }
    if (ch.type !== 'dm') {
      const until = timedOutUntil(ch.server_id, req.user.id);
      if (until) { cleanup(); throw err(403, `You’re timed out in this server until ${new Date(until).toUTCString()}`); }
      if (ch.slowmode > 0 && !has(ch.server_id, req.user.id, P.MANAGE_MESSAGES) && !has(ch.server_id, req.user.id, P.MANAGE_CHANNELS)) {
        const last = one('SELECT MAX(created) t FROM messages WHERE channel_id=? AND author_id=? AND system=0', ch.id, req.user.id)?.t || 0;
        const wait = Math.ceil((last + ch.slowmode * 1000 - now()) / 1000);
        if (wait > 0) { cleanup(); throw err(429, `Slowmode is on. You can send another message in ${wait}s.`); }
      }
    }
    const content = String(req.body?.content || '').slice(0, 4000);
    const gifUrl = String(req.body?.gif || '').trim();
    const gifOk = gifUrl && /^https:\/\/(media[0-9]?\.giphy\.com|i\.giphy\.com)\//.test(gifUrl);
    let poll = null;
    if (req.body?.poll) {
      const p = pj(req.body.poll, null) || {};
      const question = String(p.question || '').trim().slice(0, 300);
      const answers = (Array.isArray(p.answers) ? p.answers : []).map(a => String(a || '').trim().slice(0, 55)).filter(Boolean).slice(0, 10);
      if (!question || answers.length < 2) { cleanup(); throw err(400, 'A poll needs a question and at least 2 answers'); }
      const hours = [1, 4, 8, 24, 72, 168].includes(Number(p.hours)) ? Number(p.hours) : 24;
      poll = { question, answers, multi: !!p.multi, ends: now() + hours * 3600e3 };
    }
    let sticker = null;
    if (req.body?.sticker) {
      const st = one('SELECT * FROM stickers WHERE id=?', String(req.body.sticker));
      if (!st || !isMember(st.server_id, req.user.id)) { cleanup(); throw err(400, 'You can only use stickers from servers you’re in'); }
      sticker = { id: st.id, name: st.name, url: st.url };
    }
    if (!content.trim() && !req.files?.length && !gifOk && !poll && !sticker) throw err(400, 'Message is empty');
    // forum: a new post (not a reply) needs a title
    const isPost = ch.type === 'forum' && !req.body?.thread_id;
    const title = isPost ? String(req.body?.title || '').trim().slice(0, 100) : null;
    if (isPost && !title) { cleanup(); throw err(400, 'Give your post a title'); }
    const attachments = (req.files || []).map(f => ({ url: fileUrl(f), name: f.originalname.slice(0, 200), size: f.size, type: f.mimetype }));
    // voice message: duration + waveform drawn by the sender's app, attached to the recorded audio file
    if (req.body?.voice && attachments[0] && /^audio\//.test(attachments[0].type)) {
      const v = pj(req.body.voice, {}) || {};
      attachments[0].voice = true;
      attachments[0].duration = Math.max(0, Math.min(1200, Number(v.duration) || 0));
      attachments[0].waveform = (Array.isArray(v.waveform) ? v.waveform : []).slice(0, 100).map(n => Math.max(0, Math.min(100, Math.round(Number(n) || 0))));
    }
    if (gifOk) attachments.push({ url: gifUrl, name: 'GIF', type: 'image/gif', external: true, size: 0 });
    const reply = req.body?.reply_to ? one('SELECT id FROM messages WHERE id=? AND channel_id=?', Number(req.body.reply_to), ch.id) : null;
    const thread = req.body?.thread_id ? one('SELECT id FROM messages WHERE id=? AND channel_id=? AND thread_id IS NULL', Number(req.body.thread_id), ch.id) : null;
    const m = mentionsIn(content, ch, req.user.id);
    const replyAuthor = reply ? one('SELECT author_id FROM messages WHERE id=?', reply.id)?.author_id : null;
    if (replyAuthor && replyAuthor !== req.user.id && req.body?.mention_reply !== 'false' && !m.ids.includes(replyAuthor)) m.ids.push(replyAuthor);
    if (ch.type === 'forum' && req.body?.thread_id && !thread) { cleanup(); throw err(404, 'That post was deleted'); }
    const r = run('INSERT INTO messages(channel_id,author_id,content,reply_to,thread_id,attachments,mentions,mention_everyone,created,poll,sticker,title) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      ch.id, req.user.id, content, reply?.id ?? null, thread?.id ?? null, JSON.stringify(attachments), JSON.stringify(m.ids), m.everyone ? 1 : 0, now(), poll ? JSON.stringify(poll) : null, sticker ? JSON.stringify(sticker) : null, title);
    const msg = msgById(Number(r.lastInsertRowid));
    unfurlLater(msg.id, content, req.user.id);
    run('INSERT OR REPLACE INTO reads VALUES(?,?,?)', req.user.id, ch.id, msg.id);
    emitToChannel(ch, 'message:new', msg);
    if (thread) emitToChannel(ch, 'message:update', msgById(thread.id));
    if (ch.type === 'dm') viewersOf(ch).forEach(v => io.to('u:' + v).emit('dm:update', dmEntry(ch, v)));
    stopTyping(ch.id, req.user.id);
    res.json(msg);
  }));
  app.patch('/api/messages/:id', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id);
    if (!m || m.author_id !== req.user.id) throw err(403, 'You can only edit your own messages');
    { const ch0 = chanRow(m.channel_id);
      if (!canView(ch0, req.user.id)) throw err(403, 'You no longer have access to this channel');
      if (ch0.type !== 'dm' && timedOutUntil(ch0.server_id, req.user.id)) throw err(403, 'You’re timed out in this server'); }
    if (req.body?.title !== undefined && m.title != null) {
      const t = String(req.body.title || '').trim().slice(0, 100); if (!t) throw err(400, 'Give your post a title');
      run('UPDATE messages SET title=? WHERE id=?', t, m.id);
      if (req.body.content === undefined) { emitToChannel(chanRow(m.channel_id), 'message:update', msgById(m.id)); return res.json({ ok: true }); }
    }
    const content = String(req.body?.content || '').slice(0, 4000);
    if (!content.trim() && m.attachments === '[]') throw err(400, 'Message is empty');
    const ch = chanRow(m.channel_id);
    const mm = mentionsIn(content, ch, req.user.id);
    run('UPDATE messages SET content=?, edited=?, mentions=?, mention_everyone=? WHERE id=?', content, now(), JSON.stringify(mm.ids), mm.everyone ? 1 : 0, m.id);
    const linksChanged = linksIn(content).join() !== linksIn(m.content).join();
    if (linksChanged) run(`UPDATE messages SET embeds='[]' WHERE id=?`, m.id);
    emitToChannel(ch, 'message:update', msgById(m.id));
    if (linksChanged) unfurlLater(m.id, content, req.user.id);
    res.json({ ok: true });
  }));
  function deleteMessage(id) {
    const m = one('SELECT * FROM messages WHERE id=?', id);
    if (!m) return;
    const ch = chanRow(m.channel_id);
    JSON.parse(m.attachments || '[]').forEach(a => fs.unlink(path.join(uploadDir, path.basename(a.url)), () => {}));
    run('DELETE FROM messages WHERE id=? OR thread_id=?', id, id);
    emitToChannel(ch, 'message:delete', { id: m.id, channel_id: m.channel_id, thread_id: m.thread_id });
    if (m.thread_id) { const parent = msgById(m.thread_id); if (parent) emitToChannel(ch, 'message:update', parent); }
  }
  app.delete('/api/messages/:id', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id);
    if (!m) throw err(404, 'Not found');
    const ch = chanRow(m.channel_id);
    const mod = ch.type !== 'dm' && has(ch.server_id, req.user.id, P.MANAGE_MESSAGES);
    if (m.author_id !== req.user.id && !mod) throw err(403, 'Missing permission');
    if (!mod && !canView(ch, req.user.id)) throw err(403, 'You no longer have access to this channel');
    deleteMessage(m.id);
    res.json({ ok: true });
  }));
  app.put('/api/messages/:id/reactions/:emoji', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id);
    const ch = m && chanRow(m.channel_id);
    if (!m || !canView(ch, req.user.id)) throw err(404, 'Not found');
    if (ch.type !== 'dm' && timedOutUntil(ch.server_id, req.user.id)) throw err(403, 'You’re timed out in this server');
    const emoji = String(req.params.emoji).slice(0, 64);
    if (emoji.length > 16 && !/^<:[\w]{2,32}:[\w-]{6,20}>$/.test(emoji)) throw err(400, 'Unknown emoji');
    const exists = one('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, req.user.id, emoji);
    if (exists) run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, req.user.id, emoji);
    else {
      if (one('SELECT COUNT(DISTINCT emoji) c FROM reactions WHERE message_id=?', m.id).c >= 20) throw err(400, 'Too many reactions');
      run('INSERT INTO reactions VALUES(?,?,?)', m.id, req.user.id, emoji);
    }
    emitToChannel(ch, 'message:update', msgById(m.id));
    res.json({ ok: true });
  }));
  // pins
  function canPin(ch, uidv) { return ch.type === 'dm' ? canView(ch, uidv) : has(ch.server_id, uidv, P.MANAGE_MESSAGES); }
  function chanSystem(ch, text) {
    const r = run('INSERT INTO messages(channel_id,author_id,content,created,system) VALUES(?,?,?,?,1)', ch.id, null, text, now());
    emitToChannel(ch, 'message:new', msgById(Number(r.lastInsertRowid)));
  }
  app.get('/api/channels/:id/pins', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!canView(ch, req.user.id)) throw err(403, 'No access');
    res.json(fmtMessages(all('SELECT * FROM messages WHERE channel_id=? AND pinned>0 ORDER BY pinned DESC LIMIT 50', ch.id)));
  }));
  app.put('/api/messages/:id/pin', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id); const ch = m && chanRow(m.channel_id);
    if (!m || !canView(ch, req.user.id)) throw err(404, 'Not found');
    if (!canPin(ch, req.user.id)) throw err(403, 'You need Manage Messages to pin');
    if (m.system) throw err(400, 'System messages can’t be pinned');
    if (!m.pinned) {
      if (one('SELECT COUNT(*) c FROM messages WHERE channel_id=? AND pinned>0', ch.id).c >= 50) throw err(400, 'This channel already has 50 pins. Unpin something first.');
      run('UPDATE messages SET pinned=? WHERE id=?', now(), m.id);
      emitToChannel(ch, 'message:update', msgById(m.id));
      chanSystem(ch, `${nameOf(req.user.id)} pinned a message to this channel.`);
    }
    res.json({ ok: true });
  }));
  app.delete('/api/messages/:id/pin', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id); const ch = m && chanRow(m.channel_id);
    if (!m || !canView(ch, req.user.id)) throw err(404, 'Not found');
    if (!canPin(ch, req.user.id)) throw err(403, 'You need Manage Messages to unpin');
    run('UPDATE messages SET pinned=0 WHERE id=?', m.id);
    emitToChannel(ch, 'message:update', msgById(m.id));
    res.json({ ok: true });
  }));
  // polls
  app.put('/api/messages/:id/poll/:opt', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id); const ch = m && chanRow(m.channel_id);
    if (!m || !canView(ch, req.user.id) || !m.poll) throw err(404, 'Not found');
    if (ch.type !== 'dm' && timedOutUntil(ch.server_id, req.user.id)) throw err(403, 'You’re timed out in this server');
    const p = pj(m.poll, null); const opt = Number(req.params.opt);
    if (!p || !Number.isInteger(opt) || opt < 0 || opt >= p.answers.length) throw err(400, 'Unknown answer');
    if (p.ends < now()) throw err(400, 'This poll has ended');
    tx(() => {
      const had = one('SELECT 1 FROM poll_votes WHERE message_id=? AND user_id=? AND opt=?', m.id, req.user.id, opt);
      if (!p.multi) run('DELETE FROM poll_votes WHERE message_id=? AND user_id=?', m.id, req.user.id);
      if (had) run('DELETE FROM poll_votes WHERE message_id=? AND user_id=? AND opt=?', m.id, req.user.id, opt);
      else run('INSERT INTO poll_votes VALUES(?,?,?)', m.id, req.user.id, opt);
    });
    emitToChannel(ch, 'message:update', msgById(m.id));
    res.json({ ok: true });
  }));
  // custom server emojis
  app.post('/api/servers/:id/emojis', auth, imageOnly.single('file'), wrap((req, res) => {
    const sid = req.params.id; const f = req.file;
    const drop = () => f && fs.unlink(f.path, () => {});
    if (!has(sid, req.user.id, P.MANAGE_SERVER)) { drop(); throw err(403, 'You need Manage Server to add emojis'); }
    if (!f) throw err(400, 'Pick an image (PNG, GIF, JPG or WebP)');
    if (f.size > 512 * 1024) { drop(); throw err(400, 'Emojis must be under 512 KB'); }
    const name = String(req.body?.name || path.parse(f.originalname).name).replace(/[^\w]/g, '_').replace(/_+/g, '_').slice(0, 32);
    if (name.length < 2) { drop(); throw err(400, 'Emoji names need at least 2 letters or numbers'); }
    if (one('SELECT COUNT(*) c FROM emojis WHERE server_id=?', sid).c >= 100) { drop(); throw err(400, 'This server has the maximum of 100 emojis'); }
    if (one('SELECT 1 FROM emojis WHERE server_id=? AND name=?', sid, name)) { drop(); throw err(409, `There’s already an emoji called :${name}:`); }
    const id = uid();
    run('INSERT INTO emojis VALUES(?,?,?,?,?,?)', id, sid, name, fileUrl(f), req.user.id, now());
    refreshServer(sid);
    res.json({ id, name, url: fileUrl(f) });
  }));
  app.patch('/api/emojis/:id', auth, wrap((req, res) => {
    const e = one('SELECT * FROM emojis WHERE id=?', req.params.id);
    if (!e || !has(e.server_id, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
    const name = String(req.body?.name || '').replace(/[^\w]/g, '_').slice(0, 32);
    if (name.length < 2) throw err(400, 'Emoji names need at least 2 letters or numbers');
    if (one('SELECT 1 FROM emojis WHERE server_id=? AND name=? AND id<>?', e.server_id, name, e.id)) throw err(409, `There’s already an emoji called :${name}:`);
    run('UPDATE emojis SET name=? WHERE id=?', name, e.id);
    refreshServer(e.server_id);
    res.json({ ok: true });
  }));
  app.delete('/api/emojis/:id', auth, wrap((req, res) => {
    const e = one('SELECT * FROM emojis WHERE id=?', req.params.id);
    if (!e || !has(e.server_id, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
    run('DELETE FROM emojis WHERE id=?', e.id);
    fs.unlink(path.join(uploadDir, path.basename(e.url)), () => {});
    refreshServer(e.server_id);
    res.json({ ok: true });
  }));
  // stickers (per server, like emojis)
  app.post('/api/servers/:id/stickers', auth, imageOnly.single('file'), wrap((req, res) => {
    const sid = req.params.id; const f = req.file;
    const drop = () => f && fs.unlink(f.path, () => {});
    if (!has(sid, req.user.id, P.MANAGE_SERVER)) { drop(); throw err(403, 'You need Manage Server to add stickers'); }
    if (!f) throw err(400, 'Pick an image (PNG, GIF, APNG, WebP or JPG)');
    if (f.size > 512 * 1024) { drop(); throw err(400, 'Stickers must be under 512 KB'); }
    const name = String(req.body?.name || path.parse(f.originalname).name).trim().slice(0, 30);
    if (name.length < 2) { drop(); throw err(400, 'Sticker names need at least 2 characters'); }
    if (one('SELECT COUNT(*) c FROM stickers WHERE server_id=?', sid).c >= 30) { drop(); throw err(400, 'This server has the maximum of 30 stickers'); }
    const id = uid();
    run('INSERT INTO stickers VALUES(?,?,?,?,?,?)', id, sid, name, fileUrl(f), req.user.id, now());
    refreshServer(sid);
    res.json({ id, name, url: fileUrl(f) });
  }));
  app.patch('/api/stickers/:id', auth, wrap((req, res) => {
    const st = one('SELECT * FROM stickers WHERE id=?', req.params.id);
    if (!st || !has(st.server_id, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
    const name = String(req.body?.name || '').trim().slice(0, 30);
    if (name.length < 2) throw err(400, 'Sticker names need at least 2 characters');
    run('UPDATE stickers SET name=? WHERE id=?', name, st.id); refreshServer(st.server_id); res.json({ ok: true });
  }));
  app.delete('/api/stickers/:id', auth, wrap((req, res) => {
    const st = one('SELECT * FROM stickers WHERE id=?', req.params.id);
    if (!st || !has(st.server_id, req.user.id, P.MANAGE_SERVER)) throw err(403, 'Missing permission');
    run('DELETE FROM stickers WHERE id=?', st.id);   // the image file stays so old messages keep showing it
    refreshServer(st.server_id); res.json({ ok: true });
  }));
  // inbox: recent @mentions and replies to you, from every server and DM you can still see
  app.get('/api/inbox', auth, wrap((req, res) => {
    const me = req.user.id; const before = Number(req.query.before) || 9e15;
    const rows = all(`SELECT * FROM messages WHERE author_id<>? AND system=0 AND id<? AND created>? AND (mentions LIKE ? ESCAPE '\\' OR mention_everyone=1) ORDER BY id DESC LIMIT ?`,
      me, before, now() - 60 * 864e5, `%"${likeEsc(me)}"%`, Math.min(400, Math.max(1, Number(req.query.limit) || 400)));
    const seen = new Map(), out = [];
    for (const r of rows) {
      if (!seen.has(r.channel_id)) seen.set(r.channel_id, canView(chanRow(r.channel_id), me));
      if (seen.get(r.channel_id)) out.push(r);
      if (out.length >= Math.min(40, Number(req.query.limit) || 40)) break;
    }
    res.json(fmtMessages(out));
  }));
  // search with filters. scope: channel_id (a channel or DM) or server_id (every channel you can see)
  app.get('/api/search', auth, wrap((req, res) => {
    const me = req.user.id, Q = req.query;
    let chans = [];
    if (Q.server_id) {
      if (!isMember(String(Q.server_id), me)) throw err(403, 'No access');
      chans = all(`SELECT * FROM channels WHERE server_id=? AND type IN ('text','forum')`, String(Q.server_id)).filter(c => canView(c, me));
      if (Q.in) chans = chans.filter(c => c.id === String(Q.in));
    } else {
      const ch = chanRow(String(Q.channel_id || ''));
      if (!canView(ch, me)) throw err(403, 'No access');
      chans = [ch];
    }
    if (!chans.length) return res.json({ total: 0, messages: [] });
    const where = [`channel_id IN (${chans.map(() => '?').join(',')})`, 'system=0'], args = chans.map(c => c.id);
    const text = String(Q.q || '').trim();
    if (text) { where.push(`content LIKE ? ESCAPE '\\'`); args.push('%' + text.replace(/[%_\\]/g, '\\$&') + '%'); }
    const userId = (v) => { v = String(v || '').replace(/^@/, ''); const u = one('SELECT id FROM users WHERE id=? OR username=? COLLATE NOCASE', v, v); return u ? u.id : '__none__'; };
    if (Q.from) { where.push('author_id=?'); args.push(userId(Q.from)); }
    if (Q.mentions) { where.push(`mentions LIKE ? ESCAPE '\\'`); args.push(`%"${likeEsc(userId(Q.mentions))}"%`); }
    const HAS = { image: `attachments LIKE '%"type":"image/%'`, video: `attachments LIKE '%"type":"video/%'`, audio: `attachments LIKE '%"type":"audio/%'`,
      voice: `attachments LIKE '%"voice":true%'`, file: `attachments<>'[]'`, link: `(content LIKE '%http://%' OR content LIKE '%https://%')`,
      embed: `embeds<>'[]'`, poll: 'poll IS NOT NULL', sticker: 'sticker IS NOT NULL' };
    String(Q.has || '').split(',').filter(k => HAS[k]).forEach(k => where.push(HAS[k]));
    if (Q.before) { where.push('created<?'); args.push(Number(Q.before)); }
    if (Q.after) { where.push('created>=?'); args.push(Number(Q.after)); }
    if (Q.pinned === 'true') where.push('pinned>0');
    const sql = where.join(' AND ');
    const total = one(`SELECT COUNT(*) c FROM messages WHERE ${sql}`, ...args).c;
    const offset = Math.max(0, Math.min(5000, Number(Q.offset) || 0));
    const rows = all(`SELECT * FROM messages WHERE ${sql} ORDER BY id DESC LIMIT 25 OFFSET ?`, ...args, offset);
    res.json({ total, messages: fmtMessages(rows) });
  }));
  // timeouts (moderation): needs Kick Members and a higher role than the target
  app.put('/api/servers/:id/members/:uid/timeout', auth, wrap((req, res) => {
    const sid = req.params.id, t = req.params.uid;
    if (!isMember(sid, t)) throw err(404, 'Not a member');
    if (!has(sid, req.user.id, P.KICK) || t === req.user.id || !outranks(sid, req.user.id, t)) throw err(403, 'You can’t time out this member');
    const minutes = Math.max(0, Math.min(28 * 24 * 60, Number(req.body?.minutes) || 0));
    const until = minutes ? now() + minutes * 60e3 : null;
    run('UPDATE members SET timeout_until=? WHERE server_id=? AND user_id=?', until, sid, t);
    if (until) for (const [cid, room] of voice) { const c = chanRow(cid); if (c && c.server_id === sid && room.has(t)) leaveVoice(t); }
    if (until) io.to('u:' + t).emit('timeout', { server_id: sid, until, reason: String(req.body?.reason || '').slice(0, 200) });
    refreshServer(sid);
    res.json({ ok: true, until });
  }));
  app.post('/api/channels/:id/read', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!canView(ch, req.user.id)) throw err(403, 'No access');
    const last = one('SELECT MAX(id) id FROM messages WHERE channel_id=?', ch.id)?.id || 0;
    run('INSERT OR REPLACE INTO reads VALUES(?,?,?)', req.user.id, ch.id, last);
    markDmReceipt(ch, req.user.id, last);
    res.json({ ok: true });
  }));
  // the other person's read position in a 1:1 DM (for showing "Seen" when you open the chat)
  app.get('/api/channels/:id/receipt', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || ch.type !== 'dm' || ch.is_group || !canView(ch, req.user.id)) return res.json({});
    const other = all('SELECT user_id FROM dm_members WHERE channel_id=?', ch.id).map(r => r.user_id).find(x => x !== req.user.id);
    const r = other && one('SELECT last_read, updated FROM dm_receipts WHERE channel_id=? AND user_id=?', ch.id, other);
    res.json(r ? { user_id: other, last_read: r.last_read, at: r.updated } : {});
  }));
  // Read receipts for 1:1 DMs: record how far the reader has read and tell the other person,
  // but only if the reader hasn't turned receipts off (and they can't see yours if you've turned yours off).
  function markDmReceipt(ch, uidv, lastId) {
    if (!ch || ch.type !== 'dm' || ch.is_group || !lastId) return;
    const sender = one('SELECT read_receipts FROM users WHERE id=?', uidv);
    if (sender && sender.read_receipts === 0) return;
    run('INSERT OR REPLACE INTO dm_receipts(channel_id,user_id,last_read,updated) VALUES(?,?,?,?)', ch.id, uidv, lastId, now());
    all('SELECT user_id FROM dm_members WHERE channel_id=?', ch.id).map(r => r.user_id).filter(x => x !== uidv)
      .forEach(other => io.to('u:' + other).emit('dm:receipt', { channel_id: ch.id, user_id: uidv, last_read: lastId, at: now() }));
  }

  // download page + Windows installer link. Set WINDOWS_DOWNLOAD_URL on Render to point somewhere else.
  const WIN_URL = process.env.WINDOWS_DOWNLOAD_URL || opts.windowsDownloadUrl || 'https://github.com/Flowifys/Orbit/releases/latest/download/Orbit.exe';
  app.get(['/download', '/get', '/install'], (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(publicDir, 'download.html')); });
  app.get('/download/windows', (req, res) => { res.setHeader('Cache-Control', 'no-store'); res.redirect(302, WIN_URL); });
  // custom emoji image by id (works for emojis from servers you're not in, like Discord)
  app.get('/emoji/:id', (req, res) => {
    const e = one('SELECT url FROM emojis WHERE id=?', String(req.params.id));
    if (!e) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.join(uploadDir, path.basename(e.url)));
  });
  // SPA fallback (invite links like /invite/abc)
  app.get(/^\/(invite|app)(\/.*)?$/, (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(publicDir, 'index.html')); });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((e, req, res, next) => { if (e && e.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File too large (max ${maxUpload / 1048576} MB)` }); fail(res, e); });

  // ---------- realtime ----------
  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: '*' }, maxHttpBufferSize: 1e6 });
  const online = new Map(); // userId -> {status, sockets:Set}
  const voice = new Map();  // channelId -> Map(userId -> {socket, muted, deaf, video, screen})
  const typing = new Map(); // channelId -> Map(userId -> timeout)

  function presenceSnapshot(viewer) {
    const o = {};
    for (const [k, v] of online) {
      let st = v.status === 'invisible' ? 'offline' : v.status;
      if (viewer && st !== 'offline' && k !== viewer && (invisibleTo(k, viewer) || strictBlocks(k, viewer))) st = 'offline';
      o[k] = st;
    }
    return o;
  }
  function voiceSnapshot(uidv) {
    const o = {};
    for (const [cid, room] of voice) {
      const ch = chanRow(cid);
      if (!ch || !canView(ch, uidv)) continue;
      o[cid] = [...room.entries()].map(([u, s]) => ({ user_id: u, muted: s.muted, deaf: s.deaf, video: s.video, screen: s.screen }));
    }
    return o;
  }
  function emitToChannel(ch, ev, data) {
    if (!ch) return;
    if (ch.type === 'dm' || ch.private) viewersOf(ch).forEach(v => io.to('u:' + v).emit(ev, data));
    else io.to('s:' + ch.server_id).emit(ev, data);
  }
  function refreshServer(sid) { io.to('s:' + sid).emit('server:refresh', { server_id: sid }); }
  function joinRooms(uidv, sid) { io.in('u:' + uidv).socketsJoin('s:' + sid); io.to('u:' + uidv).emit('server:added', { server_id: sid }); }
  function audienceOf(uidv) {
    const set = new Set([uidv]);
    all('SELECT DISTINCT m2.user_id FROM members m1 JOIN members m2 ON m1.server_id=m2.server_id WHERE m1.user_id=?', uidv).forEach(r => set.add(r.user_id));
    all('SELECT DISTINCT d2.user_id FROM dm_members d1 JOIN dm_members d2 ON d1.channel_id=d2.channel_id WHERE d1.user_id=?', uidv).forEach(r => set.add(r.user_id));
    friendIds(uidv).forEach(id => set.add(id));
    return [...set];
  }
  function broadcastUser(uidv) { const u = getUser(uidv); audienceOf(uidv).forEach(a => io.to('u:' + a).emit('user:update', u)); }
  function broadcastPresence(uidv) { audienceOf(uidv).forEach(a => io.to('u:' + a).emit('presence', { user_id: uidv, status: a === uidv ? (online.get(uidv)?.status === 'invisible' ? 'offline' : (online.get(uidv)?.status || 'offline')) : statusFor(uidv, a) })); }
  function stopTyping(cid, uidv) { const m = typing.get(cid); if (m && m.has(uidv)) { clearTimeout(m.get(uidv)); m.delete(uidv); } }
  function voiceBroadcast(cid) {
    const ch = chanRow(cid);
    const room = voice.get(cid);
    const users = room ? [...room.entries()].map(([u, s]) => ({ user_id: u, muted: s.muted, deaf: s.deaf, video: s.video, screen: s.screen })) : [];
    emitToChannel(ch, 'voice:state', { channel_id: cid, server_id: ch?.server_id || null, users });
  }
  function leaveVoice(uidv) {
    for (const [cid, room] of voice) {
      if (!room.has(uidv)) continue;
      const s = room.get(uidv);
      room.delete(uidv);
      for (const [, o] of room) io.to(o.socket).emit('voice:peer-left', { channel_id: cid, user_id: uidv });
      io.to(s.socket).emit('voice:left', { channel_id: cid });
      if (!room.size) voice.delete(cid);
      voiceBroadcast(cid);
    }
  }

  io.use((socket, next) => {
    try { const r = checkToken(socket.handshake.auth?.token || ''); socket.uid = r.u.id; socket.sid = r.sid; next(); }
    catch { next(new Error('unauthorized')); }
  });
  io.on('connection', (socket) => {
    const me = socket.uid;
    socket.join('u:' + me);
    if (socket.sid) socket.join('sess:' + socket.sid);
    all('SELECT server_id FROM members WHERE user_id=?', me).forEach(r => socket.join('s:' + r.server_id));
    const wanted = ['online', 'idle', 'dnd', 'invisible'].includes(socket.handshake.auth?.status) ? socket.handshake.auth.status : 'online';
    const entry = online.get(me) || { status: wanted, sockets: new Set() };
    entry.sockets.add(socket.id);
    online.set(me, entry);
    if (entry.sockets.size === 1) { entry.status = wanted; broadcastPresence(me); }

    socket.on('presence', (st) => { if (!['online', 'idle', 'dnd', 'invisible'].includes(st)) return; entry.status = st; broadcastPresence(me); });
    socket.on('typing', ({ channel_id } = {}) => {
      const ch = chanRow(channel_id);
      if (!canView(ch, me)) return;
      if (!typing.has(ch.id)) typing.set(ch.id, new Map());
      const m = typing.get(ch.id);
      clearTimeout(m.get(me));
      m.set(me, setTimeout(() => m.delete(me), 8000));
      emitToChannel(ch, 'typing', { channel_id: ch.id, user_id: me });
    });

    // voice / video signaling (mesh WebRTC)
    socket.on('voice:join', ({ channel_id, muted, deaf } = {}, ack) => {
      const ch = chanRow(channel_id);
      const pass = ch && ch.type === 'voice' && hasVoicePass(ch.id, me);
      const ok = ch && (pass || (canView(ch, me) && (ch.type === 'dm' || (ch.type === 'voice' && has(ch.server_id, me, P.CONNECT)))));
      if (!ok) return ack && ack({ error: 'You can’t join this voice channel' });
      if (ch.type === 'voice' && timedOutUntil(ch.server_id, me)) return ack && ack({ error: 'You’re timed out in this server' });
      leaveVoice(me);
      if (!voice.has(ch.id)) voice.set(ch.id, new Map());
      const room = voice.get(ch.id);
      const peers = [...room.keys()];
      room.set(me, { socket: socket.id, muted: !!muted, deaf: !!deaf, video: false, screen: false });
      peers.forEach(p => io.to(room.get(p).socket).emit('voice:peer-joined', { channel_id: ch.id, user_id: me }));
      ack && ack({ ok: true, peers });
      voiceBroadcast(ch.id);
      if (ch.type === 'dm' && peers.length === 0) {
        viewersOf(ch).filter(v => v !== me).forEach(v => io.to('u:' + v).emit('call:ring', { channel_id: ch.id, from: getUser(me) }));
      }
    });
    socket.on('voice:leave', () => leaveVoice(me));
    socket.on('voice:update', (st = {}) => {
      for (const [cid, room] of voice) if (room.has(me) && room.get(me).socket === socket.id) {
        const s = room.get(me);
        ['muted', 'deaf', 'video', 'screen'].forEach(k => { if (k in st) s[k] = !!st[k]; });
        voiceBroadcast(cid);
      }
    });
    socket.on('voice:signal', ({ to, data } = {}) => {
      for (const [, room] of voice) if (room.has(me) && room.has(to)) { io.to(room.get(to).socket).emit('voice:signal', { from: me, data }); return; }
    });
    socket.on('call:decline', ({ channel_id } = {}) => {
      const ch = chanRow(channel_id);
      if (ch && ch.type === 'dm' && canView(ch, me)) viewersOf(ch).filter(v => v !== me).forEach(v => io.to('u:' + v).emit('call:declined', { channel_id, user_id: me }));
    });

    socket.on('disconnect', () => {
      for (const [, room] of voice) for (const [u, s] of room) if (u === me && s.socket === socket.id) leaveVoice(me);
      entry.sockets.delete(socket.id);
      if (!entry.sockets.size) { online.delete(me); broadcastPresence(me); if (activities.has(me)) setActivity(me, null); }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host || '0.0.0.0', () => {
      const actual = server.address().port;
      log(`Orbit running on http://localhost:${actual}  (email verification ${emailEnabled ? 'ON' : 'OFF'})`);
      resolve({ port: actual, close: () => new Promise(r => { io.close(); server.close(() => { try { db.close(); } catch {} r(); }); }), emailEnabled, dataDir });
    });
  });
}

module.exports = { start, P };
if (require.main === module) start().catch(e => { console.error(e); process.exit(1); });
