'use strict';
/* Orbit settings: user settings + server settings (fullscreen) */
function settingsShell(navHtml, onNav, first) {
  const el = h(`<div class="settings"><nav class="snav"><div class="in">${navHtml}</div></nav><div class="sbody"><div class="in"></div></div>
    <button class="close" title="Close (Esc)"><span class="c">${I.x}</span>ESC</button></div>`);
  document.body.appendChild(el);
  const body = $('.sbody .in', el);
  const close = () => { el.remove(); document.removeEventListener('keydown', k); };
  const k = (e) => { if (e.key === 'Escape' && !$('.modal-wrap, .layer')) close(); };
  document.addEventListener('keydown', k);
  $('.close', el).onclick = close;
  const go = (tab) => { $$('.snav [data-tab]', el).forEach(b => b.classList.toggle('active', b.dataset.tab === tab)); body.innerHTML = ''; onNav(tab, body, close); };
  $('.snav', el).onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); const a = e.target.closest('[data-action]'); if (a) onNav('@' + a.dataset.action, body, close); };
  go(first);
  return { el, close, go };
}
function saveBar(body, onSave, onReset) {
  $('.save-bar', body)?.remove();
  const bar = h(`<div class="save-bar"><span>Careful — you have unsaved changes!</span><button class="btn ghost sm" data-reset>Reset</button><button class="btn green sm" data-save>Save Changes</button></div>`);
  body.appendChild(bar);
  $('[data-reset]', bar).onclick = () => { bar.remove(); onReset(); };
  $('[data-save]', bar).onclick = async () => { $('[data-save]', bar).disabled = true; try { await onSave(); bar.remove(); toast('Saved!'); } catch (e) { toast(e.message, true); $('[data-save]', bar).disabled = false; } };
}
const ACCENTS = ['#7c5cff', '#5b8def', '#2bb5a8', '#2fbf71', '#d4a72c', '#f0883e', '#ef4f5f', '#e05cb7', '#8b8fa3', '#1c1d24'];

