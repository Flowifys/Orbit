// draws the overlay from the state the Orbit window sends (see Overlay in public/js/voice.js)
const box = document.getElementById('box');
const MIC_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="#f23f43" stroke-width="2.4" stroke-linecap="round"><path d="M3 3l18 18M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M19 11a7 7 0 0 1-1.1 3.8M5 11a7 7 0 0 0 11.4 5.4M12 18v3"/></svg>';
const DEAF = '<svg viewBox="0 0 24 24" fill="none" stroke="#f23f43" stroke-width="2.4" stroke-linecap="round"><path d="M3 3l18 18M3 14v-2a9 9 0 0 1 15-6.7M21 12v2M3 14h3v6H4a1 1 0 0 1-1-1zM21 14h-3v6h2a1 1 0 0 0 1-1z"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.orbitOverlay.onState((st) => {
  document.body.className = st.size || '';
  if (!st.show || !st.users?.length) { box.classList.add('hidden'); window.orbitOverlay.size(0, 0); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<div class="ch"><i></i>${esc(st.channel)}</div>` + st.users.map(u => `<div class="u ${u.speaking ? 'on' : ''}">
    <span class="av" style="${u.avatar ? `background-image:url('${esc(u.avatar)}')` : `background:${esc(u.color)}`}">${u.avatar ? '' : esc(u.initial)}</span>
    <span class="n">${esc(u.name)}</span><span class="ic">${u.live ? '<span class="live">LIVE</span>' : ''}${u.deaf ? DEAF : u.muted ? MIC_OFF : ''}</span></div>`).join('');
  requestAnimationFrame(() => { const r = box.getBoundingClientRect(); window.orbitOverlay.size(Math.ceil(r.width) + 2, Math.ceil(r.height) + 2); });
});
