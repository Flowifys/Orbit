'use strict';
/* Orbit client core: state, API, helpers, icons, formatting */
const PERM = { ADMIN: 1, MANAGE_SERVER: 2, MANAGE_CHANNELS: 4, MANAGE_ROLES: 8, KICK: 16, BAN: 32, MANAGE_MESSAGES: 64, CREATE_INVITE: 128, SEND: 256, CONNECT: 512, ATTACH: 1024, MENTION_EVERYONE: 2048 };
const PERM_INFO = [
  ['ADMIN', 'Administrator', 'Members with this permission have every permission and can see every channel. Grant with care.'],
  ['MANAGE_SERVER', 'Manage Server', 'Change the server name, icon, banner and see invites.'],
  ['MANAGE_CHANNELS', 'Manage Channels', 'Create, edit and delete channels.'],
  ['MANAGE_ROLES', 'Manage Roles', 'Create and edit roles below their highest role and assign them.'],
  ['KICK', 'Kick Members', 'Remove members from the server. They can rejoin with an invite.'],
  ['BAN', 'Ban Members', 'Permanently remove members and stop them rejoining.'],
  ['MANAGE_MESSAGES', 'Manage Messages', 'Delete messages from other members.'],
  ['CREATE_INVITE', 'Create Invite', 'Invite new people to this server.'],
  ['SEND', 'Send Messages', 'Send messages in text channels.'],
  ['ATTACH', 'Attach Files', 'Upload files and media.'],
  ['MENTION_EVERYONE', 'Mention @everyone', 'Notify every member with @everyone or @here.'],
  ['CONNECT', 'Connect to Voice', 'Join voice channels, talk and share video.'],
];

const S = {
  token: null, me: null, servers: [], dms: [], unread: {}, presence: {}, voice: {}, users: {},
  serverData: {}, messages: {}, hasMore: {}, loading: {}, typing: {},
  view: { server: '@me', channel: null }, lastChannel: {}, thread: null, reply: null, editing: null,
  pending: [], drafts: {}, membersOpen: true, info: {},
  prefs: { notify: true, sounds: true, status: 'online', mic: '', cam: '', noise: true, theme: 'dark', accent: '#8b6dff', compact: false, fontSize: 15, reduceMotion: false, ringtone: '', notifSound: '', gifFavorites: [], notifSounds: { dm: '', mention: '', server: {} }, streamVolumes: {} },
  activities: {},
  friends: { friends: [], incoming: [], outgoing: [], blocked: [] },
};
try { Object.assign(S.prefs, JSON.parse(localStorage.getItem('orbit-prefs') || '{}')); } catch {}
// 1.8: move everyone still on the old purple default to the new accent (custom picks are kept)
// 1.10: Orbit's own teal accent replaces the old defaults (custom picks are kept)
// 1.12: Orbit purple is the default accent again (anyone on an old default moves to it; custom picks are kept)
if (!S.prefs.v112) { if (!S.prefs.accent || ['#10919f', '#5865f2'].includes(S.prefs.accent)) S.prefs.accent = '#8b6dff'; S.prefs.v18 = S.prefs.v110 = S.prefs.v112 = true; }
const savePrefs = () => { try { localStorage.setItem('orbit-prefs', JSON.stringify(S.prefs)); } catch {} };
const RINGTONES = [['ring1', 'Orbital'], ['ring2', 'Orbital II'], ['ring3', 'Orbital III']];
const NOTIFSOUNDS = [['notif1', 'Ping'], ['notif2', 'Ping II'], ['notif3', 'Ping III']];
if (!S.prefs.ringtone) S.prefs.ringtone = RINGTONES[Math.floor(Math.random() * RINGTONES.length)][0];
if (!S.prefs.notifSound) S.prefs.notifSound = NOTIFSOUNDS[Math.floor(Math.random() * NOTIFSOUNDS.length)][0];
savePrefs();
const soundUrl = (id) => '/sounds/' + id + '.mp3';
let _notifAudio;
// Pick the notification sound for this context: a per-server override, then DM / @mention overrides, then the default.
function notifSoundFor(ctx) {
  const ns = S.prefs.notifSounds || {};
  if (ctx) {
    if (ctx.serverId && ns.server && ns.server[ctx.serverId]) return ns.server[ctx.serverId];
    if (ctx.type === 'dm' && ns.dm) return ns.dm;
    if (ctx.type === 'mention' && ns.mention) return ns.mention;
  }
  return S.prefs.notifSound || 'notif1';
}
function playNotif(ctx) { if (!S.prefs.sounds) return; try { _notifAudio = _notifAudio || new Audio(); _notifAudio.src = soundUrl(notifSoundFor(ctx)); _notifAudio.volume = 0.6; _notifAudio.currentTime = 0; _notifAudio.play().catch(() => {}); } catch {} }
function playSfx(name, vol) { if (!S.prefs.sounds) return; try { const a = new Audio('/sounds/' + name + '.mp3'); a.volume = vol ?? 0.5; a.play().catch(() => {}); } catch {} }
function previewSound(id, vol) { try { const a = new Audio(soundUrl(id)); a.volume = vol ?? 0.6; a.play().catch(() => {}); return a; } catch {} }