/* ================= USER SETTINGS ================= */
function openUserSettings(first = 'account') {
  settingsShell(`<h6>User settings</h6><button data-tab="account">My Account</button><button data-tab="profile">Profile</button><button data-tab="devices">Devices</button><hr>
    <button data-tab="connections">Connections</button><hr><h6>App settings</h6><button data-tab="appearance">Appearance</button><button data-tab="voice">Voice &amp; Video</button><button data-tab="notifications">Notifications</button><button data-tab="about">About</button><hr>
    <button class="danger" data-action="logout">Log out</button><p style="color:var(--dim);font-size:12px;padding:12px 10px">Orbit ${esc(S.info.version || '')}</p>`, (tab, body, close) => {
    if (tab === '@logout') return confirmModal('Log Out', 'Are you sure you want to log out?', 'Log Out', async () => logout());
    ({ account: userAccount, profile: userProfile, connections: userConnections, appearance: userAppearance, devices: userDevices, voice: userVoice, notifications: userNotify, about: userAbout })[tab](body, close);
  }, first);
}
function userAccount(body) {
  const u = S.me;
  body.innerHTML = `<h2>My Account</h2>
    <div class="preview-card" style="position:static">
      ${bannerHtml(u, 'acct-banner')}
      <div style="display:flex;align-items:flex-end;gap:14px;padding:0 16px;margin-top:-38px">${avatar(u, 's80').replace('class="av', 'style="border:6px solid var(--bg-1);box-sizing:content-box" class="av')}<div style="padding-bottom:8px;flex:1"><b style="font-size:20px">${esc(u.display_name)}</b></div><button class="btn primary sm" style="margin-bottom:10px" data-p>Edit profile</button></div>
      <div style="margin:16px;background:var(--bg-2);border-radius:8px;padding:16px">
        <div class="list-row" style="padding:8px 0"><div class="grow"><small>DISPLAY NAME</small>${esc(u.display_name)}</div></div>
        <div class="list-row" style="padding:8px 0"><div class="grow"><small>USERNAME</small>${esc(u.username)}</div><button class="btn secondary sm" data-un>Edit</button></div>
        <div class="list-row" style="padding:8px 0;border:0"><div class="grow"><small>EMAIL</small><span data-email>${esc(u.email.replace(/^(.).*(@.*)$/, '$1•••••$2'))}</span> <button class="btn ghost sm" style="padding:0" data-reveal>Reveal</button></div></div>
      </div></div>
    <h3>Password and Authentication</h3><button class="btn primary" data-pw>Change Password</button>`;
  $('[data-p]', body).onclick = () => $('.snav [data-tab=profile]').click();
  $('[data-reveal]', body).onclick = (e) => { $('[data-email]', body).textContent = u.email; e.target.remove(); };
  $('[data-un]', body).onclick = () => modal(`<div class="mh"><h2>Change your username</h2></div><div class="mb"><div class="field"><label>Username</label><input class="input" name="v" value="${esc(u.username)}" maxlength="32"></div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Done</button></div>`, (m, c) => {
    $('[data-ok]', m).onclick = async () => { try { const r = await api('PATCH', '/api/me', { username: $('[name=v]', m).value.trim() }); S.me = { ...S.me, ...r }; c(); userAccount(body); renderUserPanel(); } catch (e) { toast(e.message, true); } };
  });
  $('[data-pw]', body).onclick = () => modal(`<div class="mh"><h2>Update your password</h2><p>Enter your current password and a new password.</p></div>
    <div class="mb"><div class="field"><label>Current password</label><input class="input" type="password" name="a" autocomplete="current-password"></div>
    <div class="field"><label>New password</label><input class="input" type="password" name="b" autocomplete="new-password"></div>
    <div class="field"><label>Confirm new password</label><input class="input" type="password" name="c" autocomplete="new-password"></div></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Done</button></div>`, (m, c) => {
    $('[data-ok]', m).onclick = async () => {
      if ($('[name=b]', m).value !== $('[name=c]', m).value) return toast('New passwords don’t match', true);
      try { await api('PATCH', '/api/me', { current_password: $('[name=a]', m).value, new_password: $('[name=b]', m).value }); c(); toast('Password changed'); } catch (e) { toast(e.message, true); }
    };
  });
}
const THEME_PRESETS = [['#8b6dff', '#2b1d6b'], ['#5ee0d6', '#1b3a6b'], ['#ff6b8b', '#5b1d6b'], ['#ffb86b', '#7a2e4a'], ['#7bd88f', '#14432f'], ['#c7d2fe', '#3b3f6b'], ['#f472b6', '#fb923c'], ['#22d3ee', '#a78bfa'], ['#1e1b2e', '#0c0a16']];
const NAME_PRESETS = [[null, null], ['#ffffff', null], ['#ff9ec7', '#a78bfa'], ['#5ee0d6', '#8b6dff'], ['#ffd36b', '#ff6b8b'], ['#7bd88f', '#22d3ee'], ['#ff8a5b', '#ffd36b']];
function userProfile(body) {
  const pick = (u) => ({ display_name: u.display_name, pronouns: u.pronouns || '', bio: u.bio || '', accent: u.accent, status_text: u.status_text || '',
    theme_primary: u.theme_primary || null, theme_accent: u.theme_accent || null, name_color: u.name_color || null, name_color2: u.name_color2 || null,
    banner_color: u.banner_color || null, effect: u.effect || '', avatar_crop: u.avatar_crop || null, banner_crop: u.banner_crop || null, links: (u.links || []).map(l => ({ ...l })) });
  const orig = pick(S.me); const d = pick(S.me);
  const files = {}; const urls = {};
  const current = () => ({ ...S.me, ...d, avatar: files.avatar === null ? null : urls.avatar || S.me.avatar, banner: files.banner === null ? null : urls.banner || S.me.banner });
  const preview = () => { $('.pv', body).innerHTML = profileCardHtml(current(), { self: true, preview: true }); };
  const dirty = () => { if (JSON.stringify(d) !== JSON.stringify(orig) || Object.keys(files).length) saveBar(body, save, () => userProfile(body)); else $('.save-bar', body)?.remove(); preview(); };
  const save = async () => {
    for (const k of ['avatar', 'banner']) {
      if (files[k] === null) await api('PATCH', '/api/me', { [k]: null });
      else if (files[k]) { const f = new FormData(); f.append('crop', JSON.stringify(d[k + '_crop'] || { z: 1, x: 50, y: 50 })); f.append('file', files[k]); await upload('/api/me/' + k, f); }
    }
    const u = await api('PATCH', '/api/me', { ...d, links: d.links.filter(l => l.url) });
    S.me = { ...S.me, ...u }; S.users[S.me.id] = { ...S.users[S.me.id], ...u };
    renderUserPanel(); userProfile(body);
  };
  const pickImage = (kind, input) => {
    const f = input.files[0]; input.value = ''; if (!f) return;
    if (f.size > 15 * 1048576) return toast('Images must be under 15 MB', true);
    const url = URL.createObjectURL(f);
    cropModal(url, kind, null, (crop) => { files[kind] = f; urls[kind] = url; d[kind + '_crop'] = crop; dirty(); });
  };
  const sw = (list, cur, attr) => list.map(([a, b]) => `<button class="tswatch ${a === cur[0] && b === cur[1] ? 'sel' : ''}" data-${attr}="${a || ''}|${b || ''}" style="background:${a ? (b ? `linear-gradient(135deg,${a},${b})` : a) : 'var(--bg-3)'}" title="${a ? '' : 'Default'}">${a ? '' : '∅'}</button>`).join('');
  body.innerHTML = `<h2>Profile</h2><div class="profile-editor"><div class="pe-form">
    <div class="field"><label>Display name</label><input class="input" name="display_name" maxlength="32" value="${esc(d.display_name)}"></div>
    <div class="field"><label>Pronouns</label><input class="input" name="pronouns" maxlength="40" value="${esc(d.pronouns)}" placeholder="Add your pronouns"></div>
    <div class="pe-group"><h3>Avatar</h3><p class="hint">PNG, JPG, WebP or animated GIF, up to 15 MB. GIFs stay animated after cropping.</p>
      <div class="media-row"><label class="btn primary sm">Change avatar<input type="file" accept="image/*" hidden data-f="avatar"></label>${S.me.avatar || files.avatar ? `<button class="btn secondary sm" data-adjust="avatar">${I.crop} Adjust</button>` : ''}<button class="btn ghost sm" data-rm="avatar">Remove</button></div></div>
    <div class="pe-group"><h3>Banner</h3><p class="hint">Wide images look best. Animated GIFs work.</p>
      <div class="media-row"><label class="btn primary sm">Change banner<input type="file" accept="image/*" hidden data-f="banner"></label>${S.me.banner || files.banner ? `<button class="btn secondary sm" data-adjust="banner">${I.crop} Adjust</button>` : ''}<button class="btn ghost sm" data-rm="banner">Remove</button>
      <label class="color-dot" title="Banner color when there’s no image"><input type="color" data-k="banner_color" value="${esc(d.banner_color || d.accent || '#8b6dff')}"></label></div></div>
    <div class="pe-group"><h3>Profile theme</h3><p class="hint">A gradient behind your whole profile card.</p>
      <div class="swatches">${sw([[null, null], ...THEME_PRESETS], [d.theme_primary, d.theme_accent], 'theme')}</div>
      <div class="two-colors"><label>Top<input type="color" data-k="theme_primary" value="${esc(d.theme_primary || '#8b6dff')}"></label><label>Bottom<input type="color" data-k="theme_accent" value="${esc(d.theme_accent || d.theme_primary || '#2b1d6b')}"></label></div></div>
    <div class="pe-group"><h3>Name style</h3><p class="hint">Color or gradient for your display name. Role colors still win inside servers.</p>
      <div class="swatches">${sw(NAME_PRESETS, [d.name_color, d.name_color2], 'name')}</div>
      <div class="two-colors"><label>Start<input type="color" data-k="name_color" value="${esc(d.name_color || '#ffffff')}"></label><label>End<input type="color" data-k="name_color2" value="${esc(d.name_color2 || d.name_color || '#ffffff')}"></label><button class="btn ghost sm" data-solid>Use one color</button></div></div>
    <div class="pe-group"><h3>Avatar color</h3><p class="hint">Shown behind your initials when you have no avatar.</p>
      <div class="swatches">${ACCENTS.map(c => `<button class="swatch ${c === d.accent ? 'sel' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}<label class="color-dot"><input type="color" data-k="accent" value="${esc(d.accent)}"></label></div></div>
    <div class="pe-group"><h3>Profile effect</h3><div class="chip-select">${[['', 'None'], ['glow', 'Glow'], ['stars', 'Starfield'], ['aurora', 'Aurora']].map(([k, l]) => `<button data-effect="${k}" class="${d.effect === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="field"><label>Custom status</label><input class="input" name="status_text" maxlength="80" value="${esc(d.status_text)}" placeholder="What are you up to?"></div>
    <div class="field"><label>About me</label><textarea class="input" name="bio" maxlength="400" rows="4" placeholder="Markdown and links work here.">${esc(d.bio)}</textarea></div>
    <div class="pe-group"><h3>Links</h3><p class="hint">Up to 6 links on your profile.</p><div class="links-ed"></div><button class="btn secondary sm" data-addlink>${I.plus} Add link</button></div>
    </div><div class="pe-side"><h3>Preview</h3><div class="pv"></div></div></div>`;
  const drawLinks = () => {
    $('.links-ed', body).innerHTML = d.links.map((l, i) => `<div class="link-row"><input class="input" data-li="${i}" data-lk="label" placeholder="Label" maxlength="40" value="${esc(l.label || '')}"><input class="input" data-li="${i}" data-lk="url" placeholder="https://…" value="${esc(l.url || '')}"><button class="icon-btn danger" data-rmlink="${i}">${I.trash}</button></div>`).join('');
    $('[data-addlink]', body).classList.toggle('hidden', d.links.length >= 6);
  };
  drawLinks(); preview();
  body.addEventListener('input', (e) => {
    const t = e.target;
    if (t.name && t.name in d) { d[t.name] = t.value; dirty(); }
    if (t.dataset.k) { d[t.dataset.k] = t.value; if (t.dataset.k === 'theme_primary' && !d.theme_accent) d.theme_accent = t.value; if (t.dataset.k === 'name_color2' && !d.name_color) d.name_color = '#ffffff'; dirty(); }
    if (t.dataset.li !== undefined) { d.links[t.dataset.li][t.dataset.lk] = t.value; dirty(); }
  });
  body.addEventListener('change', (e) => { if (e.target.dataset.f) pickImage(e.target.dataset.f, e.target); });
  body.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.theme !== undefined) { const [a, b] = t.dataset.theme.split('|'); d.theme_primary = a || null; d.theme_accent = b || null; $$('[data-theme]', body).forEach(x => x.classList.toggle('sel', x === t)); dirty(); }
    if (t.dataset.name !== undefined) { const [a, b] = t.dataset.name.split('|'); d.name_color = a || null; d.name_color2 = b || null; $$('[data-name]', body).forEach(x => x.classList.toggle('sel', x === t)); dirty(); }
    if ('solid' in t.dataset) { d.name_color2 = null; dirty(); }
    if (t.dataset.c) { d.accent = t.dataset.c; $$('[data-c]', body).forEach(x => x.classList.toggle('sel', x === t)); dirty(); }
    if (t.dataset.effect !== undefined) { d.effect = t.dataset.effect; $$('[data-effect]', body).forEach(x => x.classList.toggle('on', x === t)); dirty(); }
    if (t.dataset.rm) { files[t.dataset.rm] = null; delete urls[t.dataset.rm]; d[t.dataset.rm + '_crop'] = null; dirty(); }
    if (t.dataset.adjust) { const k = t.dataset.adjust; const src = urls[k] || S.me[k]; if (src) cropModal(src, k, d[k + '_crop'], (crop) => { d[k + '_crop'] = crop; dirty(); }); }
    if ('addlink' in t.dataset) { d.links.push({ label: '', url: '' }); drawLinks(); }
    if (t.dataset.rmlink !== undefined) { d.links.splice(Number(t.dataset.rmlink), 1); drawLinks(); dirty(); }
  });
}

