'use strict';
/* Orbit voice & video: mesh WebRTC with "perfect negotiation" */
function mediaError(e, what) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return `Orbit isn’t allowed to use your ${what}. On Windows, open Settings → Privacy & security → ${what === 'camera' ? 'Camera' : 'Microphone'}, and turn on “Let desktop apps access your ${what}”.`;
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return `Your ${what} is being used by another app (like Zoom, Teams, OBS or a browser tab). Close it and try again.`;
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return `No ${what} was found. Plug one in, or pick a different one in Settings → Voice & Video.`;
  return `Couldn’t start your ${what}${e && e.message ? ': ' + e.message : ''}.`;
}
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

const Voice = {
  channel: null, state: 'idle', muted: false, deaf: false, video: false, screen: false,
  local: null, videoTrack: null, peers: new Map(), speaking: new Set(), focus: null, socket: null,
  _analysers: new Map(), _raf: null,

  bindSocket(sock) {
    this.socket = sock;
    sock.on('voice:peer-joined', ({ user_id }) => { if (this.channel) this.addPeer(user_id, true); });
    sock.on('voice:peer-left', ({ user_id }) => this.removePeer(user_id));
    sock.on('voice:left', ({ channel_id }) => { if (this.channel === channel_id && this.state !== 'leaving') this.cleanup(); });
    sock.on('voice:signal', ({ from, data }) => this.onSignal(from, data));
    sock.on('call:ring', ({ channel_id, from }) => this.ring(channel_id, from));
    sock.on('call:declined', ({ user_id }) => { toast(`${user(user_id).display_name} declined the call`); });
    sock.on('connect', () => { if (this.channel) { const c = this.channel; this.cleanup(); this.join(c); } });
  },

  async join(channelId, opts = {}) {
    if (this.channel === channelId) return;
    if (this.channel) this.leave(true);
    if (!navigator.mediaDevices?.getUserMedia) { toast('Voice needs a secure connection (https) or the Orbit desktop app.', true); return; }
    this.channel = channelId; this.state = 'connecting';
    $('.ring-modal')?.closest('.modal-wrap')?.remove();
    rerenderVoiceUi();
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: S.prefs.mic ? { ideal: S.prefs.mic } : undefined, echoCancellation: true, noiseSuppression: S.prefs.noise, autoGainControl: true }, video: false });
    } catch (e) {
      toast(mediaError(e, 'microphone') + ' You joined muted.', true);
      this.local = new MediaStream();
      this.muted = true;
    }
    this.applyMute();
    this.watchSpeaking(S.me.id, this.local);
    this.socket.emit('voice:join', { channel_id: channelId, muted: this.muted, deaf: this.deaf }, (res) => {
      if (!res || res.error) { toast(res?.error || 'Couldn’t join voice', true); this.cleanup(); return; }
      if (this.channel !== channelId) return;
      this.state = 'connected';
      beep('join');
      res.peers.forEach(p => this.addPeer(p, false));
      if (opts.video) this.toggleCamera();
      rerenderVoiceUi();
    });
  },
  leave(silent) {
    if (!this.channel) return;
    this.state = 'leaving';
    this.socket?.emit('voice:leave');
    if (!silent) beep('leave');
    this.cleanup();
  },
  cleanup() {
    for (const id of [...this.peers.keys()]) this.removePeer(id, true);
    this.local?.getTracks().forEach(t => t.stop());
    this.videoTrack?.stop();
    this.local = null; this.videoTrack = null; this.video = false; this.screen = false;
    this._analysers.forEach(a => a.ctx.close().catch(() => {})); this._analysers.clear(); this.speaking.clear();
    cancelAnimationFrame(this._raf); this._raf = null;
    this.channel = null; this.state = 'idle'; this.focus = null;
    rerenderVoiceUi();
  },

  addPeer(id, polite) {
    if (id === S.me.id || this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection(ICE);
    const peer = { id, pc, polite: S.me.id > id, makingOffer: false, ignoreOffer: false, stream: new MediaStream(), audio: new Audio(), videoStream: null };
    peer.audio.autoplay = true; peer.audio.muted = this.deaf;
    this.peers.set(id, peer);
    this.local?.getAudioTracks().forEach(t => pc.addTrack(t, this.local));
    if (this.videoTrack) pc.addTrack(this.videoTrack, this.local);
    pc.ontrack = ({ track }) => {
      if (track.kind === 'audio') {
        peer.stream.addTrack(track);
        peer.audio.srcObject = peer.stream;
        peer.audio.play().catch(() => {});
        if (S.prefs.speaker && peer.audio.setSinkId) peer.audio.setSinkId(S.prefs.speaker).catch(() => {});
        this.watchSpeaking(id, peer.stream);
      } else {
        peer.videoStream = new MediaStream([track]);
        track.onunmute = () => renderVoiceArea();
        track.onended = () => { peer.videoStream = null; renderVoiceArea(); };
        renderVoiceArea();
      }
    };
    pc.onnegotiationneeded = async () => {
      try { peer.makingOffer = true; await pc.setLocalDescription(); this.signal(id, { description: pc.localDescription }); }
      catch (e) { console.warn(e); } finally { peer.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => candidate && this.signal(id, { candidate });
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce?.(); };
    return peer;
  },
  removePeer(id, quiet) {
    const p = this.peers.get(id); if (!p) return;
    p.pc.close(); p.audio.srcObject = null;
    const a = this._analysers.get(id); if (a) { a.ctx.close().catch(() => {}); this._analysers.delete(id); }
    this.speaking.delete(id);
    this.peers.delete(id);
    if (this.focus === id) this.focus = null;
    if (!quiet) renderVoiceArea();
  },
  signal(to, data) { this.socket.emit('voice:signal', { to, data }); },
  async onSignal(from, { description, candidate }) {
    if (!this.channel) return;
    const peer = this.peers.get(from) || this.addPeer(from, true);
    const pc = peer.pc;
    try {
      if (description) {
        const collision = description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') { await pc.setLocalDescription(); this.signal(from, { description: pc.localDescription }); }
      } else if (candidate) {
        try { await pc.addIceCandidate(candidate); } catch (e) { if (!peer.ignoreOffer) throw e; }
      }
    } catch (e) { console.warn('signal error', e); }
  },

  applyMute() { this.local?.getAudioTracks().forEach(t => (t.enabled = !this.muted && !this.deaf)); },
  toggleMute() {
    if (this.deaf && this.muted) { this.deaf = false; this.peers.forEach(p => (p.audio.muted = false)); }
    this.muted = !this.muted;
    beep(this.muted ? 'mute' : 'unmute');
    this.applyMute(); this.update(); rerenderVoiceUi();
  },
  toggleDeaf() {
    this.deaf = !this.deaf;
    if (this.deaf) { this._wasMuted = this.muted; this.muted = true; } else this.muted = !!this._wasMuted && this.muted;
    if (!this.deaf && this.muted && !this._wasMuted) this.muted = false;
    this.peers.forEach(p => (p.audio.muted = this.deaf));
    beep(this.deaf ? 'mute' : 'unmute');
    this.applyMute(); this.update(); rerenderVoiceUi();
  },
  update() { if (this.channel) this.socket.emit('voice:update', { muted: this.muted, deaf: this.deaf, video: this.video, screen: this.screen }); },

  async setVideoTrack(track, kind) {
    const old = this.videoTrack;
    this.videoTrack = track;
    for (const p of this.peers.values()) {
      const sender = p.pc.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender && track) await sender.replaceTrack(track).catch(() => {});
      else if (sender && !track) p.pc.removeTrack(sender);
      else if (track) p.pc.addTrack(track, this.local);
    }
    if (old && old !== track) old.stop();
    this.video = kind === 'camera'; this.screen = kind === 'screen';
    this.update(); rerenderVoiceUi();
  },
  async toggleCamera() {
    if (!this.channel) return toast('Join a voice channel first');
    if (this.video) return this.setVideoTrack(null);
    try {
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: S.prefs.cam ? { ideal: S.prefs.cam } : undefined, width: { ideal: 1280 }, height: { ideal: 720 } } }); }
      catch (e1) { if (e1.name === 'NotAllowedError' || e1.name === 'SecurityError') throw e1; s = await navigator.mediaDevices.getUserMedia({ video: true }); }
      const t = s.getVideoTracks()[0];
      t.onended = () => { if (this.videoTrack === t) this.setVideoTrack(null); };
      this.setVideoTrack(t, 'camera');
    } catch (e) { toast(mediaError(e, 'camera'), true); }
  },
  async toggleScreen() {
    if (!this.channel) return toast('Join a voice channel first');
    if (this.screen) return this.setVideoTrack(null);
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
      const t = s.getVideoTracks()[0];
      t.contentHint = 'detail';
      t.onended = () => { if (this.videoTrack === t) this.setVideoTrack(null); };
      this.setVideoTrack(t, 'screen');
    } catch (e) { if (e.name !== 'NotAllowedError') toast('Screen sharing isn’t available here.', true); }
  },

  watchSpeaking(id, stream) {
    if (!stream || !stream.getAudioTracks().length || this._analysers.has(id)) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      this._analysers.set(id, { ctx, an, buf: new Uint8Array(an.frequencyBinCount), last: 0 });
      if (!this._raf) this.tick();
    } catch {}
  },
  tick() {
    let changed = false; const now = performance.now();
    for (const [id, a] of this._analysers) {
      a.an.getByteFrequencyData(a.buf);
      const level = a.buf.reduce((x, y) => x + y, 0) / a.buf.length;
      const muted = id === S.me.id ? this.muted : (S.voice[this.channel] || []).find(u => u.user_id === id)?.muted;
      if (level > 14 && !muted) a.last = now;
      const on = now - a.last < 250;
      if (on !== this.speaking.has(id)) { on ? this.speaking.add(id) : this.speaking.delete(id); changed = true; }
    }
    if (changed) { $$('[data-speak]').forEach(el => el.classList.toggle('speaking', this.speaking.has(el.dataset.speak))); $$('.vc-user').forEach(el => $('.av', el)?.classList.toggle('speaking', this.speaking.has(el.dataset.uid))); }
    this._raf = this._analysers.size ? requestAnimationFrame(() => this.tick()) : null;
  },

  ring(channelId, from) {
    if (this.channel === channelId) return;
    S.users[from.id] = { ...S.users[from.id], ...from };
    let n = 0; const iv = setInterval(() => { if (++n > 10 || !$('.ring-modal')) return clearInterval(iv); beep('ring'); }, 1600); beep('ring');
    modal(`<div class="ring-modal">${avatar(from, 's96')}<h2>${esc(from.display_name)}</h2><p style="color:var(--muted)">Incoming call…</p>
      <div class="btns"><button class="vbtn leave" data-no title="Decline">${I.hangup}</button><button class="vbtn" style="background:var(--green);color:#fff" data-yes title="Accept">${I.phone}</button></div></div>`, (m, close) => {
      $('[data-yes]', m).onclick = () => { close(); clearInterval(iv); if (!S.dms.find(d => d.id === channelId)) S.dms.unshift({ id: channelId, type: 'dm', user: from, last_at: Date.now() }); selectChannel(channelId); this.join(channelId); };
      $('[data-no]', m).onclick = () => { close(); clearInterval(iv); this.socket.emit('call:decline', { channel_id: channelId }); };
      setTimeout(() => { if (document.body.contains(m)) { close(); clearInterval(iv); } }, 30000);
    });
  },
};
window.Voice = Voice;

