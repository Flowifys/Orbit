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
  Object.values(S.serverData).forEach(sd => sd.channels.forEach(c => items.push({ id: c.id, kind: c.type, name: c.name, sub: sd.name, html: `<span class="qs-ico">${c.type === 'voice' ? I.speaker : c.private ? I.lock : I.hash}</span>`, unread: !!S.unread[c.id] })));
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
      <div class="avwrap">${avatar(u, 's80', true).replace(/<i class="st [a-z]+">/, `<i class="st ${st === 'invisible' ? 'offline' : st}">`)}</div>
      <button class="status-bubble" data-cstatus>${u.status_text ? esc(u.status_text) : `<span class="sb-ph">${I.smile.replace('width="20" height="20"', 'width="14" height="14"')} What’s on your mind?</span>`}</button>
      ${u.effect === 'stars' ? '<div class="fx-layer"></div>' : ''}
      <div class="inner self-inner">
        <div class="dn" style="${nameStyle(u)}">${esc(u.display_name)}${badgeHtml(u)}</div>
        <div class="un">${esc(u.username)}${u.pronouns ? ` <span class="pron">${esc(u.pronouns)}</span>` : ''}</div>
        ${u.bio ? `<div class="bio self-bio">${formatText(u.bio)}</div>` : ''}
        <div class="activity-slot">${activityHtml(u.id)}</div>
        <div class="self-menu">
          <button data-sm="edit">${I.edit}<span>Edit Profile</span></button>
          <div class="sm-sep"></div>
          <button data-sm="status" class="sm-status"><i class="dot" style="background:${cur[2]}"></i><span>${cur[1]}</span>${I.chevron}</button>
          <div class="sm-statuses hidden">${STATUS.map(([k, l, c, d]) => `<button data-st="${k}" class="${k === st ? 'on' : ''}"><i class="dot" style="background:${c}"></i><span>${l}${d ? `<small>${d}</small>` : ''}</span></button>`).join('')}</div>
          <div class="sm-sep"></div>
          <button data-sm="copy">${I.copy}<span>Copy User ID</span></button>
          <button data-sm="settings">${I.gear}<span>User Settings</span></button>
        </div>
        <div class="self-menu"><button data-sm="logout" class="danger">${I.logout}<span>Log Out</span></button></div>
      </div></div></div>`);
  L.set(el);
  const r = anchor.getBoundingClientRect(); place(el, r.left - 4, r.top - 10, { above: true });
  el.onclick = (e) => {
    const a = e.target.closest('[data-sm]')?.dataset.sm;
    if (e.target.closest('[data-cstatus]')) { L.close(); return customStatusModal(); }
    if (a === 'edit') { L.close(); openUserSettings('profile'); }
    if (a === 'settings') { L.close(); openUserSettings(); }
    if (a === 'copy') { L.close(); copy(S.me.id); }
    if (a === 'logout') { L.close(); logout(); }
    if (a === 'status') { $('.sm-statuses', el).classList.toggle('hidden'); $('.sm-status', el).classList.toggle('open'); }
    const sb = e.target.closest('[data-st]');
    if (sb) { S.prefs.status = sb.dataset.st; savePrefs(); socket.emit('presence', sb.dataset.st); renderUserPanel(); L.close(); }
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