/* crop & zoom: stores a focal point + zoom, rendered with CSS so GIFs keep animating */
function cropModal(src, kind, crop, onDone) {
  const c = { z: 1, x: 50, y: 50, ...(crop || {}) };
  const round = kind === 'avatar' || kind === 'icon';
  modal(`<div class="mh" style="text-align:left"><h2>Edit ${kind === 'avatar' ? 'avatar' : kind === 'icon' ? 'icon' : 'banner'}</h2><p>Drag to move it. Use the slider or your scroll wheel to zoom.</p></div>
    <div class="mb"><div class="cropper ${round ? 'round' : 'wide'}"><div class="frame"><img src="${esc(src)}" draggable="false" alt=""></div></div>
    <div class="zoom-row"><span>−</span><input type="range" min="1" max="4" step="0.01" value="${c.z}"><span>+</span></div></div>
    <div class="mf"><button class="btn ghost" data-reset>Reset</button><span class="sp"></span><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>Apply</button></div>`, (m, close) => {
    const img = $('.frame img', m), frame = $('.frame', m), range = $('input[type=range]', m);
    const draw = () => { img.style.cssText = cropStyle(c); range.value = c.z; };
    draw();
    let drag = null;
    frame.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y }; frame.setPointerCapture(e.pointerId); };
    frame.onpointermove = (e) => {
      if (!drag) return;
      const r = frame.getBoundingClientRect();
      const nw = img.naturalWidth || r.width, nh = img.naturalHeight || r.height;
      const cover = Math.max(r.width / nw, r.height / nh);
      const extraX = Math.max(1, nw * cover * c.z - r.width), extraY = Math.max(1, nh * cover * c.z - r.height);
      c.x = Math.min(100, Math.max(0, drag.cx - (e.clientX - drag.x) / extraX * 100 * (c.z > 1 ? 1 : 1)));
      c.y = Math.min(100, Math.max(0, drag.cy - (e.clientY - drag.y) / extraY * 100));
      draw();
    };
    frame.onpointerup = () => (drag = null);
    frame.onwheel = (e) => { e.preventDefault(); c.z = Math.min(4, Math.max(1, c.z - e.deltaY * 0.002)); draw(); };
    range.oninput = () => { c.z = Number(range.value); draw(); };
    $('[data-reset]', m).onclick = () => { c.z = 1; c.x = 50; c.y = 50; draw(); };
    $('[data-ok]', m).onclick = () => { onDone({ z: +c.z.toFixed(3), x: +c.x.toFixed(2), y: +c.y.toFixed(2) }); close(); };
  }, 'crop-modal');
}

