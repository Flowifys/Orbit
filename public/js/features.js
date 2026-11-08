'use strict';
/* Orbit 1.10 — Discord-style extras: quick switcher, pins, link previews, polls, mute, collapsible
   categories, jump-to-present, slowmode, timeouts, custom emojis, group member list, self profile card. */

/* ---------- mute (per channel / DM / server, stored on this device) ---------- */
function isMuted(id) { return !!(id && S.prefs.muted && S.prefs.muted[id]); }
function chanMuted(cid) { const ch = findChannel(cid); return isMuted(cid) || (ch && ch.server_id && isMuted(ch.server_id)); }
function toggleMuteId(id, label) {
  S.prefs.muted = S.prefs.muted || {};
  if (S.prefs.muted[id]) delete S.prefs.muted[id]; else S.prefs.muted[id] = 1;
  savePrefs(); renderSidebar(); renderRail();
  toast(S.prefs.muted[id] ? `Muted ${label}. You’ll only be notified when someone @mentions you.` : `Unmuted ${label}`);
}

/* ---------- collapsible channel groups ---------- */
function isCollapsed(key) { return !!(S.prefs.collapsed && S.prefs.collapsed[key]); }
function toggleCollapsed(key) { S.prefs.collapsed = S.prefs.collapsed || {}; if (S.prefs.collapsed[key]) delete S.prefs.collapsed[key]; else S.prefs.collapsed[key] = 1; savePrefs(); renderSidebar(); }

/* ---------- link previews ---------- */
function embedsHtml(m) {
  const list = (m.embeds || []).filter(Boolean); if (!list.length) return '';
  const canRemove = m.author_id === S.me.id;
  return `<div class="embeds">${list.map((e, i) => {
    if (e.type === 'image') return `<div class="embed-img"><img src="${esc(e.image)}" alt="" loading="lazy" data-lightbox="${esc(e.image)}" data-name="image" referrerpolicy="no-referrer"></div>`;
    const big = e.image && (e.large || !e.description);
    return `<div class="embed" style="--ec:${esc(e.color || 'var(--bg-4)')}">
      ${canRemove ? `<button class="embed-x" data-unembed title="Remove preview">${I.x}</button>` : ''}
      <div class="embed-body">${e.site || e.host ? `<div class="embed-site">${esc(e.site || e.host)}</div>` : ''}
        ${e.title ? `<a class="embed-title" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>` : ''}
        ${e.description ? `<div class="embed-desc">${esc(e.description)}</div>` : ''}
        ${big ? `<img class="embed-big" src="${esc(e.image)}" alt="" loading="lazy" data-lightbox="${esc(e.image)}" data-name="${esc(e.title || 'image')}" referrerpolicy="no-referrer">` : ''}</div>
      ${e.image && !big ? `<img class="embed-thumb" src="${esc(e.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>`;
  }).join('')}</div>`;
}

/* ---------- polls ---------- */
function pollHtml(m) {
  const p = m.poll; if (!p) return '';
  const total = new Set(p.voters.flat()).size;
  const mine = p.voters.map(v => v.includes(S.me.id));
  const voted = mine.some(Boolean), ended = p.ends < Date.now();
  const left = p.ends - Date.now();
  const leftTxt = ended ? 'Poll closed' : left > 864e5 ? `${Math.round(left / 864e5)}d left` : left > 36e5 ? `${Math.round(left / 36e5)}h left` : `${Math.max(1, Math.round(left / 6e4))}m left`;
  const show = voted || ended;
  const max = Math.max(...p.voters.map(v => v.length));
  return `<div class="poll ${show ? 'show' : ''} ${ended ? 'ended' : ''}"><div class="poll-q">${esc(p.question)}</div><div class="poll-sub">${p.multi ? 'Select one or more answers' : 'Select one answer'}</div>
    ${p.answers.map((a, i) => { const n = p.voters[i].length, pct = total ? Math.round(n / total * 100) : 0;
      return `<button class="poll-opt ${mine[i] ? 'mine' : ''} ${ended && n && n === max ? 'win' : ''}" data-vote="${i}" ${ended ? 'disabled' : ''} title="${esc(p.voters[i].map(u => user(u).display_name).join(', '))}">
        <span class="po-fill" style="width:${show ? pct : 0}%"></span><span class="po-check">${mine[i] ? I.check : ''}</span><span class="po-text">${esc(a)}</span>${show ? `<span class="po-n">${n} · ${pct}%</span>` : ''}</button>`; }).join('')}
    <div class="poll-foot">${total} ${total === 1 ? 'vote' : 'votes'} · ${leftTxt}</div></div>`;
}
function pollModal(cid, threadId) {
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>Create a poll</h2></div>
    <div class="mb"><div class="field"><label>Question</label><input class="input" name="q" maxlength="300" placeholder="What should we play tonight?"></div>
    <div class="field"><label>Answers</label><div class="poll-answers"></div><button class="btn ghost sm" data-addans>${I.plus} Add another answer</button></div>
    <div class="poll-row"><div class="field" style="flex:1"><label>Duration</label><select class="input" name="h"><option value="1">1 hour</option><option value="4">4 hours</option><option value="8">8 hours</option><option value="24" selected>24 hours</option><option value="72">3 days</option><option value="168">1 week</option></select></div>
    <label class="row-toggle" style="flex:1;border:0"><span class="rt">Allow multiple answers</span><span class="toggle"><input type="checkbox" name="multi"><span></span></span></label></div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Post</button></div>`, (m, close) => {
    const box = $('.poll-answers', m);
    const add = (v = '') => { if ($$('input', box).length >= 10) return; box.appendChild(h(`<div class="pa-row"><input class="input" maxlength="55" placeholder="Type your answer" value="${esc(v)}"><button class="icon-btn" data-rm title="Remove">${I.trash}</button></div>`)); };
    add(); add();
    box.onclick = (e) => { const b = e.target.closest('[data-rm]'); if (b && $$('input', box).length > 2) b.parentElement.remove(); };
    $('[data-addans]', m).onclick = () => { add(); $$('input', box).pop().focus(); };
    $('[name=q]', m).focus();
    $('[data-ok]', m).onclick = async () => {
      const poll = { question: $('[name=q]', m).value.trim(), answers: $$('input', box).map(i => i.value.trim()).filter(Boolean), hours: Number($('[name=h]', m).value), multi: $('[name=multi]', m).checked };
      if (!poll.question) return toast('Add a question', true);
      if (poll.answers.length < 2) return toast('Add at least 2 answers', true);
      const f = new FormData(); f.append('content', ''); f.append('poll', JSON.stringify(poll)); if (threadId) f.append('thread_id', threadId);
      try { await upload(`/api/channels/${cid}/messages`, f); close(); } catch (e) { toast(e.message, true); }
    };
  });
}
function attachMenu(anchor, comp, cid, threadId) {
  const r = anchor.getBoundingClientRect();
  contextMenu({ clientX: r.left, clientY: r.top - 8, above: true }, [
    [`<span class="mi">${I.upload} Upload a file</span>`, () => $('input[type=file]', comp).click()],
    [`<span class="mi">${I.poll} Create poll</span>`, () => pollModal(cid, threadId)],
  ], 'attach-menu', 200);
}

/* ---------- pins ---------- */
async function pinsPopout(cid, anchor) {
  const L = layer();
  const el = h(`<div class="popout pins-pop"><div class="pp-head">${I.pin} Pinned Messages</div><div class="pp-list"><div class="loader">Loading…</div></div></div>`);
  L.set(el);
  const r = anchor.getBoundingClientRect(); place(el, r.right - 420, r.bottom + 8);
  let pins = [];
  try { pins = await api('GET', `/api/channels/${cid}/pins`); } catch (e) { toast(e.message, true); }
  const sid = findChannel(cid)?.server_id || null;
  const canUnpin = sid ? can(PERM.MANAGE_MESSAGES, sid) : true;
  $('.pp-list', el).innerHTML = pins.length ? pins.map(m => `<div class="pp-item" data-pid="${m.id}">${messageHtml({ ...m, reply: null, thread: null }, sid, null, true)}
      <div class="pp-actions"><button class="btn secondary sm" data-pjump="${m.id}">Jump</button>${canUnpin ? `<button class="icon-btn" data-unpin="${m.id}" title="Unpin">${I.x}</button>` : ''}</div></div>`).join('')
    : `<div class="pp-empty">${I.pin}<b>This channel doesn’t have any pinned messages… yet.</b><span>Right-click a message and choose “Pin message” to keep it here.</span></div>`;
  el.onclick = async (e) => {
    const j = e.target.closest('[data-pjump]'); if (j) { L.close(); return jumpTo(Number(j.dataset.pjump)); }
    const u = e.target.closest('[data-unpin]'); if (u) { try { await api('DELETE', `/api/messages/${u.dataset.unpin}/pin`); u.closest('.pp-item').remove(); } catch (x) { toast(x.message, true); } }
  };
}
function canPinIn(cid) { const ch = findChannel(cid); return ch && (isDM(ch) || can(PERM.MANAGE_MESSAGES, ch.server_id)); }

/* ---------- jump to present ---------- */
function setupJumpBar(box) {
  if (box._jump || box.dataset.key.startsWith('t:')) return; box._jump = true;
  const chat = box.closest('.chat'); if (!chat) return;
  const bar = h(`<div class="jump-bar hidden"><span>You’re viewing older messages</span><button data-jumpnow>Jump to present ${I.chevron}</button></div>`);
  chat.insertBefore(bar, $('.composer', chat));
  const check = () => { const far = box.scrollHeight - box.scrollTop - box.clientHeight > box.clientHeight * 1.2; bar.classList.toggle('hidden', !far); };
  box.addEventListener('scroll', check, { passive: true });
  bar.onclick = () => { box.scrollTo({ top: box.scrollHeight, behavior: Math.abs(box.scrollHeight - box.scrollTop) > 6000 ? 'auto' : 'smooth' }); };
}

/* ---------- quick switcher (Ctrl/Cmd + K) ---------- */
function quickSwitcher() {
  if ($('.qs-modal')) return;
  const items = [];
  S.dms.forEach(d => items.push({ id: d.id, kind: 'dm', name: d.type === 'group' ? (d.name || 'Group chat') : d.user.display_name, sub: d.type === 'group' ? 'Group' : '@' + d.user.username, html: d.type === 'group' ? groupAvatar(d, 's24') : avatar(d.user, 's24'), unread: !!S.unread[d.id] }));
  Object.values(S.serverData).forEach(sd => sd.channels.filter(c => c.type !== 'category').forEach(c => items.push({ id: c.id, kind: c.type, name: c.name, sub: sd.name, html: `<span class="qs-ico">${c.type === 'voice' ? I.speaker : c.private ? I.lock : c.type === 'forum' ? I.forum : I.hash}</span>`, unread: !!S.unread[c.id] })));
  Object.values(S.serverData).forEach(sd => items.push({ id: sd.id, kind: 'server', name: sd.name, sub: 'Server', html: `<span class="qs-srv">${serverIcon(sd)}</span>` }));
  (S.friends.friends || []).forEach(u => { if (!items.find(i => i.kind === 'dm' && i.sub === '@' + u.username)) items.push({ id: u.id, kind: 'friend', name: u.display_name, sub: '@' + u.username, html: avatar(u, 's24') }); });
  const score = (it, q) => { const n = it.name.toLowerCase(), s2 = (it.sub || '').toLowerCase(); if (!q) return it.unread ? 3 : 1; if (n.startsWith(q)) return 10; if (n.includes(q)) return 6; if (s2.includes(q)) return 3; let i = 0; for (const ch of n) if (ch === q[i]) i++; return i === q.length ? 2 : 0; };
  modal(`<div class="qs"><input class="input qs-in" placeholder="Where would you like to go?" autocomplete="off"><div class="qs-list"></div><div class="qs-tip"><b>Tip:</b> start typing a channel, DM, friend or server name · <kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to go</div></div>`, (m, close) => {
    const inp = $('.qs-in', m), list = $('.qs-list', m); let sel = 0, shown = [];
    const draw = () => {
      const q = inp.value.trim().toLowerCase().replace(/^[#@*]/, '');
      shown = items.map(it => [it, score(it, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0]);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      list.innerHTML = shown.length ? shown.map((it, i) => `<button class="qs-item ${i === sel ? 'sel' : ''} ${it.unread ? 'unread' : ''}" data-i="${i}">${it.html}<span class="qs-name">${esc(it.name)}</span><span class="qs-sub">${esc(it.sub || '')}</span></button>`).join('') : `<div class="qs-none">Nothing found for “${esc(inp.value)}”</div>`;
    };
    const go = async (it) => {
      if (!it) return; close();
      if (it.kind === 'server') return selectServer(it.id);
      if (it.kind === 'friend') return openDM(it.id);
      if (it.kind === 'voice') { const c = findChannel(it.id); S.view = { server: c.server_id, channel: c.id }; saveView(); renderRail(); renderSidebar(); renderMain(); return; }
      selectChannel(it.id); showMainMobile();
    };
    inp.oninput = () => { sel = 0; draw(); };
    inp.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length); draw(); $('.qs-item.sel', list)?.scrollIntoView({ block: 'nearest' }); }
      if (e.key === 'Enter') { e.preventDefault(); go(shown[sel]); }
    };
    list.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) go(shown[Number(b.dataset.i)]); };
    draw(); inp.focus();
  }, 'qs-modal');
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && S.me) { e.preventDefault(); quickSwitcher(); }
});

