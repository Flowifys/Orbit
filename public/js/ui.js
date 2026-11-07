'use strict';
/* Orbit UI: auth, shell, sidebar, chat, members, popouts, modals */
const LOGO = '/logo.png';
let socket = null;

/* ================= AUTH ================= */
function renderAuth(mode = 'login', ctx = {}) {
  const root = $('#root');
  const invite = ctx.invite || S.pendingInvite;
  const titles = {
    login: ['Welcome back!', invite ? 'Log in to accept your invite.' : 'We’re so excited to see you again!'],
    register: ['Create an account', invite ? 'Sign up to accept your invite.' : 'Join Orbit in a few seconds.'],
    verify: ['Check your email', `We sent a 6-digit code to ${esc(ctx.email || '')}.`],
    forgot: ['Reset your password', 'Enter your email and we’ll send you a code.'],
    reset: ['Choose a new password', `Enter the code sent to ${esc(ctx.email || '')}.`],
  };
  const [t, sub] = titles[mode];
  let fields = '';
  if (mode === 'login') fields = `
    <div class="field"><label>Email or username <span class="req">*</span></label><input class="input" name="email" autocomplete="username" required></div>
    <div class="field"><label>Password <span class="req">*</span></label><input class="input" name="password" type="password" autocomplete="current-password" required></div>
    <div style="margin:-6px 0 14px"><button type="button" class="btn ghost sm" style="padding:0" data-go="forgot">Forgot your password?</button></div>
    <button class="btn primary block">Log In</button>
    <div class="switch">Need an account? <button type="button" data-go="register">Register</button></div>`;
  if (mode === 'register') fields = `
    <div class="field"><label>Email <span class="req">*</span></label><input class="input" name="email" type="email" autocomplete="email" required></div>
    <div class="field"><label>Display name</label><input class="input" name="display_name" maxlength="32" placeholder="How others see you"></div>
    <div class="field"><label>Username <span class="req">*</span></label><input class="input" name="username" autocomplete="username" maxlength="32" pattern="[a-zA-Z0-9_.]{2,32}" required placeholder="letters, numbers, _ and ."></div>
    <div class="field"><label>Password <span class="req">*</span></label><input class="input" name="password" type="password" autocomplete="new-password" minlength="6" required></div>
    <button class="btn primary block">Continue</button>
    <div class="switch"><button type="button" data-go="login">Already have an account?</button></div>`;
  if (mode === 'verify') fields = `
    <div class="field"><label>Verification code</label><input class="input code-input" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div>
    <button class="btn primary block">Verify</button>
    <div class="switch">Didn’t get it? <button type="button" data-resend>Resend code</button> · <button type="button" data-go="login">Back to login</button></div>`;
  if (mode === 'forgot') fields = `
    <div class="field"><label>Email</label><input class="input" name="email" type="email" required></div>
    <button class="btn primary block">Send code</button>
    <div class="switch"><button type="button" data-go="login">Back to login</button></div>`;
  if (mode === 'reset') fields = `
    <div class="field"><label>Code</label><input class="input code-input" name="code" inputmode="numeric" maxlength="6" required></div>
    <div class="field"><label>New password</label><input class="input" name="password" type="password" minlength="6" autocomplete="new-password" required></div>
    <button class="btn primary block">Reset password</button>
    <div class="switch"><button type="button" data-go="login">Back to login</button></div>`;
  root.innerHTML = `<div class="auth"><form class="auth-card" novalidate>
    <div class="auth-logo"><img src="${LOGO}" alt=""><span>Orbit</span></div>
    <h1>${t}</h1><p class="sub">${sub}</p>
    ${invite && (mode === 'login' || mode === 'register') ? `<div class="note">You’ve been invited to join a server.</div>` : ''}
    ${ctx.note ? `<div class="note">${esc(ctx.note)}</div>` : ''}
    <div class="err hidden"></div>${fields}</form></div>`;
  const form = $('.auth-card');
  const errBox = $('.err', form);
  const showErr = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
  form.querySelectorAll('[data-go]').forEach(b => b.onclick = () => renderAuth(b.dataset.go, { email: ctx.email }));
  const rs = $('[data-resend]', form);
  if (rs) rs.onclick = async () => { await api('POST', '/api/auth/resend', { email: ctx.email }).catch(() => {}); toast('A new code is on its way.'); };
  setTimeout(() => $('input', form)?.focus(), 30);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    const btn = $('button.primary', form); btn.disabled = true;
    try {
      let r;
      if (mode === 'login') r = await api('POST', '/api/auth/login', d, { noLogout: true });
      if (mode === 'register') r = await api('POST', '/api/auth/register', d, { noLogout: true });
      if (mode === 'verify') r = await api('POST', '/api/auth/verify', { email: ctx.email, code: d.code });
      if (mode === 'forgot') { const x = await api('POST', '/api/auth/forgot', d); return renderAuth('reset', { email: d.email, note: x.email_enabled ? '' : 'Email isn’t set up on this server, so the code was written to the server’s log. Ask whoever runs the server for it.' }); }
      if (mode === 'reset') r = await api('POST', '/api/auth/reset', { email: ctx.email, code: d.code, password: d.password });
      if (r?.needs_verification) return renderAuth('verify', { email: r.email });
      if (r?.token) { S.token = r.token; try { localStorage.setItem('orbit-token', r.token); } catch {} loadApp(); }
    } catch (ex) { showErr(ex.message); btn.disabled = false; }
  };
}

function logout() {
  try { localStorage.removeItem('orbit-token'); } catch {}
  S.token = null;
  if (window.Voice) Voice.leave();
  if (socket) { socket.disconnect(); socket = null; }
  location.href = '/';
}

/* ================= BOOT ================= */
async function boot() {
  const m = location.pathname.match(/^\/invite\/([\w-]+)/);
  if (m) { S.pendingInvite = m[1]; history.replaceState(null, '', '/'); }
  try { S.token = localStorage.getItem('orbit-token'); } catch {}
  S.info = await api('GET', '/api/info').catch(() => ({}));
  if (S.token) loadApp(); else renderAuth(S.pendingInvite ? 'register' : 'login');
}

async function loadApp() {
  let data;
  try { data = await api('GET', '/api/me'); } catch (e) { if (!S.token) return; $('#root').innerHTML = `<div class="auth"><div class="auth-card"><h1>Can’t connect</h1><p class="sub">${esc(e.message)}</p><button class="btn primary block" onclick="location.reload()">Retry</button></div></div>`; return; }
  S.me = data.me; S.users[S.me.id] = S.me;
  S.servers = data.servers; S.dms = data.dms; S.unread = data.unread; S.presence = data.presence; S.voice = data.voice; S.activities = data.activities || {}; S.friends = data.friends || S.friends;
  S.dms.forEach(d => { if (d.user) S.users[d.user.id] = d.user; (d.members || []).forEach(m => S.users[m.id] = { ...S.users[m.id], ...m }); });
  cacheFriends();
  await Promise.all(S.servers.map(s => fetchServer(s.id)));
  renderShell();
  prefetchAvatars();
  connectSocket();
  if (S.pendingInvite) { const c = S.pendingInvite; S.pendingInvite = null; showInvite(c); }
  else {
    let last = null; try { last = JSON.parse(localStorage.getItem('orbit-view') || 'null'); } catch {}
    if (last && last.server !== '@me' && S.serverData[last.server]) selectServer(last.server, last.channel);
    else if (last && last.server === '@me' && last.channel && S.dms.find(d => d.id === last.channel)) selectChannel(last.channel);
    else selectServer('@me');
  }
  if ('Notification' in window && Notification.permission === 'default' && S.prefs.notify) setTimeout(() => Notification.requestPermission().catch(() => {}), 1500);
}
async function fetchServer(sid) {
  const sd = await api('GET', '/api/servers/' + sid);
  S.serverData[sid] = sd;
  sd.members.forEach(m => (S.users[m.id] = { ...S.users[m.id], ...pickUser(m) }));
  const i = S.servers.findIndex(s => s.id === sid);
  const sum = { id: sd.id, name: sd.name, icon: sd.icon, owner_id: sd.owner_id };
  if (i >= 0) S.servers[i] = sum; else S.servers.push(sum);
  return sd;
}
function cacheFriends() { const F = S.friends || {}; ['friends', 'incoming', 'outgoing', 'blocked'].forEach(k => (F[k] || []).forEach(u => S.users[u.id] = { ...S.users[u.id], ...u })); }
const pickUser = (m) => { const { nick, joined, roles, ...u } = m; if (u.activity) S.activities[u.id] = u.activity; return u; };

/* ================= SOCKET ================= */
function connectSocket() {
  socket = io({ auth: { token: S.token, status: S.prefs.status } });
  let wasDown = false;
  socket.on('connect', () => { $('.offline-banner')?.remove(); if (wasDown) { wasDown = false; resync(); } });
  socket.on('disconnect', () => { wasDown = true; if (!$('.offline-banner')) $('.main')?.prepend(h('<div class="offline-banner">Reconnecting…</div>')); });
  socket.on('connect_error', (e) => { if (e.message === 'unauthorized') logout(); });
  socket.on('friends:refresh', (f) => { S.friends = f; cacheFriends(); if (S.view.server === '@me' && !S.view.channel) renderMain(); renderRail(); renderSidebar(); });
  socket.on('friends:request', ({ from }) => { S.users[from.id] = { ...S.users[from.id], ...from }; playNotif(); toast(`${from.display_name} sent you a friend request`); });
  socket.on('friends:accepted', ({ user: u }) => { S.users[u.id] = { ...S.users[u.id], ...u }; playNotif(); toast(`${u.display_name} accepted your friend request`); });
  socket.on('message:new', onMessageNew);
  socket.on('timeout', ({ server_id, until, reason }) => { toast(`You were timed out in ${S.serverData[server_id]?.name || 'a server'} until ${new Date(until).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}${reason ? ` — ${reason}` : ''}`, true); });
  socket.on('message:update', (m) => { upsertMessage(m); });
  socket.on('message:delete', ({ id, channel_id, thread_id }) => {
    const key = thread_id ? 't:' + thread_id : channel_id;
    if (S.messages[key]) { S.messages[key] = S.messages[key].filter(x => x.id !== id); refreshMessages(key); }
    if (S.thread && S.thread.id === id) closeThread();
  });
  socket.on('typing', ({ channel_id, user_id }) => {
    if (user_id === S.me.id) return;
    S.typing[channel_id] = S.typing[channel_id] || {};
    S.typing[channel_id][user_id] = Date.now() + 9000;
    renderTyping();
  });
  socket.on('activity', ({ user_id, activity }) => { if (activity) S.activities[user_id] = activity; else delete S.activities[user_id]; renderMembers(); const card = $(`.profile-card[data-card="${user_id}"] .activity-slot`); if (card) card.innerHTML = activityHtml(user_id); if (S.view.server === '@me' && !S.view.channel) renderMain(); if (user_id === S.me.id) renderUserPanel(); });
  socket.on('presence', ({ user_id, status }) => { S.presence[user_id] = status; if (user_id === S.me.id) return renderUserPanel(); softRefresh(); });
  socket.on('user:update', (u) => { S.users[u.id] = { ...S.users[u.id], ...u }; Object.values(S.serverData).forEach(sd => { const m = sd.members.find(x => x.id === u.id); if (m) Object.assign(m, u); });
    S.dms.forEach(d => { if (d.user && d.user.id === u.id) d.user = u; if (d.members) d.members = d.members.map(m => m.id === u.id ? u : m); }); if (u.id === S.me.id) S.me = { ...S.me, ...u }; softRefresh(true); });
  socket.on('server:refresh', async ({ server_id }) => { await fetchServer(server_id).catch(() => {}); if (S.view.server === server_id) { const c = curChannel(); if (!c) selectServer(server_id); } softRefresh(true); });
  socket.on('server:added', async ({ server_id }) => { if (!S.serverData[server_id]) { await fetchServer(server_id); renderRail(); } });
  socket.on('server:removed', ({ server_id, reason, channel_id, group }) => {
    if (group && channel_id) { S.dms = S.dms.filter(d => d.id !== channel_id); if (Voice.channel === channel_id) Voice.leave(); if (S.view.channel === channel_id) selectServer('@me'); else { renderSidebar(); renderRail(); } return; }
    const name = S.serverData[server_id]?.name;
    delete S.serverData[server_id]; S.servers = S.servers.filter(s => s.id !== server_id);
    if (Voice.channel && findChannel(Voice.channel) == null) Voice.leave();
    if (reason === 'kicked' || reason === 'banned') toast(`You were ${reason} from ${name || 'a server'}.`, true);
    if (S.view.server === server_id) selectServer('@me'); else renderRail();
  });
  socket.on('dm:update', (entry) => {
    if (entry.user) S.users[entry.user.id] = { ...S.users[entry.user.id], ...entry.user };
    (entry.members || []).forEach(m => S.users[m.id] = { ...S.users[m.id], ...m });
    const i = S.dms.findIndex(x => x.id === entry.id);
    if (i >= 0) S.dms[i] = { ...S.dms[i], ...entry }; else S.dms.unshift(entry);
    S.dms.sort((a, b) => b.last_at - a.last_at);
    if (S.view.server === '@me') renderSidebar();
    renderRail();
    if (S.view.channel === entry.id) renderTopbar();
  });
  socket.on('voice:state', ({ channel_id, users }) => {
    const prev = (S.voice[channel_id] || []).map(u => u.user_id);
    if (users.length) S.voice[channel_id] = users; else delete S.voice[channel_id];
    if (Voice.channel === channel_id) {
      const now = users.map(u => u.user_id);
      if (now.some(u => !prev.includes(u) && u !== S.me.id)) playSfx('join');
      if (prev.some(u => !now.includes(u) && u !== S.me.id)) playSfx('leave');
    }
    renderSidebar(); renderVoiceArea();
  });
  Voice.bindSocket(socket);
}
async function resync() {
  try {
    const data = await api('GET', '/api/me');
    S.servers = data.servers; S.dms = data.dms; S.unread = data.unread; S.presence = data.presence; S.voice = data.voice;
    await Promise.all(S.servers.map(s => fetchServer(s.id)));
    Object.keys(S.messages).forEach(k => delete S.messages[k]);
    renderShell(); selectChannel(S.view.channel, true);
  } catch {}
}
setInterval(() => { let changed = false; const t = Date.now(); for (const c in S.typing) for (const u in S.typing[c]) if (S.typing[c][u] < t) { delete S.typing[c][u]; changed = true; } if (changed) renderTyping(); }, 2000);

/* ================= SHELL ================= */
function renderShell() {
  $('#root').innerHTML = `<div class="app"><nav class="rail"></nav><aside class="sidebar"></aside><main class="main"></main></div>`;
  renderRail(); renderSidebar(); renderMain();
}
const softRefresh = debounce((full) => { renderSidebar(); renderMembers(); if (full) { renderRail(); renderTopbar(); refreshMessages(S.view.channel); if (S.thread) refreshMessages('t:' + S.thread.id); } renderVoiceArea(); }, 60);

function unreadForServer(sid) { let c = 0, m = 0; const sm = isMuted(sid); for (const [cid, u] of Object.entries(S.unread)) if (u.server_id === sid) { if (!sm && !isMuted(cid)) c += u.count; m += u.mentions; } return { c, m }; }
const badgeNum = (n) => (n > 99 ? '99+' : String(n));
function renderRail() {
  const rail = $('.rail'); if (!rail) return;
  const dmUnread = S.dms.filter(d => S.unread[d.id]);
  const dmMentions = incomingCount();   // Home only shows friend requests; unread DMs get their own bubble below
  rail.innerHTML = `
    <div class="rail-item ${S.view.server === '@me' ? 'active' : ''}" data-tip="Home"><i class="pill"></i><button class="rail-btn home" data-s="@me"><img src="${LOGO}" alt="Home"></button>${dmMentions ? `<span class="badge">${badgeNum(dmMentions)}</span>` : ''}</div>
    ${dmUnread.filter(d => d.id !== S.view.channel).slice(0, 3).map(d => `<div class="rail-item" data-tip="${esc(d.type === 'group' ? (d.name || 'Group chat') : d.user.display_name)}"><i class="pill"></i><button class="rail-btn" data-dm="${d.id}" style="background:none">${d.type === 'group' ? groupAvatar(d, '') : avatar(d.user, '')}</button><span class="badge">${badgeNum(S.unread[d.id].mentions || S.unread[d.id].count)}</span></div>`).join('')}
    <div class="rail-sep"></div>
    ${S.servers.map(s => { const u = unreadForServer(s.id); return `<div class="rail-item ${S.view.server === s.id ? 'active' : ''} ${u.c ? 'unread' : ''} ${isMuted(s.id) ? 'muted' : ''}" data-tip="${esc(s.name)}"><i class="pill"></i><button class="rail-btn" data-s="${s.id}">${serverIcon(s)}</button>${u.m ? `<span class="badge">${badgeNum(u.m)}</span>` : ''}</div>`; }).join('')}
    <div class="rail-item" data-tip="Add a Server"><button class="rail-btn action" data-add>${I.plus}</button></div>
    <div class="rail-item" data-tip="Join with an invite"><button class="rail-btn action" data-join>${I.compass}</button></div>`;
  rail.onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.s) selectServer(b.dataset.s);
    else if (b.dataset.dm) { S.view.server = '@me'; selectChannel(b.dataset.dm); }
    else if ('add' in b.dataset) createServerModal();
    else if ('join' in b.dataset) joinServerModal();
  };
  rail.oncontextmenu = (e) => { const b = e.target.closest('.rail-btn[data-s]'); if (b && b.dataset.s !== '@me') { e.preventDefault(); serverRailMenu(e, b.dataset.s); } const dm = e.target.closest('.rail-btn[data-dm]'); if (dm) { e.preventDefault(); const d = S.dms.find(x => x.id === dm.dataset.dm); if (d && d.user) profilePopout(d.user.id, dm); } };
  bindTips(rail);
}
let tipEl;
function bindTips(root) {
  $$('[data-tip]', root).forEach(el => {
    el.onmouseenter = () => { tipEl?.remove(); const r = el.getBoundingClientRect(); tipEl = h(`<div class="tip">${esc(el.dataset.tip)}</div>`); document.body.appendChild(tipEl);
      tipEl.style.left = (r.right + 10) + 'px'; tipEl.style.top = (r.top + r.height / 2 - tipEl.offsetHeight / 2) + 'px'; };
    el.onmouseleave = () => { tipEl?.remove(); tipEl = null; };
  });
}

