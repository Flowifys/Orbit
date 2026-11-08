/* Full profile: the profile card on the left, and Board (widgets), Activity (what they play) and
   Wishlist tabs on the right. Opened with "View Full Profile". Game art is drawn as initial tiles
   (gameTile in features.js) so no one's logo is ever used. */

const WIDGETS = {
  custom: { name: 'Create your own', icon: 'edit', hint: 'A title and anything you want to say' },
  favorite: { name: 'Favorite Game', icon: 'star', hint: 'The one game you’d pick over everything' },
  like: { name: 'Games I Like', icon: 'gamepad', hint: 'Up to 8 games you enjoy' },
  rotation: { name: 'Games in Rotation', icon: 'clock', hint: 'What you’re playing these days' },
  want: { name: 'Want to Play', icon: 'bookmark', hint: 'Games on your list' },
};
const PICK_ART = { favorite: ['League of Legends'], like: ['PEAK', 'R.E.P.O.', 'Among Us'], rotation: ['VALORANT', 'Marvel Rivals', 'Rust'], want: ['Elden Ring', 'Hollow Knight: Silksong', 'Baldur’s Gate 3'] };
const widgetKey = (w) => w.type === 'games' ? w.kind : w.type;
const agoText = (t) => { const m = Math.floor((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.floor(m / 60); if (h < 24) return h + ' h ago'; const d = Math.floor(h / 24); return d === 1 ? 'yesterday' : d + ' days ago'; };
const hoursText = (min) => min < 60 ? `${min} min total` : `${(min / 60).toFixed(min < 600 ? 1 : 0)} h total`;

function widgetHtml(w, i, self) {
  const tools = self ? `<div class="wg-tools"><button class="icon-btn" data-wedit="${i}" title="Edit">${I.edit}</button><button class="icon-btn" data-wdel="${i}" title="Remove">${I.trash || I.x}</button></div>` : '';
  if (w.type === 'favorite') return `<div class="wg wg-fav">${tools}<h6>Favorite Game</h6><div class="wg-fav-row">${gameTile(w.game)}<div><b>${esc(w.game)}</b>${w.note ? `<p>${esc(w.note)}</p>` : ''}</div></div></div>`;
  if (w.type === 'games') return `<div class="wg wg-games">${tools}<h6>${WIDGETS[w.kind].name}</h6><div class="wg-shelf">${w.games.map(g => `<div class="wg-g" title="${esc(g)}">${gameTile(g)}<span class="wg-gn">${esc(g)}</span></div>`).join('')}</div></div>`;
  return `<div class="wg wg-custom">${tools}${w.title ? `<h6>${esc(w.title)}</h6>` : ''}<div class="wg-text">${formatText(w.text || '')}</div></div>`;
}
function widgetPickerHtml(board) {
  const used = new Set(board.widgets.map(widgetKey));
  return `<div class="wg-pick">${Object.entries(WIDGETS).map(([k, v]) => {
    const taken = k !== 'custom' && used.has(k);
    return `<button class="wg-opt ${taken ? 'taken' : ''}" data-wadd="${k}" ${taken ? 'disabled title="Already on your board"' : ''}><span class="wg-opt-art">${(PICK_ART[k] || []).map(gameTile).join('')}</span><span class="wg-opt-plus">${I.plus}</span><b>${v.name}</b><small>${v.hint}</small></button>`;
  }).join('')}</div>`;
}

async function fullProfile(uidv) {
  if (!uidv) return;
  let u = S.users[uidv] || {}, board = { widgets: [], wishlist: [], recent_games: [], activity: null };
  try { u = { ...u, ...(await api('GET', '/api/users/' + uidv)) }; S.users[uidv] = { ...S.users[uidv], ...u }; } catch {}
  try { board = { ...board, ...(await api('GET', `/api/users/${uidv}/board`)) }; } catch (e) { if (!u.id) return toast(e.message, true); }
  if (board.activity) S.activities[uidv] = board.activity;
  const self = uidv === S.me.id;
  let tab = 'board';
  const L = layer();
  const el = h(`<div class="fp-wrap" role="dialog" aria-label="${esc(u.display_name)}’s profile"><div class="fp">
    <button class="fp-x icon-btn" data-fpclose title="Close (Esc)">${I.x}</button>
    <div class="fp-left pc-pop">${profileCardHtml(u, { self })}</div>
    <div class="fp-right"><nav class="fp-tabs" role="tablist">${[['board', 'Board'], ['activity', 'Activity'], ['wishlist', 'Wishlist']].map(([k, l]) => `<button role="tab" data-tab="${k}">${l}</button>`).join('')}</nav><div class="fp-body"></div></div>
  </div></div>`);
  L.set(el);
  const save = async (patch) => {
    try { const r = await api('PUT', '/api/me/board', patch); board = { ...board, ...r }; draw(); }
    catch (x) { toast(x.message, true); }
  };
  const draw = () => {
    $$('.fp-tabs [data-tab]', el).forEach(b => { b.classList.toggle('on', b.dataset.tab === tab); b.setAttribute('aria-selected', b.dataset.tab === tab); });
    const body = $('.fp-body', el);
    if (tab === 'board') {
      if (!board.widgets.length) body.innerHTML = self
        ? `<div class="fp-empty"><h3>Make your profile yours with widgets</h3><p>Show off your favorite games, what you’re playing lately, or write something of your own.</p></div>${widgetPickerHtml(board)}`
        : `<div class="fp-empty">${I.gamepad}<h3>Nothing on the board yet</h3><p>${esc(u.display_name)} hasn’t added any widgets.</p></div>`;
      else body.innerHTML = `<div class="wg-grid">${board.widgets.map((w, i) => widgetHtml(w, i, self)).join('')}</div>${self && board.widgets.length < 8 ? `<h5 class="fp-sub">Add a widget</h5>${widgetPickerHtml(board)}` : ''}`;
    } else if (tab === 'activity') {
      const now = activityOf(uidv);
      const rg = board.recent_games || [];
      body.innerHTML = `${now ? `<h5 class="fp-sub">Right now</h5><div class="fp-now">${activityHtml(uidv)}</div>` : ''}
        <h5 class="fp-sub">Recently played ${self && rg.length ? '<button class="link-btn" data-clearrg>Clear</button>' : ''}</h5>
        ${rg.length ? `<div class="rg-list">${rg.map(g => `<div class="rg-row">${gameTile(g.name)}<div><b>${esc(g.name)}</b><small>${hoursText(g.minutes || 0)} · last played ${agoText(g.last)}</small></div></div>`).join('')}</div>`
          : `<div class="fp-empty small">${I.gamepad}<p>${self ? 'Games you play with the Orbit app open show up here.' : 'No games played recently.'}</p></div>`}`;
    } else {
      const wl = board.wishlist || [];
      body.innerHTML = `${self ? `<form class="wl-add"><input class="input" name="n" maxlength="80" placeholder="Add something you want (a game, gear, anything)" required><input class="input" name="u" maxlength="300" placeholder="Link (optional)"><button class="btn primary">Add</button></form>` : ''}
        ${wl.length ? `<div class="wl-list">${wl.map((x, i) => `<div class="wl-row">${gameTile(x.name)}<div class="grow"><b>${x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer">${esc(x.name)}</a>` : esc(x.name)}</b>${x.note ? `<small>${esc(x.note)}</small>` : x.url ? `<small>${esc(new URL(x.url).hostname.replace(/^www\./, ''))}</small>` : ''}</div>${self ? `<button class="icon-btn" data-wlrm="${i}" title="Remove">${I.x}</button>` : ''}</div>`).join('')}</div>`
          : `<div class="fp-empty small">${I.bookmark || I.star}<p>${self ? 'Nothing on your wishlist yet.' : `${esc(u.display_name)}’s wishlist is empty.`}</p></div>`}`;
      $('.wl-add', body)?.addEventListener('submit', (e) => {
        e.preventDefault(); const f = e.target;
        save({ wishlist: [...wl, { name: f.n.value, url: f.u.value.trim() || null }] });
      });
    }
  };
  draw();
  el.addEventListener('click', async (e) => {
    if (e.target === el || e.target.closest('[data-fpclose]')) return L.close();
    const t = e.target.closest('.fp-tabs [data-tab]'); if (t) { tab = t.dataset.tab; return draw(); }
    const add = e.target.closest('[data-wadd]'); if (add) return widgetEditor(add.dataset.wadd, null, (w) => save({ widgets: [...board.widgets, w] }));
    const ed = e.target.closest('[data-wedit]'); if (ed) { const i = Number(ed.dataset.wedit); return widgetEditor(widgetKey(board.widgets[i]), board.widgets[i], (w) => save({ widgets: board.widgets.map((x, j) => j === i ? w : x) })); }
    const del = e.target.closest('[data-wdel]'); if (del) { const i = Number(del.dataset.wdel); return save({ widgets: board.widgets.filter((_, j) => j !== i) }); }
    const wr = e.target.closest('[data-wlrm]'); if (wr) { const i = Number(wr.dataset.wlrm); return save({ wishlist: board.wishlist.filter((_, j) => j !== i) }); }
    if (e.target.closest('[data-clearrg]')) { try { await api('DELETE', '/api/me/recent-games'); board.recent_games = []; draw(); } catch (x) { toast(x.message, true); } return; }
    // the profile card's own buttons
    if (e.target.closest('[data-editp]')) { L.close(); return openUserSettings('profile'); }
    if (e.target.closest('[data-call]')) { L.close(); const d = await openDM(uidv); if (d) Voice.join(d.id); return; }
    if (e.target.closest('[data-mod]')) { const r = e.target.closest('[data-mod]').getBoundingClientRect(); return profileMoreMenu({ clientX: r.left, clientY: r.bottom + 4 }, null, uidv); }
    const fa = async (sel, fn) => { if (!e.target.closest(sel)) return false; try { await fn(); } catch (x) { toast(x.message, true); } L.close(); return true; };
    if (await fa('[data-addfriend]', () => api('POST', '/api/friends', { username: u.username }))) return;
    if (await fa('[data-acceptreq]', () => api('POST', `/api/friends/${uidv}/accept`))) return;
    if (await fa('[data-declinereq], [data-cancelreq]', () => api('DELETE', '/api/friends/' + uidv))) return;
  });
  const mb = $('.msgbox', el);
  if (mb) mb.onkeydown = async (e) => { if (e.key !== 'Enter' || !mb.value.trim()) return; const text = mb.value.trim(); L.close(); const d = await openDM(uidv); if (d) { const fd = new FormData(); fd.append('content', text); upload(`/api/channels/${d.id}/messages`, fd).catch(x => toast(x.message, true)); } };
  // note box on the card (same as the small profile)
  const nb = $('.note-box', el);
  if (nb) { api('GET', '/api/notes/' + uidv).then(r => { nb.value = r?.note || r?.text || ''; }).catch(() => {}); let t; nb.oninput = () => { clearTimeout(t); t = setTimeout(() => api('PUT', '/api/notes/' + uidv, { note: nb.value }).catch(() => {}), 600); }; }
}

/* add / edit one widget */
function widgetEditor(kind, cur, onSave) {
  const W = WIDGETS[kind];
  let games = cur?.games ? [...cur.games] : [];
  const body = kind === 'custom'
    ? `<div class="field"><label>Title</label><input class="input" name="t" maxlength="40" placeholder="e.g. Currently building" value="${esc(cur?.title || '')}"></div>
       <div class="field"><label>Text</label><textarea class="input" name="x" rows="5" maxlength="600" placeholder="Write anything. Markdown works.">${esc(cur?.text || '')}</textarea></div>`
    : kind === 'favorite'
      ? `<div class="field"><label>Game</label><input class="input" name="g" maxlength="64" placeholder="e.g. Fortnite" value="${esc(cur?.game || '')}" list="wg-known"></div>
         <div class="field"><label>Why it’s your favorite <small style="color:var(--muted)">optional</small></label><input class="input" name="n" maxlength="200" value="${esc(cur?.note || '')}"></div>`
      : `<div class="field"><label>Games <small style="color:var(--muted)">up to 8 · press Enter after each</small></label><div class="chip-in"><div class="chip-list"></div><input class="input" name="g" maxlength="64" placeholder="Type a game and press Enter" list="wg-known"></div></div>`;
  const known = [...new Set(Object.values(window.KNOWN_GAMES || {}).concat(['Fortnite', 'Roblox', 'Minecraft', 'VALORANT', 'Counter-Strike 2', 'League of Legends', 'Apex Legends', 'Marvel Rivals', 'Rocket League', 'Overwatch 2', 'Rust', 'R.E.P.O.', 'PEAK', 'Lethal Company', 'Grand Theft Auto V', 'Elden Ring', 'Baldur’s Gate 3', 'Helldivers 2', 'Terraria', 'Stardew Valley']))];
  modal(`<div class="mh"><h2>${cur ? 'Edit' : 'Add'} ${W.name}</h2><p>${W.hint}.</p></div><div class="mb">${body}<datalist id="wg-known">${known.map(g => `<option value="${esc(g)}">`).join('')}</datalist></div>
    <div class="mf"><button class="btn ghost" data-close>Cancel</button><button class="btn primary" data-ok>${cur ? 'Save' : 'Add to board'}</button></div>`, (m, close) => {
    const drawChips = () => { const cl = $('.chip-list', m); if (cl) cl.innerHTML = games.map((g, i) => `<span class="gchip">${gameTile(g)}${esc(g)}<button type="button" data-rmg="${i}" aria-label="Remove ${esc(g)}">${I.x}</button></span>`).join(''); };
    drawChips();
    const gi = kind in { like: 1, rotation: 1, want: 1 } ? $('[name=g]', m) : null;
    const addGame = () => { const v = gi.value.trim(); if (!v) return; if (games.length >= 8) return toast('That’s the max of 8 games', true); if (!games.some(g => g.toLowerCase() === v.toLowerCase())) games.push(v); gi.value = ''; drawChips(); };
    if (gi) gi.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addGame(); } };
    m.addEventListener('click', (e) => { const r = e.target.closest('[data-rmg]'); if (r) { games.splice(Number(r.dataset.rmg), 1); drawChips(); } });
    $('[data-ok]', m).onclick = () => {
      let w;
      if (kind === 'custom') w = { type: 'custom', title: $('[name=t]', m).value.trim(), text: $('[name=x]', m).value.trim() };
      else if (kind === 'favorite') w = { type: 'favorite', game: $('[name=g]', m).value.trim(), note: $('[name=n]', m).value.trim() };
      else { if (gi.value.trim()) addGame(); w = { type: 'games', kind, games }; }
      if ((w.type === 'custom' && !w.title && !w.text) || (w.type === 'favorite' && !w.game) || (w.type === 'games' && !w.games.length)) return toast('Fill it in first', true);
      close(); onSave(w);
    };
    setTimeout(() => $('.mb input, .mb textarea', m)?.focus(), 30);
  });
}

/* open it from the small profile card and the DM side panel */
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-fullp], [data-fullprofile]'); if (!b) return;
  const id = b.dataset.fullprofile || b.closest('[data-card]')?.dataset.card || (curChannel()?.type === 'dm' ? curChannel().user?.id : null);
  if (!id) return;
  e.preventDefault(); e.stopImmediatePropagation();
  while (layerStack.length) layerStack[layerStack.length - 1].close();
  fullProfile(id);
}, true);