/* ---------- slowmode + timeouts ---------- */
S.slowUntil = S.slowUntil || {};
function myTimeout(sid) { const m = sid && member(sid, S.me.id); return m && m.timeout_until && m.timeout_until > Date.now() ? m.timeout_until : 0; }
function bypassSlow(ch) { return !ch.server_id || can(PERM.MANAGE_MESSAGES, ch.server_id) || can(PERM.MANAGE_CHANNELS, ch.server_id); }
function fmtWait(s) { return s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; }
const SLOW_OPTS = [[0, 'Off'], [5, '5s'], [10, '10s'], [15, '15s'], [30, '30s'], [60, '1m'], [120, '2m'], [300, '5m'], [600, '10m'], [900, '15m'], [1800, '30m'], [3600, '1h'], [7200, '2h'], [21600, '6h']];
function slowLabel(sec) { return (SLOW_OPTS.find(o => o[0] === sec) || [0, fmtWait(sec)])[1]; }
setInterval(() => {
  $$('.composer[data-cid]').forEach(comp => {
    const el = $('.slow-ind', comp); if (!el) return;
    const left = Math.ceil(((S.slowUntil[comp.dataset.cid] || 0) - Date.now()) / 1000);
    el.classList.toggle('waiting', left > 0);
    $('span', el).textContent = left > 0 ? fmtWait(left) : '';
  });
}, 500);
function timeoutModal(sid, uidv) {
  const opts = [[1, '60 seconds'], [5, '5 minutes'], [10, '10 minutes'], [60, '1 hour'], [1440, '1 day'], [10080, '1 week']];
  modal(`<div class="mh" style="text-align:left"><h2>Time out ${esc(nameIn(sid, uidv))}</h2><p>They won’t be able to send messages, react, or join voice until the timeout ends.</p></div>
    <div class="mb"><div class="field"><label>Duration</label><div class="chip-select to-opts">${opts.map(([v, l], i) => `<button data-min="${v}" class="${i === 2 ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field"><label>Reason <span style="color:var(--dim);font-weight:400">(optional, they’ll see it)</span></label><input class="input" name="reason" maxlength="200"></div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn danger" data-ok>Time out</button></div>`, (m, close) => {
    let min = 10;
    $('.to-opts', m).onclick = (e) => { const b = e.target.closest('[data-min]'); if (!b) return; min = Number(b.dataset.min); $$('.to-opts button', m).forEach(x => x.classList.toggle('on', x === b)); };
    $('[data-ok]', m).onclick = async () => { try { await api('PUT', `/api/servers/${sid}/members/${uidv}/timeout`, { minutes: min, reason: $('[name=reason]', m).value }); close(); toast(`${nameIn(sid, uidv)} was timed out`); } catch (e) { toast(e.message, true); } };
  });
}

/* ---------- member rows with banners (servers + group chats) ---------- */
function memBanner(u) { return u && u.banner ? `<span class="mem-banner" style="background-image:url('${esc(u.banner)}')"></span>` : u && u.banner_color ? `<span class="mem-banner" style="background:${esc(u.banner_color)}"></span>` : ''; }
function renderGroupMembers(box, ch) {
  const list = (ch.members || []).map(m => S.users[m.id] || m);
  const online = list.filter(u => statusOf(u.id) !== 'offline'), offline = list.filter(u => statusOf(u.id) === 'offline');
  const row = (u) => `<button class="mem ${statusOf(u.id) === 'offline' ? 'offline' : ''}" data-uid="${u.id}">${memBanner(u)}${avatar(u, 's32', true)}<span class="who"><b style="${nameStyle(u)}">${esc(u.display_name)}${u.id === ch.owner ? `<span class="crown" title="Group owner">${I.crown.replace('width="20" height="20"', 'width="14" height="14"')}</span>` : ''}${badgeHtml(u)}</b>${activityLine(u.id) ? `<small class="act-line">${esc(activityLine(u.id))}</small>` : u.status_text ? `<small>${esc(u.status_text)}</small>` : ''}</span></button>`;
  const by = (a, b) => a.display_name.localeCompare(b.display_name);
  box.innerHTML = (online.length ? `<h4>Online — ${online.length}</h4>${online.sort(by).map(row).join('')}` : '') + (offline.length ? `<h4>Offline — ${offline.length}</h4>${offline.sort(by).map(row).join('')}` : '');
  box.onclick = (e) => { const b = e.target.closest('[data-uid]'); if (b) profilePopout(b.dataset.uid, b, 'left'); };
  box.oncontextmenu = (e) => { const b = e.target.closest('[data-uid]'); if (!b) return; e.preventDefault(); const id = b.dataset.uid;
    contextMenu(e, [['Profile', () => profilePopout(id, null)], id !== S.me.id && ['Message', () => openDM(id)], ['Copy username', () => copy(user(id).username)], ...groupOwnerItems(ch.id, id)]); };
}

/* ---------- group chat owner tools ---------- */
function groupOwnerItems(cid, uidv) {
  const ch = findChannel(cid);
  if (!ch || ch.type !== 'group' || ch.owner !== S.me.id || uidv === S.me.id || !(ch.members || []).some(m => m.id === uidv)) return [];
  const name = esc(user(uidv).display_name);
  return ['-',
    ['Make Group Owner', () => confirmModal('Transfer group ownership', `Make <b>${name}</b> the owner of <b>${esc(ch.name || 'this group')}</b>? You’ll lose the ability to remove people.`, 'Transfer', () => api('PATCH', '/api/groups/' + cid, { owner: uidv }))],
    ['Remove From Group', () => confirmModal('Remove from group', `Remove <b>${name}</b> from <b>${esc(ch.name || 'this group')}</b>? They can only come back if someone adds them again.`, 'Remove', () => api('DELETE', `/api/channels/${cid}/recipients/${uidv}`)), 'danger']];
}

/* ---------- your own profile card (click your name in the bottom-left) ---------- */
async function selfProfilePopout(anchor) {
  try { const u = await api('GET', '/api/users/' + S.me.id); S.me = { ...S.me, ...u }; S.users[S.me.id] = { ...S.users[S.me.id], ...u }; } catch {}
  const u = S.me;
  const st = S.prefs.status;
  const STATUS = [['online', 'Online', 'var(--green)', ''], ['idle', 'Idle', 'var(--yellow)', ''], ['dnd', 'Do Not Disturb', 'var(--red)', 'You won’t get desktop notifications'], ['invisible', 'Invisible', '#80848e', 'You’ll appear offline but still have full access']];
  const cur = STATUS.find(s => s[0] === st) || STATUS[0];
  const L = layer();
  const el = h(`<div class="popout self-pop"><div class="profile-card ${u.theme_primary ? 'themed' : ''} fx-${esc(u.effect || 'none')}" style="${themeStyle(u)}">
      ${bannerHtml(u)}
      <div class="avwrap">${avatar(u, 's80', true).replace(/<i class="st [^>]*><\/i>/, stDot(st))}</div>
      <button class="status-bubble" data-cstatus>${u.status_text ? esc(u.status_text) : `<span class="sb-ph">${I.smile.replace('width="20" height="20"', 'width="14" height="14"')} What’s on your mind?</span>`}</button>
      ${u.effect === 'stars' ? '<div class="fx-layer"></div>' : ''}
      <div class="inner self-inner">
        <div class="dn" style="${nameStyle(u)}">${esc(u.display_name)}</div>
        <div class="un"><span class="un-text">${esc(u.username)}${u.pronouns ? ` <span class="pron">${esc(u.pronouns)}</span>` : ''}</span>${badgeRowHtml(u)}</div>
        ${u.bio ? `<div class="bio self-bio">${formatText(u.bio)}</div>` : ''}
        <div class="activity-slot">${activityHtml(u.id)}</div>
        <div class="self-menu">
          <button data-sm="edit">${I.edit}<span>Edit Profile</span></button>
          <div class="sm-sep"></div>
          <button data-sm="status" class="sm-status"><span class="st-solo">${stDot(st)}</span><span>${cur[1]}</span>${I.chevron}</button>
          <div class="sm-statuses hidden">${STATUS.map(([k, l, c, d]) => `<button data-st="${k}" class="${k === st ? 'on' : ''}"><span class="st-solo">${stDot(k)}</span><span>${l}${d ? `<small>${d}</small>` : ''}</span></button>`).join('')}</div>
          <div class="sm-sep"></div>
          <button data-sm="copy">${I.copy}<span>Copy User ID</span></button>
          <button data-sm="activity">${I.gamepad}<span>${S.prefs.customActivity ? 'Change activity' : 'Set activity'}</span></button>
          <button data-sm="settings">${I.gear}<span>User Settings</span></button>
          ${Install.canOffer() ? `<button data-sm="install">${I.download}<span>Install Orbit app</span></button>` : ''}
          <button data-sm="apps">${I.external}<span>Download apps</span></button>
        </div>
        <div class="self-menu"><button data-sm="logout" class="danger">${I.logout}<span>Log Out</span></button></div>
      </div></div></div>`);
  L.set(el);
  const r = anchor.getBoundingClientRect(); place(el, r.left - 4, r.top - 10, { above: true });
  el.onclick = (e) => {
    const a = e.target.closest('[data-sm]')?.dataset.sm;
    if (e.target.closest('[data-cstatus]')) { L.close(); return customStatusModal(); }
    if (a === 'activity') { L.close(); return activityModal(); }
    if (a === 'edit') { L.close(); openUserSettings('profile'); }
    if (a === 'settings') { L.close(); openUserSettings(); }
    if (a === 'copy') { L.close(); copy(S.me.id); }
    if (a === 'logout') { L.close(); logout(); }
    if (a === 'install') { L.close(); showInstallSheet(); }
    if (a === 'apps') { L.close(); window.orbitDesktop ? (location.origin && window.open(location.origin + '/download', '_blank')) : window.open('/download', '_blank'); }
    if (a === 'status') { $('.sm-statuses', el).classList.toggle('hidden'); $('.sm-status', el).classList.toggle('open'); }
    const sb = e.target.closest('[data-st]');
    if (sb) { S.prefs.status = sb.dataset.st; savePrefs(); socket.emit('presence', sb.dataset.st); renderUserPanel(); softRefresh(); L.close(); }
  };
}