/* ---------- dom helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function fmtDate(t) {
  const d = new Date(t), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1);
  if (d.toDateString() === n.toDateString()) return 'Today at ' + fmtTime(t);
  if (d.toDateString() === y.toDateString()) return 'Yesterday at ' + fmtTime(t);
  return d.toLocaleDateString() + ' ' + fmtTime(t);
}
const fmtDay = (t) => new Date(t).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
const fmtSize = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const initials = (n) => String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, isErr) {
  const t = h(`<div class="toast ${isErr ? 'err' : ''}">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

/* ---------- api ---------- */
async function api(method, url, body, opts = {}) {
  const headers = {};
  if (S.token) headers.Authorization = 'Bearer ' + S.token;
  headers['X-Orbit-Client'] = window.orbitDesktop ? 'desktop' : (matchMedia('(display-mode: standalone)').matches || navigator.standalone) ? 'app' : 'web';
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, { method, headers, body: payload }); }
  catch { throw new Error('Can’t reach the server. Check your connection.'); }
  let data = null;
  try { data = await res.json(); } catch {}
  if (res.status === 401 && S.token && !opts.noLogout) { logout(); throw new Error('Your session expired. Log in again.'); }
  if (!res.ok) throw new Error(data?.error || 'Something went wrong');
  return data;
}
function upload(url, form, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.setRequestHeader('Authorization', 'Bearer ' + S.token);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => { let d = null; try { d = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(d) : reject(new Error(d?.error || 'Upload failed')); };
    x.onerror = () => reject(new Error('Upload failed'));
    x.send(form);
  });
}