function userConnections(body) {
  const conns = (S.me.connections || []);
  const spotify = conns.find(c => c.type === 'spotify' && c.verified);
  const manual = conns.filter(c => !c.verified).map(c => ({ ...c }));
  body.innerHTML = `<h2>Connections</h2>
    <div class="conn-hero"><span class="cg big" style="background:#1db954">♫</span><div class="grow"><b>Spotify</b><small>${spotify ? `Connected as ${esc(spotify.name)}. What you’re playing shows on your profile and in member lists.` : 'Show what you’re listening to on your profile.'}</small></div>
      ${spotify ? `<button class="btn secondary sm" data-unspot>Disconnect</button>` : `<button class="btn primary sm" data-spot>Connect</button>`}</div>
    ${!S.info.spotify ? `<p class="hint" style="margin-top:8px">Spotify needs to be set up once on the Orbit server by its owner (a free Spotify developer app). The README explains how.</p>` : ''}
    <h3>Other accounts</h3><p class="hint">Add usernames to show on your profile. People can click through to them.</p>
    <div class="conn-list"></div>
    <div class="link-row"><select class="input" data-ntype>${Object.entries(CONN).filter(([k]) => k !== 'spotify').map(([k, [n]]) => `<option value="${k}">${n}</option>`).join('')}</select><input class="input" data-nname placeholder="Username"><button class="btn primary sm" data-nadd>Add</button></div>`;
  const draw = () => { $('.conn-list', body).innerHTML = manual.map((c, i) => { const [n, col, g] = CONN[c.type]; return `<div class="list-row"><span class="cg" style="background:${col}">${g}</span><div class="grow"><b>${esc(c.name)}</b><small>${n}</small></div><button class="icon-btn danger" data-rmc="${i}">${I.trash}</button></div>`; }).join('') || '<p class="hint">Nothing added yet.</p>'; };
  draw();
  const saveManual = async () => { try { const u = await api('PATCH', '/api/me', { connections: manual }); S.me = { ...S.me, ...u }; } catch (e) { toast(e.message, true); } };
  body.onclick = async (e) => {
    if (e.target.closest('[data-spot]')) {
      try { const r = await api('GET', '/api/connections/spotify/start'); window.open(r.url, '_blank'); toast('Finish connecting in the window that opened.'); }
      catch (er) { toast(er.message, true); }
    }
    if (e.target.closest('[data-unspot]')) { await api('DELETE', '/api/connections/spotify').catch(x => toast(x.message, true)); S.me.connections = (S.me.connections || []).filter(c => c.type !== 'spotify'); userConnections(body); }
    if (e.target.closest('[data-nadd]')) { const name = $('[data-nname]', body).value.trim(); if (!name) return; manual.push({ type: $('[data-ntype]', body).value, name }); $('[data-nname]', body).value = ''; draw(); saveManual(); }
    const rm = e.target.closest('[data-rmc]'); if (rm) { manual.splice(Number(rm.dataset.rmc), 1); draw(); saveManual(); }
  };
}