/* ---------- server emoji settings tab ---------- */
function srvEmojis(body, sid) {
  const draw = () => {
    const sd = S.serverData[sid]; const list = sd.emojis || [];
    body.innerHTML = `<h2>Emoji</h2><p class="hint">Add up to 100 custom emojis that anyone in this server can use in messages and reactions. PNG, GIF, JPG or WebP, under 512 KB. Names can use letters, numbers and underscores.</p>
      <div class="emoji-up"><button class="btn primary" data-up>${I.upload} Upload Emoji</button><span class="hint" style="margin:0">${list.length} / 100</span><input type="file" accept="image/png,image/gif,image/jpeg,image/webp" multiple hidden></div>
      ${list.length ? `<div class="emoji-table"><div class="et-h"><span>Image</span><span>Name</span><span></span></div>${list.map(e => `<div class="et-row" data-eid="${e.id}"><img src="${esc(e.url)}" alt=""><input class="input" value="${esc(e.name)}" maxlength="32" data-ename><button class="icon-btn danger" data-edel title="Delete">${I.trash}</button></div>`).join('')}</div>`
        : `<div class="empty"><b>No emojis yet</b><span>Upload one to get started. They show up in everyone’s emoji picker.</span></div>`}`;
    const file = $('input[type=file]', body);
    $('[data-up]', body).onclick = () => file.click();
    file.onchange = async () => {
      for (const f of file.files) { const fd = new FormData(); fd.append('file', f); fd.append('name', f.name.replace(/\.[^.]+$/, ''));
        try { const em = await upload(`/api/servers/${sid}/emojis`, fd); (S.serverData[sid].emojis = S.serverData[sid].emojis || []).push(em); } catch (e) { toast(`${f.name}: ${e.message}`, true); } }
      file.value = ''; draw();
    };
    body.onchange = async (e) => { const inp = e.target.closest('[data-ename]'); if (!inp) return; const id = inp.closest('[data-eid]').dataset.eid;
      try { await api('PATCH', '/api/emojis/' + id, { name: inp.value }); const em = S.serverData[sid].emojis.find(x => x.id === id); if (em) em.name = inp.value.replace(/[^\w]/g, '_'); toast('Saved'); } catch (x) { toast(x.message, true); } };
    body.onclick = (e) => { const d = e.target.closest('[data-edel]'); if (!d) return; const id = d.closest('[data-eid]').dataset.eid;
      confirmModal('Delete emoji', 'Messages that used it will show its name instead.', 'Delete', async () => { await api('DELETE', '/api/emojis/' + id); S.serverData[sid].emojis = S.serverData[sid].emojis.filter(x => x.id !== id); draw(); }); };
  };
  draw();
}