/* ---------- lookups ---------- */
const curServer = () => S.view.server !== '@me' ? S.serverData[S.view.server] : null;
function findChannel(id) {
  for (const sd of Object.values(S.serverData)) { const c = sd.channels.find(c => c.id === id); if (c) return c; }
  const dm = S.dms.find(d => d.id === id);
  if (!dm) return null;
  if (dm.type === 'group') return { ...dm, type: 'group', server_id: null, name: dm.name || 'Group chat' };
  return { ...dm, type: 'dm', server_id: null, name: dm.user.display_name };
}
const curChannel = () => S.view.channel ? findChannel(S.view.channel) : null;
const isDM = (ch) => !!ch && (ch.type === 'dm' || ch.type === 'group');
const isGroup = (ch) => !!ch && ch.type === 'group';
function dmTitle(ch) { return ch.type === 'group' ? (ch.name || 'Group chat') : (ch.user ? ch.user.display_name : 'Direct Message'); }
function user(id) { return S.users[id] || { id, username: 'unknown', display_name: 'Deleted User', accent: '#555' }; }
function member(sid, uidv) { const sd = S.serverData[sid]; return sd && sd.members.find(m => m.id === uidv); }
function nameIn(sid, uidv) { const m = sid && member(sid, uidv); return (m && (m.nick || m.display_name)) || user(uidv).display_name || user(uidv).username; }
function topRole(sid, uidv, onlyColored) {
  const sd = S.serverData[sid]; const m = sd && member(sid, uidv); if (!m) return null;
  return sd.roles.filter(r => m.roles.includes(r.id) && (!onlyColored || r.color)).sort((a, b) => b.position - a.position)[0] || null;
}
const colorIn = (sid, uidv) => (sid && topRole(sid, uidv, true)?.color) || null;
const can = (perm, sid = S.view.server) => { const sd = S.serverData[sid]; return !!sd && (sd.my_perms & perm) === perm; };
// your own status comes from your setting, not the server snapshot (which is taken before your connection is up)
const statusOf = (uidv) => (S.me && uidv === S.me.id) ? (S.prefs.status === 'invisible' ? 'offline' : (S.prefs.status || 'online')) : (S.presence[uidv] || 'offline');
const cropStyle = (c) => c ? `object-position:${c.x}% ${c.y}%;transform-origin:${c.x}% ${c.y}%;transform:scale(${c.z})` : '';
const AV_LOADED = new Set();
// warm the cache with everyone's profile picture so lists render instantly
function prefetchAvatars() { const seen = new Set(); for (const u of Object.values(S.users)) { if (u && u.avatar && !seen.has(u.avatar) && !AV_LOADED.has(u.avatar) && seen.size < 300) { seen.add(u.avatar); const i = new Image(); i.decoding = 'async'; i.onload = () => AV_LOADED.add(u.avatar); i.src = u.avatar; } } }
// status dot: different SHAPE per status (not just color) + a spoken label for screen readers
const STATUS_NAME = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline', invisible: 'Invisible' };
function stDot(s) { const k = s === 'invisible' ? 'offline' : (STATUS_NAME[s] ? s : 'offline'); return `<i class="st ${k}" role="img" aria-label="${STATUS_NAME[s] || 'Offline'}" title="${STATUS_NAME[s] || 'Offline'}"></i>`; }
// small inline icon with a spoken label (muted, deafened, live…)
function srIcon(svg, label) { return `<span class="sr-ico" role="img" aria-label="${label}" title="${label}">${svg}</span>`; }
function avatar(u, cls = '', withStatus = false) {
  u = typeof u === 'string' ? user(u) : u;
  const st = withStatus ? stDot(statusOf(u.id)) : '';
  const a = u.accent || '#8b6dff';
  // people with a picture get a neutral placeholder (no colored flash while it loads); no lazy-loading for avatars
  const known = u.avatar && AV_LOADED.has(u.avatar);
  return `<div class="av ${cls} ${u.avatar ? 'has-img' : ''}" data-uid="${esc(u.id)}" style="background:${u.avatar ? 'var(--bg-3)' : esc(a)}">${u.avatar ? `<span class="crop"><img src="${esc(u.avatar)}" alt="" decoding="async" class="${known ? 'ok' : ''}" onload="this.classList.add('ok');AV_LOADED.add(this.getAttribute('src'))" style="${cropStyle(u.avatar_crop)}"></span>` : `<span class="ini">${esc(initials(u.display_name || u.username))}</span>`}${st}</div>`;
}
function bannerHtml(u, cls = 'banner') {
  const bg = u.banner_color || u.theme_primary || u.accent || '#8b6dff';
  return `<div class="${cls}" style="background:${esc(bg)}">${u.banner ? `<img src="${esc(u.banner)}" alt="" style="${cropStyle(u.banner_crop)}">` : ''}</div>`;
}
function nameStyle(u) {
  if (u.name_color && u.name_color2) return `background:linear-gradient(90deg,${u.name_color},${u.name_color2});-webkit-background-clip:text;background-clip:text;color:transparent`;
  if (u.name_color) return `color:${u.name_color}`;
  return '';
}
function themeStyle(u) {
  if (!u.theme_primary) return '';
  const a = u.theme_primary, b = u.theme_accent || u.theme_primary;
  return `--card-a:${a};--card-b:${b}`;
}
const CONN = {
  spotify: ['Spotify', '#1db954', '♫'], github: ['GitHub', '#6e7681', 'GH'], steam: ['Steam', '#2a475e', 'ST'], youtube: ['YouTube', '#ff0033', '▶'],
  twitch: ['Twitch', '#9146ff', 'TV'], x: ['X', '#444', 'X'], instagram: ['Instagram', '#e1306c', 'IG'], tiktok: ['TikTok', '#25f4ee', 'TT'],
  reddit: ['Reddit', '#ff4500', 'R'], xbox: ['Xbox', '#107c10', 'XB'], playstation: ['PlayStation', '#0070d1', 'PS'], roblox: ['Roblox', '#444', 'RB'],
};
const activityOf = (uidv) => S.activities[uidv] || null;
function friendState(uid) {
  const F = S.friends;
  if (uid === S.me.id) return 'self';
  if ((F.blocked || []).some(u => u.id === uid)) return 'blocked';
  if ((F.friends || []).some(u => u.id === uid)) return 'friend';
  if ((F.incoming || []).some(u => u.id === uid)) return 'incoming';
  if ((F.outgoing || []).some(u => u.id === uid)) return 'outgoing';
  return 'none';
}
const incomingCount = () => (S.friends.incoming || []).length;
const isFriend = (uid) => friendState(uid) === 'friend';
const isBlockedUser = (uid) => uid !== S.me?.id && (S.friends.blocked || []).some(u => u.id === uid);
const ACT_VERB = { playing: 'Playing', watching: 'Watching', listening: 'Listening to', competing: 'Competing in' };
function activityLine(uidv) { const a = activityOf(uidv); return a && ACT_VERB[a.type] ? `${ACT_VERB[a.type]} ${a.name}` : ''; }
function hueOf(str) { let h = 0; for (const c of String(str)) h = (h * 31 + c.codePointAt(0)) % 360; return h; }
function gradFor(str) { return 'transparent'; }  // server initials sit on the rail's own neutral tile (no gradients)
function serverIcon(s) { return s.icon ? `<img src="${esc(s.icon)}" alt="">` : `<span class="srv-ini" style="background:${gradFor(s.id + s.name)}">${esc(initials(s.name))}</span>`; }