function userAppearance(body) {
  const p = S.prefs;
  body.innerHTML = `<h2>Appearance</h2>
    <h3>Theme</h3><div class="theme-pick">${[['dark', 'Dark'], ['midnight', 'Midnight'], ['light', 'Light']].map(([k, l]) => `<button data-th="${k}" class="${p.theme === k ? 'on' : ''}"><span class="th-prev th-${k}"><i></i><i></i><i></i></span>${l}</button>`).join('')}</div>
    <h3>Accent color</h3><div class="swatches">${['#8b6dff', '#a78bfa', '#5b8def', '#10919f', '#22c3b5', '#3fbf74', '#e8b23a', '#ff8a5b', '#ff5c7a', '#e05cb7'].map(c => `<button class="swatch ${c === p.accent ? 'sel' : ''}" data-ac="${c}" style="background:${c}"></button>`).join('')}<label class="color-dot"><input type="color" data-acc value="${esc(p.accent)}"></label></div>
    <h3>Message display</h3>
    <label class="row-toggle"><span class="rt">Compact mode<small>Fit more messages on screen and hide avatars on grouped lines.</small></span><span class="toggle"><input type="checkbox" data-pp="compact" ${p.compact ? 'checked' : ''}><span></span></span></label>
    <label class="row-toggle"><span class="rt">Reduce motion<small>Turn off animations.</small></span><span class="toggle"><input type="checkbox" data-pp="reduceMotion" ${p.reduceMotion ? 'checked' : ''}><span></span></span></label>
    <h3>Text size</h3><div class="zoom-row"><span style="font-size:12px">Aa</span><input type="range" min="12" max="20" step="1" value="${p.fontSize}" data-fs><span style="font-size:20px">Aa</span><b data-fsv>${p.fontSize}px</b></div>`;
  const set = (k, v) => { S.prefs[k] = v; savePrefs(); applyAppearance(); };
  body.onclick = (e) => {
    const th = e.target.closest('[data-th]'); if (th) { set('theme', th.dataset.th); $$('[data-th]', body).forEach(x => x.classList.toggle('on', x === th)); }
    const ac = e.target.closest('[data-ac]'); if (ac) { set('accent', ac.dataset.ac); $$('[data-ac]', body).forEach(x => x.classList.toggle('sel', x === ac)); }
  };
  $('[data-acc]', body).oninput = (e) => set('accent', e.target.value);
  $$('[data-pp]', body).forEach(c => c.onchange = () => set(c.dataset.pp, c.checked));
  $('[data-fs]', body).oninput = (e) => { set('fontSize', Number(e.target.value)); $('[data-fsv]', body).textContent = e.target.value + 'px'; };
}
async function userVoice(body) {
  let devices = [];
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch {}
  const opt = (kind, cur) => `<option value="">Default</option>` + devices.filter(d => d.kind === kind).map(d => `<option value="${esc(d.deviceId)}" ${d.deviceId === cur ? 'selected' : ''}>${esc(d.label || kind)}</option>`).join('');
  body.innerHTML = `<h2>Voice &amp; Video</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
      <div class="field"><label>Input device</label><select class="input" data-p="mic">${opt('audioinput', S.prefs.mic)}</select></div>
      <div class="field"><label>Output device</label><select class="input" data-p="speaker">${opt('audiooutput', S.prefs.speaker)}</select></div></div>
    <h3>Mic test</h3><p style="color:var(--muted);font-size:13px;margin-bottom:8px">Say something and watch the bar move.</p>
    <div style="display:flex;gap:12px;align-items:center"><button class="btn primary sm" data-test>Let’s Check</button><div style="flex:1;height:10px;background:var(--bg-0);border-radius:5px;overflow:hidden"><div data-level style="height:100%;width:0;background:var(--green);transition:width .05s"></div></div></div>
    <label class="row-toggle" style="margin-top:12px"><span class="rt">Noise suppression<small>Filters background noise from your mic.</small></span><span class="toggle"><input type="checkbox" data-p="noise" ${S.prefs.noise ? 'checked' : ''}><span></span></span></label>
    <h3>Camera</h3><div class="field"><select class="input" data-p="cam">${opt('videoinput', S.prefs.cam)}</select></div>
    <div style="display:flex;gap:12px;align-items:flex-start"><button class="btn primary sm" data-cam>Test Video</button><video data-preview autoplay muted playsinline style="width:320px;max-width:100%;border-radius:8px;background:#000;display:none;transform:scaleX(-1)"></video></div>
    ${!devices.some(d => d.label) ? '<p style="color:var(--muted);font-size:13px;margin-top:12px">Device names appear after you allow microphone or camera access once.</p>' : ''}`;
  let stream, camStream, raf;
  const stop = () => { stream?.getTracks().forEach(t => t.stop()); camStream?.getTracks().forEach(t => t.stop()); cancelAnimationFrame(raf); };
  const obs = new MutationObserver(() => { if (!document.body.contains(body) || !$('[data-test]', body)) { stop(); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });
  $$('[data-p]', body).forEach(el => el.onchange = () => { S.prefs[el.dataset.p] = el.type === 'checkbox' ? el.checked : el.value; savePrefs(); });
  $('[data-test]', body).onclick = async (e) => {
    if (stream) { stop(); stream = null; e.target.textContent = 'Let’s Check'; $('[data-level]', body).style.width = '0'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.prefs.mic ? { ideal: S.prefs.mic } : undefined, noiseSuppression: S.prefs.noise } });
      e.target.textContent = 'Stop Testing';
      const ctx = new AudioContext(); const an = ctx.createAnalyser(); ctx.createMediaStreamSource(stream).connect(an); const buf = new Uint8Array(an.frequencyBinCount);
      const loop = () => { an.getByteFrequencyData(buf); const v = buf.reduce((a, b) => a + b, 0) / buf.length; const el = $('[data-level]', body); if (el) el.style.width = Math.min(100, v * 2.2) + '%'; raf = requestAnimationFrame(loop); }; loop();
    } catch (er) { toast(mediaError(er, 'microphone'), true); }
  };
  $('[data-cam]', body).onclick = async (e) => {
    const v = $('[data-preview]', body);
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; v.style.display = 'none'; e.target.textContent = 'Test Video'; return; }
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: S.prefs.cam ? { ideal: S.prefs.cam } : undefined } }); v.srcObject = camStream; v.style.display = 'block'; e.target.textContent = 'Stop Video'; }
    catch (er) { toast(mediaError(er, 'camera'), true); }
  };
}
function userNotify(body) {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const pick = (kind, list, cur) => `<div class="sound-pick">${list.map(([id, name]) => `<button class="sound-opt ${cur === id ? 'on' : ''}" data-sound="${kind}" data-id="${id}"><span class="so-play" data-play="${id}">${I.play}</span><span class="so-name">${name}</span><span class="so-check">${cur === id ? I.check.replace('width="20" height="20"', 'width="16" height="16"') : ''}</span></button>`).join('')}</div>`;
  body.innerHTML = `<h2>Notifications & Sounds</h2>
    <label class="row-toggle"><span class="rt">Desktop notifications<small>Get notified for direct messages and @mentions.${perm === 'denied' ? ' <b style="color:var(--red)">Blocked in your browser settings.</b>' : ''}</small></span><span class="toggle"><input type="checkbox" data-p="notify" ${S.prefs.notify ? 'checked' : ''}><span></span></span></label>
    <label class="row-toggle"><span class="rt">Sounds<small>Play sounds for messages, calls, and voice join/leave.</small></span><span class="toggle"><input type="checkbox" data-p="sounds" ${S.prefs.sounds ? 'checked' : ''}><span></span></span></label>
    <h3>Notification sound</h3><p class="hint">Plays when you get a message. Tap to preview.</p>${pick('notifSound', NOTIFSOUNDS, S.prefs.notifSound)}
    <h3>Ringtone</h3><p class="hint">Plays for incoming calls. Tap to preview.</p>${pick('ringtone', RINGTONES, S.prefs.ringtone)}
    <p class="hint" style="margin-top:16px">A random pair is chosen for you the first time — change them here anytime. Set your status to Do Not Disturb to silence everything.</p>`;
  $$('[data-p]', body).forEach(el => el.onchange = () => { S.prefs[el.dataset.p] = el.checked; savePrefs(); if (el.dataset.p === 'notify' && el.checked && perm === 'default') Notification.requestPermission(); });
  let preview;
  body.addEventListener('click', (e) => {
    const pl = e.target.closest('[data-play]');
    const opt = e.target.closest('[data-sound]');
    if (!opt) return;
    const kind = opt.dataset.sound, id = opt.dataset.id;
    if (preview) { try { preview.pause(); } catch {} }
    preview = previewSound(id, kind === 'ringtone' ? 0.7 : 0.6);
    if (!pl) { S.prefs[kind] = id; savePrefs(); $$(`[data-sound="${kind}"]`, body).forEach(b => { b.classList.toggle('on', b.dataset.id === id); $('.so-check', b).innerHTML = b.dataset.id === id ? I.check.replace('width="20" height="20"', 'width="16" height="16"') : ''; }); }
  });
}
function userAbout(body) {
  body.innerHTML = `<h2>About Orbit</h2><div style="display:flex;gap:16px;align-items:center"><img src="${LOGO}" style="width:72px;height:72px;object-fit:contain"><div><b style="font-size:20px">Orbit ${esc(S.info.version || '')}</b><p style="color:var(--muted)">Connected to ${esc(location.host)}</p></div></div>
    <h3>Keyboard shortcuts</h3><div style="color:var(--text-2);font-size:14px;line-height:2">
    <b>Ctrl+K</b> — find or start a conversation<br><b>Ctrl+Shift+M</b> — toggle mute<br><b>Ctrl+Shift+D</b> — toggle deafen<br><b>↑</b> in an empty message box — edit your last message<br><b>Shift+Enter</b> — new line<br><b>Shift+click</b> delete — delete without confirming</div>
    <h3>Formatting</h3><div style="color:var(--text-2);font-size:14px;line-height:2">**bold** · *italic* · __underline__ · ~~strike~~ · ||spoiler|| · \`code\` · \`\`\`code block\`\`\` · &gt; quote · @mention</div>`;
  if (S.me.staff) {
    body.insertAdjacentHTML('beforeend', `<div class="danger-zone" style="border-color:var(--line-2)"><div class="grow"><b>Database backup</b><small>Download a full copy of Orbit’s data (accounts, servers, messages). Orbit also keeps 7 daily copies on the server, but save one somewhere else every so often in case Render’s disk is ever lost.</small></div><button class="btn primary" data-backup>${I.download} Download backup</button></div>`);
    $('[data-backup]', body).onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'Preparing…';
      try {
        const r = await fetch('/api/admin/backup', { headers: { Authorization: 'Bearer ' + S.token } });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Backup failed');
        const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a');
        a.href = url; a.download = `orbit-backup-${new Date().toISOString().slice(0, 10)}.db`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
        toast('Backup downloaded');
      } catch (x) { toast(x.message, true); }
      b.disabled = false; b.innerHTML = `${I.download} Download backup`;
    };
  }
}

