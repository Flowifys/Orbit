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

const VERSION = '1.7.0';
const STAFF = new Set((process.env.STAFF_USERS || '..,__').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
const GROUP_MAX = 35;
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
  `);
  const userCols = all0(db, "PRAGMA table_info(users)").map(c => c.name);
  const chanCols = all0(db, "PRAGMA table_info(channels)").map(c => c.name);
  [['is_group', 'INTEGER DEFAULT 0'], ['gc_owner', 'TEXT'], ['gc_icon', 'TEXT']].forEach(([c, t]) => { if (!chanCols.includes(c)) db.exec(`ALTER TABLE channels ADD COLUMN ${c} ${t}`); });
  [['pronouns', "TEXT DEFAULT ''"], ['theme_primary', 'TEXT'], ['theme_accent', 'TEXT'], ['name_color', 'TEXT'], ['name_color2', 'TEXT'],
   ['avatar_crop', 'TEXT'], ['banner_crop', 'TEXT'], ['links', "TEXT DEFAULT '[]'"], ['connections', "TEXT DEFAULT '[]'"], ['spotify', 'TEXT'],
   ['effect', "TEXT DEFAULT ''"], ['banner_color', 'TEXT']].forEach(([c, t]) => { if (!userCols.includes(c)) db.exec(`ALTER TABLE users ADD COLUMN ${c} ${t}`); });
  const q = (sql) => db.prepare(sql);
  const one = (sql, ...a) => q(sql).get(...a);
  const all = (sql, ...a) => q(sql).all(...a);
  const run = (sql, ...a) => q(sql).run(...a);
  const tx = (fn) => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  // ---------- helpers ----------
  const pj = (v, d) => { try { return v ? JSON.parse(v) : d; } catch { return d; } };
  const publicUser = (u) => u && ({ id: u.id, username: u.username, display_name: u.display_name || u.username, avatar: u.avatar,
    banner: u.banner, bio: u.bio, accent: u.accent, status_text: u.status_text, created: u.created, pronouns: u.pronouns || '',
    theme_primary: u.theme_primary || null, theme_accent: u.theme_accent || null, name_color: u.name_color || null, name_color2: u.name_color2 || null,
    avatar_crop: pj(u.avatar_crop, null), banner_crop: pj(u.banner_crop, null), links: pj(u.links, []), connections: pj(u.connections, []),
    effect: u.effect || '', banner_color: u.banner_color || null, activity: activities.get(u.id) || null, staff: STAFF.has((u.username || '').toLowerCase()) });
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
    return rows.map(r => {
      const rx = {};
      reacts.filter(x => x.message_id === r.id).forEach(x => (rx[x.emoji] = rx[x.emoji] || []).push(x.user_id));
      const rep = replies.find(x => x.id === r.reply_to);
      const tc = threadCounts.find(x => x.thread_id === r.id);
      return { id: r.id, channel_id: r.channel_id, author_id: r.author_id, content: r.content, reply_to: r.reply_to, thread_id: r.thread_id,
        attachments: JSON.parse(r.attachments || '[]'), mentions: JSON.parse(r.mentions || '[]'), mention_everyone: !!r.mention_everyone,
        edited: r.edited, created: r.created, system: !!r.system, reactions: rx,
        reply: rep ? { id: rep.id, author_id: rep.author_id, content: rep.content.slice(0, 200), has_attachments: rep.attachments !== '[]' } : (r.reply_to ? { id: r.reply_to, deleted: true } : null),
        thread: tc ? { count: tc.c, last: tc.last } : null };
    });
  }
  const msgById = (id) => fmtMessages(all('SELECT * FROM messages WHERE id=?', id))[0];

  function serverPayload(sid, uidv) {
    const s = one('SELECT * FROM servers WHERE id=?', sid);
    if (!s) return null;
    const channels = all('SELECT * FROM channels WHERE server_id=? ORDER BY position, created', sid).filter(c => canView(c, uidv)).map(fmtChannel);
    const roles = all('SELECT * FROM roles WHERE server_id=? ORDER BY position DESC', sid).map(r => ({ ...r, hoist: !!r.hoist, is_default: !!r.is_default }));
    const mrs = all('SELECT user_id, role_id FROM member_roles WHERE server_id=?', sid);
    const members = all('SELECT m.user_id, m.nick, m.joined, u.* FROM members m JOIN users u ON u.id=m.user_id WHERE m.server_id=?', sid)
      .map(m => ({ ...publicUser(m), nick: m.nick, joined: m.joined, roles: mrs.filter(x => x.user_id === m.user_id).map(x => x.role_id) }));
    return { id: s.id, name: s.name, icon: s.icon, banner: s.banner, description: s.description, owner_id: s.owner_id,
      channels, roles, members, my_perms: permsOf(sid, uidv) };
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
    servers.forEach(sid => all(`SELECT * FROM channels WHERE server_id=? AND type='text'`, sid).forEach(c => canView(c, uidv) && chans.push(c)));
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
  app.use('/uploads', express.static(uploadDir, { maxAge: '30d', setHeaders: (res, p) => {
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
  function auth(req, res, next) {
    const t = (req.headers.authorization || '').replace(/^Bearer /, '');
    try { const p = jwt.verify(t, SECRET); const u = one('SELECT * FROM users WHERE id=?', p.id); if (!u) throw 0; req.user = u; next(); }
    catch { res.status(401).json({ error: 'Not logged in' }); }
  }
  const token = (u) => jwt.sign({ id: u.id }, SECRET, { expiresIn: '60d' });
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
    res.json({ token: token(u) });
  }));
  app.post('/api/auth/verify', wrap((req, res) => {
    const { email, code } = req.body || {};
    checkCode(email, code, 'verify');
    const u = one('SELECT * FROM users WHERE email=?', email);
    if (!u) throw err(404, 'Account not found');
    run('UPDATE users SET verified=1 WHERE id=?', u.id);
    res.json({ token: token(u) });
  }));
  app.post('/api/auth/resend', wrap(async (req, res) => {
    const u = one('SELECT * FROM users WHERE email=?', req.body?.email || '');
    if (u && !u.verified) await sendCode(u.email, newCode(u.email, 'verify'), 'verify');
    res.json({ ok: true });
  }));
  app.post('/api/auth/login', wrap(async (req, res) => {
    const { email, password } = req.body || {};
    const u = one('SELECT * FROM users WHERE email=? OR username=?', email || '', email || '');
    if (!u || !bcrypt.compareSync(password || '', u.pass)) throw err(401, 'Wrong email or password');
    if (!u.verified && emailEnabled) { await sendCode(u.email, newCode(u.email, 'verify'), 'verify'); return res.json({ needs_verification: true, email: u.email }); }
    res.json({ token: token(u) });
  }));
  app.post('/api/auth/forgot', wrap(async (req, res) => {
    const u = one('SELECT * FROM users WHERE email=?', req.body?.email || '');
    if (u) await sendCode(u.email, newCode(u.email, 'reset'), 'reset');
    res.json({ ok: true, email_enabled: emailEnabled });
  }));
  app.post('/api/auth/reset', wrap((req, res) => {
    const { email, code, password } = req.body || {};
    if (!password || password.length < 6) throw err(400, 'Password must be at least 6 characters');
    checkCode(email, code, 'reset');
    const u = one('SELECT * FROM users WHERE email=?', email);
    if (!u) throw err(404, 'Account not found');
    run('UPDATE users SET pass=?, verified=1 WHERE id=?', bcrypt.hashSync(password, 10), u.id);
    res.json({ token: token(u) });
  }));

  // ----- me / users -----
  app.get('/api/me', auth, wrap((req, res) => {
    const me = { ...publicUser(req.user), email: req.user.email };
    const servers = all('SELECT s.* FROM servers s JOIN members m ON m.server_id=s.id WHERE m.user_id=? ORDER BY m.joined', req.user.id).map(serverSummary);
    res.json({ me, servers, dms: dmList(req.user.id), unread: unreadFor(req.user.id), presence: presenceSnapshot(), voice: voiceSnapshot(req.user.id), activities: Object.fromEntries(activities), friends: friendsPayload(req.user.id) });
  }));
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
  app.get('/api/users/:id', auth, wrap((req, res) => {
    const u = getUser(req.params.id);
    if (!u) throw err(404, 'User not found');
    const mutual = all(`SELECT s.id, s.name, s.icon FROM servers s WHERE s.id IN (SELECT server_id FROM members WHERE user_id=?) AND s.id IN (SELECT server_id FROM members WHERE user_id=?)`, req.user.id, u.id);
    res.json({ ...u, mutual_servers: mutual, relationship: relTo(req.user.id, u.id) });
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
    run('INSERT INTO channels(id,server_id,type,name,topic,position,private,allowed_roles,created) VALUES(?,?,?,?,?,?,?,?,?)', id, sid, type, name,
      extra.topic || '', pos, extra.private ? 1 : 0, JSON.stringify(extra.allowed_roles || []), now());
    return id;
  }
  const cleanChanName = (n, type) => { const s = String(n || '').trim().slice(0, 40); return type === 'voice' ? s : s.toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, ''); };
  app.post('/api/servers', auth, wrap((req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    if (!name) throw err(400, 'Give your server a name');
    const sid = uid();
    tx(() => {
      run('INSERT INTO servers(id,name,owner_id,created) VALUES(?,?,?,?)', sid, name, req.user.id, now());
      run('INSERT INTO members VALUES(?,?,?,?)', sid, req.user.id, null, now());
      run('INSERT INTO roles(id,server_id,name,color,perms,position,hoist,is_default) VALUES(?,?,?,?,?,?,?,1)', uid(), sid, '@everyone', '', DEFAULT_PERMS, 0, 0);
      createChannel(sid, 'text', 'general');
      createChannel(sid, 'text', 'media');
      createChannel(sid, 'voice', 'General');
      createChannel(sid, 'voice', 'Gaming');
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
      run('INSERT INTO members VALUES(?,?,?,?)', i.server_id, req.user.id, null, now());
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
    const type = req.body?.type === 'voice' ? 'voice' : 'text';
    const name = cleanChanName(req.body?.name, type);
    if (!name) throw err(400, 'Give the channel a name');
    const id = createChannel(sid, type, name, { topic: String(req.body?.topic || '').slice(0, 300), private: !!req.body?.private, allowed_roles: Array.isArray(req.body?.allowed_roles) ? req.body.allowed_roles : [] });
    refreshServer(sid);
    res.json(fmtChannel(chanRow(id)));
  }));
  app.patch('/api/channels/:id', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!ch || ch.type === 'dm' || !has(ch.server_id, req.user.id, P.MANAGE_CHANNELS)) throw err(403, 'Missing permission');
    const b = req.body || {};
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
    run('DELETE FROM channels WHERE id=?', ch.id);
    refreshServer(ch.server_id);
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
    if (!canView(ch, req.user.id) || ch.type === 'voice') { cleanup(); throw err(403, 'No access'); }
    if (ch.type !== 'dm' && !has(ch.server_id, req.user.id, P.SEND)) { cleanup(); throw err(403, 'You can’t send messages here'); }
    if (req.files?.length && ch.type !== 'dm' && !has(ch.server_id, req.user.id, P.ATTACH)) { cleanup(); throw err(403, 'You can’t attach files here'); }
    const content = String(req.body?.content || '').slice(0, 4000);
    const gifUrl = String(req.body?.gif || '').trim();
    const gifOk = gifUrl && /^https:\/\/(media[0-9]?\.giphy\.com|i\.giphy\.com)\//.test(gifUrl);
    if (!content.trim() && !req.files?.length && !gifOk) throw err(400, 'Message is empty');
    const attachments = (req.files || []).map(f => ({ url: fileUrl(f), name: f.originalname.slice(0, 200), size: f.size, type: f.mimetype }));
    if (gifOk) attachments.push({ url: gifUrl, name: 'GIF', type: 'image/gif', external: true, size: 0 });
    const reply = req.body?.reply_to ? one('SELECT id FROM messages WHERE id=? AND channel_id=?', Number(req.body.reply_to), ch.id) : null;
    const thread = req.body?.thread_id ? one('SELECT id FROM messages WHERE id=? AND channel_id=? AND thread_id IS NULL', Number(req.body.thread_id), ch.id) : null;
    const m = mentionsIn(content, ch, req.user.id);
    const replyAuthor = reply ? one('SELECT author_id FROM messages WHERE id=?', reply.id)?.author_id : null;
    if (replyAuthor && replyAuthor !== req.user.id && req.body?.mention_reply !== 'false' && !m.ids.includes(replyAuthor)) m.ids.push(replyAuthor);
    const r = run('INSERT INTO messages(channel_id,author_id,content,reply_to,thread_id,attachments,mentions,mention_everyone,created) VALUES(?,?,?,?,?,?,?,?,?)',
      ch.id, req.user.id, content, reply?.id ?? null, thread?.id ?? null, JSON.stringify(attachments), JSON.stringify(m.ids), m.everyone ? 1 : 0, now());
    const msg = msgById(Number(r.lastInsertRowid));
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
    const content = String(req.body?.content || '').slice(0, 4000);
    if (!content.trim() && m.attachments === '[]') throw err(400, 'Message is empty');
    const ch = chanRow(m.channel_id);
    const mm = mentionsIn(content, ch, req.user.id);
    run('UPDATE messages SET content=?, edited=?, mentions=?, mention_everyone=? WHERE id=?', content, now(), JSON.stringify(mm.ids), mm.everyone ? 1 : 0, m.id);
    emitToChannel(ch, 'message:update', msgById(m.id));
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
    deleteMessage(m.id);
    res.json({ ok: true });
  }));
  app.put('/api/messages/:id/reactions/:emoji', auth, wrap((req, res) => {
    const m = one('SELECT * FROM messages WHERE id=?', req.params.id);
    const ch = m && chanRow(m.channel_id);
    if (!m || !canView(ch, req.user.id)) throw err(404, 'Not found');
    const emoji = String(req.params.emoji).slice(0, 16);
    const exists = one('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, req.user.id, emoji);
    if (exists) run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, req.user.id, emoji);
    else {
      if (one('SELECT COUNT(DISTINCT emoji) c FROM reactions WHERE message_id=?', m.id).c >= 20) throw err(400, 'Too many reactions');
      run('INSERT INTO reactions VALUES(?,?,?)', m.id, req.user.id, emoji);
    }
    emitToChannel(ch, 'message:update', msgById(m.id));
    res.json({ ok: true });
  }));
  app.post('/api/channels/:id/read', auth, wrap((req, res) => {
    const ch = chanRow(req.params.id);
    if (!canView(ch, req.user.id)) throw err(403, 'No access');
    const last = one('SELECT MAX(id) id FROM messages WHERE channel_id=?', ch.id)?.id || 0;
    run('INSERT OR REPLACE INTO reads VALUES(?,?,?)', req.user.id, ch.id, last);
    res.json({ ok: true });
  }));

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

  function presenceSnapshot() { const o = {}; for (const [k, v] of online) o[k] = v.status === 'invisible' ? 'offline' : v.status; return o; }
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
  function broadcastPresence(uidv) { let st = online.get(uidv)?.status || 'offline'; if (st === 'invisible') st = 'offline'; audienceOf(uidv).forEach(a => io.to('u:' + a).emit('presence', { user_id: uidv, status: st })); }
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
    try { const p = jwt.verify(socket.handshake.auth?.token || '', SECRET); const u = one('SELECT id FROM users WHERE id=?', p.id); if (!u) throw 0; socket.uid = u.id; next(); }
    catch { next(new Error('unauthorized')); }
  });
  io.on('connection', (socket) => {
    const me = socket.uid;
    socket.join('u:' + me);
    all('SELECT server_id FROM members WHERE user_id=?', me).forEach(r => socket.join('s:' + r.server_id));
    const wanted = ['online', 'idle', 'dnd', 'invisible'].includes(socket.handshake.auth?.status) ? socket.handshake.auth.status : 'online';
    const entry = online.get(me) || { status: wanted, sockets: new Set() };
    entry.sockets.add(socket.id);
    online.set(me, entry);
    if (entry.sockets.size === 1) { entry.status = wanted; broadcastPresenceSafe(); }
    function broadcastPresenceSafe() { if (entry.status === 'invisible') { const st = entry.status; entry.status = 'offline'; broadcastPresence(me); entry.status = st; } else broadcastPresence(me); }

    socket.on('presence', (st) => { if (!['online', 'idle', 'dnd', 'invisible'].includes(st)) return; entry.status = st; broadcastPresenceSafe(); });
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
      const ok = ch && canView(ch, me) && (ch.type === 'dm' || (ch.type === 'voice' && has(ch.server_id, me, P.CONNECT)));
      if (!ok) return ack && ack({ error: 'You can’t join this voice channel' });
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
