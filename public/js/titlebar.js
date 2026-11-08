/* Desktop app title bar: back / forward, where you are, and room for the window's own
   minimize / maximize / close buttons. Only shows in the Orbit app (the website keeps the browser's bar). */

/* ---------- back / forward through the places you've been ---------- */
const Nav = {
  stack: [], at: -1, moving: false,
  key: (v) => `${v.server}|${v.channel || ''}`,
  record(view) {
    if (this.moving || !view) return;
    const cur = this.stack[this.at];
    if (cur && this.key(cur) === this.key(view)) return;
    this.stack = this.stack.slice(0, this.at + 1);
    this.stack.push({ server: view.server, channel: view.channel || null });
    if (this.stack.length > 60) this.stack.shift();
    this.at = this.stack.length - 1;
    TitleBar.update();
  },
  can(d) { return this.at + d >= 0 && this.at + d < this.stack.length; },
  go(d) {
    // skip places that no longer exist (left a server, channel deleted)
    let i = this.at + d;
    while (i >= 0 && i < this.stack.length) {
      const v = this.stack[i];
      const ok = v.channel ? !!findChannel(v.channel) : (v.server === '@me' || !!S.serverData[v.server]);
      if (ok) break;
      this.stack.splice(i, 1); if (d < 0) { i--; this.at--; }
    }
    if (i < 0 || i >= this.stack.length) return TitleBar.update();
    this.at = i; this.moving = true;
    const v = this.stack[i];
    try { if (v.channel) selectChannel(v.channel, true); else selectServer(v.server); } finally { this.moving = false; }
    TitleBar.update();
  },
};
// every place change goes through saveView()
{
  const _save = saveView;
  saveView = function () { _save(); Nav.record(S.view); };
}
// mouse side buttons and Alt+← / Alt+→, like a browser
document.addEventListener('mouseup', (e) => { if (e.button === 3) { e.preventDefault(); Nav.go(-1); } if (e.button === 4) { e.preventDefault(); Nav.go(1); } });
document.addEventListener('keydown', (e) => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest?.('input, textarea, [contenteditable]')) { e.preventDefault(); Nav.go(e.key === 'ArrowLeft' ? -1 : 1); } });

/* ---------- the bar itself ---------- */
const TitleBar = {
  on: !!window.orbitDesktop?.frame,
  el: null,
  mount() {
    if (!this.on || this.el) return;
    document.body.classList.add('has-titlebar', 'tb-' + window.orbitDesktop.frame);
    this.el = h(`<header class="titlebar"><div class="tb-nav"><button class="tb-btn" data-nav="-1" title="Back (Alt+←)">${I.back}</button><button class="tb-btn" data-nav="1" title="Forward (Alt+→)">${I.back}</button></div>
      <div class="tb-where"></div><div class="tb-tools"><button class="tb-btn" data-tb-inbox title="Inbox">${I.inbox}</button></div></header>`);
    document.body.prepend(this.el);
    this.el.onclick = (e) => {
      const n = e.target.closest('[data-nav]'); if (n) return Nav.go(Number(n.dataset.nav));
      if (e.target.closest('[data-tb-inbox]')) return inboxPopout(e.target.closest('[data-tb-inbox]'));
    };
    this.el.ondblclick = (e) => { if (!e.target.closest('button')) e.preventDefault(); };
    this.update(); this.syncColors();
  },
  update() {
    if (!this.el) return;
    $$('[data-nav]', this.el).forEach(b => { b.disabled = !Nav.can(Number(b.dataset.nav)); });
    const v = S.view || {}; let icon = '', name = 'Orbit';
    if (v.server && v.server !== '@me' && S.serverData[v.server]) {
      const sd = S.serverData[v.server];
      icon = sd.icon ? `<img src="${esc(sd.icon)}" alt="">` : `<span class="tb-ini">${esc(sd.name.split(/\s+/).map(w => w[0]).join('').slice(0, 3))}</span>`;
      name = sd.name;
    } else if (v.channel) {
      const ch = findChannel(v.channel);
      if (ch?.type === 'dm') { icon = avatar(ch.user, 's24'); name = ch.user?.display_name || 'Direct message'; }
      else if (ch?.type === 'group') { name = ch.name || 'Group chat'; icon = `<span class="tb-ico">${I.users}</span>`; }
    } else if (v.server === '@me') { name = 'Friends'; icon = `<span class="tb-ico">${I.users}</span>`; }
    $('.tb-where', this.el).innerHTML = `${icon}<span>${esc(name)}</span>`;
    document.title = name === 'Orbit' ? 'Orbit' : `${name} — Orbit`;
    $('[data-tb-inbox]', this.el).classList.toggle('has-dot', !!S.inboxUnread);
  },
  // keep the window's min/max/close buttons in the same colors as the theme
  syncColors() {
    if (!this.on || !window.orbitDesktop.setTitleBarColors) return;
    const cs = getComputedStyle(document.body);
    const hex = (c) => { const m = c.match(/\d+(\.\d+)?/g); if (!m) return null; return '#' + m.slice(0, 3).map(x => Math.round(Number(x)).toString(16).padStart(2, '0')).join(''); };
    const bg = hex(getComputedStyle(this.el).backgroundColor), fg = hex(cs.getPropertyValue('color'));
    if (bg && fg) window.orbitDesktop.setTitleBarColors(bg, fg).catch(() => {});
  },
};
if (TitleBar.on) {
  const start = () => { if (S.me) { TitleBar.mount(); Nav.record(S.view); } else setTimeout(start, 300); };
  start();
  // theme switches and server renames: keep the bar current
  new MutationObserver(() => TitleBar.syncColors()).observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
  new MutationObserver(() => TitleBar.syncColors()).observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  setInterval(() => TitleBar.update(), 4000);
}