/* turn :name: into <:name:id> using emojis you have access to (this server's first) */
function resolveEmojiText(content, sid) {
  const list = myEmojis(); if (!list.length) return content;
  const pick = (n) => list.find(e => e.name === n && e.sid === sid) || list.find(e => e.name === n);
  return content.replace(/```[\s\S]*?```|`[^`\n]+`|<:\w+:[\w-]+>|(^|[^\w<]):(\w{2,32}):/g, (m, pre, n) => { if (!n) return m; const e = pick(n); return e ? `${pre}<:${e.name}:${e.id}>` : m; });
}

/* ---------- "Install Orbit" banner for phones (home-screen app) ---------- */
const Install = {
  deferred: null,
  standalone: () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true || !!window.orbitDesktop,
  ios: () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1),
  iosSafari: () => Install.ios() && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|Instagram|FBAN|FBAV|Snapchat|Discord|Line\//.test(navigator.userAgent),
  mobile: () => Install.ios() || /Android/.test(navigator.userAgent) || matchMedia('(pointer:coarse) and (max-width: 900px)').matches,
  snoozed: () => { try { return Date.now() < Number(localStorage.getItem('orbit-install-snooze') || 0); } catch { return false; } },
  snooze: (days) => { try { localStorage.setItem('orbit-install-snooze', String(Date.now() + days * 864e5)); } catch {} },
  canOffer: () => !Install.standalone() && Install.mobile() && (Install.ios() || !!Install.deferred),
};
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); Install.deferred = e; maybeShowInstall(); });
window.addEventListener('appinstalled', () => { Install.deferred = null; $('.install-sheet')?.remove(); toast('Orbit is installed! Open it from your home screen.'); });
function maybeShowInstall() { if (Install.canOffer() && !Install.snoozed() && !$('.install-sheet')) setTimeout(() => { if (!$('.install-sheet') && !$('.modal-wrap')) showInstallSheet(); }, 1800); }
function showInstallSheet() {
  $('.install-sheet')?.remove();
  const shareIco = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>`;
  const addIco = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>`;
  const head = `<div class="is-head"><img src="/icon-192.png" alt=""><div><b>Get the Orbit app</b><span>Full screen, its own icon, and it updates by itself.</span></div><button class="icon-btn" data-isclose title="Close">${I.x}</button></div>`;
  let body;
  if (Install.ios() && !Install.iosSafari()) {
    body = `<p class="is-note">To install Orbit on iPhone, open this page in <b>Safari</b>.</p>
      <div class="is-actions"><button class="btn primary block" data-iscopy>${I.copy} Copy link, then paste it in Safari</button></div>`;
  } else if (Install.ios()) {
    body = `<ol class="is-steps">
        <li><span class="is-n">1</span><span>Tap the <b>Share</b> button <span class="is-chip">${shareIco}</span> in Safari’s toolbar <small>(on newer iPhones, tap <b>•••</b> first, then <b>Share</b>)</small></span></li>
        <li><span class="is-n">2</span><span>Scroll down and tap <b>Add to Home Screen</b> <span class="is-chip">${addIco}</span></span></li>
        <li><span class="is-n">3</span><span>Tap <b>Add</b>, then open <b>Orbit</b> from your home screen</span></li>
      </ol><p class="is-note">You’ll log in once inside the app.</p><div class="is-arrow" aria-hidden="true">${I.chevron}</div>`;
  } else {
    body = `<div class="is-actions"><button class="btn primary block" data-isinstall>${I.download} Install Orbit</button></div>`;
  }
  const el = h(`<div class="install-sheet" role="dialog" aria-label="Install Orbit">${head}${body}<button class="is-later" data-islater>Not now</button></div>`);
  document.body.appendChild(el);
  el.onclick = async (e) => {
    if (e.target.closest('[data-isclose]') || e.target.closest('[data-islater]')) { Install.snooze(e.target.closest('[data-islater]') ? 7 : 2); el.remove(); }
    if (e.target.closest('[data-iscopy]')) copy(location.origin);
    if (e.target.closest('[data-isinstall]') && Install.deferred) {
      const d = Install.deferred; Install.deferred = null;
      d.prompt(); const r = await d.userChoice.catch(() => null);
      el.remove(); if (!r || r.outcome !== 'accepted') Install.snooze(3);
    }
  };
}
window.addEventListener('load', maybeShowInstall);

/* ---------- touch screens: message action sheet (press and hold a message) ---------- */
function touchUI() { return matchMedia('(hover: none) and (pointer: coarse)').matches; }
function messageSheet(m, items, msgEl) {
  const L = layer(() => msgEl?.classList.remove('sheet-target'));
  const list = items.filter(Boolean);
  const el = h(`<div class="msg-sheet" role="dialog" aria-label="Message actions">
    <div class="ms-grab"></div>
    <div class="ms-reacts">${QUICK_REACTS.map(e => `<button data-q="${e}" class="${(m.reactions?.[e] || []).includes(S.me.id) ? 'on' : ''}">${e}</button>`).join('')}<button data-more title="More reactions">${I.smile}</button></div>
    <div class="ms-list">${list.map((it, i) => it === '-' ? '<div class="ms-sep"></div>' : `<button data-i="${i}" class="${it[2] || ''}">${esc(it[0].replace(/<[^>]+>/g, '').trim())}</button>`).join('')}</div>
    <button class="ms-cancel" data-cancel>Cancel</button></div>`);
  L.set(el);
  msgEl?.classList.add('sheet-target');
  const close = () => L.close();
  el.onclick = (e) => {
    if (e.target.closest('[data-cancel]')) return close();
    const q = e.target.closest('[data-q]'); if (q) { close(); return toggleReaction(m.id, q.dataset.q); }
    if (e.target.closest('[data-more]')) { close(); return emojiPicker(msgEl || document.body, (em) => toggleReaction(m.id, em)); }
    const b = e.target.closest('[data-i]'); if (b) { close(); list[Number(b.dataset.i)][1](); }
  };
  // swipe the sheet down to dismiss
  let y0 = null;
  el.addEventListener('touchstart', (e) => { if (el.scrollTop <= 0) y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', (e) => { if (y0 == null) return; const d = e.touches[0].clientY - y0; if (d > 0) el.style.transform = `translateY(${d}px)`; }, { passive: true });
  el.addEventListener('touchend', (e) => { if (y0 == null) return; const d = (e.changedTouches[0].clientY - y0); y0 = null; if (d > 90) close(); else el.style.transform = ''; });
}

/* ---------- accessibility: every icon-only control gets a spoken name ---------- */
// Buttons that only show an icon get their tooltip (title / data-tip) as an aria-label, rail servers
// and DM bubbles are announced by name, and unread badges say what they count.
function a11yPass(root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('button, [role="button"], a.icon-btn').forEach(b => {
    if (b.hasAttribute('aria-label')) return;
    const name = b.getAttribute('title') || b.closest('[data-tip]')?.getAttribute('data-tip');
    if (name && !b.textContent.trim()) b.setAttribute('aria-label', name);
    else if (name && b.closest('.rail-item')) b.setAttribute('aria-label', name);
  });
  root.querySelectorAll('.badge:not([aria-label])').forEach(bd => { const n = bd.textContent.trim(); if (n) bd.setAttribute('aria-label', `${n} unread`); });
  root.querySelectorAll('.tile[data-tile]:not([aria-label])').forEach(t => t.setAttribute('aria-label', t.querySelector('.ln')?.textContent || 'Participant'));
}
new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach(n => n.nodeType === 1 && a11yPass(n)); }).observe(document.documentElement, { childList: true, subtree: true });
a11yPass(document);

/* ================= 1.15: categories, inbox, stickers, voice messages, search filters ================= */

/* ---------- channel categories ---------- */
const byPos = (a, b) => (a.position - b.position) || String(a.created).localeCompare(String(b.created));
function channelTree(sd) {
  const cats = sd.channels.filter(c => c.type === 'category').sort(byPos);
  const ids = new Set(cats.map(c => c.id));
  const kids = (pid) => sd.channels.filter(c => c.type !== 'category' && ((c.parent_id && ids.has(c.parent_id) ? c.parent_id : null) === pid))
    .sort((a, b) => ((a.type === 'voice') - (b.type === 'voice')) || byPos(a, b));
  return { loose: kids(null), cats: cats.map(c => ({ cat: c, list: kids(c.id) })) };
}
function channelTreeHtml(sd, chanBtn) {
  const tree = channelTree(sd), manage = can(PERM.MANAGE_CHANNELS, sd.id);
  const showWhenCollapsed = (c) => S.view.channel === c.id || Voice.channel === c.id || (S.unread[c.id] && !isMuted(c.id)) || (c.type === 'voice' && (S.voice[c.id] || []).length);
  let html = tree.loose.map(chanBtn).join('');
  for (const { cat, list } of tree.cats) {
    const col = isCollapsed(cat.id);
    html += `<div class="cat ${col ? 'collapsed' : ''}" data-collapse="${cat.id}" data-cat="${cat.id}" ${manage ? 'draggable="true"' : ''}><span>${I.chevron}${esc(cat.name)}</span>${manage ? `<button data-new="text" data-parent="${cat.id}" title="Create channel in ${esc(cat.name)}">+</button>` : ''}</div>`;
    html += list.filter(c => !col || showWhenCollapsed(c)).map(chanBtn).join('');
    if (!list.length && manage && !col) html += `<div class="cat-empty" data-cat-drop="${cat.id}">Drag channels here</div>`;
  }
  return html;
}
// drag & drop: drop a channel on a channel (goes before/after it), on a category header (goes to the top
// of that category) or on the empty space; drag a category header to reorder categories
function bindChannelDnD(side, sd) {
  const list = $('.side-list', side); if (!list) return;
  let drag = null;
  const clear = () => $$('.drop-before,.drop-after,.drop-into', list).forEach(x => x.classList.remove('drop-before', 'drop-after', 'drop-into'));
  list.ondragstart = (e) => {
    const el = e.target.closest('[data-ch],[data-cat]'); if (!el) return;
    drag = el.dataset.cat ? { id: el.dataset.cat, cat: true } : { id: el.dataset.ch, cat: false };
    e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', drag.id);
    el.classList.add('dragging');
  };
  list.ondragend = () => { $$('.dragging', list).forEach(x => x.classList.remove('dragging')); clear(); drag = null; };
  const targetOf = (e) => {
    const t = e.target.closest('[data-ch],[data-cat],[data-cat-drop]'); if (!t || !drag) return null;
    const r = t.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    if (drag.cat) { const c = t.closest('[data-cat]') || (t.dataset.ch && $(`[data-cat="${findChannel(t.dataset.ch)?.parent_id}"]`, list)); return c ? { el: c, kind: 'cat', id: c.dataset.cat, after } : null; }
    if (t.dataset.catDrop) return { el: t, kind: 'into', id: t.dataset.catDrop };
    if (t.dataset.cat) return { el: t, kind: 'into', id: t.dataset.cat };
    return t.dataset.ch === drag.id ? null : { el: t, kind: 'ch', id: t.dataset.ch, after };
  };
  list.ondragover = (e) => { const tg = targetOf(e); if (!tg) return; e.preventDefault(); clear(); tg.el.classList.add(tg.kind === 'into' ? 'drop-into' : tg.after ? 'drop-after' : 'drop-before'); };
  list.ondragleave = (e) => { if (!list.contains(e.relatedTarget)) clear(); };
  list.ondrop = async (e) => {
    const tg = targetOf(e); clear(); if (!tg || !drag) return; e.preventDefault();
    const tree = channelTree(sd);
    let order;   // [{id, parent_id}] in final order
    if (drag.cat) {
      const cats = tree.cats.map(x => x.cat.id).filter(id => id !== drag.id);
      let i = cats.indexOf(tg.id); if (i < 0) return; if (tg.after) i++;
      cats.splice(i, 0, drag.id);
      order = [...tree.loose.map(c => ({ id: c.id, parent_id: null })), ...cats.flatMap(cid => [{ id: cid, parent_id: null }, ...tree.cats.find(x => x.cat.id === cid).list.map(c => ({ id: c.id, parent_id: cid }))])];
    } else {
      const groups = [{ id: null, list: tree.loose.map(c => c.id) }, ...tree.cats.map(x => ({ id: x.cat.id, list: x.list.map(c => c.id) }))];
      groups.forEach(g => (g.list = g.list.filter(id => id !== drag.id)));
      if (tg.kind === 'into') groups.find(g => g.id === tg.id).list.unshift(drag.id);
      else { const tgt = findChannel(tg.id); const pid = tree.cats.some(x => x.cat.id === tgt.parent_id) ? tgt.parent_id : null; const g = groups.find(g => g.id === pid); let i = g.list.indexOf(tg.id); if (tg.after) i++; g.list.splice(i, 0, drag.id); }
      order = groups.flatMap(g => [...(g.id ? [{ id: g.id, parent_id: null }] : []), ...g.list.map(id => ({ id, parent_id: g.id }))]);
    }
    const body = order.map((o, i) => ({ id: o.id, parent_id: o.parent_id, position: i }));
    // show it right away, then save
    body.forEach(o => { const c = sd.channels.find(x => x.id === o.id); if (c) { c.position = o.position; if (c.type !== 'category') c.parent_id = o.parent_id; } });
    renderSidebar();
    try { await api('PUT', `/api/servers/${sd.id}/channels/order`, body); } catch (x) { toast(x.message, true); await fetchServer(sd.id); renderSidebar(); }
  };
}
function createCategoryModal(sid) {
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>Create Category</h2><p>Group channels together. Drag channels into it afterwards.</p></div>
    <div class="mb"><div class="field"><label>Category name</label><input class="input" name="name" maxlength="40" placeholder="New Category"></div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Create Category</button></div>`, (m, close) => {
    const go = async () => { const name = $('[name=name]', m).value.trim(); if (!name) return; try { await api('POST', `/api/servers/${sid}/channels`, { name, type: 'category' }); await fetchServer(sid); close(); renderSidebar(); } catch (e) { toast(e.message, true); } };
    $('[data-ok]', m).onclick = go; $('[name=name]', m).onkeydown = (e) => e.key === 'Enter' && go(); $('[name=name]', m).focus();
  });
}
function categoryMenu(e, catId) {
  const c = findChannel(catId); if (!c) return; const sid = c.server_id; const manage = can(PERM.MANAGE_CHANNELS, sid);
  contextMenu(e, [
    [isCollapsed(catId) ? 'Expand category' : 'Collapse category', () => toggleCollapsed(catId)],
    ['Collapse all categories', () => { S.prefs.collapsed = S.prefs.collapsed || {}; S.serverData[sid].channels.filter(x => x.type === 'category').forEach(x => (S.prefs.collapsed[x.id] = 1)); savePrefs(); renderSidebar(); }],
    manage && '-', manage && ['Create channel here', () => createChannelModal('text', catId)],
    manage && ['Rename category', () => renameCategoryModal(c)],
    manage && ['Delete category', () => confirmModal('Delete category', `Delete <b>${esc(c.name)}</b>? Its channels aren’t deleted. They move to the top of the list.`, 'Delete', () => api('DELETE', '/api/channels/' + catId)), 'danger'],
  ]);
}
function renameCategoryModal(c) {
  modal(`<div class="mh" style="text-align:left"><h2>Rename category</h2></div><div class="mb"><input class="input" name="name" maxlength="40" value="${esc(c.name)}"></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, (m, close) => {
    const go = async () => { try { await api('PATCH', '/api/channels/' + c.id, { name: $('[name=name]', m).value }); close(); } catch (e) { toast(e.message, true); } };
    $('[data-ok]', m).onclick = go; $('[name=name]', m).onkeydown = (e) => e.key === 'Enter' && go(); $('[name=name]', m).select();
  });
}

/* ---------- inbox ---------- */
async function checkInbox() {
  try { const [top] = await api('GET', '/api/inbox?limit=1'); if (top && top.id > (S.prefs.inboxSeen || 0)) { S.inboxUnread = true; $('.inbox-btn')?.classList.add('has-new'); } } catch {}
}
async function inboxPopout(anchor) {
  S.inboxUnread = false; $('.inbox-btn')?.classList.remove('has-new');
  const L = layer();
  const el = h(`<div class="popout inbox-pop"><div class="pp-head">${I.inbox} Inbox <span class="ib-sub">Mentions and replies from the last 60 days</span></div><div class="pp-list"><div class="loader">Loading…</div></div></div>`);
  L.set(el);
  const r = anchor.getBoundingClientRect(); place(el, r.right - 440, r.bottom + 8);
  let rows = [];
  try { rows = await api('GET', '/api/inbox'); } catch (e) { toast(e.message, true); }
  if (rows[0]) { S.prefs.inboxSeen = Math.max(S.prefs.inboxSeen || 0, rows[0].id); savePrefs(); }
  const where = (m) => { const ch = findChannel(m.channel_id); if (!ch) return ''; return ch.type === 'dm' ? `@${ch.name}` : ch.type === 'group' ? ch.name : `#${ch.name} · ${S.serverData[ch.server_id]?.name || ''}`; };
  $('.pp-list', el).innerHTML = rows.length ? rows.map(m => { const sid = findChannel(m.channel_id)?.server_id || null;
      return `<div class="pp-item ib-item" data-go="${m.id}" data-cid="${m.channel_id}" data-thread="${m.thread_id || ''}"><div class="ib-where">${esc(where(m))}</div>${messageHtml({ ...m, thread: null }, sid, null, true)}
        <div class="pp-actions"><button class="btn secondary sm" data-go-btn>Jump</button></div></div>`; }).join('')
    : `<div class="pp-empty">${I.inbox}<b>You’re all caught up</b><span>When someone @mentions you or replies to you, it shows up here.</span></div>`;
  el.onclick = (e) => { const it = e.target.closest('[data-go]'); if (!it || e.target.closest('a')) return; L.close(); goToMessage(it.dataset.cid, Number(it.dataset.go), Number(it.dataset.thread) || null); };
}
async function goToMessage(cid, mid, threadId) {
  if (S.view.channel !== cid) { selectChannel(cid); showMainMobile(); }
  if (threadId) {   // a reply inside a thread / forum post: open that thread, then find the reply there
    try { const parent = await api('GET', '/api/messages/' + threadId); await openThread(parent); } catch (e) { return toast('That thread was deleted', true); }
    for (let i = 0; i < 20; i++) { const el = $(`.thread-panel [data-mid="${mid}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('highlight'); setTimeout(() => el.classList.remove('highlight'), 1600); return; } await new Promise(r => setTimeout(r, 150)); }
    return;
  }
  if (findChannel(cid)?.type === 'forum') { const m = (S.messages[cid] || []).find(x => x.id === mid); if (m) return openThread(m); try { return openThread(await api('GET', '/api/messages/' + mid)); } catch { return; } }
  for (let i = 0; i < 20; i++) { if ($(`.messages [data-mid="${mid}"]`)) break; await new Promise(r => setTimeout(r, 150)); }
  jumpTo(mid);
}

/* ---------- stickers ---------- */
function myStickers() { const out = []; for (const sd of Object.values(S.serverData)) (sd.stickers || []).forEach(s => out.push({ ...s, server: sd.name, sid: sd.id })); return out; }
function stickerPicker(anchor, cid, threadId, state, comp) {
  const L = layer();
  const by = {}; myStickers().forEach(s => (by[s.server] = by[s.server] || []).push(s));
  const el = h(`<div class="popout sticker-picker"><input class="input" placeholder="Search stickers"><div class="sp-grid2">${Object.entries(by).map(([srv, list]) => `<h6>${esc(srv)}</h6>` + list.map(s => `<button data-st="${esc(s.id)}" data-n="${esc(s.name.toLowerCase())}" title="${esc(s.name)}"><img src="${esc(s.url)}" alt="${esc(s.name)}" loading="lazy"></button>`).join('')).join('')}</div></div>`);
  L.set(el);
  const r = anchor.getBoundingClientRect(); place(el, r.right - 360, r.top - 8, { above: true });
  $('input', el).oninput = (e) => { const q = e.target.value.toLowerCase(); $$('[data-st]', el).forEach(b => b.classList.toggle('hidden', !!q && !b.dataset.n.includes(q))); };
  el.onclick = async (e) => {
    const b = e.target.closest('[data-st]'); if (!b) return; L.close();
    const f = new FormData(); f.append('content', ''); f.append('sticker', b.dataset.st);
    if (threadId) f.append('thread_id', threadId);
    if (state.reply) { f.append('reply_to', state.reply.id); f.append('mention_reply', String(state.mentionReply)); comp._setReply(null); }
    try { await upload(`/api/channels/${cid}/messages`, f); } catch (x) { toast(x.message, true); }
  };
  if (window.innerWidth > 760) $('input', el).focus();
}
function srvStickers(body, sid) {
  const draw = () => {
    const list = S.serverData[sid].stickers || [];
    body.innerHTML = `<h2>Stickers</h2><p class="hint">Up to 30 stickers anyone in this server can send. PNG, GIF, APNG, WebP or JPG under 512 KB. Square images around 320×320 look best.</p>
      <div class="emoji-up"><button class="btn primary" data-up>${I.upload} Upload Sticker</button><span class="hint" style="margin:0">${list.length} / 30</span><input type="file" accept="image/png,image/gif,image/apng,image/webp,image/jpeg" multiple hidden></div>
      ${list.length ? `<div class="sticker-grid">${list.map(s => `<div class="sg-item" data-sid="${s.id}"><img src="${esc(s.url)}" alt=""><input class="input" value="${esc(s.name)}" maxlength="30" data-sname><button class="icon-btn danger" data-sdel title="Delete">${I.trash}</button></div>`).join('')}</div>`
        : `<div class="empty"><b>No stickers yet</b><span>Upload one to get started. They show up in everyone’s sticker picker.</span></div>`}`;
    const file = $('input[type=file]', body);
    $('[data-up]', body).onclick = () => file.click();
    file.onchange = async () => { for (const f of file.files) { const fd = new FormData(); fd.append('file', f); fd.append('name', f.name.replace(/\.[^.]+$/, ''));
      try { const st = await upload(`/api/servers/${sid}/stickers`, fd); (S.serverData[sid].stickers = S.serverData[sid].stickers || []).push(st); } catch (e) { toast(`${f.name}: ${e.message}`, true); } } file.value = ''; draw(); };
    body.onchange = async (e) => { const inp = e.target.closest('[data-sname]'); if (!inp) return; const id = inp.closest('[data-sid]').dataset.sid;
      try { await api('PATCH', '/api/stickers/' + id, { name: inp.value }); const s = S.serverData[sid].stickers.find(x => x.id === id); if (s) s.name = inp.value.trim(); toast('Saved'); } catch (x) { toast(x.message, true); } };
    body.onclick = (e) => { const d = e.target.closest('[data-sdel]'); if (!d) return; const id = d.closest('[data-sid]').dataset.sid;
      confirmModal('Delete sticker', 'Messages that already used it keep showing it.', 'Delete', async () => { await api('DELETE', '/api/stickers/' + id); S.serverData[sid].stickers = S.serverData[sid].stickers.filter(x => x.id !== id); draw(); }); };
  };
  draw();
}

/* ---------- voice messages ---------- */
const fmtDur = (s) => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function voiceMsgHtml(a) {
  const wf = (a.waveform && a.waveform.length ? a.waveform : Array.from({ length: 40 }, () => 30));
  return `<div class="voice-msg" data-vurl="${esc(a.url)}" data-dur="${Number(a.duration) || 0}">
    <button class="vm-play" aria-label="Play voice message">${I.play}</button>
    <div class="vm-wave" aria-hidden="true">${wf.map(v => `<i style="height:${Math.max(12, v)}%"></i>`).join('')}</div>
    <span class="vm-time">${fmtDur(a.duration || 0)}</span></div>`;
}
const voicePlayers = {};
function voiceMsgAction(el, e) {
  const url = el.dataset.vurl; let a = voicePlayers[url];
  const bars = $$('.vm-wave i', el), time = $('.vm-time', el), btn = $('.vm-play', el), dur = () => (isFinite(a.duration) && a.duration > 0 ? a.duration : Number(el.dataset.dur) || 1);
  const paint = () => { const p = a.currentTime / dur(); $$(`.voice-msg[data-vurl="${CSS.escape(url)}"]`).forEach(box => { const bs = $$('.vm-wave i', box); bs.forEach((b, i) => b.classList.toggle('on', i / bs.length < p)); $('.vm-time', box).textContent = fmtDur(a.paused && !a.currentTime ? dur() : a.currentTime); $('.vm-play', box).innerHTML = a.paused ? I.play : I.pause; }); };
  if (!a) { a = voicePlayers[url] = new Audio(url); a.preload = 'auto'; a.ontimeupdate = paint; a.onplay = paint; a.onpause = paint; a.onended = () => { a.currentTime = 0; paint(); }; if (S.prefs.speaker && a.setSinkId) a.setSinkId(S.prefs.speaker).catch(() => {}); }
  const wave = e.target.closest('.vm-wave');
  if (wave) { const r = wave.getBoundingClientRect(); a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur(); if (a.paused) a.play().catch(() => {}); paint(); return; }
  if (!e.target.closest('.vm-play')) return;   // only the play/pause button plays or pauses
  Object.entries(voicePlayers).forEach(([u, p]) => { if (u !== url && !p.paused) p.pause(); });
  if (a.paused) a.play().catch(() => toast('Couldn’t play that voice message', true)); else a.pause();
}
async function startVoiceRecording(comp, cid, threadId, state) {
  if ($('.rec-bar', comp)) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, deviceId: S.prefs.mic ? { ideal: S.prefs.mic } : undefined } }); }
  catch (e) { return toast(typeof mediaError === 'function' ? mediaError(e, 'microphone') : 'Couldn’t use your microphone', true); }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 64000 } : undefined);
  const chunks = [], levels = []; let cancelled = false; const t0 = Date.now();
  const ctx = new (window.AudioContext || window.webkitAudioContext)(); ctx.resume?.().catch(() => {}); const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an); const buf = new Uint8Array(an.fftSize);
  const bar = h(`<div class="rec-bar"><button class="icon-btn danger" data-rcancel title="Delete recording">${I.trash}</button><span class="rec-dot"></span><span class="rec-time">0:00</span><div class="rec-wave"></div><button class="send-btn ready" data-rsend title="Send voice message">${I.arrow}</button></div>`);
  $('.cbox', comp).classList.add('recording'); $('.cbox', comp).appendChild(bar);
  const wave = $('.rec-wave', bar);
  const tick = setInterval(() => {
    an.getByteTimeDomainData(buf); let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
    const lvl = Math.min(100, Math.round(peak / 128 * 160)); levels.push(lvl);
    wave.appendChild(h(`<i style="height:${Math.max(10, lvl)}%"></i>`)); while (wave.children.length > 60) wave.firstChild.remove();
    const s = (Date.now() - t0) / 1000; $('.rec-time', bar).textContent = fmtDur(s);
    if (s >= 600) stop(true);
  }, 100);
  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  const finish = () => { clearInterval(tick); stream.getTracks().forEach(t => t.stop()); ctx.close().catch(() => {}); bar.remove(); $('.cbox', comp)?.classList.remove('recording'); };
  rec.onstop = async () => {
    finish(); if (cancelled || !chunks.length) return;
    const duration = (Date.now() - t0) / 1000; if (duration < 0.6) return toast('Hold on a little longer to record a voice message');
    const mime = rec.mimeType || type || 'audio/webm';
    const blob = new Blob(chunks, { type: mime.split(';')[0] });
    const ext = /mp4/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : 'webm';
    // squeeze the levels into 48 bars, scaled so the loudest bar is full height
    const n = 48, out = []; for (let i = 0; i < n; i++) { const a = Math.floor(i * levels.length / n), b = Math.max(a + 1, Math.floor((i + 1) * levels.length / n)); out.push(Math.max(...levels.slice(a, b), 0)); }
    const mx = Math.max(10, ...out); const waveform = out.map(v => Math.round(v / mx * 100));
    const f = new FormData(); f.append('content', ''); f.append('files', new File([blob], `voice-message.${ext}`, { type: blob.type }));
    f.append('voice', JSON.stringify({ duration, waveform })); if (threadId) f.append('thread_id', threadId);
    if (state.reply) { f.append('reply_to', state.reply.id); f.append('mention_reply', String(state.mentionReply)); comp._setReply(null); }
    try { await upload(`/api/channels/${cid}/messages`, f); } catch (x) { toast(x.message, true); }
  };
  const stop = (send) => { if (rec.state === 'inactive') return; cancelled = !send; rec.stop(); };
  bar.onclick = (e) => { if (e.target.closest('[data-rcancel]')) stop(false); if (e.target.closest('[data-rsend]')) stop(true); };
  const key = (e) => { if (!bar.isConnected) return document.removeEventListener('keydown', key); if (e.key === 'Escape') stop(false); if (e.key === 'Enter') { e.preventDefault(); stop(true); } };
  document.addEventListener('keydown', key);
  rec.start(250);
}

/* ---------- search with filters ---------- */
const SEARCH_FILTERS = [
  ['from:', 'user', 'Messages from a person'], ['mentions:', 'user', 'Messages that mention a person'], ['has:', 'link, image, video, file, voice, poll, sticker', 'Messages that contain something'],
  ['in:', 'channel', 'Messages in a channel'], ['before:', 'date', 'Before a date (YYYY-MM-DD)'], ['after:', 'date', 'After a date'], ['during:', 'date', 'On a specific day'], ['pinned:', 'true', 'Only pinned messages'],
];
const HAS_OPTS = ['link', 'image', 'video', 'file', 'audio', 'voice', 'poll', 'sticker', 'embed'];
function parseDay(v) { const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v) || /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v); if (!m) return null; const [y, mo, d] = m[1].length === 4 ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]]; const t = new Date(Number(y), Number(mo) - 1, Number(d)).getTime(); return isNaN(t) ? null : t; }
function parseSearch(raw, ch) {
  const q = { text: [], has: [] }; const errs = [];
  raw.replace(/(\w+):("[^"]*"|\S+)|("[^"]*"|\S+)/g, (_, k, v, plain) => {
    if (!k) { q.text.push(plain.replace(/^"|"$/g, '')); return ''; }
    v = v.replace(/^"|"$/g, ''); k = k.toLowerCase();
    if (k === 'from' || k === 'mentions') q[k] = v.replace(/^@/, '');
    else if (k === 'has') v.split(',').forEach(x => HAS_OPTS.includes(x) ? q.has.push(x) : errs.push(`has:${x}`));
    else if (k === 'in') { const name = v.replace(/^#/, '').toLowerCase(); const c = ch.server_id && S.serverData[ch.server_id].channels.find(x => (x.type === 'text' || x.type === 'forum') && x.name.toLowerCase() === name); c ? (q.in = c.id) : errs.push(`in:${v}`); }
    else if (k === 'before' || k === 'after' || k === 'during') { const t = parseDay(v); if (t == null) errs.push(`${k}:${v}`); else if (k === 'during') { q.after = t; q.before = t + 864e5; } else q[k] = k === 'after' ? t + 864e5 : t; }
    else if (k === 'pinned') q.pinned = v === 'true' || v === 'yes';
    else q.text.push(`${k}:${v}`);
    return '';
  });
  return { q, errs };
}
function bindSearchBox(input, ch) {
  let pop = null;
  const close = () => { pop?.remove(); pop = null; };
  const show = () => {
    close();
    const val = input.value, word = val.slice(0, input.selectionStart).split(/\s/).pop();
    let items = [];
    const fm = /^(from|mentions):(.*)$/i.exec(word), hm = /^has:(.*)$/i.exec(word), im = /^in:#?(.*)$/i.exec(word);
    if (fm) { const pool = ch.server_id ? S.serverData[ch.server_id].members : (ch.members || [S.me, ch.user].filter(Boolean)); items = pool.filter(u => (u.username || '').toLowerCase().startsWith(fm[2].toLowerCase()) || (u.display_name || '').toLowerCase().startsWith(fm[2].toLowerCase())).slice(0, 8).map(u => [`${fm[1]}:${u.username} `, `${avatar(S.users[u.id] || u, 's24')}<b>${esc(u.display_name || u.username)}</b><small>@${esc(u.username)}</small>`]); }
    else if (hm) items = HAS_OPTS.filter(x => x.startsWith(hm[1].toLowerCase())).map(x => [`has:${x} `, `<b>has:</b>${x}`]);
    else if (im && ch.server_id) items = S.serverData[ch.server_id].channels.filter(c => (c.type === 'text' || c.type === 'forum') && c.name.startsWith(im[1].toLowerCase())).slice(0, 8).map(c => [`in:${c.name} `, `${I.hash}<b>${esc(c.name)}</b>`]);
    else if (!word || !word.includes(':')) items = SEARCH_FILTERS.filter(([k]) => !word || k.startsWith(word.toLowerCase())).filter(([k]) => ch.server_id || k !== 'in:').map(([k, hint, d]) => [k, `<b>${k}</b><span class="sf-hint">${esc(hint)}</span><small>${esc(d)}</small>`]);
    if (!items.length) return;
    pop = h(`<div class="search-filters"><div class="sf-h">${word && word.includes(':') ? 'Suggestions' : 'Search options'}</div>${items.map(([ins, html], i) => `<button data-ins="${esc(ins)}" class="${i === 0 ? '' : ''}">${html}</button>`).join('')}</div>`);
    document.body.appendChild(pop);
    const r = input.getBoundingClientRect(); pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(innerWidth - 328, r.right - 320)) + 'px';
    pop.onmousedown = (e) => { e.preventDefault(); const b = e.target.closest('[data-ins]'); if (!b) return;
      const pos = input.selectionStart, before = val.slice(0, pos).replace(/\S*$/, ''); input.value = before + b.dataset.ins + val.slice(pos).replace(/^\S*/, ''); input.focus(); input.selectionStart = input.selectionEnd = (before + b.dataset.ins).length; show(); };
  };
  input.onfocus = show; input.oninput = show; input.onblur = () => setTimeout(close, 120);
  input.onkeydown = (e) => { if (e.key === 'Enter' && input.value.trim()) { close(); runSearch(ch, input.value.trim()); } if (e.key === 'Escape') { input.value = ''; close(); $('.search-results')?.remove(); input.blur(); } };
}
async function runSearch(chOrId, raw, offset = 0, panel) {
  const ch = typeof chOrId === 'string' ? findChannel(chOrId) : chOrId; if (!ch) return;
  const { q, errs } = parseSearch(raw, ch);
  if (errs.length) toast(`Didn’t understand: ${errs.join(', ')}`, true);
  if (!panel) {
    $('.search-results')?.remove();
    panel = h(`<div class="search-results"><div class="sr-head"><span>Searching…</span><button class="icon-btn" title="Close search">${I.x}</button></div><div class="sr-list"></div></div>`);
    $('.content').appendChild(panel);
    $('.sr-head button', panel).onclick = () => panel.remove();
  }
  const params = new URLSearchParams();
  if (ch.server_id) params.set('server_id', ch.server_id); else params.set('channel_id', ch.id);
  if (q.text.length) params.set('q', q.text.join(' '));
  ['from', 'mentions', 'in', 'before', 'after'].forEach(k => q[k] != null && params.set(k, q[k]));
  if (q.has.length) params.set('has', q.has.join(','));
  if (q.pinned) params.set('pinned', 'true');
  params.set('offset', offset);
  try {
    const { total, messages } = await api('GET', '/api/search?' + params);
    $('.sr-head span', panel).textContent = `${total} result${total === 1 ? '' : 's'}`;
    const list = $('.sr-list', panel);
    if (!offset) list.innerHTML = '';
    $('.sr-more', list)?.remove();
    const sid = ch.server_id || null;
    list.insertAdjacentHTML('beforeend', messages.length ? messages.map(m => { const c = findChannel(m.channel_id);
      return `<div class="sr-item" data-go="${m.id}" data-cid="${m.channel_id}" data-thread="${m.thread_id || ''}">${sid && c ? `<div class="ib-where">#${esc(c.name)}</div>` : ''}${messageHtml({ ...m, thread: null }, sid, null, true)}</div>`; }).join('') : (offset ? '' : '<div class="empty">No results. Try fewer words or different filters.</div>'));
    if (offset + messages.length < total) { const more = h(`<button class="btn secondary block sr-more">Show more results</button>`); list.appendChild(more); more.onclick = () => runSearch(ch, raw, offset + 25, panel); }
    list.onclick = (e) => { const it = e.target.closest('[data-go]'); if (!it || e.target.closest('a,button')) return; goToMessage(it.dataset.cid, Number(it.dataset.go), Number(it.dataset.thread) || null); };
  } catch (e) { $('.sr-head span', panel).textContent = e.message; }
}

/* ---------- Settings → Devices ---------- */
function describeDevice(ua, client) {
  ua = ua || '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'Unknown device';
  const browser = /Electron|Orbit\//.test(ua) || client === 'desktop' ? 'Orbit desktop app' : client === 'app' ? 'Orbit app (Home Screen)' : /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const kind = /iPhone|Android.*Mobile/.test(ua) ? 'phone' : /iPad|Android/.test(ua) ? 'tablet' : 'computer';
  return { os, browser, kind };
}
const DEV_ICONS = {
  phone: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/></svg>',
  tablet: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="3"/><path d="M11 18h2"/></svg>',
  computer: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
};
function timeAgo(t) { const s = (Date.now() - t) / 1000; if (s < 90) return 'Active now'; if (s < 3600) return `Active ${Math.round(s / 60)} minutes ago`; if (s < 86400) return `Active ${Math.round(s / 3600)} hours ago`; return `Active ${Math.round(s / 86400)} days ago`; }
async function userDevices(body) {
  body.innerHTML = `<h2>Devices</h2><p class="hint">Here’s everywhere you’re logged in to Orbit. If you don’t recognize one, log it out and change your password.</p><div class="dev-list"><div class="loader">Loading…</div></div>`;
  const draw = async () => {
    let list = [];
    try { list = await api('GET', '/api/sessions'); } catch (e) { $('.dev-list', body).innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    const cur = list.filter(x => x.current), others = list.filter(x => !x.current);
    const row = (x) => { const d = describeDevice(x.ua, x.client);
      return `<div class="dev-row ${x.current ? 'current' : ''}"><span class="dev-ico">${DEV_ICONS[d.kind]}</span><div class="grow"><b>${esc(d.os)} · ${esc(d.browser)}</b><small>${x.current ? 'This device' : esc(timeAgo(x.last_seen))} · Signed in ${new Date(x.created).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</small></div>
        ${x.current ? '<span class="dev-this">This device</span>' : `<button class="icon-btn" data-out="${esc(x.id)}" title="Log out this device">${I.x}</button>`}</div>`; };
    $('.dev-list', body).innerHTML = `<h3>Current device</h3>${cur.map(row).join('') || '<p class="hint">This device signed in before devices were tracked. Reload Orbit to add it.</p>'}
      <h3>Other devices</h3>${others.length ? others.map(row).join('') : '<p class="hint">You’re not logged in anywhere else.</p>'}
      ${others.length ? `<div class="danger-zone"><div class="grow"><b>Log out of all other devices</b><small>You’ll stay logged in here.</small></div><button class="btn danger" data-allout>Log out all other devices</button></div>` : ''}`;
  };
  body.onclick = (e) => {
    const o = e.target.closest('[data-out]');
    if (o) confirmModal('Log out device', 'That device will be logged out right away and has to log in again.', 'Log out', async () => { await api('DELETE', '/api/sessions/' + o.dataset.out); draw(); toast('Device logged out'); });
    if (e.target.closest('[data-allout]')) confirmModal('Log out all other devices', 'Every other phone, computer and browser will be logged out right away.', 'Log out all', async () => { const r = await api('DELETE', '/api/sessions'); draw(); toast(`Logged out ${r.count} device${r.count === 1 ? '' : 's'}`); });
  };
  draw();
}

/* ---------- forum channels: a list of posts, each post opens its own reply thread ---------- */
S.forumSort = S.forumSort || {}; S.forumFilter = S.forumFilter || {};
function renderForum(cid) {
  const view = $(`.forum-view[data-forum="${CSS.escape(cid)}"]`); if (!view) return;
  const ch = findChannel(cid); if (!ch) return;
  const canPost = can(PERM.SEND, ch.server_id) && !myTimeout(ch.server_id);
  const sort = S.forumSort[cid] || 'active', filter = (S.forumFilter[cid] || '').toLowerCase();
  const activity = (m) => Math.max(m.created, m.thread?.last || 0);
  let posts = (S.messages[cid] || []).filter(m => m.title && !m._pending);
  if (filter) posts = posts.filter(m => m.title.toLowerCase().includes(filter) || (m.content || '').toLowerCase().includes(filter));
  posts.sort((a, b) => sort === 'new' ? b.created - a.created : activity(b) - activity(a));
  const sid = ch.server_id;
  const card = (m) => {
    const img = (m.attachments || []).find(a => (a.type || '').startsWith('image/'));
    const n = m.thread?.count || 0;
    const reacts = Object.entries(m.reactions || {}).filter(([, v]) => v.length).sort((a, b) => b[1].length - a[1].length)[0];
    return `<button class="fp" data-post="${m.id}">
      <div class="fp-main"><div class="fp-title">${esc(m.title)}</div>
        <div class="fp-preview"><b style="${colorIn(sid, m.author_id) ? 'color:' + colorIn(sid, m.author_id) : ''}">${esc(nameIn(sid, m.author_id))}:</b> ${esc(plainPreview(m.content) || (img ? 'Image' : (m.attachments || []).length ? 'Attachment' : ''))}</div>
        <div class="fp-meta">${reacts ? `<span class="fp-react">${emojiHtml(reacts[0])} ${reacts[1].length}</span>` : ''}<span>${I.forum.replace('width="20" height="20"', 'width="14" height="14"')} ${n}</span><span>${fmtRel(activity(m))}</span></div></div>
      ${img ? `<img class="fp-img" src="${esc(img.url)}" alt="" loading="lazy">` : ''}</button>`;
  };
  view.innerHTML = `<div class="fv-head"><div class="fv-search"><input class="input" placeholder="Search posts" value="${esc(S.forumFilter[cid] || '')}" data-ffilter></div>
      <select class="input fv-sort" data-fsort aria-label="Sort posts"><option value="active" ${sort === 'active' ? 'selected' : ''}>Recently active</option><option value="new" ${sort === 'new' ? 'selected' : ''}>Newest posts</option></select>
      ${canPost ? `<button class="btn primary" data-newpost>${I.plus} New Post</button>` : ''}</div>
    ${ch.topic ? `<div class="fv-guide">${formatText(ch.topic, sid)}</div>` : ''}
    <div class="fv-list">${S.messages[cid] ? (posts.length ? posts.map(card).join('') : `<div class="pp-empty">${I.forum}<b>${filter ? 'No posts match that search' : 'No posts yet'}</b><span>${filter ? 'Try another word.' : canPost ? 'Start the first conversation with “New Post”.' : 'Check back later.'}</span></div>`) : '<div class="loader">Loading posts…</div>'}
    ${S.hasMore[cid] ? '<button class="btn secondary block" data-fmore>Load older posts</button>' : ''}</div>`;
  view.onclick = (e) => {
    if (e.target.closest('[data-newpost]')) return newPostModal(cid);
    if (e.target.closest('[data-fmore]')) return loadForumPosts(cid, true);
    const p = e.target.closest('[data-post]'); if (p) { const m = (S.messages[cid] || []).find(x => x.id === Number(p.dataset.post)); if (m) { $$('.fp.open', view).forEach(x => x.classList.remove('open')); p.classList.add('open'); openThread(m); } }
  };
  $('[data-fsort]', view).onchange = (e) => { S.forumSort[cid] = e.target.value; renderForum(cid); };
  const f = $('[data-ffilter]', view);
  f.oninput = debounce(() => { S.forumFilter[cid] = f.value; const pos = f.selectionStart; renderForum(cid); const nf = $(`.forum-view[data-forum="${CSS.escape(cid)}"] [data-ffilter]`); nf?.focus(); nf?.setSelectionRange(pos, pos); }, 200);
  if (S.thread) $(`.fp[data-post="${S.thread.id}"]`, view)?.classList.add('open');
}
function fmtRel(t) { const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`; return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }); }
function newPostModal(cid) {
  let files = [];
  modal(`<button class="x icon-btn" data-close>${I.x}</button><div class="mh" style="text-align:left"><h2>New Post</h2><p>in ${esc(findChannel(cid)?.name || '')}</p></div>
    <div class="mb"><div class="field"><label>Title</label><input class="input" name="title" maxlength="100" placeholder="What’s it about?"></div>
    <div class="field"><label>Message</label><textarea class="input" name="body" maxlength="4000" rows="5" placeholder="Add details, a question or a link"></textarea></div>
    <div class="row-files"><button class="btn ghost sm" data-addfile>${I.upload} Add images or files</button><span class="np-files"></span><input type="file" multiple hidden></div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Post</button></div>`, (m, close) => {
    const inp = $('input[type=file]', m);
    $('[data-addfile]', m).onclick = () => inp.click();
    inp.onchange = () => { files = [...files, ...inp.files].slice(0, 10); $('.np-files', m).textContent = files.map(f => f.name).join(', '); inp.value = ''; };
    $('[name=title]', m).focus();
    $('[data-ok]', m).onclick = async (e) => {
      const title = $('[name=title]', m).value.trim(), body = $('[name=body]', m).value.trim();
      if (!title) return toast('Give your post a title', true);
      if (!body && !files.length) return toast('Add a message or a file', true);
      const f = new FormData(); f.append('title', title); f.append('content', resolveEmojiText(body, findChannel(cid)?.server_id)); files.forEach(x => f.append('files', x, x.name));
      e.target.disabled = true;
      try { const msg = await upload(`/api/channels/${cid}/messages`, f); close(); const list = S.messages[cid]; if (list && !list.find(x => x.id === msg.id)) { list.push(msg); renderForum(cid); } openThread(msg); }
      catch (x) { e.target.disabled = false; toast(x.message, true); }
    };
  });
}

/* ---------- 1:1 DMs: the right side shows the other person's profile ---------- */
const dmProfileCache = {};
async function renderDmProfile(box, ch) {
  const id = ch.user.id;
  const draw = () => {
    if (!box.isConnected) return;
    const u = { ...(S.users[id] || ch.user), ...(dmProfileCache[id] || {}) };
    const mutual = u.mutual_servers || [];
    const mutualFriends = id === S.me.id ? [] : (S.friends.friends || []).filter(f => f.id !== id && (dmProfileCache[id]?.mutual_friends || []).includes(f.id));
    // one full-height card: the person's profile colors run the whole panel
    box.innerHTML = profileCardHtml({ ...u, mutual_servers: [] }, { preview: true });
    const card = $('.profile-card', box), inner = $('.inner', card);
    card.classList.add('dmp');
    inner.insertAdjacentHTML('beforeend', `
      <section><h5>Member since</h5><div class="since">${new Date(u.created || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</div></section>`);
    card.insertAdjacentHTML('beforeend', `
      ${mutual.length ? `<details class="dmp-row" open><summary>Mutual Servers — ${mutual.length}${I.chevron}</summary><div class="dmp-servers">${mutual.map(sv => `<button data-msrv="${esc(sv.id)}"><span class="qs-srv">${S.serverData[sv.id] ? serverIcon(S.serverData[sv.id]) : esc(initials(sv.name))}</span><span>${esc(sv.name)}</span></button>`).join('')}</div></details>` : ''}
      ${mutualFriends.length ? `<details class="dmp-row"><summary>Mutual Friends — ${mutualFriends.length}${I.chevron}</summary><div class="dmp-servers">${mutualFriends.map(f => `<button data-mfr="${esc(f.id)}">${avatar(f, 's24')}<span>${esc(f.display_name)}</span></button>`).join('')}</div></details>` : ''}
      <div class="dmp-foot">${friendActionRow(id)}<button class="dmp-full" data-fullp>View Full Profile</button></div>`);
    box.onclick = async (e) => {
      const sv = e.target.closest('[data-msrv]'); if (sv && S.serverData[sv.dataset.msrv]) return selectServer(sv.dataset.msrv);
      const mf = e.target.closest('[data-mfr]'); if (mf) return profilePopout(mf.dataset.mfr, mf, 'left');
      if (e.target.closest('[data-fullp]')) return profilePopout(id, e.target.closest('[data-fullp]'), 'left');
      const fa = async (sel, fn) => { const b = e.target.closest(sel); if (!b) return false; try { await fn(); } catch (x) { toast(x.message, true); } return true; };
      if (await fa('[data-addfriend]', () => api('POST', '/api/friends', { username: user(id).username }))) return;
      if (await fa('[data-acceptreq]', () => api('POST', `/api/friends/${id}/accept`))) return;
      if (await fa('[data-declinereq]', () => api('DELETE', '/api/friends/' + id))) return;
      if (await fa('[data-cancelreq]', () => api('DELETE', '/api/friends/' + id))) return;
      if (await fa('[data-unblockp]', () => api('DELETE', `/api/friends/${id}/block`))) return;
      if (e.target.closest('[data-unfriend]')) confirmModal('Remove friend', `Remove <b>${esc(user(id).display_name)}</b>?`, 'Remove', () => api('DELETE', '/api/friends/' + id));
    };
  };
  draw();
  if (!dmProfileCache[id] || dmProfileCache[id]._at < Date.now() - 60e3) {
    try { const u = await api('GET', '/api/users/' + id); dmProfileCache[id] = { ...u, _at: Date.now() }; S.users[id] = { ...S.users[id], ...u }; if (u.activity) S.activities[id] = u.activity; draw(); } catch {}
  }
}

/* ---------- forum posts load newest-activity first ---------- */
async function loadForumPosts(cid, more) {
  if (S.loading[cid]) return; S.loading[cid] = true;
  const have = more ? (S.messages[cid] || []).filter(m => m.title).length : 0;
  try {
    const rows = await api('GET', `/api/channels/${cid}/messages?sort=active&limit=50&offset=${have}`);
    const list = more ? (S.messages[cid] || []) : [];
    rows.forEach(r => { if (!list.find(x => x.id === r.id)) list.push(r); });
    S.messages[cid] = list; S.hasMore[cid] = rows.length === 50;
  } catch (e) { toast(e.message, true); S.messages[cid] = S.messages[cid] || []; }
  S.loading[cid] = false; renderForum(cid);
}

/* ---------- move channels without drag & drop (phones, keyboards) ---------- */
async function saveTree(sd, groups) {
  const body = groups.flatMap(g => [...(g.id ? [{ id: g.id, parent_id: null }] : []), ...g.list.map(id => ({ id, parent_id: g.id }))]).map((o, i) => ({ ...o, position: i }));
  body.forEach(o => { const c = sd.channels.find(x => x.id === o.id); if (c) { c.position = o.position; if (c.type !== 'category') c.parent_id = o.parent_id; } });
  renderSidebar();
  try { await api('PUT', `/api/servers/${sd.id}/channels/order`, body); } catch (x) { toast(x.message, true); await fetchServer(sd.id); renderSidebar(); }
}
function treeGroups(sd) { const t = channelTree(sd); return [{ id: null, list: t.loose.map(c => c.id) }, ...t.cats.map(x => ({ id: x.cat.id, list: x.list.map(c => c.id) }))]; }
function moveChannel(cid, dir) {
  const sd = S.serverData[findChannel(cid)?.server_id]; if (!sd) return;
  const groups = treeGroups(sd), g = groups.find(x => x.list.includes(cid)); const i = g.list.indexOf(cid), j = i + dir;
  if (j < 0 || j >= g.list.length) return toast(dir < 0 ? 'Already at the top of its category' : 'Already at the bottom of its category');
  [g.list[i], g.list[j]] = [g.list[j], g.list[i]]; saveTree(sd, groups);
}
function moveToCategoryMenu(e, cid) {
  const sd = S.serverData[findChannel(cid)?.server_id]; if (!sd) return;
  const cats = channelTree(sd).cats.map(x => x.cat);
  const to = (pid) => { const groups = treeGroups(sd); groups.forEach(g => (g.list = g.list.filter(x => x !== cid))); groups.find(g => g.id === pid).list.push(cid); saveTree(sd, groups); };
  setTimeout(() => contextMenu(e, [['No category (top of list)', () => to(null)], '-', ...cats.map(c => [esc(c.name), () => to(c.id)])]), 0);
}

/* ================= BOOKMARKS (saved messages with folders + search) ================= */
// A light index of which message ids are saved, so the message menu can toggle instantly.
let _bmIndex = new Set();
async function loadBookmarkIndex() {
  try { const d = await api('GET', '/api/bookmarks'); S.bookmarks = d; S.bookmarkFolders = d.folders || []; _bmIndex = new Set((d.items || []).map(x => x.message_id)); }
  catch { _bmIndex = new Set(); }
}
const isBookmarked = (mid) => _bmIndex.has(mid);
async function saveBookmark(m, opts = {}) {
  try {
    await api('POST', '/api/bookmarks', { message_id: m.id, folder_id: opts.folder_id || null, label: opts.label || '' });
    _bmIndex.add(m.id); toast('Saved to bookmarks');
    if ($('.bookmarks-hub')) await refreshBookmarks();
  } catch (e) { toast(e.message, true); }
}
async function removeBookmarkByMsg(mid) {
  const item = (S.bookmarks?.items || []).find(x => x.message_id === mid);
  if (!item) { // not loaded — fetch then remove
    try { const d = await api('GET', '/api/bookmarks'); S.bookmarks = d; const it = (d.items || []).find(x => x.message_id === mid); if (it) await api('DELETE', '/api/bookmarks/' + it.id); } catch {}
  } else { try { await api('DELETE', '/api/bookmarks/' + item.id); } catch (e) { return toast(e.message, true); } }
  _bmIndex.delete(mid); toast('Removed bookmark');
  if ($('.bookmarks-hub')) await refreshBookmarks();
}
async function refreshBookmarks() {
  const d = await api('GET', '/api/bookmarks').catch(() => null); if (!d) return;
  S.bookmarks = d; S.bookmarkFolders = d.folders || []; _bmIndex = new Set((d.items || []).map(x => x.message_id));
  const hub = $('.bookmarks-hub'); if (hub) renderBookmarksInto(hub);
}
let _bmFilter = { folder: 'all', q: '' };
let _bmClose = null;
function openBookmarks() {
  _bmFilter = { folder: 'all', q: '' };
  const { el, close } = modal(`<button class="x icon-btn" data-close>${I.x}</button>
    <div class="mh" style="text-align:left"><h2>Bookmarks</h2><p>Your saved messages, organized into folders.</p></div>
    <div class="bookmarks-hub"></div>`, null, 'wide');
  _bmClose = close;
  renderBookmarksInto($('.bookmarks-hub', el));
  refreshBookmarks();
}
function renderBookmarksInto(hub) {
  const d = S.bookmarks || { folders: [], items: [] };
  const folders = d.folders || [];
  const q = _bmFilter.q.trim().toLowerCase();
  let items = d.items || [];
  if (_bmFilter.folder === 'none') items = items.filter(x => !x.folder_id);
  else if (_bmFilter.folder !== 'all') items = items.filter(x => x.folder_id === _bmFilter.folder);
  if (q) items = items.filter(x => (x.label || '').toLowerCase().includes(q) || (x.content || '').toLowerCase().includes(q) || (x.author?.display_name || '').toLowerCase().includes(q) || (x.where || '').toLowerCase().includes(q));
  const chip = (id, name, color) => `<button class="bm-chip ${_bmFilter.folder === id ? 'on' : ''}" data-folder="${esc(id)}"><span class="dot" style="background:${esc(color || 'var(--accent)')}"></span>${esc(name)}</button>`;
  hub.innerHTML = `
    <div class="bm-bar">
      <input class="bm-search" placeholder="Search bookmarks…" value="${esc(_bmFilter.q)}">
      <button class="btn small bm-newfolder">New folder</button>
    </div>
    <div class="bm-chips">
      <button class="bm-chip ${_bmFilter.folder === 'all' ? 'on' : ''}" data-folder="all">All</button>
      ${folders.map(f => chip(f.id, f.name, f.color)).join('')}
      <button class="bm-chip ${_bmFilter.folder === 'none' ? 'on' : ''}" data-folder="none">Unfiled</button>
    </div>
    <div class="bm-list">
      ${items.length ? items.map(bmCardHtml).join('') : `<div class="bm-empty">No bookmarks here yet. Right-click (or long-press) any message and choose <b>Save message</b>.</div>`}
    </div>`;
  const search = $('.bm-search', hub);
  search.oninput = () => { _bmFilter.q = search.value; const list = $('.bm-list', hub); if (list) { // re-filter only
    renderBookmarksInto(hub); const s2 = $('.bm-search', hub); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); } };
  $$('.bm-chip', hub).forEach(c => c.onclick = () => { _bmFilter.folder = c.dataset.folder; renderBookmarksInto(hub); });
  $('.bm-newfolder', hub).onclick = () => newBookmarkFolder();
  $$('.bm-card', hub).forEach(card => {
    const id = card.dataset.bm;
    card.querySelector('[data-jump]')?.addEventListener('click', () => { const it = (S.bookmarks.items || []).find(x => x.id === id); if (it && !it.missing) { _bmClose && _bmClose(); selectChannel(it.channel_id); setTimeout(() => jumpTo(it.message_id), 300); } });
    card.querySelector('[data-bm-folder]')?.addEventListener('click', (e) => moveBookmarkMenu(e, id));
    card.querySelector('[data-bm-label]')?.addEventListener('click', () => labelBookmark(id));
    card.querySelector('[data-bm-del]')?.addEventListener('click', async () => { await api('DELETE', '/api/bookmarks/' + id).catch(() => {}); const it = (S.bookmarks.items || []).find(x => x.id === id); if (it) _bmIndex.delete(it.message_id); await refreshBookmarks(); });
  });
}
function bmCardHtml(it) {
  const folder = (S.bookmarkFolders || []).find(f => f.id === it.folder_id);
  const who = it.author ? esc(it.author.display_name) : 'Unknown';
  const body = it.missing ? `<i class="bm-missing">This message is no longer available.</i>` : esc((it.content || '').slice(0, 280)) || '<i>(no text)</i>';
  return `<div class="bm-card" data-bm="${esc(it.id)}">
    <div class="bm-head"><b>${who}</b><span class="bm-where">${esc(it.where || '')}</span>${it.at ? `<span class="bm-when">${esc(fmtDay(it.at))}</span>` : ''}</div>
    ${it.label ? `<div class="bm-tag">${esc(it.label)}</div>` : ''}
    <div class="bm-body">${body}</div>
    <div class="bm-actions">
      ${it.missing ? '' : `<button class="link-btn" data-jump>Jump</button>`}
      <button class="link-btn" data-bm-folder>${folder ? `<span class="dot" style="background:${esc(folder.color)}"></span>${esc(folder.name)}` : 'Add to folder'}</button>
      <button class="link-btn" data-bm-label>${it.label ? 'Edit label' : 'Add label'}</button>
      <button class="link-btn danger" data-bm-del>Remove</button>
    </div>
  </div>`;
}
async function newBookmarkFolder() {
  const name = await promptModal('New folder', 'Folder name', '', 'Create');
  if (!name) return;
  try { await api('POST', '/api/bookmark-folders', { name }); await refreshBookmarks(); } catch (e) { toast(e.message, true); }
}
function moveBookmarkMenu(e, id) {
  const folders = S.bookmarkFolders || [];
  const items = [['No folder', () => setBmFolder(id, null)], '-', ...folders.map(f => [f.name, () => setBmFolder(id, f.id)]), '-', ['+ New folder…', async () => { await newBookmarkFolder(); }]];
  contextMenu(e, items);
}
async function setBmFolder(id, folder_id) { try { await api('PATCH', '/api/bookmarks/' + id, { folder_id }); await refreshBookmarks(); } catch (x) { toast(x.message, true); } }
async function labelBookmark(id) {
  const it = (S.bookmarks.items || []).find(x => x.id === id);
  const label = await promptModal('Label', 'A short searchable label', it?.label || '', 'Save');
  if (label === null) return;
  try { await api('PATCH', '/api/bookmarks/' + id, { label }); await refreshBookmarks(); } catch (x) { toast(x.message, true); }
}

/* ---------- activities: "Playing Fortnite" from the desktop app, or one you set yourself ---------- */
ic('gamepad', '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.6 6.1A2.9 2.9 0 0 0 5 18c1 0 1.9-.5 2.4-1.3L8.5 15h7l1.1 1.7A2.9 2.9 0 0 0 19 18a2.9 2.9 0 0 0 2.9-3.3l-.6-6.1A4 4 0 0 0 17.3 5z"/>');
ic('tv', '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M8 21h8M12 17v4"/>');
ic('trophy', '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>');
const ACT_ICON = { playing: 'gamepad', watching: 'tv', listening: 'music', competing: 'trophy' };
const ACT_HEAD = { playing: 'Playing a game', watching: 'Watching', listening: 'Listening to', competing: 'Competing in' };
const sinceText = (t) => { const m = Math.max(0, Math.floor((Date.now() - t) / 60000)); return m < 1 ? 'just started' : m < 60 ? `for ${m} min` : `for ${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim(); };
// a colored tile with the game's initials, so we never need anyone's logo
function gameTile(name) {
  let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const ini = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  return `<span class="game-tile" style="--gh:${h % 360}">${esc(ini)}</span>`;
}
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
function gameActivityHtml(a) {
  const head = a.type === 'playing' ? (a.source === 'detected' ? 'Playing on PC' : 'Playing') : (ACT_HEAD[a.type] || 'Activity');
  return `<div class="activity act-game"><h5>${head}</h5><div class="act-row">${a.type === 'playing' ? gameTile(a.name) : `<span class="art-ph">${I[ACT_ICON[a.type]] || I.gamepad}</span>`}
    <div class="act-meta"><b class="act-title">${esc(a.name)}</b>${a.details ? `<span>${esc(a.details)}</span>` : ''}${a.start ? `<span class="act-elapsed">${(I[ACT_ICON[a.type]] || I.gamepad).replace('width="20" height="20"', 'width="15" height="15"')}<span class="act-since" data-since="${a.start}">${clock(Date.now() - a.start)}</span></span>` : ''}</div></div></div>`;
}
// one ticker keeps every open profile live: game timers and Spotify progress move every second
setInterval(() => {
  $$('.act-since[data-since]').forEach(el => { el.textContent = clock(Date.now() - Number(el.dataset.since)); });
  $$('.act-live[data-song-start]').forEach(el => {
    const st = Number(el.dataset.songStart), dur = Math.max(1, Number(el.dataset.songEnd) - st), pos = Math.min(dur, Date.now() - st);
    const bar = el.querySelector('.act-bar i'); if (bar) bar.style.width = (pos / dur * 100).toFixed(2) + '%';
    const p = el.querySelector('.act-pos'); if (p) p.textContent = clock(pos);
  });
}, 1000);

const Act = {
  detected: null, sent: undefined,
  desktop: !!window.orbitDesktop?.onGame,
  wanted() {
    if (this.desktop && S.prefs.detectGames !== false && this.detected) return { type: 'playing', name: this.detected, auto: true };
    const c = S.prefs.customActivity;
    if (c && (!c.until || c.until > Date.now())) return { type: c.type, name: c.name, details: c.details || '' };
    return null;
  },
  async push() {
    if (!S.me || typeof socket === 'undefined') return;
    const w = this.wanted(), key = JSON.stringify(w);
    if (key === this.sent) return;
    this.sent = key;
    try { const r = await api('PUT', '/api/me/activity', w || { clear: true }); if (r.activity) S.activities[S.me.id] = r.activity; else delete S.activities[S.me.id]; renderMembers(); }
    catch { this.sent = undefined; }
  },
};
if (Act.desktop) {
  window.orbitDesktop.onGame((g) => { Act.detected = g; Act.push(); });
  window.orbitDesktop.currentGame().then(g => { Act.detected = g; Act.push(); }).catch(() => {});
}
setInterval(() => { const c = S.prefs.customActivity; if (c?.until && c.until <= Date.now()) { delete S.prefs.customActivity; savePrefs(); } Act.push(); }, 60e3);

const ACT_CLEAR = [[0, 'Don’t clear'], [30, '30 minutes'], [60, '1 hour'], [240, '4 hours'], [1440, 'Today']];
function activityModal() {
  const c = S.prefs.customActivity || { type: 'playing', name: '', details: '' };
  const types = [['playing', 'Playing'], ['watching', 'Watching'], ['listening', 'Listening to'], ['competing', 'Competing in']];
  modal(`<div class="mh"><h2>Set an activity</h2><p>Shows under your name in member lists and on your profile.</p></div>
    <div class="mb">
      <div class="act-types">${types.map(([k, l]) => `<button type="button" class="chip ${c.type === k ? 'on' : ''}" data-t="${k}">${I[ACT_ICON[k]]}${l}</button>`).join('')}</div>
      <div class="field"><label>Name</label><input class="input" name="n" maxlength="64" placeholder="e.g. Fortnite, a movie, a tournament" value="${esc(c.name)}"></div>
      <div class="field"><label>Details <small style="color:var(--muted)">optional</small></label><input class="input" name="d" maxlength="100" placeholder="e.g. Ranked with friends" value="${esc(c.details || '')}"></div>
      <div class="field"><label>Clear after</label><div class="act-types">${ACT_CLEAR.map(([m, l], i) => `<button type="button" class="chip ${i === 0 ? 'on' : ''}" data-clr="${m}">${l}</button>`).join('')}</div></div>
      ${Act.desktop ? `<label class="row-toggle" style="margin-top:14px"><span class="rt">Show the game I’m playing<small>The Orbit app spots popular games (Fortnite, Roblox, Minecraft, CS2, VALORANT and more) and shows them instead of this while you play.${Act.detected ? ` Playing now: <b>${esc(Act.detected)}</b>.` : ''}</small></span><span class="toggle"><input type="checkbox" data-detect ${S.prefs.detectGames !== false ? 'checked' : ''}><span></span></span></label>`
        : '<p class="hint" style="margin-top:12px">Get the Orbit app for Windows to show the game you’re playing automatically.</p>'}
    </div>
    <div class="mf">${S.prefs.customActivity ? '<button class="btn ghost danger" data-clear style="margin-right:auto">Clear activity</button>' : ''}<button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Save</button></div>`, (el, close) => {
    let type = c.type, clr = 0;
    el.addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]'); if (t) { type = t.dataset.t; $$('[data-t]', el).forEach(b => b.classList.toggle('on', b === t)); }
      const k = e.target.closest('[data-clr]'); if (k) { clr = Number(k.dataset.clr); $$('[data-clr]', el).forEach(b => b.classList.toggle('on', b === k)); }
    });
    $('[data-detect]', el)?.addEventListener('change', (e) => { S.prefs.detectGames = e.target.checked; savePrefs(); Act.push(); });
    $('[data-clear]', el)?.addEventListener('click', () => { delete S.prefs.customActivity; savePrefs(); Act.push(); close(); toast('Activity cleared'); });
    $('[data-ok]', el).onclick = () => {
      const name = $('[name=n]', el).value.trim();
      if (!name) { delete S.prefs.customActivity; savePrefs(); Act.push(); return close(); }
      S.prefs.customActivity = { type, name: name.slice(0, 64), details: $('[name=d]', el).value.trim().slice(0, 100), until: clr ? Date.now() + clr * 60e3 : 0 };
      savePrefs(); Act.push(); close(); toast(`${ACT_VERB[type]} ${name}`);
    };
    setTimeout(() => $('[name=n]', el).focus(), 30);
  });
}