function selectServer(sid, channelId) {
  tipEl?.remove();
  closeThread(true);
  if (sid === '@me') {
    S.view = { server: '@me', channel: null };
    if (channelId && S.dms.find(d => d.id === channelId)) S.view.channel = channelId;
  } else {
    const sd = S.serverData[sid]; if (!sd) return;
    const text = sd.channels.filter(c => c.type === 'text');
    const pick = channelId && sd.channels.find(c => c.id === channelId && c.type === 'text') ? channelId : (S.lastChannel[sid] && text.find(c => c.id === S.lastChannel[sid]) ? S.lastChannel[sid] : text[0]?.id || null);
    S.view = { server: sid, channel: pick };
  }
  saveView();
  renderRail(); renderSidebar(); renderMain();
  if (S.view.channel) openChannel(S.view.channel);
}
function selectChannel(cid, force) {
  const ch = findChannel(cid);
  if (!ch) return selectServer('@me');
  if (ch.type === 'voice') { S.view.server = ch.server_id; S.view.channel = cid; saveView(); renderSidebar(); renderMain(); return; }
  const serverChanged = (ch.server_id || '@me') !== S.view.server;
  if (!force && !serverChanged && S.view.channel === cid) { showMainMobile(); return; }
  S.view = { server: ch.server_id || '@me', channel: cid };
  if (ch.server_id) S.lastChannel[ch.server_id] = cid;
  closeThread(true);
  saveView();
  if (serverChanged) renderRail();
  renderSidebar(); renderMain();
  openChannel(cid);
}
function saveView() { try { localStorage.setItem('orbit-view', JSON.stringify(S.view)); } catch {} }
function showMainMobile() { $('.app')?.classList.add('show-main'); }

/* ================= SIDEBAR ================= */
function renderSidebar() {
  const side = $('.sidebar'); if (!side) return;
  const scroll = $('.side-list', side)?.scrollTop || 0;
  if (S.view.server === '@me') {
    side.innerHTML = `<button class="side-search" data-find>Find or start a conversation</button>
      <div class="side-list">
        <button class="dm-item ${!S.view.channel ? 'active' : ''}" data-home><span class="icon-btn" style="width:32px">${I.users}</span><span class="nm">Friends</span>${incomingCount() ? `<span class="badge">${incomingCount()}</span>` : ''}</button>
        <div class="cat"><span>Direct messages</span><button data-find title="New message">+</button></div>
        ${S.dms.length ? S.dms.map(d => { const un = S.unread[d.id]; const inCall = (S.voice[d.id] || []).length;
          if (d.type === 'group') return `<button class="dm-item ${S.view.channel === d.id ? 'active' : ''} ${un && !isMuted(d.id) ? 'unread' : ''} ${isMuted(d.id) ? 'muted' : ''}" data-dm="${d.id}">${groupAvatar(d, 's32')}<span class="nm">${esc(d.name || 'Group chat')}<small>${d.member_count} members</small></span>${inCall ? `<span style="color:var(--green)">${I.phone}</span>` : ''}${un ? `<span class="badge">${un.count}</span>` : ''}</button>`;
          return `<button class="dm-item ${S.view.channel === d.id ? 'active' : ''} ${un && !isMuted(d.id) ? 'unread' : ''} ${isMuted(d.id) ? 'muted' : ''}" data-dm="${d.id}">${avatar(d.user, 's32', true)}<span class="nm">${esc(d.user.display_name)}${activityLine(d.user.id) ? `<small>${esc(activityLine(d.user.id))}</small>` : d.user.status_text ? `<small>${esc(d.user.status_text)}</small>` : ''}</span>${inCall ? `<span style="color:var(--green)">${I.phone}</span>` : ''}${un ? `<span class="badge">${un.count}</span>` : ''}</button>`; }).join('')
          : `<p style="color:var(--dim);font-size:13px;padding:8px">No conversations yet. Click someone’s name to message them.</p>`}
      </div>${voiceBarHtml()}${userPanelHtml()}`;
  } else {
    const sd = curServer(); if (!sd) return;
    const text = sd.channels.filter(c => c.type === 'text'), voice = sd.channels.filter(c => c.type === 'voice');
    const chanBtn = (c) => {
      const un = S.unread[c.id];
      const icon = c.type === 'voice' ? I.speaker : I.hash;
      const people = c.type === 'voice' ? (S.voice[c.id] || []) : [];
      const muted = isMuted(c.id) || isMuted(sd.id);
      return `<div role="button" tabindex="0" class="ch ${S.view.channel === c.id ? 'active' : ''} ${un && !muted && S.view.channel !== c.id ? 'unread' : ''} ${muted ? 'muted' : ''}" data-ch="${c.id}">
        <span class="ico">${c.private ? I.lock : icon}</span><span class="nm">${esc(c.name)}</span>
        ${un && un.mentions && S.view.channel !== c.id ? `<span class="badge">${un.mentions}</span>` : ''}
        <span class="act">${can(PERM.CREATE_INVITE) ? `<button data-invite title="Invite">${I.invite}</button>` : ''}${can(PERM.MANAGE_CHANNELS) ? `<button data-edit="${c.id}" title="Edit channel">${I.gear}</button>` : ''}</span>
      </div>${people.length ? `<div class="vc-users">${people.map(p => `<div class="vc-user" data-uid="${p.user_id}">${avatar(p.user_id, 's24' + (Voice.speaking.has(p.user_id) ? ' speaking' : ''))}<span>${esc(nameIn(sd.id, p.user_id))}</span><span class="icons">${p.screen ? '<span class="live" aria-label="Streaming live">LIVE</span>' : ''}${p.video ? srIcon(I.video, 'Camera on') : ''}${p.deaf ? srIcon(I.deaf, 'Deafened') : p.muted ? srIcon(I.micOff, 'Muted') : ''}</span></div>`).join('')}</div>` : ''}`;
    };
    const head = `<div class="side-head" data-smenu><span class="sh-icon">${serverIcon(sd)}</span><span class="t">${esc(sd.name)}</span>${I.chevron}</div>`;
    side.innerHTML = `${sd.banner ? `<div class="side-banner" style="background-image:url('${esc(sd.banner)}')">${head}</div>` : head}
      <div class="side-list">
        <div class="cat ${isCollapsed(sd.id + ':text') ? 'collapsed' : ''}" data-collapse="${sd.id}:text"><span>${I.chevron}Text channels</span>${can(PERM.MANAGE_CHANNELS) ? `<button data-new="text" title="Create channel">+</button>` : ''}</div>
        ${text.filter(c => !isCollapsed(sd.id + ':text') || S.view.channel === c.id || (S.unread[c.id] && !isMuted(c.id))).map(chanBtn).join('')}
        <div class="cat ${isCollapsed(sd.id + ':voice') ? 'collapsed' : ''}" data-collapse="${sd.id}:voice"><span>${I.chevron}Voice channels</span>${can(PERM.MANAGE_CHANNELS) ? `<button data-new="voice" title="Create channel">+</button>` : ''}</div>
        ${voice.filter(c => !isCollapsed(sd.id + ':voice') || S.view.channel === c.id || Voice.channel === c.id || (S.voice[c.id] || []).length).map(chanBtn).join('')}
      </div>${voiceBarHtml()}${userPanelHtml()}`;
  }
  const list = $('.side-list', side); if (list) list.scrollTop = scroll;
  side.onclick = (e) => {
    const t = e.target;
    if (t.closest('[data-find]')) return newDmModal();
    if (t.closest('[data-home]')) { S.view.channel = null; saveView(); renderSidebar(); renderMain(); showMainMobile(); return; }
    const dm = t.closest('[data-dm]'); if (dm) { selectChannel(dm.dataset.dm); showMainMobile(); return; }
    if (t.closest('[data-invite]')) { e.stopPropagation(); return inviteModal(S.view.server); }
    const ed = t.closest('[data-edit]'); if (ed) { e.stopPropagation(); return channelSettingsModal(ed.dataset.edit); }
    const nw = t.closest('[data-new]'); if (nw) return createChannelModal(nw.dataset.new);
    const col = t.closest('[data-collapse]'); if (col) return toggleCollapsed(col.dataset.collapse);
    const vu = t.closest('.vc-user'); if (vu) return profilePopout(vu.dataset.uid, vu);
    const ch = t.closest('[data-ch]');
    if (ch) { const c = findChannel(ch.dataset.ch); if (c.type === 'voice') { if (Voice.channel !== c.id) Voice.join(c.id); S.view.channel = c.id; saveView(); renderSidebar(); renderMain(); showMainMobile(); } else { selectChannel(c.id); showMainMobile(); } return; }
    if (t.closest('[data-smenu]')) return serverMenu(t.closest('[data-smenu]'));
    voiceBarClick(e); userPanelClick(e);
  };
  side.oncontextmenu = (e) => {
    const dmEl = e.target.closest('[data-dm]');
    if (dmEl) { e.preventDefault(); const d = S.dms.find(x => x.id === dmEl.dataset.dm); if (!d) return; const label = d.type === 'group' ? (d.name || 'this group') : '@' + d.user.username;
      return contextMenu(e, [S.unread[d.id] && ['Mark as read', () => markRead(d.id, true)], [isMuted(d.id) ? `Unmute ${esc(label)}` : `Mute ${esc(label)}`, () => toggleMuteId(d.id, label)],
        d.user && ['Profile', () => profilePopout(d.user.id, dmEl)], d.user && ['Call', () => { selectChannel(d.id); Voice.join(d.id); }], ['Copy channel ID', () => copy(d.id)]]); }
    const ch = e.target.closest('[data-ch]'); if (!ch) return;
    e.preventDefault();
    const c = findChannel(ch.dataset.ch);
    contextMenu(e, [
      S.unread[c.id] && ['Mark as read', () => markRead(c.id, true)],
      [isMuted(c.id) ? 'Unmute channel' : 'Mute channel', () => toggleMuteId(c.id, (c.type === 'voice' ? '' : '#') + c.name)],
      can(PERM.CREATE_INVITE) && ['Invite people', () => inviteModal(S.view.server)],
      ['Copy channel link', () => copy(location.origin + '/app/' + c.id)],
      can(PERM.MANAGE_CHANNELS) && '-', can(PERM.MANAGE_CHANNELS) && ['Edit channel', () => channelSettingsModal(c.id)],
      can(PERM.MANAGE_CHANNELS) && ['Delete channel', () => deleteChannel(c), 'danger'],
    ]);
  };
}
function userPanelHtml() {
  const st = S.prefs.status === 'invisible' ? 'offline' : S.prefs.status;
  return `<div class="user-panel"><button class="me" data-status aria-label="Your profile and status: ${STATUS_NAME[S.prefs.status] || 'Online'}">${avatar({ ...S.me, id: '__me' }, 's32').replace('</div>', `${stDot(st)}</div>`)}<span class="who"><b>${esc(S.me.display_name)}</b><span>${esc(activityLine(S.me.id) || S.me.status_text || S.me.username)}</span></span></button>
    <button class="icon-btn ${Voice.muted ? 'active' : ''}" data-mute title="${Voice.muted ? 'Unmute' : 'Mute'}">${Voice.muted ? I.micOff : I.mic}</button>
    <button class="icon-btn ${Voice.deaf ? 'active' : ''}" data-deaf title="${Voice.deaf ? 'Undeafen' : 'Deafen'}">${Voice.deaf ? I.deaf : I.headphones}</button>
    <button class="icon-btn" data-settings title="User settings">${I.gear}</button></div>`;
}
function renderUserPanel() { const p = $('.user-panel'); if (p) p.outerHTML = userPanelHtml(); }
function userPanelClick(e) {
  if (e.target.closest('[data-mute]')) Voice.toggleMute();
  else if (e.target.closest('[data-deaf]')) Voice.toggleDeaf();
  else if (e.target.closest('[data-settings]')) openUserSettings();
  else if (e.target.closest('[data-status]')) selfProfilePopout(e.target.closest('.user-panel'));
}
function statusMenu(anchor) {
  const opts = [['online', 'Online', 'var(--green)'], ['idle', 'Idle', 'var(--yellow)'], ['dnd', 'Do Not Disturb', 'var(--red)'], ['invisible', 'Invisible', '#5d5c6b']];
  const r = anchor.getBoundingClientRect();
  const items = [['View profile', () => profilePopout(S.me.id, anchor)], ['Edit profile', () => openUserSettings('profile')], '-',
    ...opts.map(([k, l, c]) => [`<span><span class="dot" style="background:${c}"></span>${l}</span>${S.prefs.status === k ? I.check : ''}`, () => { S.prefs.status = k; savePrefs(); socket.emit('presence', k); renderUserPanel(); }]),
    '-', ['Set custom status', () => customStatusModal()], ['Log out', logout, 'danger']];
  contextMenu({ clientX: r.left, clientY: r.top - 8, above: true }, items, 'status-menu');
}
function voiceBarHtml() {
  if (!Voice.channel) return '';
  const ch = findChannel(Voice.channel);
  const where = !ch ? '' : ch.type === 'dm' ? 'Call with ' + ch.name : ch.type === 'group' ? ch.name : [ch.name, S.serverData[ch.server_id]?.name].filter(Boolean).join(' / ');
  return `<div class="voice-bar"><div class="row1"><div class="status"><b>${I.speaker} ${Voice.state === 'connecting' ? 'Connecting…' : 'Voice Connected'}<time data-vtime>${Voice.joinedAt ? fmtCallTime(Date.now() - Voice.joinedAt) : ''}</time></b><span data-goto-voice>${esc(where)}</span></div>
    <button class="icon-btn" data-vleave title="Disconnect">${I.hangup}</button></div>
    <div class="row2"><button data-vcam class="${Voice.video ? 'on' : ''}" title="Camera">${Voice.video ? I.video : I.videoOff}</button><button data-vscreen class="${Voice.screen ? 'on' : ''}" title="Share screen">${I.screen}</button></div></div>`;
}
function voiceBarClick(e) {
  if (e.target.closest('[data-vleave]')) Voice.leave();
  else if (e.target.closest('[data-vcam]')) Voice.toggleCamera();
  else if (e.target.closest('[data-vscreen]')) Voice.toggleScreen();
  else if (e.target.closest('[data-goto-voice]')) { const ch = findChannel(Voice.channel); if (ch) { if (ch.type === 'dm') selectChannel(ch.id); else { S.view = { server: ch.server_id, channel: ch.id }; renderRail(); renderSidebar(); renderMain(); } showMainMobile(); } }
}
function serverRailMenu(e, sid) {
  const sd = S.serverData[sid]; if (!sd) return;
  const owner = sd.owner_id === S.me.id;
  const unread = sd.channels.some(c => S.unread[c.id]);
  contextMenu(e, [
    can(PERM.CREATE_INVITE, sid) && [`Invite People ${I.invite}`, () => inviteModal(sid)],
    (can(PERM.MANAGE_SERVER, sid) || can(PERM.MANAGE_ROLES, sid) || can(PERM.KICK, sid) || can(PERM.BAN, sid)) && [`Server Settings ${I.gear}`, () => openServerSettings(sid)],
    can(PERM.MANAGE_CHANNELS, sid) && [`Create Channel ${I.plus}`, () => { selectServer(sid); createChannelModal('text'); }],
    ['Edit Server Profile', () => nickModal(sid)],
    unread && [`Mark As Read ${I.check}`, () => sd.channels.forEach(c => S.unread[c.id] && markRead(c.id, true))],
    [isMuted(sid) ? 'Unmute Server' : 'Mute Server', () => toggleMuteId(sid, sd.name)],
    ['Copy Server Name', () => copy(sd.name)],
    '-', !owner && ['Leave Server', () => confirmModal('Leave server', `Are you sure you want to leave <b>${esc(sd.name)}</b>? You won’t be able to rejoin unless you are re-invited.`, 'Leave Server', async () => { await api('POST', `/api/servers/${sid}/leave`); }), 'danger'],
    owner && ['Delete Server', () => confirmModal('Delete server', `Delete <b>${esc(sd.name)}</b>? This cannot be undone and removes it for everyone.`, 'Delete', () => api('DELETE', '/api/servers/' + sid)), 'danger'],
  ].filter(Boolean), '', 230);
}
function serverMenu(anchor) {
  const sd = curServer(); const r = anchor.getBoundingClientRect();
  const owner = sd.owner_id === S.me.id;
  contextMenu({ clientX: r.left + 8, clientY: r.bottom + 4 }, [
    can(PERM.CREATE_INVITE) && [`Invite People ${I.invite}`, () => inviteModal(sd.id)],
    (can(PERM.MANAGE_SERVER) || can(PERM.MANAGE_ROLES) || can(PERM.KICK) || can(PERM.BAN)) && [`Server Settings ${I.gear}`, () => openServerSettings(sd.id)],
    can(PERM.MANAGE_CHANNELS) && [`Create Channel ${I.plus}`, () => createChannelModal('text')],
    ['Edit Server Profile', () => nickModal(sd.id)],
    ['Mark all as read', () => sd.channels.forEach(c => S.unread[c.id] && markRead(c.id, true))],
    [isMuted(sd.id) ? 'Unmute Server' : 'Mute Server', () => toggleMuteId(sd.id, sd.name)],
    '-', !owner && ['Leave Server', () => confirmModal('Leave server', `Are you sure you want to leave <b>${esc(sd.name)}</b>? You won’t be able to rejoin unless you are re-invited.`, 'Leave Server', async () => { await api('POST', `/api/servers/${sd.id}/leave`); }), 'danger'],
  ], '', 240);
}