function rerenderVoiceUi() { renderSidebar(); renderVoiceArea(); }

/* voice channel view + DM call strip */
function renderVoiceArea() {
  const ch = curChannel(); if (!ch) return;
  if (ch.type === 'voice') {
    const view = $('.voice-view'); if (!view) return;
    const inThis = Voice.channel === ch.id;
    const people = S.voice[ch.id] || [];
    if (!inThis) {
      view.innerHTML = `<div class="voice-empty"><div class="ch-welcome" style="padding:0"><div class="big" style="margin:0 auto 12px">${I.speaker}</div></div><h2>${esc(ch.name)}</h2>
        <p>${people.length ? `${people.map(p => esc(nameIn(ch.server_id, p.user_id))).join(', ')} ${people.length === 1 ? 'is' : 'are'} in voice.` : 'No one is here yet.'}</p>
        <button class="btn green" data-joinv>Join Voice</button></div>`;
      $('[data-joinv]', view).onclick = () => { if (!can(PERM.CONNECT, ch.server_id)) return toast('You don’t have permission to connect here', true); Voice.join(ch.id); };
      return;
    }
    view.innerHTML = `<div class="voice-grid"></div>${voiceControlsHtml()}`;
    drawTiles($('.voice-grid', view), ch.id, ch.server_id);
    bindVoiceControls(view);
  } else if (ch.type === 'dm' || ch.type === 'group') {
    const slot = $('.call-slot'); if (!slot) return;
    const people = S.voice[ch.id] || [];
    if (Voice.channel === ch.id) {
      slot.className = 'call-slot call-strip';
      slot.innerHTML = `<div class="voice-grid"></div>${voiceControlsHtml()}`;
      drawTiles($('.voice-grid', slot), ch.id, null);
      bindVoiceControls(slot);
    } else if (people.length) {
      slot.className = 'call-slot call-strip';
      slot.innerHTML = `<div class="voice-empty" style="padding:16px"><p>${esc(people.map(p => user(p.user_id).display_name).join(', '))} ${people.length === 1 ? 'is' : 'are'} in a call</p><button class="btn green" data-joinv>${I.phone} Join Call</button></div>`;
      $('[data-joinv]', slot).onclick = () => Voice.join(ch.id);
    } else { slot.className = 'call-slot'; slot.innerHTML = ''; }
  }
}
function voiceControlsHtml() {
  return `<div class="voice-controls">
    <button class="vbtn ${Voice.video ? 'on' : ''}" data-v="cam" title="${Voice.video ? 'Turn off camera' : 'Turn on camera'}">${Voice.video ? I.video : I.videoOff}</button>
    <button class="vbtn ${Voice.screen ? 'on' : ''}" data-v="screen" title="Share your screen">${I.screen}</button>
    <button class="vbtn ${Voice.muted ? 'off' : ''}" data-v="mute" title="${Voice.muted ? 'Unmute' : 'Mute'}">${Voice.muted ? I.micOff : I.mic}</button>
    <button class="vbtn ${Voice.deaf ? 'off' : ''}" data-v="deaf" title="${Voice.deaf ? 'Undeafen' : 'Deafen'}">${Voice.deaf ? I.deaf : I.headphones}</button>
    <button class="vbtn leave" data-v="leave" title="Disconnect">${I.hangup}</button></div>`;
}
function bindVoiceControls(root) {
  $('.voice-controls', root).onclick = (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (v === 'cam') Voice.toggleCamera(); if (v === 'screen') Voice.toggleScreen();
    if (v === 'mute') Voice.toggleMute(); if (v === 'deaf') Voice.toggleDeaf(); if (v === 'leave') Voice.leave();
  };
}
function drawTiles(grid, cid, sid) {
  const people = (S.voice[cid] || []).slice();
  if (!people.find(p => p.user_id === S.me.id)) people.unshift({ user_id: S.me.id, muted: Voice.muted, deaf: Voice.deaf, video: Voice.video, screen: Voice.screen });
  grid.innerHTML = people.map(p => {
    const u = user(p.user_id);
    const isMe = p.user_id === S.me.id;
    const hasVideo = isMe ? !!Voice.videoTrack : !!Voice.peers.get(p.user_id)?.videoStream;
    const tbg = u.theme_primary ? `background:linear-gradient(160deg,${u.theme_primary},${u.theme_accent || u.theme_primary})` : `background:radial-gradient(120% 120% at 50% 0%,color-mix(in oklab,${u.accent || '#8b6dff'} 40%,var(--bg-2)),var(--bg-2))`;
    return `<div class="tile ${Voice.speaking.has(p.user_id) ? 'speaking' : ''} ${Voice.focus === p.user_id ? 'focus' : ''}" data-speak="${p.user_id}" data-tile="${p.user_id}" style="${hasVideo ? '' : tbg}">
      ${hasVideo ? `<video autoplay playsinline muted></video>` : avatar(u, '')}
      <span class="label">${esc(sid ? nameIn(sid, p.user_id) : u.display_name)}${isMe ? ' (you)' : ''}${p.screen ? ' <span class="live" style="background:var(--red);color:#fff;font-size:10px;padding:0 4px;border-radius:3px">LIVE</span>' : ''}${p.deaf ? I.deaf : p.muted ? I.micOff : ''}</span>
      ${hasVideo ? `<button class="expand" data-focus title="Focus">${I.expand}</button>` : ''}</div>`;
  }).join('');
  $$('[data-tile]', grid).forEach(tile => {
    const id = tile.dataset.tile; const v = $('video', tile); if (!v) return;
    v.srcObject = id === S.me.id ? new MediaStream([Voice.videoTrack]) : Voice.peers.get(id).videoStream;
    if (id === S.me.id && Voice.video) v.style.transform = 'scaleX(-1)';
    v.play().catch(() => {});
  });
  grid.onclick = (e) => {
    const f = e.target.closest('[data-focus]'); if (f) { const id = f.closest('[data-tile]').dataset.tile; Voice.focus = Voice.focus === id ? null : id; renderVoiceArea(); return; }
    const t = e.target.closest('[data-tile]'); if (t && !e.target.closest('video')) profilePopout(t.dataset.tile, t);
  };
}