/* ---------- icons ---------- */
const I = {};
const ic = (name, d, vb = '0 0 24 24') => (I[name] = `<svg viewBox="${vb}" width="20" height="20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`);
ic('hash', '<path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18"/>');
ic('speaker', '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>');
ic('lock', '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>');
ic('plus', '<path d="M12 5v14M5 12h14"/>');
ic('gear', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>');
ic('mic', '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8"/>');
ic('micOff', '<path d="m2 2 20 20M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.8"/><path d="M17 16.9A7 7 0 0 1 5 10M19 10a7 7 0 0 1-.1 1.2M12 17v4M8 21h8"/>');
ic('headphones', '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>');
ic('deaf', '<path d="M3 18v-6a9 9 0 0 1 14.5-7.1M21 12v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/><path d="m2 2 20 20"/>');
ic('video', '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 8-6 4 6 4z"/>');
ic('videoOff', '<path d="m2 2 20 20M16 16v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h2m5.7 0H15a1 1 0 0 1 1 1v3.3l1 1L22 8v8"/>');
ic('screen', '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6"/>');
ic('phone', '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>');
ic('hangup', '<path d="M10.7 13.3a16 16 0 0 0 3.4 2.6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8"/><path d="m22 2-20 20"/>');
ic('users', '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>');
ic('smile', '<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>');
ic('reply', '<path d="m9 17-5-5 5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>');
ic('thread', '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>');
ic('edit', '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>');
ic('trash', '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>');
ic('copy', '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
ic('x', '<path d="M18 6 6 18M6 6l12 12"/>');
ic('bookmark', '<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>');
ic('check', '<path d="M20 6 9 17l-5-5"/>');
ic('chevron', '<path d="m6 9 6 6 6-6"/>');
ic('menu', '<path d="M3 6h18M3 12h18M3 18h18"/>');
ic('back', '<path d="m15 18-6-6 6-6"/>');
ic('upload', '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>');
ic('file', '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>');
ic('download', '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>');
ic('invite', '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>');
ic('logout', '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>');
ic('compass', '<circle cx="12" cy="12" r="10"/><path d="m16.2 7.8-2.1 6.3-6.3 2.1 2.1-6.3z"/>');
ic('crown', '<path d="m2 18 2-11 5 5 3-7 3 7 5-5 2 11z" fill="currentColor"/>');
ic('pin', '<path d="M12 17v5M9 10.8V4h6v6.8l3 3.2v2H6v-2z"/>');
ic('bell', '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/>');
ic('check', '<path d="M20 6 9 17l-5-5"/>');
ic('expand', '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>');
ic('clock', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>');
ic('inbox', '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>');
ic('sticker', '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9.5L21 14.5V5a2 2 0 0 0-2-2z"/><path d="M14 21v-5a2 2 0 0 1 2-2h5"/><path d="M8 13s1.5 2 4 2"/><path d="M9 9h.01M15 9h.01"/>');
ic('stop', '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>');
ic('forum', '<path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/>');
ic('poll', '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>');
ic('shrink', '<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>');
ic('usersOff', '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m2 2 20 20"/>');
ic('message', '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l2-5.2a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 8.4-9 8.4 8.4 0 0 1 8.5 8.5z"/>');
ic('music', '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>');
ic('link', '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>');
ic('crop', '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>');
ic('external', '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>');
ic('arrow', '<path d="M5 12h14M12 5l7 7-7 7"/>');
ic('heart', '<path d="M19 14c1.5-1.5 3-3.3 3-5.5A4.5 4.5 0 0 0 12 5 4.5 4.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7z"/>');
ic('play', '<path d="M6 4l14 8-14 8z" fill="currentColor" stroke="none"/>');
ic('pause', '<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>');
ic('fs', '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M16 21h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>');
ic('group', '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>');
ic('leave', '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>');
ic('star', '<path d="M12 2l3 7 7 .5-5.5 4.5 2 7-6.5-4-6.5 4 2-7L2 9.5 9 9z" fill="currentColor" stroke="none"/>');
/* ---------- badges ---------- */
// Orbit Staff: a purple shield with Orbit's planet + ring
const BADGE_SVG = {
  og: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.2 2.2h9.6l5 9.8-5 9.8H7.2l-5-9.8z" fill="#f2b84b"/><path d="M7.2 2.2h9.6l2.6 5.1H4.6z" fill="#fff" opacity=".28"/><path d="M7.2 2.2h9.6l5 9.8-5 9.8H7.2l-5-9.8z" fill="none" stroke="#b9791a" stroke-width="1.1"/><text x="12" y="15.6" text-anchor="middle" font-family="Arial Black,Arial,Helvetica,sans-serif" font-weight="900" font-size="9.6" fill="#3b2400" letter-spacing="-.3">OG</text></svg>',
  trusted: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12.00 1.00L14.43 2.92L17.50 2.47L18.65 5.35L21.53 6.50L21.08 9.57L23.00 12.00L21.08 14.43L21.53 17.50L18.65 18.65L17.50 21.53L14.43 21.08L12.00 23.00L9.57 21.08L6.50 21.53L5.35 18.65L2.47 17.50L2.92 14.43L1.00 12.00L2.92 9.57L2.47 6.50L5.35 5.35L6.50 2.47L9.57 2.92z" fill="#23a55a"/><circle cx="12" cy="12" r="7.6" fill="#fff" opacity=".14"/><path d="m8 12.3 2.7 2.7L16.2 9.4" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  staff: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 1.6 3.6 4.8v6.1c0 5.3 3.6 9.9 8.4 11.5 4.8-1.6 8.4-6.2 8.4-11.5V4.8z" fill="#7b5cf5"/><path d="M12 1.6 3.6 4.8v6.1c0 .9.1 1.8.3 2.6L20.4 6.9V4.8z" fill="#fff" opacity=".16"/></svg>',
};
// badge = shape + (for staff) the real Orbit logo on top, drawn white
function badgeIcon(id) { return `<span class="bdg-art">${BADGE_SVG[id]}${id === 'staff' ? '<img class="bdg-logo" src="/logo.png" alt="" draggable="false">' : ''}</span>`; }
// every badge a user has, in display order (add new badges here)
const BADGE_INFO = { staff: 'Orbit Staff', trusted: 'Trusted User', og: 'OG: one of the first people on Orbit' };
function badgesOf(u) {
  if (!u) return [];
  const have = new Set(u.badges || []); if (u.staff) have.add('staff');
  return ['staff', 'trusted', 'og'].filter(b => have.has(b)).map(id => ({ id, label: BADGE_INFO[id] }));
}
// the row of badges next to the username on profile cards
function badgeRowHtml(u) { const b = badgesOf(u); return b.length ? `<span class="badges" role="list" aria-label="Badges">${b.map(x => `<span class="bdg bdg-${x.id}" role="listitem" aria-label="${esc(x.label)}" data-tip="${esc(x.label)}" title="${esc(x.label)}">${badgeIcon(x.id)}</span>`).join('')}</span>` : ''; }
// tiny icon next to a name in chat / member lists
function badgeHtml(u) { const b = badgesOf(u)[0]; return b ? `<span class="bdg-mini" role="img" aria-label="${esc(b.label)}" title="${esc(b.label)}">${badgeIcon(b.id)}</span>` : ''; }
function groupAvatar(g, cls = '') {
  if (g.icon) return `<div class="av ${cls}" style="background:var(--bg-3)"><span class="crop"><img src="${esc(g.icon)}" alt=""></span></div>`;
  const ms = (g.members || []).filter(m => m.id !== S.me.id).slice(0, 2);
  if (ms.length >= 2) return `<div class="av gc ${cls}"><span class="g1">${avatar(ms[0], 's24')}</span><span class="g2">${avatar(ms[1], 's24')}</span></div>`;
  return `<div class="av ${cls}" style="background:var(--accent);color:#fff">${I.group.replace('width="20" height="20"', 'width="18" height="18"')}</div>`;
}

/* ---------- emoji ---------- */
const EMOJI = {
  'Smileys': '😀 😃 😄 😁 😆 😅 🤣 😂 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 😝 🤑 🤗 🤭 🤫 🤔 🤐 🤨 😐 😑 😶 😏 😒 🙄 😬 😮‍💨 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🥵 🥶 🥴 😵 🤯 🤠 🥳 🥸 😎 🤓 🧐 😕 😟 🙁 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️ 💩 🤡 👻 👽 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾',
  'Gestures': '👋 🤚 🖐️ ✋ 🖖 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅 💪 🦾 🧠 👀 👁️ 👅 👄 🫡 🫠',
  'Hearts': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝 💟 💯 💢 💥 💫 💦 💨 🕳️ 💬 💭 💤',
  'Things': '🔥 ✨ ⭐ 🌟 🎉 🎊 🎈 🎁 🏆 🥇 🎮 🕹️ 🎧 🎤 🎵 🎶 📷 📸 💻 🖥️ 📱 ⌚ 💡 📌 📎 ✏️ 📝 📚 💰 💎 🔒 🔑 🔔 📢 🚀 ✈️ 🚗 🏠 🌍 🌙 ☀️ 🌈 ⚡ ❄️ 🌊 🍀 🌸 🌹',
  'Food': '🍕 🍔 🍟 🌭 🌮 🌯 🍣 🍜 🍝 🍩 🍪 🎂 🍰 🧁 🍫 🍿 🍎 🍌 🍉 🍓 🍑 🥑 🥓 🍳 ☕ 🍵 🧋 🥤 🍺 🍻 🥂 🍷',
  'Animals': '🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🦆 🦉 🐺 🐗 🐴 🦄 🐝 🦋 🐌 🐞 🐢 🐍 🦖 🐙 🦑 🦀 🐬 🐳 🦈 🐊',
  'Symbols': '✅ ❌ ❓ ❗ ⚠️ 🚫 ⛔ 💤 🆗 🆕 🆒 🔴 🟠 🟡 🟢 🔵 🟣 ⚫ ⚪ ➕ ➖ ➗ ✖️ 💲 ♾️ ™️ ©️ ®️ 🔝 🔜 ▶️ ⏸️ ⏹️ 🔁 🔀',
};
const QUICK_REACTS = ['👍', '❤️', '😂', '🔥', '😮', '😢'];

/* ---------- message formatting ---------- */
function customEmojiImg(name, id) { return `<img class="cemoji" src="/emoji/${esc(id)}" alt=":${esc(name)}:" title=":${esc(name)}:" draggable="false" loading="lazy">`; }
// render an emoji key (unicode or <:name:id>) for reactions / pickers
function emojiHtml(e) { const m = /^<:(\w{2,32}):([\w-]{6,20})>$/.exec(e); return m ? customEmojiImg(m[1], m[2]) : esc(e); }
// every custom emoji you can use: [{id,name,url,server}]
function myEmojis() { const out = []; for (const sd of Object.values(S.serverData)) (sd.emojis || []).forEach(e => out.push({ ...e, server: sd.name, sid: sd.id })); return out; }
function formatText(text, sid) {
  if (!text) return '';
  const blocks = [];
  let s = String(text).replace(/```(?:[a-z0-9+-]*\n)?([\s\S]*?)```/gi, (_, code) => { blocks.push(`<pre>${esc(code.replace(/\n$/, ''))}</pre>`); return `\u0000${blocks.length - 1}\u0000`; });
  const inline = [];
  s = s.replace(/`([^`\n]+)`/g, (_, c) => { inline.push(`<code>${esc(c)}</code>`); return `\u0001${inline.length - 1}\u0001`; });
  s = esc(s);
  // custom emoji <:name:id>  (after escaping it looks like &lt;:name:id&gt;)
  const emo = [];
  s = s.replace(/&lt;:(\w{2,32}):([\w-]{6,20})&gt;/g, (_, n, id) => { emo.push(customEmojiImg(n, id)); return `\u0002${emo.length - 1}\u0002`; });
  // masked links [text](https://…) — only real http(s) links, and the real address is shown on hover
  const links = [];
  s = s.replace(/\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => { links.push(`<a href="${u}" target="_blank" rel="noopener noreferrer" title="${u}">${t}</a>`); return `\u0003${links.length - 1}\u0003`; });
  s = s.replace(/&lt;(https?:\/\/[^\s<]+?)&gt;/g, '$1');   // <link> = link without preview
  s = s.replace(/(https?:\/\/[^\s<\u0003]+[^\s<.,:;"')\]!?\u0003])/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
  // block markdown: headers, subtext, lists
  s = s.replace(/^### (.+)$/gm, '<div class="md-h3">$1</div>').replace(/^## (.+)$/gm, '<div class="md-h2">$1</div>').replace(/^# (.+)$/gm, '<div class="md-h1">$1</div>')
    .replace(/^-# (.+)$/gm, '<div class="md-sub">$1</div>').replace(/^\s{0,3}[-*] (.+)$/gm, '<div class="md-li">$1</div>')
    .replace(/(<div class="md-[a-z0-9]+">.*?<\/div>)\n/g, '$1');
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, '$1<i>$2</i>').replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<i>$2</i>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');
  s = s.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>');
  s = s.replace(/(^|[^\w@])@([\w.]{2,32})/g, (m, pre, name) => {
    const lower = name.toLowerCase();
    if (lower === 'everyone' || lower === 'here') return `${pre}<span class="mention">@${name}</span>`;
    const pool = sid ? (S.serverData[sid]?.members || []) : Object.values(S.users);
    const u = pool.find(x => x.username && x.username.toLowerCase() === lower);
    return u ? `${pre}<span class="mention" data-uid="${esc(u.id)}">@${esc(sid ? nameIn(sid, u.id) : u.display_name)}</span>` : m;
  });
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => inline[i]).replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]).replace(/\u0002(\d+)\u0002/g, (_, i) => emo[i]).replace(/\u0003(\d+)\u0003/g, (_, i) => links[i]);
  const plain = String(text).trim();
  if (/^(\s*<:\w{2,32}:[\w-]{6,20}>\s*|\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,27}$/u.test(plain) && /<:\w+:[\w-]+>/.test(plain)) return `<span class="big-emoji">${s}</span>`;
  if (/^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s){1,24}$/u.test(plain) && /\p{Extended_Pictographic}/u.test(plain) && [...plain.replace(/\s/g, '')].length <= 27) s = `<span class="big-emoji">${s}</span>`;
  return s;
}
const plainPreview = (text) => String(text || '').replace(/```[\s\S]*?```/g, '[code]').replace(/[*_~|`>]/g, '').slice(0, 120);

/* ---------- sounds ---------- */
let audioCtx;
function beep(kind) {
  if (!S.prefs.sounds) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const tones = { msg: [[880, 0, .08], [1320, .07, .1]], join: [[523, 0, .1], [784, .09, .12]], leave: [[784, 0, .1], [523, .09, .12]], mute: [[440, 0, .06]], unmute: [[660, 0, .06]] }[kind] || [[600, 0, .1]];
    tones.forEach(([f, start, dur]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + start;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12, t + .01); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      o.start(t); o.stop(t + dur + .02);
    });
  } catch {}
}