/* ================= MAIN ================= */
function renderMain() {
  const main = $('.main'); if (!main) return;
  const ch = curChannel();
  main.innerHTML = `<header class="topbar"></header><div class="content"></div>`;
  renderTopbar();
  const content = $('.content', main);
  if (!ch) {
    if (S.view.server === '@me') return renderHome(content);
    content.innerHTML = `<div class="empty" style="margin:auto"><img src="${LOGO}" alt=""><b>No text channels</b><span>${can(PERM.MANAGE_CHANNELS) ? 'Create one with the + next to Text Channels.' : 'There’s nothing you can see here yet.'}</span></div>`;
    return;
  }
  if (ch.type === 'voice') { content.innerHTML = `<div class="voice-view"></div>`; renderVoiceArea(); return; }
  content.innerHTML = `<div class="chat">${isDM(ch) ? '<div class="call-slot"></div>' : ''}<div class="messages scroll" data-key="${ch.id}"></div>${composerHtml(ch)}</div>${(ch.type === 'group' || !isDM(ch)) && S.membersOpen ? '<aside class="members"></aside>' : ''}`;
  renderMembers();
  bindComposer($('.chat .composer', content), ch.id, null);
  bindMessageList($('.messages', content));
  renderVoiceArea();
}
function renderTopbar() {
  const bar = $('.topbar'); if (!bar) return;
  const ch = curChannel();
  const back = `<button class="icon-btn mobile-only" data-back>${I.back}</button>`;
  if (!ch) { bar.innerHTML = `${back}<span class="ico">${I.users}</span><span class="title">Friends</span><span class="spacer"></span>`; }
  else if (ch.type === 'dm') {
    const u = S.users[ch.user.id] || ch.user;
    bar.innerHTML = `${back}${avatar(u, 's24', false)}<span class="title" data-uid="${u.id}" style="cursor:pointer">${esc(u.display_name)}</span><span class="topic" style="cursor:default">@${esc(u.username)} · ${statusLabel(statusOf(u.id))}</span>
      <button class="icon-btn" data-call title="Start voice call">${I.phone}</button><button class="icon-btn" data-vcall title="Start video call">${I.video}</button>
      <button class="icon-btn" data-pins title="Pinned messages">${I.pin}</button>
      <input class="search" placeholder="Search" data-search>`;
  } else if (ch.type === 'group') {
    bar.innerHTML = `${back}${groupAvatar(ch, 's24')}<span class="title" data-gsettings style="cursor:pointer">${esc(ch.name || 'Group chat')}</span><span class="topic" data-gsettings>${ch.member_count} members</span>
      <button class="icon-btn" data-call title="Start group call">${I.phone}</button><button class="icon-btn" data-vcall title="Start video call">${I.video}</button>
      <button class="icon-btn" data-pins title="Pinned messages">${I.pin}</button><button class="icon-btn" data-gadd title="Add people">${I.invite}</button>
      <button class="icon-btn" data-members title="Member list" style="${S.membersOpen ? 'color:var(--text)' : ''}">${I.users}</button><button class="icon-btn" data-gmenu title="Group settings">${I.gear}</button>
      <input class="search" placeholder="Search" data-search>`;
  } else if (ch.type === 'voice') {
    bar.innerHTML = `${back}<span class="ico">${I.speaker}</span><span class="title">${esc(ch.name)}</span><span class="spacer"></span>`;
  } else {
    bar.innerHTML = `${back}<span class="ico">${ch.private ? I.lock : I.hash}</span><span class="title">${esc(ch.name)}</span>
      <span class="topic" data-topic title="${esc(ch.topic || '')}">${esc(ch.topic || (can(PERM.MANAGE_CHANNELS) ? 'Add a channel topic' : ''))}</span>
      ${ch.slowmode ? `<span class="slow-tag" title="Slowmode: ${slowLabel(ch.slowmode)}">${I.clock}</span>` : ''}<button class="icon-btn" data-pins title="Pinned messages">${I.pin}</button><button class="icon-btn" data-members title="Member list" style="${S.membersOpen ? 'color:var(--text)' : ''}">${I.users}</button>
      <input class="search" placeholder="Search" data-search>`;
  }
  bar.onclick = (e) => {
    if (e.target.closest('[data-back]')) return $('.app').classList.remove('show-main');
    if (e.target.closest('[data-members]')) { S.membersOpen = !S.membersOpen; const m = $('.members'); if (window.innerWidth <= 1100) { if (m) m.classList.toggle('force'); else { S.membersOpen = true; renderMain(); setTimeout(() => $('.members')?.classList.add('force')); } } else renderMain(); return; }
    if (e.target.closest('[data-topic]') && can(PERM.MANAGE_CHANNELS)) return channelSettingsModal(ch.id);
    if (e.target.closest('[data-pins]')) return pinsPopout(ch.id, e.target.closest('[data-pins]'));
    if (e.target.closest('[data-call]')) return Voice.join(ch.id);
    if (e.target.closest('[data-vcall]')) return Voice.join(ch.id, { video: true });
    if (e.target.closest('[data-gadd]')) return addToGroupModal(ch.id);
    if (e.target.closest('[data-gmenu]') || e.target.closest('[data-gsettings]')) return groupSettingsModal(ch.id);
    const t = e.target.closest('[data-uid]'); if (t) profilePopout(t.dataset.uid, t);
  };
  const search = $('[data-search]', bar);
  if (search) search.onkeydown = (e) => { if (e.key === 'Enter' && search.value.trim()) runSearch(ch.id, search.value.trim()); if (e.key === 'Escape') { search.value = ''; $('.search-results')?.remove(); } };
}
const statusLabel = (s) => ({ online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' }[s] || 'Offline');

function renderHome(content) {
  const tab = S.friendsTab || 'online';
  const F = S.friends;
  const row = (u, right) => `<div class="friend-row" data-uid="${u.id}">${avatar(u, 's40', true)}
      <div class="who"><b>${esc(u.display_name)}${badgeHtml(u)}</b><small>${esc(activityLine(u.id) || u.status_text || statusLabel(statusOf(u.id)))}</small></div>
      <div class="fr-actions">${right}</div></div>`;
  const friendBtns = (u) => `<button class="icon-btn" data-msg="${u.id}" title="Message">${I.message}</button><button class="icon-btn" data-callu="${u.id}" title="Call">${I.phone}</button><button class="icon-btn" data-fmenu="${u.id}" title="More">${I.gear}</button>`;
  let body = '';
  if (tab === 'add') {
    body = `<div class="add-friend"><h3>Add a friend</h3><p class="muted-note" style="text-align:left;padding:0 0 12px">Enter a username to send a friend request. You can message and call friends without sharing a server.</p>
      <form class="af-form"><input class="input" name="u" placeholder="Enter a username" autocomplete="off"><button class="btn primary" type="submit">Send request</button></form>
      <div class="af-msg"></div>
      ${F.outgoing.length ? `<h3 style="margin-top:24px">Sent requests — ${F.outgoing.length}</h3>${F.outgoing.map(u => row(u, `<span class="pending-tag">Pending</span><button class="icon-btn danger" data-cancel="${u.id}" title="Cancel">${I.x}</button>`)).join('')}` : ''}</div>`;
  } else if (tab === 'pending') {
    const total = F.incoming.length + F.outgoing.length;
    body = total ? `${F.incoming.length ? `<h3>Incoming — ${F.incoming.length}</h3>${F.incoming.map(u => row(u, `<button class="icon-btn accept" data-accept="${u.id}" title="Accept">${I.check}</button><button class="icon-btn danger" data-decline="${u.id}" title="Ignore">${I.x}</button>`)).join('')}` : ''}
      ${F.outgoing.length ? `<h3 ${F.incoming.length ? 'style="margin-top:20px"' : ''}>Sent — ${F.outgoing.length}</h3>${F.outgoing.map(u => row(u, `<span class="pending-tag">Pending</span><button class="icon-btn danger" data-cancel="${u.id}" title="Cancel">${I.x}</button>`)).join('')}` : ''}`
      : `<div class="empty"><img src="${LOGO}" alt=""><b>No pending requests</b><span>Requests you send or receive show up here.</span></div>`;
  } else if (tab === 'blocked') {
    body = F.blocked.length ? `<h3>Blocked — ${F.blocked.length}</h3>${F.blocked.map(u => row(u, `<button class="btn secondary sm" data-unblock="${u.id}">Unblock</button>`)).join('')}`
      : `<div class="empty"><img src="${LOGO}" alt=""><b>No one blocked</b></div>`;
  } else {
    let list = F.friends.slice();
    if (tab === 'online') list = list.filter(u => statusOf(u.id) !== 'offline');
    list.sort((a, b) => (statusOf(a.id) === 'offline') - (statusOf(b.id) === 'offline') || a.display_name.localeCompare(b.display_name));
    body = list.length ? `<h3>${tab === 'online' ? 'Online' : 'All friends'} — ${list.length}</h3>${list.map(u => row(u, friendBtns(u))).join('')}`
      : `<div class="empty"><img src="${LOGO}" alt=""><b>${tab === 'online' ? 'No friends online' : 'No friends yet'}</b><span>${F.friends.length ? 'Nobody’s online right now.' : 'Add someone by username to get started.'}</span>${!F.friends.length ? `<button class="btn primary" data-tab="add" style="margin-top:8px">Add a friend</button>` : ''}</div>`;
  }
  const t = (k, label, n) => `<button class="ftab ${tab === k ? 'active' : ''} ${k === 'add' ? 'add' : ''}" data-tab="${k}">${label}${n ? `<span class="badge">${n}</span>` : ''}</button>`;
  content.innerHTML = `<div class="friends-hub">
    <div class="fh-top"><span class="fh-title">${I.users} Friends</span>
      ${t('online', 'Online')}${t('all', 'All')}${t('pending', 'Pending', incomingCount())}${t('blocked', 'Blocked')}
      <button class="btn primary sm fh-add ${tab === 'add' ? 'on' : ''}" data-tab="add">Add friend</button></div>
    <div class="fh-body">${body}</div></div>`;
  content.querySelector('.af-form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); const inp = e.target.u; const v = inp.value.trim(); if (!v) return;
    const msg = content.querySelector('.af-msg');
    try { const r = await api('POST', '/api/friends', { username: v }); inp.value = '';
      msg.className = 'af-msg ok'; msg.textContent = r.status === 'friend' ? `You’re now friends with ${v}!` : `Friend request sent to ${v}.`; }
    catch (ex) { msg.className = 'af-msg err'; msg.textContent = ex.message; }
  });
  content.onclick = async (e) => {
    const tb = e.target.closest('[data-tab]'); if (tb) { S.friendsTab = tb.dataset.tab; renderMain(); return; }
    const act = async (sel, fn) => { const b = e.target.closest(sel); if (b) { e.stopPropagation(); try { await fn(b.dataset[Object.keys(b.dataset)[0]]); } catch (ex) { toast(ex.message, true); } return true; } return false; };
    if (await act('[data-msg]', id => openDM(id))) return;
    if (await act('[data-callu]', async id => { const d = await openDM(id); if (d) Voice.join(d.id); })) return;
    if (await act('[data-accept]', id => api('POST', `/api/friends/${id}/accept`))) return;
    if (await act('[data-decline]', id => api('DELETE', `/api/friends/${id}`))) return;
    if (await act('[data-cancel]', id => api('DELETE', `/api/friends/${id}`))) return;
    if (await act('[data-unblock]', id => api('DELETE', `/api/friends/${id}/block`))) return;
    const fm = e.target.closest('[data-fmenu]'); if (fm) { e.stopPropagation(); return friendMenu(e, fm.dataset.fmenu); }
    const r = e.target.closest('[data-uid]'); if (r) profilePopout(r.dataset.uid, r);
  };
}
function profileMoreMenu(e, sid, uidv) {
  const st = friendState(uidv);
  const items = [['Copy username', () => copy(user(uidv).username)], ['Copy User ID', () => copy(uidv)], ...groupOwnerItems(S.view.channel, uidv), '-'];
  if (sid && uidv !== S.me.id && can(PERM.KICK, sid) && uidv !== S.serverData[sid]?.owner_id) items.push(member(sid, uidv)?.timeout_until ? ['Remove timeout', () => api('PUT', `/api/servers/${sid}/members/${uidv}/timeout`, { minutes: 0 }).catch(x => toast(x.message, true))] : ['Time out', () => timeoutModal(sid, uidv), 'danger']);
  if (sid && (can(PERM.KICK, sid) || can(PERM.BAN, sid)) && uidv !== S.serverData[sid]?.owner_id) {
    if (can(PERM.KICK, sid)) items.push(['Kick from server', () => kickMember(sid, uidv), 'danger']);
    if (can(PERM.BAN, sid)) items.push(['Ban from server', () => banMember(sid, uidv), 'danger']);
    items.push('-');
  }
  if (st === 'friend') items.push(['Remove friend', () => confirmModal('Remove friend', `Remove <b>${esc(user(uidv).display_name)}</b>?`, 'Remove', () => api('DELETE', '/api/friends/' + uidv)), 'danger']);
  if (st === 'blocked') items.push(['Unblock', () => api('DELETE', `/api/friends/${uidv}/block`).catch(x => toast(x.message, true))]);
  else items.push(['Block', () => confirmModal('Block user', `Block <b>${esc(user(uidv).display_name)}</b>?`, 'Block', () => api('POST', `/api/friends/${uidv}/block`)), 'danger']);
  contextMenu(e, items.filter(Boolean));
}
function callUserMenu(e, uid) {
  const L = layer();
  const self = uid === S.me.id;
  const u = user(uid);
  const st = friendState(uid);
  const muted = Voice.localMutes.has(uid);
  const vol = Math.round((Voice.volumes[uid] ?? 1) * 100);
  const friendRow = self ? '' : st === 'friend' ? `<button data-remove>${I.check} Friends</button>`
    : st === 'incoming' ? `<button data-accept>Accept friend request</button>`
    : st === 'outgoing' ? `<button data-cancel>Cancel friend request</button>`
    : st === 'none' ? `<button data-add>${I.invite} Add friend</button>` : '';
  const el = h(`<div class="menu call-menu">
    <div class="cm-head">${avatar(u, 's32', true)}<b>${esc(u.display_name)}${badgeHtml(u)}</b></div>
    <button data-profile>View profile</button>
    ${self ? '' : `<button data-message>${I.message} Message</button>${friendRow}
    <hr>
    <button data-mute><span>${muted ? 'Unmute' : 'Mute'} for me</span><span class="check ${muted ? 'on' : ''}">${muted ? '✓' : ''}</span></button>
    <div class="vol-row"><span>Volume</span><input type="range" min="0" max="150" value="${vol}"><b class="vol-val">${vol}%</b></div>
    <hr>
    <button class="danger" data-block>Block</button>`}
  </div>`);
  L.set(el);
  place(el, e.clientX, e.clientY);
  const act = async (fn) => { try { await fn(); } catch (ex) { toast(ex.message, true); } L.close(); };
  el.querySelector('[data-profile]').onclick = () => { L.close(); profilePopout(uid, null); };
  el.querySelector('[data-message]')?.addEventListener('click', () => { L.close(); openDM(uid); });
  el.querySelector('[data-add]')?.addEventListener('click', () => act(() => api('POST', '/api/friends', { username: u.username })));
  el.querySelector('[data-accept]')?.addEventListener('click', () => act(() => api('POST', `/api/friends/${uid}/accept`)));
  el.querySelector('[data-cancel]')?.addEventListener('click', () => act(() => api('DELETE', '/api/friends/' + uid)));
  el.querySelector('[data-remove]')?.addEventListener('click', () => { L.close(); confirmModal('Remove friend', `Remove <b>${esc(u.display_name)}</b>?`, 'Remove', () => api('DELETE', '/api/friends/' + uid)); });
  el.querySelector('[data-block]')?.addEventListener('click', () => { L.close(); confirmModal('Block user', `Block <b>${esc(u.display_name)}</b>?`, 'Block', () => api('POST', `/api/friends/${uid}/block`)); });
  const mb = el.querySelector('[data-mute]');
  if (mb) mb.onclick = () => { const on = Voice.toggleUserMute(uid); mb.querySelector('span:last-child').className = 'check ' + (on ? 'on' : ''); mb.querySelector('span:last-child').textContent = on ? '✓' : ''; mb.querySelector('span:first-child').textContent = (on ? 'Unmute' : 'Mute') + ' for me'; };
  const range = el.querySelector('input[type=range]');
  if (range) range.oninput = () => { Voice.setUserVolume(uid, Number(range.value) / 100); el.querySelector('.vol-val').textContent = range.value + '%'; };
}
function friendMenu(e, uid) {
  const r = e.target.closest('[data-fmenu]').getBoundingClientRect();
  contextMenu({ clientX: r.left, clientY: r.bottom + 4 }, [
    ['Message', () => openDM(uid)],
    ['Call', async () => { const d = await openDM(uid); if (d) Voice.join(d.id); }],
    ['View profile', () => profilePopout(uid, null)],
    '-',
    ['Remove friend', () => confirmModal('Remove friend', `Remove <b>${esc(user(uid).display_name)}</b> from your friends?`, 'Remove', () => api('DELETE', '/api/friends/' + uid)), 'danger'],
    ['Block', () => confirmModal('Block user', `Block <b>${esc(user(uid).display_name)}</b>? They’ll be removed as a friend and can’t message you.`, 'Block', () => api('POST', `/api/friends/${uid}/block`)), 'danger'],
  ]);
}
async function openDM(userId) {
  try {
    const d = await api('POST', '/api/dms', { user_id: userId });
    if (d.user) S.users[d.user.id] = { ...S.users[d.user.id], ...d.user };
    if (!S.dms.find(x => x.id === d.id)) S.dms.unshift(d);
    S.view.server = '@me';
    selectChannel(d.id, true);
    renderRail();
    showMainMobile();
    return d;
  } catch (e) { toast(e.message, true); }
}

/* ================= MEMBERS ================= */
function renderMembers() {
  const box = $('.members'); if (!box) return;
  const ch = curChannel();
  if (ch && ch.type === 'group') return renderGroupMembers(box, ch);
  const sd = curServer(); if (!sd) return;
  let mem = sd.members;
  if (ch && ch.private) mem = mem.filter(m => m.id === sd.owner_id || (sd.roles.some(r => m.roles.includes(r.id) && ch.allowed_roles.includes(r.id))) || sd.roles.some(r => m.roles.includes(r.id) && (r.perms & PERM.ADMIN)));
  const online = mem.filter(m => statusOf(m.id) !== 'offline'), offline = mem.filter(m => statusOf(m.id) === 'offline');
  const hoisted = sd.roles.filter(r => r.hoist && !r.is_default).sort((a, b) => b.position - a.position);
  const groups = [];
  const used = new Set();
  hoisted.forEach(r => { const g = online.filter(m => !used.has(m.id) && m.roles.includes(r.id)); g.forEach(m => used.add(m.id)); if (g.length) groups.push([r.name, g]); });
  const rest = online.filter(m => !used.has(m.id)); if (rest.length) groups.push(['Online', rest]);
  if (offline.length) groups.push(['Offline', offline]);
  const sortName = (a, b) => nameIn(sd.id, a.id).localeCompare(nameIn(sd.id, b.id));
  box.innerHTML = groups.map(([t, list]) => `<h4>${esc(t)} — ${list.length}</h4>` + list.sort(sortName).map(m => {
    const color = colorIn(sd.id, m.id);
    return `<button class="mem ${statusOf(m.id) === 'offline' ? 'offline' : ''}" data-uid="${m.id}">${memBanner(S.users[m.id] || m)}${avatar(S.users[m.id] || m, 's32', true)}<span class="who"><b style="${color ? 'color:' + color : ''}">${esc(nameIn(sd.id, m.id))}${m.id === sd.owner_id ? `<span class="crown" title="Server owner">${I.crown.replace('width="20" height="20"', 'width="14" height="14"')}</span>` : ''}${badgeHtml(S.users[m.id] || m)}</b>${activityLine(m.id) ? `<small class="act-line">${I.music.replace('width="20" height="20"', 'width="12" height="12"')} ${esc(activityLine(m.id))}</small>` : m.status_text ? `<small>${esc(m.status_text)}</small>` : ''}</span></button>`;
  }).join('')).join('');
  box.onclick = (e) => { const b = e.target.closest('[data-uid]'); if (b) profilePopout(b.dataset.uid, b, 'left'); };
  box.oncontextmenu = (e) => { const b = e.target.closest('[data-uid]'); if (b) { e.preventDefault(); memberMenu(e, sd.id, b.dataset.uid); } };
}
function memberMenu(e, sid, uidv) {
  const sd = S.serverData[sid];
  const self = uidv === S.me.id;
  contextMenu(e, [
    ['Profile', () => profilePopout(uidv, null)], !self && ['Message', () => openDM(uidv)], !self && ['Call', async () => { const d = await openDM(uidv); if (d) Voice.join(d.id); }],
    ['Mention', () => { const ta = $('.chat .composer textarea'); if (ta) { ta.value += `@${user(uidv).username} `; ta.focus(); } }],
    ['Copy username', () => copy(user(uidv).username)],
    can(PERM.MANAGE_ROLES, sid) && '-', can(PERM.MANAGE_ROLES, sid) && ['Edit roles', () => memberRolesModal(sid, uidv)],
    !self && uidv !== sd.owner_id && can(PERM.KICK, sid) && (member(sid, uidv)?.timeout_until ? ['Remove timeout', () => api('PUT', `/api/servers/${sid}/members/${uidv}/timeout`, { minutes: 0 }).catch(x => toast(x.message, true))] : ['Time out ' + nameIn(sid, uidv), () => timeoutModal(sid, uidv), 'danger']),
    !self && uidv !== sd.owner_id && can(PERM.KICK, sid) && ['Kick ' + nameIn(sid, uidv), () => kickMember(sid, uidv), 'danger'],
    !self && uidv !== sd.owner_id && can(PERM.BAN, sid) && ['Ban ' + nameIn(sid, uidv), () => banMember(sid, uidv), 'danger'],
  ]);
}
function kickMember(sid, uidv) { confirmModal(`Kick ${esc(nameIn(sid, uidv))}`, `They can rejoin with a new invite.`, 'Kick', () => api('POST', `/api/servers/${sid}/kick/${uidv}`)); }
function banMember(sid, uidv) {
  modal(`<div class="mh"><h2>Ban ${esc(nameIn(sid, uidv))}</h2><p>They won’t be able to rejoin unless you unban them.</p></div>
    <div class="mb"><div class="field"><label>Reason</label><input class="input" name="reason" maxlength="200"></div>
    <label class="row-toggle"><span class="rt">Delete their messages from the last 24 hours</span><span class="toggle"><input type="checkbox" name="del"><span></span></span></label></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-ok>Ban</button></div>`, (m, close) => {
    $('[data-ok]', m).onclick = async () => { try { await api('POST', `/api/servers/${sid}/ban/${uidv}`, { reason: $('[name=reason]', m).value, delete_messages: $('[name=del]', m).checked }); close(); } catch (e) { toast(e.message, true); } };
  });
}

/* ================= MESSAGES ================= */
async function openChannel(cid) {
  const key = cid;
  renderTyping();
  if (!S.messages[key]) await loadMessages(key);
  else refreshMessages(key, true);
  markRead(cid);
  const ta = $('.chat .composer textarea'); if (ta && window.innerWidth > 760) ta.focus();
}
async function loadMessages(key, older) {
  if (S.loading[key]) return;
  const isThread = key.startsWith('t:');
  const cid = isThread ? S.thread?.channel_id : key;
  if (!cid) return;
  S.loading[key] = true;
  const list = S.messages[key] || [];
  const before = older && list.length ? list[0].id : '';
  try {
    const rows = await api('GET', `/api/channels/${cid}/messages?limit=50${before ? '&before=' + before : ''}${isThread ? '&thread=' + key.slice(2) : ''}`);
    S.messages[key] = older ? [...rows, ...list] : rows;
    S.hasMore[key] = rows.length === 50;
  } catch (e) { toast(e.message, true); S.messages[key] = S.messages[key] || []; }
  S.loading[key] = false;
  refreshMessages(key, !older, older);
}
function containersFor(key) { return $$(`.messages[data-key="${CSS.escape(String(key))}"]`); }
function refreshMessages(key, toBottom, keepTop) {
  if (!key) return;
  containersFor(key).forEach(box => {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const oldHeight = box.scrollHeight, oldTop = box.scrollTop;
    box.innerHTML = messageListHtml(key);
    if (keepTop) box.scrollTop = box.scrollHeight - oldHeight + oldTop;
    else if (toBottom || atBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = oldTop;
    const ed = $('.edit-box', box);
    if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); autoGrow(ed); }
    $$('img', box).forEach(img => !img.complete && img.addEventListener('load', () => { if (toBottom || atBottom) box.scrollTop = box.scrollHeight; }, { once: true }));
  });
}
function channelSid(key) { if (String(key).startsWith('t:')) return S.thread ? findChannel(S.thread.channel_id)?.server_id : null; return findChannel(key)?.server_id || null; }
function messageListHtml(key) {
  const list = S.messages[key] || [];
  const isThread = String(key).startsWith('t:');
  const ch = isThread ? findChannel(S.thread.channel_id) : findChannel(key);
  const sid = ch?.server_id || null;
  let html = '';
  if (isThread) {
    html += `<div class="parent">${S.thread.parent ? messageHtml(S.thread.parent, sid, null, true) : ''}</div>`;
    html += `<div class="divider">${list.length} ${list.length === 1 ? 'reply' : 'replies'}</div>`;
  } else if (S.hasMore[key]) html += `<div class="loader">Loading older messages…</div>`;
  else if (ch) {
    if (ch.type === 'group') html += `<div class="ch-welcome">${groupAvatar(ch, 's80')}<h2 style="margin-top:12px">${esc(ch.name || 'Group chat')}</h2><p>This is the start of the <b>${esc(ch.name || 'group chat')}</b>. ${ch.member_count} people are here.</p></div>`;
    else if (ch.type === 'dm') html += `<div class="ch-welcome">${avatar(ch.user, 's80')}<h2 style="margin-top:12px">${esc(ch.user.display_name)}</h2><p>This is the beginning of your direct message history with <b>@${esc(ch.user.username)}</b>.</p></div>`;
    else html += `<div class="ch-welcome"><div class="big">${ch.private ? I.lock : I.hash}</div><h2>Welcome to #${esc(ch.name)}!</h2><p>This is the start of the #${esc(ch.name)} channel.${ch.topic ? ' ' + esc(ch.topic) : ''}</p></div>`;
  }
  let prev = null, lastDay = '';
  const lastRead = S.readMarker?.[key];
  let markerShown = false;
  for (const m of list) {
    const day = new Date(m.created).toDateString();
    if (day !== lastDay) { html += `<div class="divider date"><span>${fmtDay(m.created)}</span></div>`; lastDay = day; prev = null; }
    if (lastRead && !markerShown && m.id > lastRead && m.author_id !== S.me.id) { html += `<div class="divider new">New</div>`; markerShown = true; prev = null; }
    html += messageHtml(m, sid, prev);
    prev = m;
  }
  return html;
}
function messageHtml(m, sid, prev, isParent) {
  if (m.system) return `<div class="msg system head" data-mid="${m.id}"><div class="left">${I.arrow}</div><div class="body"><div class="text">${esc(m.content)} <span class="ts" style="font-size:12px;color:var(--dim);font-style:normal">${fmtDate(m.created)}</span></div></div></div>`;
  const u = user(m.author_id);
  const grouped = prev && !prev.system && prev.author_id === m.author_id && m.created - prev.created < 7 * 60e3 && !m.reply;
  const mentioned = m.author_id !== S.me.id && (m.mention_everyone || (m.mentions || []).includes(S.me.id));
  const color = sid ? colorIn(sid, m.author_id) : null;
  const sd = sid && S.serverData[sid];
  const mine = m.author_id === S.me.id;
  const canManage = sid ? can(PERM.MANAGE_MESSAGES, sid) : false;
  const editing = S.editing === m.id;
  const reply = m.reply ? (m.reply.deleted ? `<div class="reply-ref"><span><i>Original message was deleted</i></span></div>`
    : `<div class="reply-ref" data-jump="${m.reply.id}">${avatar(m.reply.author_id, '')}<b style="${sid && colorIn(sid, m.reply.author_id) ? 'color:' + colorIn(sid, m.reply.author_id) : ''}">@${esc(nameIn(sid, m.reply.author_id))}</b><span>${esc(plainPreview(m.reply.content)) || '<i>Click to see attachment</i>'}</span></div>`) : '';
  const atts = (m.attachments || []).map(a => {
    const t = a.type || '';
    if (t.startsWith('image/')) { const gif = t === 'image/gif' || /\.gif($|\?)/i.test(a.url) || /giphy\.com/.test(a.url);
      const img = `<img class="att-img" src="${esc(a.url)}" alt="${esc(a.name)}" loading="lazy" data-lightbox="${esc(a.url)}" data-name="${esc(a.name)}">`;
      return gif ? `<div class="att-gif"><span class="gif-tag">GIF</span>${img}<button class="att-fav ${gifIsFav(a.url) ? 'on' : ''}" data-fav="${esc(a.url)}" title="Favorite GIF">${I.heart.replace('width="20" height="20"', 'width="16" height="16"')}</button></div>` : img; }
    if (t.startsWith('video/')) return `<video class="att-video" src="${esc(a.url)}" controls preload="metadata"></video>`;
    if (t.startsWith('audio/')) return `<div class="audio-embed" data-audio="${esc(a.url)}"><button class="ae-play">${I.play}</button><div class="ae-main"><div class="ae-name">${esc(a.name)}</div><div class="ae-bar"><div class="ae-fill"></div></div><div class="ae-time"><span class="ae-cur">0:00</span><span class="ae-dur">--:--</span></div></div><a class="ae-dl" href="${esc(a.url)}" download="${esc(a.name)}" title="Download">${I.download}</a></div>`;
    return `<div class="att-file">${I.file}<div class="fi"><a href="${esc(a.url)}" download="${esc(a.name)}" target="_blank">${esc(a.name)}</a><small>${fmtSize(a.size)}</small></div><a href="${esc(a.url)}" download="${esc(a.name)}" class="icon-btn" title="Download">${I.download}</a></div>`;
  }).join('');
  const reacts = Object.entries(m.reactions || {}).filter(([, v]) => v.length).map(([e, v]) => `<button class="react ${v.includes(S.me.id) ? 'mine' : ''}" data-react="${esc(e)}" title="${esc(v.map(x => nameIn(sid, x)).join(', '))}">${emojiHtml(e)}<b>${v.length}</b></button>`).join('');
  const body = editing
    ? `<textarea class="edit-box" data-edit="${m.id}" rows="1">${esc(m.content)}</textarea><div class="edit-hint">escape to <button data-cancel-edit>cancel</button> • enter to <button data-save-edit>save</button></div>`
    : `${m.content ? `<div class="text">${formatText(m.content, sid)}${m.edited ? ` <span class="edited" title="${esc(fmtDate(m.edited))}">(edited)</span>` : ''}</div>` : ''}`;
  const thread = !isParent && m.thread && !m.thread_id ? `<button class="thread-link" data-open-thread>${I.thread}<b>${m.thread.count} ${m.thread.count === 1 ? 'reply' : 'replies'}</b><span>Last ${fmtDate(m.thread.last)}</span></button>` : '';
  const tools = isParent ? '' : `<div class="toolbar">
      ${QUICK_REACTS.slice(0, 3).map(e => `<button data-quick="${e}" title="React ${e}" style="font-size:16px">${e}</button>`).join('')}
      <button data-act="react" title="Add reaction">${I.smile}</button>
      <button data-act="reply" title="Reply">${I.reply}</button>
      ${!m.thread_id && !String(S.view.channel).startsWith('t:') ? `<button data-act="thread" title="Create thread">${I.thread}</button>` : ''}
      ${mine ? `<button data-act="edit" title="Edit">${I.edit}</button>` : ''}
      ${mine || canManage ? `<button data-act="delete" class="danger" title="Delete">${I.trash}</button>` : ''}
    </div>`;
  const tag = sd && m.author_id === sd.owner_id ? '' : '';
  return `<div class="msg ${grouped ? '' : 'head'} ${m.pinned ? 'pinned' : ''} ${m.reply ? 'has-reply' : ''} ${mentioned ? 'mentioned' : ''} ${m._pending ? 'pending' : ''} ${m._failed ? 'failed' : ''}" data-mid="${m.id}">
    <div class="left">${grouped ? `<span class="time">${fmtTime(m.created)}</span>` : avatar(u, '')}</div>
    <div class="body">${reply}${grouped ? '' : `<div class="meta"><span class="name" data-uid="${u.id}" style="${color ? 'color:' + color : nameStyle(u)}">${esc(nameIn(sid, u.id))}</span>${badgeHtml(u)}${tag}<span class="ts">${fmtDate(m.created)}</span></div>`}
      ${body}${atts ? `<div class="attachments">${atts}</div>` : ''}${editing ? '' : embedsHtml(m) + pollHtml(m)}${reacts ? `<div class="reactions">${reacts}<button class="react add" data-act="react" title="Add reaction">${I.smile.replace('width="20" height="20"', 'width="16" height="16"')}</button></div>` : ''}${thread}
    </div>${tools}</div>`;
}
function findMsg(id) {
  for (const k in S.messages) { const m = S.messages[k].find(x => x.id == id); if (m) return [m, k]; }
  if (S.thread?.parent?.id == id) return [S.thread.parent, null];
  return [null, null];
}
function bindMessageList(box) {
  const key = () => box.dataset.key;
  setupJumpBar(box);
  box.addEventListener('scroll', () => { if (box.scrollTop < 200 && S.hasMore[key()] && !S.loading[key()]) loadMessages(key(), true); if (box.scrollHeight - box.scrollTop - box.clientHeight < 40) markRead(S.view.channel); });
  box.addEventListener('click', async (e) => {
    const t = e.target;
    const msgEl = t.closest('[data-mid]'); const mid = msgEl && Number(msgEl.dataset.mid);
    const [m] = mid ? findMsg(mid) : [null];
    const sid = channelSid(key());
    if (t.closest('.spoiler')) return t.closest('.spoiler').classList.add('shown');
    const mention = t.closest('.mention[data-uid]'); if (mention) return profilePopout(mention.dataset.uid, mention);
    const nm = t.closest('.name[data-uid], .left .av'); if (nm) return profilePopout(nm.dataset.uid, nm);
    const favBtn = t.closest('[data-fav]'); if (favBtn) { e.stopPropagation(); const on = toggleGifFav(favBtn.dataset.fav, $('img', favBtn.closest('.att-gif'))); favBtn.classList.toggle('on', on); toast(on ? 'Added to GIF favorites' : 'Removed from favorites'); return; }
    const lb = t.closest('[data-lightbox]'); if (lb) return lightbox(lb.dataset.lightbox, lb.dataset.name);
    const ae = t.closest('.audio-embed'); if (ae && !t.closest('.ae-dl')) { audioEmbedAction(ae, e); return; }
    const jump = t.closest('[data-jump]'); if (jump) return jumpTo(Number(jump.dataset.jump));
    if (!m) return;
    const r = t.closest('[data-react]'); if (r) return toggleReaction(m.id, r.dataset.react);
    const v = t.closest('[data-vote]'); if (v) return api('PUT', `/api/messages/${m.id}/poll/${v.dataset.vote}`).catch(x => toast(x.message, true));
    if (t.closest('[data-unembed]')) return api('DELETE', `/api/messages/${m.id}/embeds`).catch(x => toast(x.message, true));
    const q = t.closest('[data-quick]'); if (q) return toggleReaction(m.id, q.dataset.quick);
    if (t.closest('[data-open-thread]')) return openThread(m);
    if (t.closest('[data-cancel-edit]')) { S.editing = null; return refreshMessages(key()); }
    if (t.closest('[data-save-edit]')) return saveEdit($('.edit-box', box));
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'react') emojiPicker(t.closest('[data-act]'), (em) => toggleReaction(m.id, em));
    if (act === 'reply') startReply(m, box.closest('.chat, .thread-panel'));
    if (act === 'thread') openThread(m);
    if (act === 'edit') { S.editing = m.id; refreshMessages(key()); }
    if (act === 'delete') { if (e.shiftKey) return api('DELETE', '/api/messages/' + m.id).catch(x => toast(x.message, true)); confirmModal('Delete Message', 'Are you sure you want to delete this message?', 'Delete', () => api('DELETE', '/api/messages/' + m.id)); }
  });
  box.addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('edit-box')) return;
    if (e.key === 'Escape') { S.editing = null; refreshMessages(key()); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(e.target); }
  });
  box.addEventListener('input', (e) => { if (e.target.classList.contains('edit-box')) autoGrow(e.target); });
  box.addEventListener('contextmenu', (e) => {
    const msgEl = e.target.closest('[data-mid]'); if (!msgEl) return;
    const [m] = findMsg(Number(msgEl.dataset.mid)); if (!m || m.system) return;
    e.preventDefault();
    const sid = channelSid(key());
    const mine = m.author_id === S.me.id;
    const img = e.target.closest('img.att-img');
    if (touchUI() && $('.msg-sheet')) return;
    const items = ([
      ['Add reaction', () => emojiPicker(msgEl, (em) => toggleReaction(m.id, em))],
      mine && ['Edit message', () => { S.editing = m.id; refreshMessages(key()); }],
      ['Reply', () => startReply(m, box.closest('.chat, .thread-panel'))],
      !m.thread_id && !key().startsWith('t:') && ['Create thread', () => openThread(m)],
      canPinIn(m.channel_id) && !m._pending && (m.pinned ? ['Unpin message', () => api('DELETE', `/api/messages/${m.id}/pin`).catch(x => toast(x.message, true))] : ['Pin message', () => api('PUT', `/api/messages/${m.id}/pin`).catch(x => toast(x.message, true))]),
      ['Copy text', () => copy(m.content)],
      ['Copy message ID', () => copy(String(m.id))],
      img && ['Copy image link', () => copy(location.origin + img.getAttribute('src'))],
      ['Mark unread', () => { S.unread[S.view.channel] = { count: 1, mentions: 0, server_id: sid }; renderSidebar(); renderRail(); }],
      (mine || (sid && can(PERM.MANAGE_MESSAGES, sid))) && '-', (mine || (sid && can(PERM.MANAGE_MESSAGES, sid))) && ['Delete message', () => confirmModal('Delete Message', 'Are you sure you want to delete this message?', 'Delete', () => api('DELETE', '/api/messages/' + m.id)), 'danger'],
    ]);
    // phones / tablets: big bottom sheet instead of a tiny menu
    if (touchUI()) return messageSheet(m, items, msgEl);
    contextMenu(e, items);
  });
  // press and hold a message on touch screens (iOS never sends a contextmenu event)
  let lp = null;
  box.addEventListener('touchstart', (e) => {
    const msgEl = e.target.closest('[data-mid]'); if (!msgEl || e.touches.length > 1 || e.target.closest('a, button, video, textarea, .poll, .audio-embed')) return;
    const t = e.touches[0]; const x = t.clientX, y = t.clientY;
    clearTimeout(lp?.timer);
    lp = { x, y, timer: setTimeout(() => { lp = null; msgEl.classList.add('pressed'); setTimeout(() => msgEl.classList.remove('pressed'), 250); navigator.vibrate?.(10);
      msgEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })); }, 420) };
  }, { passive: true });
  const cancelLp = (e) => { if (!lp) return; if (e.type === 'touchmove') { const t = e.touches[0]; if (Math.abs(t.clientX - lp.x) < 10 && Math.abs(t.clientY - lp.y) < 10) return; } clearTimeout(lp.timer); lp = null; };
  ['touchmove', 'touchend', 'touchcancel'].forEach(ev => box.addEventListener(ev, cancelLp, { passive: true }));
}
async function saveEdit(ta) {
  const id = Number(ta.dataset.edit); const v = ta.value.trim();
  const [m, key] = findMsg(id);
  S.editing = null;
  if (m && v && v !== m.content) { try { await api('PATCH', '/api/messages/' + id, { content: v }); } catch (e) { toast(e.message, true); } }
  else if (m && !v && !(m.attachments || []).length) { confirmModal('Delete Message', 'Are you sure you want to delete this message?', 'Delete', () => api('DELETE', '/api/messages/' + id)); }
  refreshMessages(key || S.view.channel);
}
async function toggleReaction(id, emoji) { try { await api('PUT', `/api/messages/${id}/reactions/${encodeURIComponent(emoji)}`); } catch (e) { toast(e.message, true); } }
function jumpTo(id) {
  const el = $(`.messages [data-mid="${id}"]`);
  if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.classList.add('highlight'); setTimeout(() => el.classList.remove('highlight'), 1600); }
  else toast('That message is further back. Scroll up to load it.');
}
function upsertMessage(m) {
  const keys = [m.thread_id ? 't:' + m.thread_id : m.channel_id];
  for (const key of keys) {
    const list = S.messages[key]; if (!list) continue;
    const i = list.findIndex(x => x.id === m.id);
    if (i >= 0) { list[i] = m; refreshMessages(key); }
  }
  if (S.thread && S.thread.id === m.id) { S.thread.parent = m; refreshMessages('t:' + m.id); }
}
function onMessageNew(m) {
  if (m.author_id) S.users[m.author_id] = S.users[m.author_id] || { id: m.author_id, username: '…', display_name: '…' };
  const key = m.thread_id ? 't:' + m.thread_id : m.channel_id;
  const list = S.messages[key];
  if (list) {
    const pi = list.findIndex(x => x._pending && x._nonce && x.author_id === m.author_id && x.content === m.content);
    if (pi >= 0) list.splice(pi, 1);
    if (!list.find(x => x.id === m.id)) list.push(m);
    refreshMessages(key);
  }
  if (m.author_id === S.me.id) return;
  if (S.typing[m.channel_id]) { delete S.typing[m.channel_id][m.author_id]; renderTyping(); }
  const ch = findChannel(m.channel_id);
  if (!ch) { if (!m.thread_id) api('GET', '/api/me').then(d => { S.dms = d.dms; S.unread = d.unread; renderSidebar(); renderRail(); }); return; }
  const viewing = S.view.channel === m.channel_id && document.hasFocus() && !document.hidden;
  const box = containersFor(m.channel_id)[0];
  const atBottom = box && box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const mentioned = m.mention_everyone || (m.mentions || []).includes(S.me.id) || isDM(ch);
  const directMention = (m.mentions || []).includes(S.me.id) || ch.type === 'dm';
  if (chanMuted(m.channel_id) && !directMention) { if (!m.thread_id && !(viewing && atBottom)) { const u = S.unread[m.channel_id] || { count: 0, mentions: 0, server_id: ch.server_id || null }; u.count++; S.unread[m.channel_id] = u; renderSidebar(); renderRail(); } else if (viewing) markRead(m.channel_id); return; }
  if (!m.thread_id && !(viewing && atBottom)) {
    const u = S.unread[m.channel_id] || { count: 0, mentions: 0, server_id: ch.server_id || null };
    u.count++; if (mentioned) u.mentions++;
    S.unread[m.channel_id] = u;
    renderSidebar(); renderRail();
  } else if (viewing) markRead(m.channel_id);
  if (mentioned && S.prefs.status !== 'dnd' && !viewing) notify(m, ch);
}
function notify(m, ch) {
  playNotif();
  if (!S.prefs.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const sid = ch.server_id;
  const title = ch.type === 'dm' ? nameIn(null, m.author_id) : ch.type === 'group' ? `${nameIn(null, m.author_id)} (${ch.name || 'Group chat'})` : `${nameIn(sid, m.author_id)} (#${ch.name}, ${S.serverData[sid]?.name || ''})`;
  try {
    const n = new Notification(title, { body: plainPreview(m.content) || 'Sent an attachment', icon: user(m.author_id).avatar || LOGO, tag: 'orbit-' + m.channel_id });
    n.onclick = () => { window.focus(); selectChannel(m.channel_id); n.close(); };
  } catch {}
}
const readTimers = {};
function markRead(cid, force) {
  if (!cid || (!S.unread[cid] && !force)) return;
  S.readMarker = S.readMarker || {};
  if (S.unread[cid] && !S.readMarker[cid]) { const list = S.messages[cid] || []; const idx = list.length - S.unread[cid].count - 1; S.readMarker[cid] = idx >= 0 ? list[idx].id : 0; setTimeout(() => { delete S.readMarker[cid]; }, 15000); }
  delete S.unread[cid];
  renderSidebar(); renderRail();
  clearTimeout(readTimers[cid]);
  readTimers[cid] = setTimeout(() => api('POST', `/api/channels/${cid}/read`).catch(() => {}), 400);
}
window.addEventListener('focus', () => { if (S.view.channel) markRead(S.view.channel); });

/* ================= COMPOSER ================= */
function composerHtml(ch, thread) {
  const sd = ch.server_id && S.serverData[ch.server_id];
  const timedOut = ch.server_id ? myTimeout(ch.server_id) : 0;
  const canSend = (isDM(ch) || can(PERM.SEND, ch.server_id)) && !timedOut;
  const placeholder = timedOut ? `You’re timed out until ${new Date(timedOut).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : thread ? 'Message thread' : !canSend ? 'You do not have permission to send messages in this channel.' : ch.type === 'dm' ? `Message @${ch.user.display_name}` : ch.type === 'group' ? `Message ${ch.name || 'the group'}` : `Message #${ch.name}`;
  return `<div class="composer" data-cid="${ch.id}" ${thread ? `data-thread="${thread}"` : ''}>
    <div class="reply-slot"></div><div class="attach-slot"></div>
    <div class="cbox ${canSend ? '' : 'disabled'}">
      ${canSend && (isDM(ch) || can(PERM.ATTACH, ch.server_id)) ? `<button class="icon-btn" data-attach title="Upload a file">${I.plus}</button>` : ''}
      <textarea rows="1" placeholder="${esc(placeholder)}" ${canSend ? '' : 'disabled'} maxlength="4000"></textarea>
      ${canSend && S.info.gif ? `<button class="icon-btn gif-btn" data-gif title="GIF">GIF</button>` : ''}
      ${canSend && ch.slowmode && !bypassSlow(ch) ? `<span class="slow-ind" title="Slowmode is on: one message every ${slowLabel(ch.slowmode)}">${I.clock}<span></span></span>` : ''}
      ${canSend ? `<button class="icon-btn" data-emoji title="Emoji">${I.smile}</button><button class="send-btn" data-send title="Send (Enter)">${I.arrow}</button>` : ''}
    </div><input type="file" multiple hidden>
    ${thread ? '' : '<div class="typing"></div>'}</div>`;
}
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * .4) + 'px'; }
function bindComposer(comp, cid, threadId) {
  if (!comp) return;
  const ta = $('textarea', comp), file = $('input[type=file]', comp);
  const state = { files: [], reply: null, mentionReply: true };
  comp._state = state;
  const draftKey = threadId ? 't:' + threadId : cid;
  ta.value = S.drafts[draftKey] || ''; autoGrow(ta);
  const renderAttach = () => {
    const slot = $('.attach-slot', comp);
    slot.innerHTML = state.files.length ? `<div class="attach-list">${state.files.map((f, i) => `<div class="att-chip"><button class="x" data-rm="${i}" title="Remove">${I.trash}</button><div class="prev">${f._url ? (f.type.startsWith('video/') ? `<video src="${f._url}" muted></video>` : `<img src="${f._url}">`) : I.file}</div><div class="n">${esc(f.name)}</div><small style="color:var(--dim)">${fmtSize(f.size)}</small></div>`).join('')}</div>` : '';
    slot.onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b) { const f = state.files.splice(Number(b.dataset.rm), 1)[0]; f._url && URL.revokeObjectURL(f._url); renderAttach(); } };
  };
  const addFiles = (list) => {
    const max = (S.info.max_upload_mb || 50) * 1048576;
    [...list].forEach(f => {
      if (f.size > max) return toast(`${f.name} is too large (max ${S.info.max_upload_mb || 50} MB)`, true);
      if (state.files.length >= 10) return toast('You can upload up to 10 files at a time', true);
      if (/^(image|video)\//.test(f.type)) f._url = URL.createObjectURL(f);
      state.files.push(f);
    });
    renderAttach(); ta.focus(); comp._syncSend && comp._syncSend();
  };
  comp._addFiles = addFiles;
  comp._setReply = (m) => {
    state.reply = m;
    const slot = $('.reply-slot', comp);
    if (!m) { slot.innerHTML = ''; return; }
    const sid = findChannel(cid)?.server_id;
    slot.innerHTML = `<div class="reply-bar"><span>Replying to <b>${esc(nameIn(sid, m.author_id))}</b></span><span class="sp"></span>${m.author_id !== S.me.id ? `<button class="ping ${state.mentionReply ? 'on' : ''}" data-ping title="Notify them">@${state.mentionReply ? 'ON' : 'OFF'}</button>` : ''}<button data-cancel title="Cancel">${I.x}</button></div>`;
    slot.onclick = (e) => { if (e.target.closest('[data-cancel]')) comp._setReply(null); if (e.target.closest('[data-ping]')) { state.mentionReply = !state.mentionReply; comp._setReply(m); } };
    ta.focus();
  };
  $('[data-attach]', comp)?.addEventListener('click', (e) => attachMenu(e.currentTarget, comp, cid, threadId));
  const sendBtn = $('[data-send]', comp);
  const syncSend = () => sendBtn && sendBtn.classList.toggle('ready', !!(ta.value.trim() || state.files.length));
  sendBtn?.addEventListener('click', () => { send(); syncSend(); });
  ta.addEventListener('input', syncSend); comp._syncSend = syncSend;
  file.onchange = () => { addFiles(file.files); file.value = ''; };
  $('[data-emoji]', comp)?.addEventListener('click', (e) => emojiPicker(e.currentTarget, (em, info) => { insertAtCursor(ta, info ? `:${info.name}: ` : em); }, true));
  $('[data-gif]', comp)?.addEventListener('click', (e) => gifPicker(e.currentTarget, cid, threadId, state, comp));
  ta.addEventListener('paste', (e) => { const fs = [...(e.clipboardData?.files || [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  let lastTyping = 0;
  ta.addEventListener('input', () => {
    autoGrow(ta); S.drafts[draftKey] = ta.value;
    if (ta.value && Date.now() - lastTyping > 4000) { lastTyping = Date.now(); socket?.emit('typing', { channel_id: cid }); }
    mentionAutocomplete(comp, ta, cid);
  });
  ta.addEventListener('keydown', (e) => {
    const ac = $('.autocomplete', comp);
    if (ac) {
      const items = $$('.ac-item', ac); let i = items.findIndex(x => x.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[i]?.classList.remove('sel'); i = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items[i].classList.add('sel'); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); items[i]?.click(); return; }
      if (e.key === 'Escape') { ac.remove(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    if (e.key === 'Escape' && state.reply) comp._setReply(null);
    if (e.key === 'ArrowUp' && !ta.value) {
      const key = threadId ? 't:' + threadId : cid;
      const mine = (S.messages[key] || []).filter(m => m.author_id === S.me.id && !m._pending);
      if (mine.length) { e.preventDefault(); S.editing = mine[mine.length - 1].id; refreshMessages(key); }
    }
  });
  // drag & drop on the whole chat area
  const zone = comp.closest('.chat, .thread-panel');
  if (zone && !zone._dnd) {
    zone._dnd = true; let depth = 0;
    zone.addEventListener('dragenter', (e) => { if (![...e.dataTransfer.types].includes('Files')) return; depth++; if (!$('.drop-overlay', zone)) zone.appendChild(h(`<div class="drop-overlay">Drop files to upload</div>`)); });
    zone.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('.drop-overlay', zone)?.remove(); } });
    zone.addEventListener('dragover', (e) => e.preventDefault());
    zone.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('.drop-overlay', zone)?.remove(); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  }
  async function send() {
    const chNow = findChannel(cid);
    const content = resolveEmojiText(ta.value.trim(), chNow?.server_id);
    if (!content && !state.files.length) return;
    const wait = Math.ceil(((S.slowUntil[cid] || 0) - Date.now()) / 1000);
    if (wait > 0) return toast(`Slowmode is on. You can send another message in ${fmtWait(wait)}.`, true);
    if (content.length > 4000) return toast('Message is too long (4000 characters max)', true);
    const key = threadId ? 't:' + threadId : cid;
    const form = new FormData();
    form.append('content', content);
    if (state.reply) { form.append('reply_to', state.reply.id); form.append('mention_reply', String(state.mentionReply)); }
    if (threadId) form.append('thread_id', threadId);
    state.files.forEach(f => form.append('files', f, f.name));
    const temp = { id: 'p' + Date.now(), _pending: true, _nonce: 1, author_id: S.me.id, content, created: Date.now(), attachments: [], reactions: {}, reply: state.reply ? { id: state.reply.id, author_id: state.reply.author_id, content: state.reply.content } : null };
    const hadFiles = state.files.length;
    if (S.messages[key]) { S.messages[key].push(temp); refreshMessages(key, true); }
    ta.value = ''; S.drafts[draftKey] = ''; autoGrow(ta);
    state.files.forEach(f => f._url && URL.revokeObjectURL(f._url));
    state.files = []; renderAttach(); comp._setReply(null); comp._syncSend && comp._syncSend();
    if (chNow && chNow.slowmode && !bypassSlow(chNow)) S.slowUntil[cid] = Date.now() + chNow.slowmode * 1000;
    try {
      const m = await upload(`/api/channels/${cid}/messages`, form, hadFiles ? (p) => { const el = $(`[data-mid="${temp.id}"] .text`); if (el) el.textContent = `${content ? content + ' — ' : ''}Uploading… ${Math.round(p * 100)}%`; } : null);
      const list = S.messages[key];
      if (list) { const i = list.indexOf(temp); if (i >= 0) { if (list.find(x => x.id === m.id)) list.splice(i, 1); else list[i] = m; } refreshMessages(key, true); }
    } catch (e) {
      temp._failed = true; temp._pending = false; temp.content = (content || '') + `  (failed to send: ${e.message})`;
      refreshMessages(key); toast(e.message, true);
    }
  }
}
function insertAtCursor(ta, text) { const s = ta.selectionStart ?? ta.value.length, e = ta.selectionEnd ?? s; ta.value = ta.value.slice(0, s) + text + ta.value.slice(e); ta.selectionStart = ta.selectionEnd = s + text.length; ta.focus(); ta.dispatchEvent(new Event('input')); }
function startReply(m, scope) { const comp = $('.composer', scope || document); comp?._setReply(m); }
function mentionAutocomplete(comp, ta, cid) {
  $('.autocomplete', comp)?.remove();
  const before = ta.value.slice(0, ta.selectionStart);
  const mm = before.match(/(^|\s)@([\w.]{0,32})$/);
  if (!mm) return;
  const q = mm[2].toLowerCase();
  const ch = findChannel(cid);
  let pool = ch.type === 'dm' ? [S.me, ch.user] : ch.type === 'group' ? (ch.members || []) : (S.serverData[ch.server_id]?.members || []);
  pool = pool.filter(u => u.username.toLowerCase().startsWith(q) || (u.display_name || '').toLowerCase().startsWith(q) || (ch.server_id && nameIn(ch.server_id, u.id).toLowerCase().startsWith(q))).slice(0, 8);
  const extra = ch.type !== 'dm' && can(PERM.MENTION_EVERYONE, ch.server_id) ? ['everyone', 'here'].filter(x => x.startsWith(q)) : [];
  if (!pool.length && !extra.length) return;
  const ac = h(`<div class="autocomplete"><div class="h">Members</div>${pool.map((u, i) => `<button class="ac-item ${i === 0 ? 'sel' : ''}" data-u="${esc(u.username)}">${avatar(S.users[u.id] || u, 's24')}<span>${esc(ch.server_id ? nameIn(ch.server_id, u.id) : u.display_name)}</span><small>@${esc(u.username)}</small></button>`).join('')}${extra.map((x, i) => `<button class="ac-item ${!pool.length && i === 0 ? 'sel' : ''}" data-u="${x}"><b>@${x}</b><small>Notify ${x === 'here' ? 'everyone online' : 'everyone'}</small></button>`).join('')}</div>`);
  comp.appendChild(ac);
  ac.onmousedown = (e) => e.preventDefault();
  ac.onclick = (e) => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    const start = ta.selectionStart - mm[2].length - 1;
    ta.value = ta.value.slice(0, start) + '@' + b.dataset.u + ' ' + ta.value.slice(ta.selectionStart);
    ta.selectionStart = ta.selectionEnd = start + b.dataset.u.length + 2;
    ac.remove(); ta.focus();
  };
}
function renderTyping() {
  const el = $('.chat .typing'); if (!el) return;
  const cid = S.view.channel;
  const t = S.typing[cid] || {}; const now = Date.now();
  const ids = Object.keys(t).filter(u => t[u] > now && u !== S.me.id);
  const sid = findChannel(cid)?.server_id;
  const names = ids.map(u => `<b>${esc(nameIn(sid, u))}</b>`);
  el.innerHTML = !ids.length ? '' : `<span class="dots"><i></i><i></i><i></i></span>${ids.length > 3 ? 'Several people are typing…' : names.join(ids.length === 2 ? ' and ' : ', ') + (ids.length === 1 ? ' is typing…' : ' are typing…')}`;
}

/* ================= THREADS ================= */
async function openThread(m) {
  const ch = findChannel(m.channel_id); if (!ch) return;
  S.thread = { id: m.id, channel_id: m.channel_id, parent: m };
  const content = $('.content'); if (!content) return;
  $('.thread-panel')?.remove();
  const panel = h(`<aside class="thread-panel"><header class="topbar"><span class="ico">${I.thread}</span><span class="title">Thread</span><span class="topic" style="cursor:default">${esc(plainPreview(m.content) || 'Attachment')}</span><button class="icon-btn" data-close-thread>${I.x}</button></header>
    <div class="messages" data-key="t:${m.id}"></div>${composerHtml(ch, m.id)}</aside>`);
  content.appendChild(panel);
  $('[data-close-thread]', panel).onclick = () => closeThread();
  bindMessageList($('.messages', panel));
  bindComposer($('.composer', panel), ch.id, m.id);
  await loadMessages('t:' + m.id);
  $('.composer textarea', panel).focus();
}
function closeThread(silent) { S.thread = null; $('.thread-panel')?.remove(); }

/* ================= SEARCH ================= */
async function runSearch(cid, q) {
  const content = $('.content'); $('.search-results')?.remove();
  const panel = h(`<div class="search-results"><div class="sr-head"><span>Searching…</span><button class="icon-btn">${I.x}</button></div><div class="sr-list"></div></div>`);
  content.appendChild(panel);
  $('.sr-head button', panel).onclick = () => panel.remove();
  try {
    const rows = await api('GET', `/api/channels/${cid}/search?q=${encodeURIComponent(q)}`);
    const sid = findChannel(cid)?.server_id;
    $('.sr-head span', panel).textContent = `${rows.length} result${rows.length === 1 ? '' : 's'}`;
    $('.sr-list', panel).innerHTML = rows.length ? rows.map(m => messageHtml(m, sid, null, true)).join('') : '<div class="empty">No results found.</div>';
    $('.sr-list', panel).onclick = (e) => { const el = e.target.closest('[data-mid]'); if (el) jumpTo(Number(el.dataset.mid)); };
  } catch (e) { $('.sr-head span', panel).textContent = e.message; }
}

/* ================= POPOUTS / MENUS ================= */
// popups stack: a menu opened from a profile card sits above it, and clicking outside the menu
// only closes the menu (not the card underneath), like Discord
const layerStack = [];
function layer(onClose) {
  const z = 100 + layerStack.length * 2;
  const l = h(`<div class="layer" style="z-index:${z}"></div>`); document.body.appendChild(l);
  const me = { close: null };
  const close = () => { if (!l.isConnected) return; l.remove(); pop?.remove(); const i = layerStack.indexOf(me); if (i >= 0) layerStack.splice(i, 1); document.removeEventListener('keydown', esc_); onClose && onClose(); };
  me.close = close; layerStack.push(me);
  let pop = null;
  const esc_ = (e) => { if (e.key === 'Escape' && layerStack[layerStack.length - 1] === me) { e.stopImmediatePropagation(); close(); } };
  document.addEventListener('keydown', esc_);
  l.onmousedown = close; l.oncontextmenu = (e) => { e.preventDefault(); close(); };
  return { set(el) { pop = el; el.style.zIndex = z + 1; document.body.appendChild(el); }, close };
}
function place(el, x, y, opts = {}) {
  const w = el.offsetWidth, hh = el.offsetHeight;
  let left = x, top = opts.above ? y - hh : y;
  if (left + w > innerWidth - 8) left = innerWidth - w - 8;
  if (top + hh > innerHeight - 8) top = innerHeight - hh - 8;
  el.style.left = Math.max(8, left) + 'px'; el.style.top = Math.max(8, top) + 'px';
}
function contextMenu(e, items, cls = '', minW) {
  const L = layer();
  const list = items.filter(Boolean);
  const el = h(`<div class="menu ${cls}" ${minW ? `style="min-width:${minW}px"` : ''}>${list.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it[2] || ''}">${it[0]}</button>`).join('')}</div>`);
  L.set(el); place(el, e.clientX, e.clientY, { above: e.above });
  el.onclick = (ev) => { const b = ev.target.closest('[data-i]'); if (!b) return; L.close(); list[b.dataset.i][1](); };
}
const gifIsFav = (url) => (S.prefs.gifFavorites || []).some(g => g.url === url);
function toggleGifFav(url, imgEl) {
  const list = (S.prefs.gifFavorites || []).filter(x => x.url !== url);
  if (!gifIsFav(url)) list.unshift({ url, preview: url, w: imgEl?.naturalWidth || 1, h: imgEl?.naturalHeight || 1 });
  S.prefs.gifFavorites = list.slice(0, 100); savePrefs();
  return gifIsFav(url);
}
function gifPicker(anchor, cid, threadId, state, comp) {
  const L = layer();
  const favs = () => S.prefs.gifFavorites || [];
  const isFav = (url) => favs().some(g => g.url === url);
  const toggleFav = (g) => { const list = favs().filter(x => x.url !== g.url); if (!isFav(g.url)) list.unshift({ url: g.url, preview: g.preview, w: g.w, h: g.h }); S.prefs.gifFavorites = list.slice(0, 100); savePrefs(); };
  const el = h(`<div class="popout gif-picker">
    <div class="gp-head"><input class="input" placeholder="Search Giphy"><button class="gp-fav-tab" title="Favorites">${I.heart}</button></div>
    <div class="gp-grid"><div class="gp-col"></div><div class="gp-col"></div></div>
    <div class="gp-foot">Powered by GIPHY</div></div>`);
  L.set(el);
  const r = anchor.getBoundingClientRect();
  place(el, r.right - 360, r.top - 8, { above: true });
  const grid = $('.gp-grid', el);
  const cols = $$('.gp-col', grid);
  let token = 0, mode = 'trending';
  const render = (gifs) => {
    cols.forEach(c => c.innerHTML = '');
    if (!gifs.length) { grid.innerHTML = `<div class="gp-loading">${mode === 'fav' ? 'No favorites yet. Tap the ♥ on a GIF to save it.' : 'No GIFs found.'}</div>`; return; }
    gifs.forEach((g, i) => {
      const item = h(`<button class="gp-item" style="aspect-ratio:${g.w}/${g.h}"><img src="${esc(g.preview)}" alt="" loading="lazy"><span class="gp-fav ${isFav(g.url) ? 'on' : ''}" title="Favorite">${I.heart.replace('width="20" height="20"', 'width="15" height="15"')}</span></button>`);
      item.dataset.url = g.url; item._g = g;
      cols[i % 2].appendChild(item);
    });
  };
  const load = async (q) => {
    const mine = ++token; mode = 'trending';
    grid.innerHTML = '<div class="gp-loading">Loading GIFs…</div>';
    grid.append(cols[0], cols[1]); cols.forEach(c => c.innerHTML = '');
    try { const { gifs } = await api('GET', '/api/gifs?q=' + encodeURIComponent(q || '') + '&_=' + Date.now()); if (mine !== token) return; grid.innerHTML = ''; grid.append(cols[0], cols[1]); render(gifs); }
    catch (e) { if (mine === token) grid.innerHTML = `<div class="gp-loading">${esc(e.message)}</div>`; }
  };
  const showFavs = () => { token++; mode = 'fav'; grid.innerHTML = ''; grid.append(cols[0], cols[1]); render(favs()); };
  const search = debounce((v) => load(v), 350);
  $('input', el).oninput = (e) => { $('.gp-fav-tab', el).classList.remove('on'); search(e.target.value.trim()); };
  $('.gp-fav-tab', el).onclick = (e) => { const on = mode !== 'fav'; e.currentTarget.classList.toggle('on', on); if (on) showFavs(); else load($('input', el).value.trim()); };
  grid.onclick = async (e) => {
    const fav = e.target.closest('.gp-fav');
    const item = e.target.closest('.gp-item'); if (!item) return;
    if (fav) { e.stopPropagation(); toggleFav(item._g); fav.classList.toggle('on', isFav(item._g.url)); if (mode === 'fav') showFavs(); return; }
    L.close();
    const form = new FormData();
    form.append('gif', item.dataset.url);
    if (state && state.reply) { form.append('reply_to', state.reply.id); form.append('mention_reply', String(state.mentionReply)); }
    if (threadId) form.append('thread_id', threadId);
    try { await upload(`/api/channels/${cid}/messages`, form); if (comp && state && state.reply) comp._setReply(null); } catch (er) { toast(er.message, true); }
  };
  load('');
  if (window.innerWidth > 760) $('input', el).focus();
}
function emojiPicker(anchor, onPick, keepOpen) {
  const L = layer();
  const cats = Object.entries(EMOJI);
  const custom = myEmojis();
  const bySrv = {}; custom.forEach(e => (bySrv[e.server] = bySrv[e.server] || []).push(e));
  const customHtml = Object.entries(bySrv).map(([srv, list]) => `<h6>${esc(srv)}</h6>` + list.map(e => `<button data-e="<:${esc(e.name)}:${esc(e.id)}>" data-cname="${esc(e.name)}" data-c="${esc(e.name.toLowerCase())} ${esc(srv.toLowerCase())}" title=":${esc(e.name)}:"><img src="${esc(e.url)}" alt=":${esc(e.name)}:" loading="lazy"></button>`).join('')).join('');
  const el = h(`<div class="popout emoji-picker"><input class="input" placeholder="Search emoji…"><div class="grid">${customHtml}${cats.map(([c, list]) => `<h6>${c}</h6>` + list.split(' ').map(e => `<button data-e="${e}" data-c="${c.toLowerCase()}">${e}</button>`).join('')).join('')}</div></div>`);
  L.set(el);
  const r = anchor.getBoundingClientRect();
  place(el, r.right - 340, r.top - 8, { above: true });
  $('input', el).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('.grid button', el).forEach(b => b.classList.toggle('hidden', q && !b.dataset.c.includes(q))); $$('.grid h6', el).forEach(x => x.classList.toggle('hidden', !!q)); };
  el.onclick = (e) => { const b = e.target.closest('[data-e]'); if (!b) return; onPick(b.dataset.e, b.dataset.cname ? { name: b.dataset.cname } : null); if (!keepOpen || !e.shiftKey) L.close(); };
  if (window.innerWidth > 760) $('input', el).focus();
}
function activityHtml(uidv) {
  const a = activityOf(uidv);
  if (!a || a.type !== 'listening') return '';
  const dur = Math.max(1, a.end - a.start), pos = Math.min(dur, Date.now() - a.start);
  const t = (ms) => { const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  return `<div class="activity"><h5>Listening to ${esc(a.name)}</h5><div class="act-row">${a.art ? `<img src="${esc(a.art)}" alt="">` : `<span class="art-ph">${I.music}</span>`}
    <div class="act-meta"><a ${a.url ? `href="${esc(a.url)}" target="_blank" rel="noopener"` : ''} class="act-title">${esc(a.title)}</a><span>by ${esc(a.artist || '')}</span><span>on ${esc(a.album || '')}</span></div></div>
    <div class="act-bar"><i style="width:${(pos / dur * 100).toFixed(1)}%"></i></div><div class="act-times"><span>${t(pos)}</span><span>${t(dur)}</span></div></div>`;
}
function friendActionRow(uid) {
  const st = friendState(uid);
  if (st === 'self') return '';
  if (st === 'friend') return `<div class="actions"><button class="btn secondary" data-unfriend="${uid}">${I.check} Friends</button></div>`;
  if (st === 'outgoing') return `<div class="actions"><button class="btn secondary" data-cancelreq="${uid}">Request sent · Cancel</button></div>`;
  if (st === 'incoming') return `<div class="actions"><button class="btn primary" data-acceptreq="${uid}">Accept request</button><button class="btn ghost" data-declinereq="${uid}">Ignore</button></div>`;
  if (st === 'blocked') return `<div class="actions"><button class="btn secondary" data-unblockp="${uid}">Unblock</button></div>`;
  if (st === 'blocked_by') return '';
  return `<div class="actions"><button class="btn primary" data-addfriend="${uid}">${I.invite} Add friend</button></div>`;
}
function profileCardHtml(u, opts = {}) {
  const { sid, mem, roles = [], self, preview } = opts;
  const themed = !!u.theme_primary;
  const conns = (u.connections || []);
  return `<div class="profile-card ${themed ? 'themed' : ''} fx-${esc(u.effect || 'none')}" data-card="${esc(u.id)}" style="${themeStyle(u)}">
    ${bannerHtml(u)}
    <div class="avwrap">${avatar(u, 's80', true)}</div>
    ${u.effect === 'stars' ? '<div class="fx-layer"></div>' : ''}
    <div class="inner">
      <div class="dn" style="${nameStyle(u)}">${esc(mem?.nick || u.display_name)}${badgeHtml(u)}</div>
      <div class="un">${esc(u.username)}${u.pronouns ? ` <span class="pron">${esc(u.pronouns)}</span>` : ''}</div>
      ${u.status_text ? `<div class="stt">${esc(u.status_text)}</div>` : ''}
      <div class="activity-slot">${activityHtml(u.id)}</div>
      ${u.bio ? `<section><h5>About me</h5><div class="bio">${formatText(u.bio)}</div></section>` : ''}
      ${(u.links || []).length ? `<section><h5>Links</h5><div class="links">${u.links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${I.link.replace('width="20" height="20"', 'width="14" height="14"')}<span>${esc(l.label || new URL(l.url).hostname)}</span></a>`).join('')}</div></section>` : ''}
      ${conns.length ? `<section><h5>Connections</h5><div class="conns">${conns.map(c => { const [n, col, g] = CONN[c.type] || [c.type, '#555', '?']; return `<a class="conn" ${c.url ? `href="${esc(c.url)}" target="_blank" rel="noopener noreferrer"` : ''} title="${esc(n)}"><span class="cg" style="background:${col}">${g}</span><span class="cn">${esc(c.name)}</span>${c.verified ? `<span class="ver" title="Verified">${I.check.replace('width="20" height="20"', 'width="12" height="12"')}</span>` : ''}</a>`; }).join('')}</div></section>` : ''}
      ${!preview ? `<section><h5>Member since</h5><div class="since">${new Date(u.created || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}${mem ? `<span class="since-sep"></span>${esc(S.serverData[sid].name)}: ${new Date(mem.joined).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}</div></section>` : ''}
      ${mem ? `<section><h5>Roles</h5><div class="role-tags">${roles.map(r => `<span class="role-tag"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}${can(PERM.MANAGE_ROLES, sid) ? `<button data-unrole="${r.id}" title="Remove role">✕</button>` : ''}</span>`).join('')}${can(PERM.MANAGE_ROLES, sid) ? `<button class="role-tag add" data-roles>+ Add role</button>` : ''}${!roles.length && !can(PERM.MANAGE_ROLES, sid) ? '<span class="none">No roles</span>' : ''}</div></section>` : ''}
      ${u.mutual_servers?.length && !self ? `<section><h5>Mutual servers</h5><div class="since">${u.mutual_servers.map(s => esc(s.name)).join(', ')}</div></section>` : ''}
    </div>
    ${preview ? '' : self ? `<div class="actions"><button class="btn secondary" data-editp>${I.edit} Edit profile</button></div>`
      : `${friendActionRow(u.id)}<div class="actions"><input class="msgbox" placeholder="Message @${esc(u.username)}"><button class="icon-btn" data-call title="Call">${I.phone}</button><button class="icon-btn" data-mod title="More">•••</button></div>`}
  </div>`;
}
async function profilePopout(uidv, anchor, side) {
  if (!uidv) return;
  let u = S.users[uidv];
  try { u = { ...u, ...(await api('GET', '/api/users/' + uidv)) }; S.users[uidv] = { ...S.users[uidv], ...u }; if (u.activity) S.activities[uidv] = u.activity; } catch {}
  if (!u) return;
  const sid = S.view.server !== '@me' ? S.view.server : null;
  const sd = sid && S.serverData[sid];
  const mem = sd && member(sid, uidv);
  const roles = mem ? sd.roles.filter(r => mem.roles.includes(r.id)).sort((a, b) => b.position - a.position) : [];
  const self = uidv === S.me.id;
  const L = layer();
  const el = h(`<div class="popout pc-pop">${profileCardHtml(u, { sid, mem, roles, self })}</div>`);
  L.set(el);
  if (anchor) { const r = anchor.getBoundingClientRect(); if (side === 'left') place(el, r.left - el.offsetWidth - 12, r.top); else place(el, r.right + 12, r.top); }
  else place(el, innerWidth / 2 - el.offsetWidth / 2, innerHeight / 2 - el.offsetHeight / 2);
  el.onclick = async (e) => {
    if (e.target.closest('[data-editp]')) { L.close(); openUserSettings('profile'); }
    if (e.target.closest('[data-call]')) { L.close(); const d = await openDM(uidv); if (d) Voice.join(d.id); }
    if (e.target.closest('[data-roles]')) { L.close(); memberRolesModal(sid, uidv); }
    const ur = e.target.closest('[data-unrole]'); if (ur) { await api('PUT', `/api/servers/${sid}/members/${uidv}`, { roles: mem.roles.filter(r => r !== ur.dataset.unrole) }).catch(x => toast(x.message, true)); L.close(); }
    const fa = async (sel, fn) => { const b = e.target.closest(sel); if (b) { try { await fn(uidv); } catch (ex) { toast(ex.message, true); } L.close(); return true; } return false; };
    if (await fa('[data-addfriend]', id => api('POST', '/api/friends', { username: user(id).username }))) return;
    if (await fa('[data-acceptreq]', id => api('POST', `/api/friends/${id}/accept`))) return;
    if (await fa('[data-declinereq]', id => api('DELETE', '/api/friends/' + id))) return;
    if (await fa('[data-cancelreq]', id => api('DELETE', '/api/friends/' + id))) return;
    if (await fa('[data-unblockp]', id => api('DELETE', `/api/friends/${id}/block`))) return;
    if (e.target.closest('[data-unfriend]')) { L.close(); confirmModal('Remove friend', `Remove <b>${esc(u.display_name)}</b>?`, 'Remove', () => api('DELETE', '/api/friends/' + uidv)); return; }
    if (e.target.closest('[data-mod]')) { const r = e.target.closest('[data-mod]').getBoundingClientRect(); profileMoreMenu({ clientX: r.left, clientY: r.bottom + 4 }, sid, uidv); }
  };
  const mb = $('.msgbox', el);
  if (mb) mb.onkeydown = async (e) => {
    if (e.key !== 'Enter' || !mb.value.trim()) return;
    const text = mb.value.trim(); L.close();
    const d = await openDM(uidv);
    if (d) { const f = new FormData(); f.append('content', text); upload(`/api/channels/${d.id}/messages`, f).catch(x => toast(x.message, true)); }
  };
}
const audioPlayers = {};
function audioEmbedAction(embed, e) {
  const url = embed.dataset.audio;
  let a = audioPlayers[url];
  if (!a) { a = audioPlayers[url] = new Audio(url); ['timeupdate','loadedmetadata','ended','play','pause'].forEach(ev => a.addEventListener(ev, () => updateAudioEmbeds(url))); }
  const bar = e.target.closest('.ae-bar');
  if (bar) { const r = bar.getBoundingClientRect(); const pct = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); if (a.duration) a.currentTime = pct * a.duration; return; }
  if (a.paused) { Object.values(audioPlayers).forEach(x => x !== a && x.pause()); a.play().catch(() => {}); } else a.pause();
}
function updateAudioEmbeds(url) {
  const a = audioPlayers[url]; if (!a) return;
  const fmt = (s) => { s = Math.floor(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  $$('.audio-embed').filter(x => x.dataset.audio === url).forEach(embed => {
    embed.classList.toggle('playing', !a.paused);
    $('.ae-play', embed).innerHTML = a.paused ? I.play : I.pause;
    $('.ae-fill', embed).style.width = (a.duration ? a.currentTime / a.duration * 100 : 0) + '%';
    $('.ae-cur', embed).textContent = fmt(a.currentTime);
    if (a.duration) $('.ae-dur', embed).textContent = fmt(a.duration);
  });
}
function lightbox(url, name) {
  const el = h(`<div class="lightbox"><div><img src="${esc(url)}" alt=""><a href="${esc(url)}" target="_blank" download="${esc(name || '')}">Open original</a></div></div>`);
  document.body.appendChild(el);
  const close = () => { el.remove(); document.removeEventListener('keydown', k); };
  const k = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', k);
  el.onclick = (e) => { if (e.target.tagName !== 'A') close(); };
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Copied!'); } catch { prompt('Copy this:', text); } }

/* ================= MODALS ================= */
function modal(html, setup, cls = '') {
  const wrap = h(`<div class="modal-wrap"><div class="modal ${cls}" style="position:relative">${html}</div></div>`);
  document.body.appendChild(wrap);
  const m = $('.modal', wrap);
  const close = () => { wrap.remove(); document.removeEventListener('keydown', k); };
  const k = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', k);
  wrap.onmousedown = (e) => { if (e.target === wrap) close(); };
  $$('[data-close]', m).forEach(b => b.onclick = close);
  setup && setup(m, close);
  setTimeout(() => $('input:not([type=checkbox]):not([type=file]),textarea', m)?.focus(), 30);
  return { el: m, close };
}
function confirmModal(title, html, okText, fn) {
  modal(`<div class="mh" style="text-align:left"><h2>${esc(title)}</h2></div><div class="mb" style="color:var(--text-2)">${html}</div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-ok>${esc(okText)}</button></div>`, (m, close) => {
    $('[data-ok]', m).onclick = async () => { try { await fn(); close(); } catch (e) { toast(e.message, true); } };
  });
}
function createServerModal() {
  let iconFile = null;
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh"><h2>Create your server</h2><p>Your server is where you and your friends hang out. Make yours and start talking.</p></div>
    <div class="mb"><label class="upload-circle" data-icon>${I.upload}<input type="file" accept="image/*" hidden></label>
    <div class="field"><label>Server name</label><input class="input" name="name" maxlength="50" value="${esc(S.me.display_name)}’s server"></div></div>
    <div class="mf"><button class="btn ghost" data-close>Back</button><span class="sp"></span><button class="btn primary" data-ok>Create</button></div>`, (m, close) => {
    const fi = $('input[type=file]', m);
    fi.onchange = () => { iconFile = fi.files[0]; if (iconFile) $('[data-icon]', m).innerHTML = `<img src="${URL.createObjectURL(iconFile)}">`; $('[data-icon]', m).appendChild(fi); };
    const go = async () => {
      const name = $('[name=name]', m).value.trim(); if (!name) return;
      try {
        const sd = await api('POST', '/api/servers', { name });
        if (iconFile) { const f = new FormData(); f.append('file', iconFile); await upload(`/api/servers/${sd.id}/image/icon`, f).catch(() => {}); }
        await fetchServer(sd.id); close(); selectServer(sd.id);
      } catch (e) { toast(e.message, true); }
    };
    $('[data-ok]', m).onclick = go; $('[name=name]', m).onkeydown = (e) => e.key === 'Enter' && go();
  });
}
function joinServerModal(prefill = '') {
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh"><h2>Join a server</h2><p>Enter an invite below to join an existing server.</p></div>
    <div class="mb"><div class="field"><label>Invite link <span class="req" style="color:var(--red)">*</span></label><input class="input" name="code" value="${esc(prefill)}" placeholder="${esc(location.origin)}/invite/hTKzmak"></div>
    <p style="font-size:13px;color:var(--muted)">Invites look like <b>hTKzmak</b> or <b>${esc(location.origin)}/invite/hTKzmak</b></p></div>
    <div class="mf"><button class="btn ghost" data-close>Back</button><span class="sp"></span><button class="btn primary" data-ok>Join Server</button></div>`, (m, close) => {
    const go = async () => { const code = $('[name=code]', m).value.trim().split('/').pop(); if (!code) return; close(); showInvite(code); };
    $('[data-ok]', m).onclick = go; $('[name=code]', m).onkeydown = (e) => e.key === 'Enter' && go();
  });
}
async function showInvite(code) {
  let inv;
  try { inv = await api('GET', '/api/invites/' + encodeURIComponent(code)); } catch (e) { return toast(e.message, true); }
  const s = inv.server;
  if (S.serverData[s.id]) return selectServer(s.id);
  modal(`${s.banner ? `<div style="height:110px;background:url('${esc(s.banner)}') center/cover"></div>` : ''}<div class="mh"><div class="rail-btn" style="width:72px;height:72px;margin:0 auto 12px;border-radius:20px;font-size:24px">${serverIcon(s)}</div>
    <p>You’ve been invited to join</p><h2>${esc(s.name)}</h2><p><span style="color:var(--green)">●</span> ${s.online} Online &nbsp; <span style="color:var(--dim)">●</span> ${s.members} Members</p>${s.description ? `<p>${esc(s.description)}</p>` : ''}</div>
    <div class="mf"><button class="btn ghost" data-close>Not now</button><button class="btn primary" data-ok>Accept Invite</button></div>`, (m, close) => {
    $('[data-ok]', m).onclick = async () => { try { const sd = await api('POST', '/api/invites/' + encodeURIComponent(code)); await fetchServer(sd.id); close(); selectServer(sd.id); } catch (e) { toast(e.message, true); } };
  });
}
async function inviteModal(sid) {
  let code;
  try { code = (await api('POST', `/api/servers/${sid}/invites`)).code; } catch (e) { return toast(e.message, true); }
  const link = `${location.origin}/invite/${code}`;
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>Invite friends to ${esc(S.serverData[sid].name)}</h2></div>
    <div class="mb"><div class="field"><label>Send a server invite link to a friend</label><div class="invite-box"><input readonly value="${esc(link)}"><button class="btn primary sm" data-copy>Copy</button></div></div>
    <p style="font-size:13px;color:var(--muted)">They can paste the link in a browser, or use “Join with an invite” in Orbit and enter <b>${esc(code)}</b>.</p></div>`, (m) => {
    $('[data-copy]', m).onclick = (e) => { copy(link); e.target.textContent = 'Copied'; e.target.classList.add('green'); };
  });
}
function createChannelModal(type = 'text') {
  const sd = curServer();
  let sel = type, priv = false, roles = [];
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>Create Channel</h2></div>
    <div class="mb"><div class="field"><label>Channel type</label>
      <button class="choice" data-t="text"><span class="ci">${I.hash}</span><span class="ct"><b>Text</b><small>Send messages, images, GIFs, emoji, opinions and puns</small></span></button>
      <button class="choice" data-t="voice"><span class="ci">${I.speaker}</span><span class="ct"><b>Voice</b><small>Hang out together with voice, video and screen share</small></span></button></div>
    <div class="field"><label>Channel name</label><input class="input" name="name" maxlength="40" placeholder="new-channel"></div>
    <label class="row-toggle"><span class="rt"><b>${I.lock} Private channel</b><small>Only selected roles will be able to view this channel.</small></span><span class="toggle"><input type="checkbox" name="priv"><span></span></span></label>
    <div class="field roles-pick hidden"><label>Who can access this channel?</label><div class="chip-select">${sd.roles.filter(r => !r.is_default).map(r => `<button data-r="${r.id}"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</button>`).join('') || '<span style="color:var(--muted);font-size:13px">No roles yet. Create roles in Server Settings. Admins can always see private channels.</span>'}</div></div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Create Channel</button></div>`, (m, close) => {
    const upd = () => $$('[data-t]', m).forEach(b => b.classList.toggle('sel', b.dataset.t === sel));
    upd();
    $$('[data-t]', m).forEach(b => b.onclick = () => { sel = b.dataset.t; upd(); });
    $('[name=priv]', m).onchange = (e) => { priv = e.target.checked; $('.roles-pick', m).classList.toggle('hidden', !priv); };
    $$('[data-r]', m).forEach(b => b.onclick = () => { b.classList.toggle('on'); roles = $$('[data-r].on', m).map(x => x.dataset.r); });
    const go = async () => {
      const name = $('[name=name]', m).value.trim(); if (!name) return;
      try { const c = await api('POST', `/api/servers/${sd.id}/channels`, { name, type: sel, private: priv, allowed_roles: roles }); await fetchServer(sd.id); close(); if (c.type === 'text') selectChannel(c.id); else renderSidebar(); }
      catch (e) { toast(e.message, true); }
    };
    $('[data-ok]', m).onclick = go; $('[name=name]', m).onkeydown = (e) => e.key === 'Enter' && go();
  });
}
function channelSettingsModal(cid) {
  const c = findChannel(cid); const sd = S.serverData[c.server_id];
  let roles = [...c.allowed_roles];
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>${c.type === 'voice' ? '🔊' : '#'} ${esc(c.name)}</h2><p>Channel settings</p></div>
    <div class="mb"><div class="field"><label>Channel name</label><input class="input" name="name" maxlength="40" value="${esc(c.name)}"></div>
    ${c.type === 'text' ? `<div class="field"><label>Channel topic</label><textarea class="input" name="topic" maxlength="300" placeholder="Let everyone know how to use this channel!">${esc(c.topic || '')}</textarea></div>` : ''}
    <label class="row-toggle"><span class="rt"><b>${I.lock} Private channel</b><small>Only selected roles (and admins) can view it.</small></span><span class="toggle"><input type="checkbox" name="priv" ${c.private ? 'checked' : ''}><span></span></span></label>
    <div class="field roles-pick ${c.private ? '' : 'hidden'}"><label>Roles with access</label><div class="chip-select">${sd.roles.filter(r => !r.is_default).map(r => `<button data-r="${r.id}" class="${roles.includes(r.id) ? 'on' : ''}"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</button>`).join('') || '<span style="color:var(--muted);font-size:13px">No roles yet.</span>'}</div></div>${c.type === 'text' ? `<div class="field" style="margin-top:14px"><label>Slowmode</label><select class="input" name="slow">${SLOW_OPTS.map(([v, l]) => `<option value="${v}" ${v === (c.slowmode || 0) ? 'selected' : ''}>${l}</option>`).join('')}</select><p class="hint" style="margin:6px 0 0">Members can send one message per this interval. People who can manage messages or channels aren’t limited.</p></div>` : ''}</div>
    <div class="mf"><button class="btn danger" data-del>Delete Channel</button><span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, (m, close) => {
    $('[name=priv]', m).onchange = (e) => $('.roles-pick', m).classList.toggle('hidden', !e.target.checked);
    $$('[data-r]', m).forEach(b => b.onclick = () => { b.classList.toggle('on'); roles = $$('[data-r].on', m).map(x => x.dataset.r); });
    $('[data-ok]', m).onclick = async () => {
      try { await api('PATCH', '/api/channels/' + cid, { name: $('[name=name]', m).value, topic: $('[name=topic]', m)?.value, private: $('[name=priv]', m).checked, allowed_roles: roles, ...($('[name=slow]', m) ? { slowmode: Number($('[name=slow]', m).value) } : {}) }); close(); }
      catch (e) { toast(e.message, true); }
    };
    $('[data-del]', m).onclick = () => { close(); deleteChannel(c); };
  });
}
function deleteChannel(c) { confirmModal('Delete Channel', `Are you sure you want to delete <b>${c.type === 'voice' ? '' : '#'}${esc(c.name)}</b>? This cannot be undone.`, 'Delete Channel', () => api('DELETE', '/api/channels/' + c.id)); }
function peopleIKnow() {
  const people = new Map();
  (S.friends.friends || []).forEach(u => people.set(u.id, S.users[u.id] || u));
  Object.values(S.serverData).forEach(sd => sd.members.forEach(m => m.id !== S.me.id && people.set(m.id, S.users[m.id] || m)));
  S.dms.forEach(d => { if (d.user && d.user.id !== S.me.id) people.set(d.user.id, S.users[d.user.id] || d.user); (d.members || []).forEach(m => m.id !== S.me.id && people.set(m.id, S.users[m.id] || m)); });
  return [...people.values()];
}
function newDmModal() {
  const list = peopleIKnow();
  const picked = new Set();
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>New message</h2><p>Pick one person for a direct message, or several for a group chat (up to 35).</p></div>
    <div class="mb"><input class="input" placeholder="Type a username"><div class="chips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px"></div><div class="pl" style="margin-top:10px;max-height:300px;overflow:auto"></div></div>
    <div class="mf"><span class="sp"></span><button class="btn primary" data-go disabled>Message</button></div>`, (m, close) => {
    const draw = (q = '') => { const f = list.filter(u => !q || u.username.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q));
      $('.pl', m).innerHTML = f.length ? f.map(u => `<button class="ac-item ${picked.has(u.id) ? 'sel' : ''}" data-u="${u.id}">${avatar(u, 's32', true)}<span>${esc(u.display_name)}</span><small>@${esc(u.username)}</small><span class="pick-check">${picked.has(u.id) ? I.check.replace('width="20" height="20"', 'width="16" height="16"') : ''}</span></button>`).join('') : '<p style="color:var(--muted);padding:8px">No one found. Join a server to meet people.</p>'; };
    const sync = () => {
      $('.chips', m).innerHTML = [...picked].map(id => { const u = user(id); return `<span class="pchip">${avatar(u, 's24')}${esc(u.display_name)}<button data-un="${id}">${I.x.replace('width="20" height="20"', 'width="12" height="12"')}</button></span>`; }).join('');
      const go = $('[data-go]', m); go.disabled = picked.size === 0; go.textContent = picked.size > 1 ? `Create group (${picked.size})` : 'Message';
    };
    draw(); sync();
    $('input', m).oninput = (e) => draw(e.target.value.toLowerCase());
    $('.pl', m).onclick = (e) => { const b = e.target.closest('[data-u]'); if (!b) return; const id = b.dataset.u; picked.has(id) ? picked.delete(id) : (picked.size < 35 && picked.add(id)); draw($('input', m).value.toLowerCase()); sync(); };
    $('.chips', m).onclick = (e) => { const b = e.target.closest('[data-un]'); if (b) { picked.delete(b.dataset.un); draw($('input', m).value.toLowerCase()); sync(); } };
    $('[data-go]', m).onclick = async () => {
      const ids = [...picked]; close();
      try { const entry = ids.length > 1 ? await api('POST', '/api/groups', { members: ids }) : await openDM(ids[0]);
        if (ids.length > 1 && entry) { if (!S.dms.find(d => d.id === entry.id)) S.dms.unshift(entry); (entry.members || []).forEach(x => S.users[x.id] = { ...S.users[x.id], ...x }); S.view.server = '@me'; selectChannel(entry.id, true); renderRail(); showMainMobile(); }
      } catch (e) { toast(e.message, true); }
    };
  });
}
function addToGroupModal(cid) {
  const ch = findChannel(cid); if (!ch) return;
  const inGroup = new Set((ch.members || []).map(m => m.id));
  const list = peopleIKnow().filter(u => !inGroup.has(u.id));
  const room = 35 - (ch.member_count || inGroup.size);
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>Add people</h2><p>${room > 0 ? `You can add ${room} more.` : 'This group is full (35).'}</p></div>
    <div class="mb"><input class="input" placeholder="Type a username"><div class="pl" style="margin-top:10px;max-height:320px;overflow:auto"></div></div>`, (m, close) => {
    const draw = (q = '') => { const f = list.filter(u => !q || u.username.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q));
      $('.pl', m).innerHTML = f.length ? f.map(u => `<button class="ac-item" data-u="${u.id}" ${room <= 0 ? 'disabled style="opacity:.5"' : ''}>${avatar(u, 's32', true)}<span>${esc(u.display_name)}</span><small>@${esc(u.username)}</small></button>`).join('') : '<p style="color:var(--muted);padding:8px">Everyone you know is already here.</p>'; };
    draw();
    $('input', m).oninput = (e) => draw(e.target.value.toLowerCase());
    $('.pl', m).onclick = async (e) => { const b = e.target.closest('[data-u]'); if (!b || room <= 0) return; try { await api('POST', `/api/channels/${cid}/recipients`, { user_id: b.dataset.u }); close(); } catch (er) { toast(er.message, true); } };
  });
}
function groupSettingsModal(cid) {
  const ch = findChannel(cid); if (!ch) return;
  const isOwner = ch.owner === S.me.id;
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh"><label class="upload-circle" data-icon style="margin-bottom:10px">${ch.icon ? `<img src="${esc(ch.icon)}">` : I.group}<input type="file" accept="image/*" hidden></label>
    <input class="input" name="name" maxlength="60" value="${esc(ch.name || '')}" placeholder="Group name" style="text-align:center"></div>
    <div class="mb"><h3 style="font-size:13px;color:var(--muted);margin-bottom:8px">${ch.member_count} members</h3><div class="gmembers">${(ch.members || []).map(u => `<div class="list-row">${avatar(u, 's32', true)}<div class="grow"><b>${esc(u.display_name)}${badgeHtml(u)}</b><small>@${esc(u.username)}${u.id === ch.owner ? ' · owner' : ''}</small></div>${isOwner && u.id !== S.me.id ? `<button class="icon-btn danger" data-remove="${u.id}" title="Remove">${I.x}</button>` : ''}</div>`).join('')}</div>
    <button class="btn secondary sm" data-add style="margin-top:10px">${I.invite} Add people</button></div>
    <div class="mf"><button class="btn danger" data-leave>Leave group</button><span class="sp"></span><button class="btn ghost" data-close>Close</button><button class="btn primary" data-save>Save</button></div>`, (m, close) => {
    $('[data-icon] input', m).onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append('file', f); try { await upload(`/api/groups/${cid}/icon`, fd); toast('Group icon updated'); } catch (er) { toast(er.message, true); } };
    $('[data-save]', m).onclick = async () => { try { await api('PATCH', '/api/groups/' + cid, { name: $('[name=name]', m).value.trim() }); close(); } catch (er) { toast(er.message, true); } };
    $('[data-add]', m).onclick = () => { close(); addToGroupModal(cid); };
    $('[data-leave]', m).onclick = () => confirmModal('Leave group', `Leave <b>${esc(ch.name || 'this group')}</b>? You’ll need to be added back to rejoin.`, 'Leave', async () => { await api('DELETE', `/api/channels/${cid}/recipients/${S.me.id}`); if (S.view.channel === cid) selectServer('@me'); });
    $('.gmembers', m).onclick = async (e) => { const b = e.target.closest('[data-remove]'); if (b) { try { await api('DELETE', `/api/channels/${cid}/recipients/${b.dataset.remove}`); groupSettingsModal(cid); close(); } catch (er) { toast(er.message, true); } } const uu = e.target.closest('[data-uid]'); };
  });
}
function memberRolesModal(sid, uidv) {
  const sd = S.serverData[sid]; const mem = member(sid, uidv);
  let roles = [...mem.roles];
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>Roles for ${esc(nameIn(sid, uidv))}</h2></div>
    <div class="mb"><div class="chip-select">${sd.roles.filter(r => !r.is_default).map(r => `<button data-r="${r.id}" class="${roles.includes(r.id) ? 'on' : ''}"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</button>`).join('') || '<span style="color:var(--muted)">No roles yet. Create some in Server Settings → Roles.</span>'}</div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, (m, close) => {
    $$('[data-r]', m).forEach(b => b.onclick = () => { b.classList.toggle('on'); roles = $$('[data-r].on', m).map(x => x.dataset.r); });
    $('[data-ok]', m).onclick = async () => { try { await api('PUT', `/api/servers/${sid}/members/${uidv}`, { roles }); close(); } catch (e) { toast(e.message, true); } };
  });
}
function nickModal(sid) {
  const mem = member(sid, S.me.id);
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>Server profile</h2><p>Set a nickname that only shows in ${esc(S.serverData[sid].name)}.</p></div>
    <div class="mb"><div class="field"><label>Nickname</label><input class="input" name="nick" maxlength="32" value="${esc(mem?.nick || '')}" placeholder="${esc(S.me.display_name)}"></div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, (m, close) => {
    $('[data-ok]', m).onclick = async () => { try { await api('PUT', `/api/servers/${sid}/members/${S.me.id}`, { nick: $('[name=nick]', m).value }); close(); } catch (e) { toast(e.message, true); } };
  });
}
function customStatusModal() {
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh"><h2>Set a custom status</h2></div>
    <div class="mb"><div class="field"><label>What’s cookin’?</label><input class="input" name="st" maxlength="80" value="${esc(S.me.status_text || '')}" placeholder="Support has arrived!"></div></div>
    <div class="mf"><button class="btn ghost" data-clear>Clear</button><span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, (m, close) => {
    const save = async (v) => { try { const u = await api('PATCH', '/api/me', { status_text: v }); S.me = { ...S.me, ...u }; renderUserPanel(); close(); } catch (e) { toast(e.message, true); } };
    $('[data-ok]', m).onclick = () => save($('[name=st]', m).value);
    $('[data-clear]', m).onclick = () => save('');
    $('[name=st]', m).onkeydown = (e) => e.key === 'Enter' && save(e.target.value);
  });
}

/* keyboard shortcuts */
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && S.me) { e.preventDefault(); newDmModal(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'm' && S.me) { e.preventDefault(); Voice.toggleMute(); }
  if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd' && S.me) { e.preventDefault(); Voice.toggleDeaf(); }
  // typing anywhere focuses the composer
  if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1 && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !$('.modal-wrap, .layer, .settings')) {
    const ta = $('.chat .composer textarea:not([disabled])'); if (ta) ta.focus();
  }
});