/* ================= SERVER SETTINGS ================= */
function openServerSettings(sid, first) {
  const sd = S.serverData[sid];
  const owner = sd.owner_id === S.me.id;
  const tabs = [can(PERM.MANAGE_SERVER, sid) && ['overview', 'Overview'], can(PERM.MANAGE_ROLES, sid) && ['roles', 'Roles'], can(PERM.MANAGE_SERVER, sid) && ['emoji', 'Emoji'], can(PERM.MANAGE_SERVER, sid) && ['stickers', 'Stickers'], (can(PERM.KICK, sid) || can(PERM.BAN, sid) || can(PERM.MANAGE_ROLES, sid)) && ['members', 'Members'],
    can(PERM.MANAGE_SERVER, sid) && ['invites', 'Invites'], can(PERM.BAN, sid) && ['bans', 'Bans']].filter(Boolean);
  const ui = settingsShell(`<h6>${esc(sd.name)}</h6>${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}${owner ? '<hr><button class="danger" data-action="delete">Delete Server</button>' : ''}`, (tab, body, close) => {
    const cur = S.serverData[sid]; if (!cur) return close();
    if (tab === '@delete') return confirmModal(`Delete ‘${cur.name}’`, `Are you sure you want to delete <b>${esc(cur.name)}</b>? This action cannot be undone.`, 'Delete Server', async () => { await api('DELETE', '/api/servers/' + sid); close(); });
    ({ overview: srvOverview, emoji: srvEmojis, stickers: srvStickers, roles: srvRoles, members: srvMembers, invites: srvInvites, bans: srvBans })[tab](body, sid, close);
  }, first || tabs[0]?.[0]);
  return ui;
}
function srvOverview(body, sid) {
  const sd = S.serverData[sid];
  const orig = { name: sd.name, description: sd.description || '' }; const d = { ...orig }; const files = {};
  const dirty = () => { if (JSON.stringify(d) !== JSON.stringify(orig) || Object.keys(files).length) saveBar(body, save, () => srvOverview(body, sid)); else $('.save-bar', body)?.remove(); };
  const save = async () => {
    for (const k of ['icon', 'banner']) {
      if (files[k] === null) await api('PATCH', '/api/servers/' + sid, { [k]: null });
      else if (files[k]) { const f = new FormData(); f.append('file', files[k]); await upload(`/api/servers/${sid}/image/${k}`, f); }
    }
    await api('PATCH', '/api/servers/' + sid, d);
    await fetchServer(sid); renderRail(); renderSidebar(); srvOverview(body, sid);
  };
  const iconUrl = () => files.icon === null ? null : files.icon ? URL.createObjectURL(files.icon) : sd.icon;
  const bannerUrl = () => files.banner === null ? null : files.banner ? URL.createObjectURL(files.banner) : sd.banner;
  body.innerHTML = `<h2>Server Overview</h2>
    <div style="display:flex;gap:24px;flex-wrap:wrap"><div style="text-align:center"><label class="upload-circle" style="width:100px;height:100px" data-ic>${iconUrl() ? `<img src="${esc(iconUrl())}">` : 'Upload<br>Icon'}<input type="file" accept="image/*" hidden data-f="icon"></label>
      <button class="btn ghost sm" data-rm="icon">Remove</button></div>
      <div style="flex:1;min-width:220px"><p style="color:var(--muted);font-size:13px;margin-bottom:10px">We recommend an image of at least 512×512. Animated GIFs work too.</p>
      <div class="field"><label>Server name</label><input class="input" name="name" maxlength="50" value="${esc(d.name)}"></div></div></div>
    <h3>Description</h3><textarea class="input" name="description" maxlength="300" rows="3" placeholder="Shown on invites">${esc(d.description)}</textarea>
    <h3>Server Banner</h3><p style="color:var(--muted);font-size:13px;margin-bottom:8px">Shows at the top of the channel list and on invites. Animated GIFs are supported.</p>
    <div data-bprev style="height:140px;border-radius:10px;background:var(--bg-1) center/cover;margin-bottom:10px;${bannerUrl() ? `background-image:url('${esc(bannerUrl())}')` : ''}"></div>
    <div class="media-row"><label class="btn primary sm">Upload Banner<input type="file" accept="image/*" hidden data-f="banner"></label><button class="btn ghost sm" data-rm="banner">Remove Banner</button></div>`;
  $$('input[name], textarea[name]', body).forEach(i => i.oninput = () => { d[i.name] = i.value; dirty(); });
  const refresh = () => { const ic = $('[data-ic]', body), fi = $('[data-f=icon]', body); ic.innerHTML = iconUrl() ? `<img src="${esc(iconUrl())}">` : 'Upload<br>Icon'; ic.appendChild(fi); $('[data-bprev]', body).style.backgroundImage = bannerUrl() ? `url('${bannerUrl()}')` : 'none'; };
  $$('[data-f]', body).forEach(i => i.onchange = () => { if (i.files[0]) { files[i.dataset.f] = i.files[0]; refresh(); dirty(); } });
  $$('[data-rm]', body).forEach(b => b.onclick = () => { files[b.dataset.rm] = null; refresh(); dirty(); });
}
function srvRoles(body, sid, close, selected) {
  const sd = S.serverData[sid];
  const roles = sd.roles.slice().sort((a, b) => b.position - a.position);
  let cur = roles.find(r => r.id === selected) || roles.find(r => !r.is_default) || roles[0];
  const draw = () => {
    const r = cur; const d = { name: r.name, color: r.color || '#99aab5', perms: r.perms, hoist: r.hoist };
    const orig = JSON.stringify(d);
    body.innerHTML = `<h2>Roles</h2><p style="color:var(--muted);margin:-12px 0 18px;font-size:14px">Use roles to group your members and give them permissions. Higher roles in the list rank above lower ones.</p>
      <div class="roles-layout"><div><button class="btn primary sm" data-new style="width:100%;margin-bottom:10px">Create Role</button><div class="role-list">
      ${roles.map((x, i) => `<button data-r="${x.id}" class="${x.id === r.id ? 'active' : ''}"><i style="background:${esc(x.color || '#99aab5')}"></i><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${esc(x.name)}</span>${!x.is_default ? `<span data-up="${x.id}" title="Move up" style="opacity:.6">▲</span><span data-down="${x.id}" title="Move down" style="opacity:.6">▼</span>` : ''}</button>`).join('')}
      </div></div><div>
      <h3 style="margin-top:0">Edit role — ${esc(r.name)}</h3>
      ${r.is_default ? '<p style="color:var(--muted);font-size:13px;margin-bottom:10px">@everyone applies to every member of the server.</p>' : `
      <div class="field"><label>Role name</label><input class="input" name="name" maxlength="32" value="${esc(d.name)}"></div>
      <div class="field"><label>Role color</label><div class="swatches">${['#99aab5', '#ef4f5f', '#f0883e', '#f0b232', '#2fbf71', '#2bb5a8', '#4ea1ff', '#7c5cff', '#e05cb7', '#ffffff'].map(c => `<button class="swatch ${c === d.color ? 'sel' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}<input type="color" value="${esc(d.color)}"></div></div>
      <label class="row-toggle"><span class="rt">Display role members separately from online members</span><span class="toggle"><input type="checkbox" name="hoist" ${d.hoist ? 'checked' : ''}><span></span></span></label>`}
      <h3>Permissions</h3>
      ${PERM_INFO.map(([k, l, desc]) => `<div class="perm-row"><div><b>${l}</b><small>${desc}</small></div><span class="toggle"><input type="checkbox" data-perm="${k}" ${(d.perms & PERM[k]) ? 'checked' : ''}><span></span></span></div>`).join('')}
      ${!r.is_default ? `<div class="danger-zone"><div class="grow"><b>Delete role</b><small>Members lose this role and its permissions.</small></div><button class="btn danger sm" data-del>Delete</button></div>` : ''}
      </div></div>`;
    const dirty = () => { if (JSON.stringify(d) !== orig) saveBar(body, async () => { await api('PATCH', '/api/roles/' + r.id, d); await fetchServer(sid); srvRoles(body, sid, close, r.id); }, draw); else $('.save-bar', body)?.remove(); };
    $('[name=name]', body)?.addEventListener('input', (e) => { d.name = e.target.value; dirty(); });
    $('[name=hoist]', body)?.addEventListener('change', (e) => { d.hoist = e.target.checked; dirty(); });
    $$('[data-c]', body).forEach(b => b.onclick = () => { d.color = b.dataset.c; $$('[data-c]', body).forEach(x => x.classList.toggle('sel', x === b)); dirty(); });
    $('input[type=color]', body)?.addEventListener('input', (e) => { d.color = e.target.value; dirty(); });
    $$('[data-perm]', body).forEach(c => c.onchange = () => { const bit = PERM[c.dataset.perm]; d.perms = c.checked ? d.perms | bit : d.perms & ~bit; dirty(); });
    $('.role-list', body).onclick = async (e) => {
      const up = e.target.closest('[data-up]'), down = e.target.closest('[data-down]');
      if (up || down) {
        e.stopPropagation();
        const list = roles.filter(x => !x.is_default); const i = list.findIndex(x => x.id === (up || down).dataset[up ? 'up' : 'down']); const j = up ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        try { await Promise.all(list.map((x, k) => api('PATCH', '/api/roles/' + x.id, { position: list.length - k }))); await fetchServer(sid); srvRoles(body, sid, close, cur.id); } catch (er) { toast(er.message, true); }
        return;
      }
      const b = e.target.closest('[data-r]'); if (b) { cur = roles.find(x => x.id === b.dataset.r); draw(); }
    };
    $('[data-new]', body).onclick = async () => { try { const nr = await api('POST', `/api/servers/${sid}/roles`, { name: 'new role' }); await fetchServer(sid); srvRoles(body, sid, close, nr.id); } catch (e) { toast(e.message, true); } };
    $('[data-del]', body)?.addEventListener('click', () => confirmModal('Delete role', `Delete the role <b>${esc(r.name)}</b>?`, 'Delete', async () => { await api('DELETE', '/api/roles/' + r.id); await fetchServer(sid); srvRoles(body, sid, close); }));
  };
  draw();
}
function srvMembers(body, sid) {
  const draw = (q = '') => {
    const sd = S.serverData[sid];
    const list = sd.members.filter(m => !q || m.username.toLowerCase().includes(q) || nameIn(sid, m.id).toLowerCase().includes(q));
    $('.ml', body).innerHTML = list.map(m => {
      const roles = sd.roles.filter(r => m.roles.includes(r.id));
      return `<div class="list-row">${avatar(S.users[m.id] || m, 's32', true)}<div class="grow"><b>${esc(nameIn(sid, m.id))}</b>${m.id === sd.owner_id ? ` <span class="crown">${I.crown.replace('width="20" height="20"', 'width="13" height="13"')}</span>` : ''}<small>@${esc(m.username)} · joined ${new Date(m.joined).toLocaleDateString()}</small>
        <div class="role-tags" style="margin-top:4px">${roles.map(r => `<span class="role-tag"><i style="background:${esc(r.color || '#99aab5')}"></i>${esc(r.name)}</span>`).join('')}</div></div>
        ${can(PERM.MANAGE_ROLES, sid) ? `<button class="btn secondary sm" data-roles="${m.id}">Roles</button>` : ''}
        ${m.id !== S.me.id && m.id !== sd.owner_id && can(PERM.KICK, sid) ? `<button class="btn secondary sm" data-kick="${m.id}">Kick</button>` : ''}
        ${m.id !== S.me.id && m.id !== sd.owner_id && can(PERM.BAN, sid) ? `<button class="btn danger sm" data-ban="${m.id}">Ban</button>` : ''}
        ${sd.owner_id === S.me.id && m.id !== S.me.id ? `<button class="btn ghost sm" data-own="${m.id}" title="Transfer ownership">${I.crown.replace('width="20" height="20"', 'width="16" height="16"')}</button>` : ''}</div>`;
    }).join('');
  };
  body.innerHTML = `<h2>Server Members</h2><input class="input" placeholder="Search members" style="margin-bottom:12px"><div class="ml"></div>`;
  draw();
  $('input', body).oninput = (e) => draw(e.target.value.toLowerCase());
  $('.ml', body).onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.roles) memberRolesModal(sid, b.dataset.roles);
    if (b.dataset.kick) kickMember(sid, b.dataset.kick);
    if (b.dataset.ban) banMember(sid, b.dataset.ban);
    if (b.dataset.own) confirmModal('Transfer ownership', `Make <b>${esc(nameIn(sid, b.dataset.own))}</b> the owner of this server? You will lose owner permissions.`, 'Transfer', () => api('POST', `/api/servers/${sid}/transfer`, { user_id: b.dataset.own }));
  };
  const iv = setInterval(() => { if (!document.body.contains(body) || !$('.ml', body)) return clearInterval(iv); draw($('input', body)?.value.toLowerCase() || ''); }, 4000);
}
async function srvInvites(body, sid) {
  body.innerHTML = `<h2>Invites</h2><div class="il"><div class="loader">Loading…</div></div>`;
  try {
    const list = await api('GET', `/api/servers/${sid}/invites`);
    $('.il', body).innerHTML = list.length ? list.map(i => `<div class="list-row">${avatar(i.creator || {}, 's32')}<div class="grow"><b>${esc(i.code)}</b><small>by ${esc(i.creator?.display_name || '?')} · ${i.uses} use${i.uses === 1 ? '' : 's'} · ${new Date(i.created).toLocaleDateString()}</small></div>
      <button class="btn secondary sm" data-copy="${esc(i.code)}">Copy link</button><button class="btn danger sm" data-revoke="${esc(i.code)}">Revoke</button></div>`).join('') : '<p style="color:var(--muted)">No invites yet. Use “Invite People” from the server menu to make one.</p>';
    $('.il', body).onclick = async (e) => {
      const c = e.target.closest('[data-copy]'); if (c) copy(`${location.origin}/invite/${c.dataset.copy}`);
      const r = e.target.closest('[data-revoke]'); if (r) { await api('DELETE', '/api/invites/' + r.dataset.revoke).catch(x => toast(x.message, true)); srvInvites(body, sid); }
    };
  } catch (e) { $('.il', body).textContent = e.message; }
}
async function srvBans(body, sid) {
  body.innerHTML = `<h2>Bans</h2><div class="bl"><div class="loader">Loading…</div></div>`;
  try {
    const list = await api('GET', `/api/servers/${sid}/bans`);
    $('.bl', body).innerHTML = list.length ? list.map(b => `<div class="list-row">${avatar(b.user || {}, 's32')}<div class="grow"><b>${esc(b.user?.display_name || 'Unknown')}</b><small>@${esc(b.user?.username || '')}${b.reason ? ' · ' + esc(b.reason) : ''}</small></div><button class="btn secondary sm" data-unban="${b.user_id}">Revoke Ban</button></div>`).join('') : '<p style="color:var(--muted)">No one has been banned.</p>';
    $('.bl', body).onclick = async (e) => { const u = e.target.closest('[data-unban]'); if (u) { await api('DELETE', `/api/servers/${sid}/bans/${u.dataset.unban}`).catch(x => toast(x.message, true)); srvBans(body, sid); } };
  } catch (e) { $('.bl', body).textContent = e.message; }
}

/* start */
boot();