/* A warmer, repeating call ringtone (two gentle chimes, like a phone trill). */
const Ringtone = {
  audio: null,
  start() {
    if (!S.prefs.sounds || this.audio) return;
    try {
      this.audio = new Audio(soundUrl(S.prefs.ringtone || 'ring1'));
      this.audio.loop = true; this.audio.volume = 0.7;
      this.audio.play().catch(() => {});
    } catch {}
  },
  stop() { if (this.audio) { try { this.audio.pause(); this.audio.currentTime = 0; } catch {} this.audio = null; } },
};

/* ---------- appearance ---------- */
function applyAppearance() {
  const p = S.prefs, r = document.documentElement;
  r.dataset.theme = p.theme || 'dark';
  r.style.setProperty('--accent', p.accent || '#8b6dff');
  r.style.setProperty('--accent-2', `color-mix(in oklab, ${p.accent || '#8b6dff'} 78%, white)`);
  r.style.setProperty('--accent-soft', `color-mix(in oklab, ${p.accent || '#8b6dff'} 18%, transparent)`);
  r.style.setProperty('--fs', (p.fontSize || 15) + 'px');
  r.classList.toggle('compact', !!p.compact);
  r.classList.toggle('reduce-motion', !!p.reduceMotion);
}
applyAppearance();

/* phones: size the app to the part of the screen you can actually see (shrinks when the keyboard
   opens), and snap the page back if iOS scrolled it while typing — otherwise the top gets cut off
   and the buttons up there stop responding. */
(function fitViewport() {
  const vv = window.visualViewport; if (!vv) return;
  const root = document.documentElement;
  const fit = () => {
    if (vv.scale > 1.01) return;   // someone pinch-zoomed on purpose: leave it alone
    root.style.setProperty('--app-h', Math.round(vv.height) + 'px');
    if (window.scrollY || window.scrollX) window.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 300));
  document.addEventListener('focusout', () => setTimeout(fit, 60));
  fit();
})();
