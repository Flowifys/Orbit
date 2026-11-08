/* Controller mode: use Orbit with an Xbox (or any) controller — on an Xbox in Microsoft Edge,
   or on a PC with a controller plugged in.
     D-pad / left stick  move between things      A  select        B  back / close
     X  options (the right-click menu)            Y  jump to the message box
     LB / RB  previous / next server              LT / RT  scroll the chat
     right stick  scroll        View  member list        Menu  settings
   Turns on by itself when a controller is used (Settings → Appearance → Controller to change). */

const Pad = {
  on: false, raf: 0, held: {}, focus: null, lastMove: 0,
  pref: () => S.prefs.padMode || 'auto',          // 'auto' | 'on' | 'off'
  B: { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, MENU: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 },

  enable() {
    if (this.on || this.pref() === 'off') return;
    this.on = true; document.body.classList.add('pad');
    // Edge on Xbox drives a mouse pointer with the controller unless the page asks for the real controller
    try { if ('gamepadInputEmulation' in navigator) navigator.gamepadInputEmulation = 'gamepad'; } catch {}
    this.hints(); this.loop();
    if (!this.focus || !this.focus.isConnected) this.move(null);
  },
  disable() {
    this.on = false; document.body.classList.remove('pad'); cancelAnimationFrame(this.raf);
    this.focus?.classList.remove('pad-focus'); this.focus = null; $('.pad-hints')?.remove();
    try { if ('gamepadInputEmulation' in navigator) navigator.gamepadInputEmulation = 'mouse'; } catch {}
  },

  /* ---- what can be selected: only inside whatever is on top (menu, popup, settings, the app) ---- */
  scope() {
    const tops = $$('.menu, .msg-sheet, .modal-wrap, .fp-wrap, .popout, .settings, .lightbox').filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed');
    return tops.length ? tops[tops.length - 1] : $('#root') || document.body;
  },
  candidates() {
    const sel = 'button:not(:disabled), a[href], input:not([type=hidden]):not([hidden]), textarea, select, [role=button], [data-ch], [data-dm], [data-server], .msg[data-mid]:not(.system), .mem[data-uid], [data-uid].list-row, [tabindex="0"]';
    return $$(sel, this.scope()).filter(el => {
      if (el.closest('.pad-hints, [hidden], .titlebar') || el.matches('.msg *.toolbar *, .toolbar')) return false;
      const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return false;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      // a parent that's also selectable wins (no landing on the icon inside a button)
      const p = el.parentElement?.closest(sel); if (p && this.scope().contains(p) && p !== el && !p.matches('.msg[data-mid]')) return false;
      return true;
    });
  },
  set(el) {
    this.focus?.classList.remove('pad-focus');
    this.focus = el; if (!el) return;
    el.classList.add('pad-focus');
    if (!el.matches('input, textarea, select')) { try { el.focus({ preventScroll: true }); } catch {} }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  },
  // pick the nearest thing in a direction: straight ahead counts most, sideways drift costs extra
  move(dir) {
    const list = this.candidates(); if (!list.length) return;
    const cur = this.focus && this.focus.isConnected && this.scope().contains(this.focus) ? this.focus : null;
    if (!cur || !dir) {
      const pick = list.find(e => e.matches('.ch.active, .dm-item.active, [data-server].active')) || list.find(e => e.closest('.main')) || list[0];
      return this.set(pick);
    }
    const a = cur.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of list) {
      if (el === cur || el.contains(cur) || cur.contains(el)) continue;
      const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      let main, side;
      if (dir === 'up') { main = a.top - b.bottom; side = Math.abs(bx - ax); if (by >= ay - 2) continue; }
      if (dir === 'down') { main = b.top - a.bottom; side = Math.abs(bx - ax); if (by <= ay + 2) continue; }
      if (dir === 'left') { main = a.left - b.right; side = Math.abs(by - ay); if (bx >= ax - 2) continue; }
      if (dir === 'right') { main = b.left - a.right; side = Math.abs(by - ay); if (bx <= ax + 2) continue; }
      const overlap = dir === 'up' || dir === 'down' ? (b.right > a.left && b.left < a.right) : (b.bottom > a.top && b.top < a.bottom);
      const score = Math.max(0, main) + side * (overlap ? 0.3 : 2.2);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.set(best);
  },

  press(el) {
    if (!el) return;
    if (el.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]), textarea, select, [contenteditable]')) { el.focus(); el.click?.(); return; }
    if (el.matches('.msg[data-mid]')) return this.menu(el);      // A on a message = its actions
    el.click();
    setTimeout(() => { if (!this.focus?.isConnected || !this.scope().contains(this.focus)) this.move(null); }, 120);
  },
  menu(el) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + Math.min(r.width / 2, 120), clientY: r.top + Math.min(r.height / 2, 30) }));
    setTimeout(() => this.move(null), 80);
  },
  back() {
    const ae = document.activeElement;
    if (ae && ae.matches('input, textarea, [contenteditable]')) { ae.blur(); if (this.focus) this.set(this.focus); return; }
    const scope = this.scope();
    if (scope !== $('#root')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if (scope.isConnected && scope.matches('.settings')) scope.querySelector('.close, [data-close]')?.click();
      setTimeout(() => this.move(null), 120); return;
    }
    if ($('.app.show-main')) { $('[data-back]')?.click(); return setTimeout(() => this.move(null), 120); }
    if (typeof Nav !== 'undefined' && Nav.can(-1)) { Nav.go(-1); setTimeout(() => this.move(null), 150); }
  },
  server(step) {
    const ids = ['@me', ...S.servers.map(s => s.id)];
    const i = Math.max(0, ids.indexOf(S.view.server || '@me'));
    selectServer(ids[(i + step + ids.length) % ids.length]);
    setTimeout(() => this.move(null), 150);
  },
  scrollChat(dy) { const box = this.focus?.closest('.scroll, .messages, .fp-body, .sbody') || $('.main .messages'); box?.scrollBy({ top: dy }); },

  /* ---- reading the controller ---- */
  loop() {
    cancelAnimationFrame(this.raf);
    const tick = (t) => {
      if (!this.on) return;
      const gp = [...(navigator.getGamepads?.() || [])].find(Boolean);
      if (gp) this.read(gp, t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  read(gp, t) {
    const btn = (i) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, rx = gp.axes[2] || 0, ry = gp.axes[3] || 0;
    const dirs = { up: btn(this.B.UP) || ay < -0.6, down: btn(this.B.DOWN) || ay > 0.6, left: btn(this.B.LEFT) || ax < -0.6, right: btn(this.B.RIGHT) || ax > 0.6 };
    // directions repeat while held: first step, short pause, then steady
    for (const [d, isOn] of Object.entries(dirs)) {
      const k = 'dir-' + d, h = this.held[k];
      if (!isOn) { delete this.held[k]; continue; }
      if (!h) { this.held[k] = { at: t, next: t + 380 }; this.move(d); }
      else if (t >= h.next) { h.next = t + 110; this.move(d); }
    }
    const once = (name, fn) => { const i = this.B[name]; if (btn(i)) { if (!this.held[name]) { this.held[name] = 1; fn(); } } else delete this.held[name]; };
    once('A', () => this.press(this.focus));
    once('B', () => this.back());
    once('X', () => this.menu(this.focus));
    once('Y', () => { const c = $('.main .composer textarea, .main .composer [contenteditable]'); if (c) { c.focus(); this.set(c); } });
    once('LB', () => this.server(-1));
    once('RB', () => this.server(1));
    once('VIEW', () => { $('[data-members]')?.click(); setTimeout(() => this.move(null), 120); });
    once('MENU', () => { openUserSettings(); setTimeout(() => this.move(null), 200); });
    const lt = gp.buttons[this.B.LT]?.value || 0, rt = gp.buttons[this.B.RT]?.value || 0;
    if (lt > 0.2) this.scrollChat(-18 * lt); if (rt > 0.2) this.scrollChat(18 * rt);
    if (Math.abs(ry) > 0.2) this.scrollChat(ry * 16);
    if (Math.abs(rx) > 0.5 && !this.held.rx) { this.held.rx = 1; } else if (Math.abs(rx) <= 0.5) delete this.held.rx;
  },

  hints() {
    if ($('.pad-hints')) return;
    const g = (l, c) => `<span class="ph-key ph-${c}">${l}</span>`;
    document.body.insertAdjacentHTML('beforeend', `<div class="pad-hints" aria-hidden="true">
      <span>${g('A', 'a')}Select</span><span>${g('B', 'b')}Back</span><span>${g('X', 'x')}Options</span><span>${g('Y', 'y')}Type</span>
      <span>${g('LB', 'sh')}${g('RB', 'sh')}Servers</span><span>${g('LT', 'sh')}${g('RT', 'sh')}Scroll</span></div>`);
  },
};

// a controller showing up (or a button press on one) turns controller mode on; touching the mouse turns the highlight off
window.addEventListener('gamepadconnected', () => { if (Pad.pref() !== 'off') Pad.enable(); });
window.addEventListener('gamepaddisconnected', () => { if (Pad.pref() === 'auto' && ![...(navigator.getGamepads?.() || [])].some(Boolean)) Pad.disable(); });
document.addEventListener('mousemove', (e) => { if (Pad.on && Pad.pref() === 'auto' && (Math.abs(e.movementX) + Math.abs(e.movementY)) > 6 && !('gamepadInputEmulation' in navigator)) { Pad.focus?.classList.remove('pad-focus'); } }, { passive: true });
// some browsers only report a controller after its first button press: poll lightly until one appears
setInterval(() => { if (!Pad.on && Pad.pref() !== 'off' && [...(navigator.getGamepads?.() || [])].some(g => g && g.buttons.some(b => b.pressed))) Pad.enable(); }, 1000);
// Xbox: Edge reports itself with "Xbox" in the user agent — start in controller mode there
if (/Xbox/i.test(navigator.userAgent) && Pad.pref() !== 'off') setTimeout(() => Pad.enable(), 800);
if (Pad.pref() === 'on') setTimeout(() => Pad.enable(), 800);

/* Settings → Appearance → Controller (settings.js loads after this file, so hook in once everything is loaded) */
window.addEventListener('load', () => {
  if (typeof userAppearance !== 'function') return;
  const _ua = userAppearance;
  userAppearance = function (body) {
    _ua(body);
    const cur = Pad.pref();
    body.insertAdjacentHTML('beforeend', `<h3>Controller</h3><p class="hint">Use Orbit with an Xbox or other controller — on an Xbox in Microsoft Edge, or on a PC with a controller plugged in.</p>
      <div class="chip-select pad-pick">${[['auto', 'Automatic'], ['on', 'Always on'], ['off', 'Off']].map(([k, l]) => `<button data-padmode="${k}" class="${cur === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <p class="hint" style="margin-top:8px">A select · B back · X options · Y type a message · LB/RB switch servers · LT/RT scroll · View member list · Menu settings</p>`);
    $$('[data-padmode]', body).forEach(b => b.onclick = () => {
      S.prefs.padMode = b.dataset.padmode; savePrefs();
      $$('[data-padmode]', body).forEach(x => x.classList.toggle('on', x === b));
      if (b.dataset.padmode === 'on') Pad.enable(); else if (b.dataset.padmode === 'off') Pad.disable();
      else if ([...(navigator.getGamepads?.() || [])].some(Boolean)) Pad.enable(); else Pad.disable();
    });
  };
});
