'use strict';
/* Orbit voice & video: mesh WebRTC with "perfect negotiation" */
function mediaError(e, what) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return `Orbit isn’t allowed to use your ${what}. On Windows, open Settings → Privacy & security → ${what === 'camera' ? 'Camera' : 'Microphone'}, and turn on “Let desktop apps access your ${what}”.`;
  if (n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError') return `Your ${what} is being used by another app (like Zoom, Teams, OBS or a browser tab). Close it and try again.`;
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') return `No ${what} was found. Plug one in, or pick a different one in Settings → Voice & Video.`;
  return `Couldn’t start your ${what}${e && e.message ? ': ' + e.message : ''}.`;
}
// outgoing-call ringback: a soft two-tone beep, drawn with Web Audio (no sound file needed)
const Ringback = {
  ctx: null, timer: null, stopAt: 0,
  start(onTimeout) {
    if (this.timer || !S.prefs.sounds) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); this.ctx.resume?.(); } catch { return; }
    const ring = () => {
      const c = this.ctx, t = c.currentTime, g = c.createGain(); g.connect(c.destination);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.05); g.gain.setValueAtTime(0.06, t + 1.3); g.gain.linearRampToValueAtTime(0, t + 1.4);
      [440, 480].forEach(f => { const o = c.createOscillator(); o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 1.45); });
    };
    ring(); this.timer = setInterval(ring, 3500);
    this.stopAt = setTimeout(() => { this.stop(); onTimeout && onTimeout(); }, 45000);
  },
  stop() { clearInterval(this.timer); clearTimeout(this.stopAt); this.timer = null; try { this.ctx?.close(); } catch {} this.ctx = null; },
};
const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

const Voice = {
  channel: null, state: 'idle', muted: false, deaf: false, video: false, screen: false,
  local: null, videoTrack: null, peers: new Map(), speaking: new Set(), focus: null, socket: null, volumes: {}, localMutes: new Set(), screenVolumes: {}, screenMutes: new Set(),
  screenAudio: null, screenAudioStream: null, expanded: false, stripHidden: false, _localPreview: null,
  _analysers: new Map(), _raf: null,

  bindSocket(sock) {
    this.socket = sock;
    sock.on('voice:peer-joined', ({ user_id }) => { Ringback.stop(); if (this.channel) this.addPeer(user_id, true); });
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
    this.stopRing();
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
    // relay (TURN) servers from Orbit's server, so calls also work on strict networks
    if (!this._iceAt || this._iceAt < Date.now() - 30 * 60e3) { try { this.ice = await api('GET', '/api/ice'); this._iceAt = Date.now(); } catch {} }
    if (this.channel !== channelId) return;
    this.socket.emit('voice:join', { channel_id: channelId, muted: this.muted, deaf: this.deaf }, (res) => {
      if (!res || res.error) { toast(res?.error || 'Couldn’t join voice', true); this.cleanup(); return; }
      if (this.channel !== channelId) return;
      this.state = 'connected'; this.joinedAt = Date.now();
      playSfx('join');
      res.peers.forEach(p => this.addPeer(p, false));
      // you started a DM / group call and nobody's in it yet: play a ringback tone until someone picks up
      const ch = findChannel(channelId);
      if (!res.peers.length && ch && (ch.type === 'dm' || ch.type === 'group')) Ringback.start(() => { if (this.channel === channelId && !this.peers.size) toast('No answer'); });
      if (opts.video) this.toggleCamera();
      rerenderVoiceUi();
    });
  },
  leave(silent) {
    if (!this.channel) return;
    this.state = 'leaving';
    this.socket?.emit('voice:leave');
    if (!silent) playSfx('leave');
    this.cleanup();
  },
  cleanup() {
    Ringback.stop();
    for (const id of [...this.peers.keys()]) this.removePeer(id, true);
    this.local?.getTracks().forEach(t => t.stop());
    this.videoTrack?.stop(); this.screenAudio?.stop();
    this.local = null; this.videoTrack = null; this.screenAudio = null; this.screenAudioStream = null; this._localPreview = null;
    this.video = false; this.screen = false; this.expanded = false; this.stripHidden = false;
    this._analysers.forEach(a => { try { a.src.disconnect(); } catch {} }); this._speakCtx?.close().catch(() => {}); this._speakCtx = null; this._analysers.clear(); this.speaking.clear(); clearTimeout(this._raf); this._raf = null; this._sentSpeak = false;
    cancelAnimationFrame(this._raf); this._raf = null;
    this.channel = null; this.state = 'idle'; this.focus = null; this.joinedAt = null;
    rerenderVoiceUi();
  },

  addPeer(id, polite) {
    if (id === S.me.id || this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection(this.ice || ICE);
    const peer = { id, pc, polite: S.me.id > id, makingOffer: false, ignoreOffer: false, stream: new MediaStream(), audio: new Audio(), videoStream: null,
      screenStreamId: null, screenAudioEl: null, screenAudioSender: null };
    peer.audio.autoplay = true;
    this.peers.set(id, peer);
    this.applyPeerAudio(peer);
    this.local?.getAudioTracks().forEach(t => pc.addTrack(t, this.local));
    if (this.videoTrack) pc.addTrack(this.videoTrack, this.local);
    if (this.screenAudio) { this.signal(id, { meta: { screenStream: this.screenAudioStream.id } }); peer.screenAudioSender = pc.addTrack(this.screenAudio, this.screenAudioStream); this.tuneAudioSender(peer.screenAudioSender); }
    pc.ontrack = ({ track, streams }) => {
      if (track.kind === 'audio') {
        const sid = streams && streams[0] && streams[0].id;
        if (sid && sid === peer.screenStreamId) {
          // their screen-share audio plays through its own element so it never fights with their mic
          const el = peer.screenAudioEl || (peer.screenAudioEl = new Audio());
          el.autoplay = true; el.srcObject = new MediaStream([track]);
          this.applyPeerAudio(peer);
          el.play().catch(() => {});
          return;
        }
        peer.stream.addTrack(track);
        peer.audio.srcObject = peer.stream;
        peer.audio.play().catch(() => {});
        this.watchSpeaking(id, peer.stream);
      } else {
        peer.videoStream = new MediaStream([track]);
        track.onunmute = () => renderVoiceArea();
        track.onmute = () => renderVoiceArea();
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
    p.pc.close(); p.audio.srcObject = null; if (p.screenAudioEl) p.screenAudioEl.srcObject = null;
    Voice.videoEls.delete(id);
    const a = this._analysers.get(id); if (a) { try { a.src.disconnect(); } catch {} this._analysers.delete(id); }   // shared context stays open
    this.speaking.delete(id);
    this.peers.delete(id);
    if (this.focus === id) this.focus = null;
    if (!quiet) renderVoiceArea();
  },
  signal(to, data) { this.socket.emit('voice:signal', { to, data }); },
  async onSignal(from, { description, candidate, meta }) {
    if (!this.channel) return;
    const peer = this.peers.get(from) || this.addPeer(from, true);
    const pc = peer.pc;
    if (meta) { if ('screenStream' in meta) peer.screenStreamId = meta.screenStream; return; }
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
  // one place that decides volume / mute / output device for everything we hear from a peer
  applyPeerAudio(p) {
    const muted = this.deaf || this.localMutes.has(p.id);
    const micVol = Math.min(1, this.volumes[p.id] ?? 1);
    const scrVol = Math.min(1, this.screenVolumes[p.id] ?? (S.prefs.streamVolumes?.[p.id] ?? 1));
    const pairs = [[p.audio, micVol], [p.screenAudioEl, this.screenMutes.has(p.id) ? 0 : scrVol]];
    for (const [el, vol] of pairs) {
      if (!el) continue;
      el.muted = muted; el.volume = vol;
      if (S.prefs.speaker && el.setSinkId && el.sinkId !== S.prefs.speaker) el.setSinkId(S.prefs.speaker).catch(() => {});
    }
  },
  tuneAudioSender(sender) {
    // screen audio is usually music/game sound: give it far more bitrate than a voice
    try { const prm = sender.getParameters(); prm.encodings = prm.encodings && prm.encodings.length ? prm.encodings : [{}]; prm.encodings[0].maxBitrate = 128000; sender.setParameters(prm).catch(() => {}); } catch {}
  },
  setUserVolume(id, v) { this.volumes[id] = v; if (v > 0) this.localMutes.delete(id); const p = this.peers.get(id); if (p) this.applyPeerAudio(p); },
  toggleUserMute(id) { const on = !this.localMutes.has(id); on ? this.localMutes.add(id) : this.localMutes.delete(id); const p = this.peers.get(id); if (p) this.applyPeerAudio(p); return on; },
  // separate volume for a person's SCREEN-SHARE audio, independent of their mic
  setStreamVolume(id, v) { this.screenVolumes[id] = v; if (v > 0) this.screenMutes.delete(id); S.prefs.streamVolumes = S.prefs.streamVolumes || {}; S.prefs.streamVolumes[id] = v; savePrefs(); const p = this.peers.get(id); if (p) this.applyPeerAudio(p); },
  toggleStreamMute(id) { const on = !this.screenMutes.has(id); on ? this.screenMutes.add(id) : this.screenMutes.delete(id); const p = this.peers.get(id); if (p) this.applyPeerAudio(p); return on; },
  hasStreamAudio(id) { const p = this.peers.get(id); return !!(p && p.screenAudioEl && p.screenAudioEl.srcObject); },
  toggleMute() {
    if (this.deaf && this.muted) { this.deaf = false; this.peers.forEach(p => this.applyPeerAudio(p)); }
    this.muted = !this.muted;
    beep(this.muted ? 'mute' : 'unmute');
    this.applyMute(); this.update(); rerenderVoiceUi();
  },
  toggleDeaf() {
    this.deaf = !this.deaf;
    if (this.deaf) { this._wasMuted = this.muted; this.muted = true; } else this.muted = !!this._wasMuted && this.muted;
    if (!this.deaf && this.muted && !this._wasMuted) this.muted = false;
    this.peers.forEach(p => this.applyPeerAudio(p));
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
    this._localPreview = null;
    this.video = kind === 'camera'; this.screen = kind === 'screen';
    if (kind !== 'screen' && this.screenAudio) await this.setScreenAudio(null);
    if (kind !== 'screen' && this.focus === S.me.id) this.focus = null;
    this.update(); rerenderVoiceUi();
  },
  async setScreenAudio(track) {
    const old = this.screenAudio;
    if (track && !this.screenAudioStream) this.screenAudioStream = new MediaStream();
    this.screenAudio = track;
    for (const p of this.peers.values()) {
      if (p.screenAudioSender) { await p.screenAudioSender.replaceTrack(track).catch(() => {}); continue; }
      if (!track) continue;
      this.signal(p.id, { meta: { screenStream: this.screenAudioStream.id } });
      p.screenAudioSender = p.pc.addTrack(track, this.screenAudioStream);
      this.tuneAudioSender(p.screenAudioSender);
    }
    if (old && old !== track) old.stop();
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
    // ask the browser to leave our own call audio out of the capture, so nobody hears themselves echoed back
    const shareAudio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false, restrictOwnAudio: true };
    try {
      let stream;
      if (window.orbitDesktop?.getScreenSources) {
        const pick = await pickScreenSource();
        if (!pick) return;
        const q = pick.quality || {};
        if (window.orbitDesktop.setShareSource) {
          // newer desktop app: real getDisplayMedia with system audio (loopback)
          await window.orbitDesktop.setShareSource(pick.id, !!pick.audio);
          stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: q.w || 1920 }, height: { ideal: q.h || 1080 }, frameRate: { ideal: q.fps || 30 } }, audio: pick.audio ? shareAudio : false });
        } else {
          const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: pick.id, maxWidth: q.w || 1920, maxHeight: q.h || 1080, maxFrameRate: q.fps || 30 } };
          try { stream = await navigator.mediaDevices.getUserMedia({ audio: pick.audio ? { mandatory: { chromeMediaSource: 'desktop' } } : false, video }); }
          catch (e1) { if (!pick.audio) throw e1; stream = await navigator.mediaDevices.getUserMedia({ audio: false, video }); toast('Couldn’t capture your computer’s sound, so you’re sharing video only.', true); }
        }
      } else {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 }, width: { ideal: 1920 } }, audio: shareAudio, systemAudio: 'include', selfBrowserSurface: 'exclude' });
      }
      const t = stream.getVideoTracks()[0];
      t.contentHint = 'detail';
      t.onended = () => { if (this.videoTrack === t) this.setVideoTrack(null); };
      const a = stream.getAudioTracks()[0] || null;
      if (a) { a.contentHint = 'music'; a.onended = () => { if (this.screenAudio === a) this.setScreenAudio(null); }; }
      await this.setVideoTrack(t, 'screen');
      if (!this.channel || this.videoTrack !== t) { a?.stop(); return; }
      await this.setScreenAudio(a);
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('Screen sharing isn’t available here.', true); }
  },

  remoteSpeaking: new Set(),   // people talking in calls I'm not in (from the server)
  watchSpeaking(id, stream) {
    if (!stream || !stream.getAudioTracks().length || this._analysers.has(id)) return;
    try {
      // one shared audio context, started when you join (a click). Contexts made later for other people
      // start "suspended" in browsers, which read as silence — that's why only your own ring used to move.
      const ctx = this._speakCtx = this._speakCtx && this._speakCtx.state !== 'closed' ? this._speakCtx : new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const src = ctx.createMediaStreamSource(stream); const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      this._analysers.set(id, { ctx, src, an, buf: new Uint8Array(an.frequencyBinCount), last: 0 });
      if (!this._raf) this.tick();
    } catch {}
  },
  tick() {
    if (this._speakCtx?.state === 'suspended') this._speakCtx.resume().catch(() => {});
    let changed = false; const now = performance.now();
    for (const [id, a] of this._analysers) {
      a.an.getByteFrequencyData(a.buf);
      const level = a.buf.reduce((x, y) => x + y, 0) / a.buf.length;
      const muted = id === S.me.id ? this.muted : (S.voice[this.channel] || []).find(u => u.user_id === id)?.muted;
      if (level > 14 && !muted) a.last = now;
      const on = now - a.last < 250;
      if (on !== this.speaking.has(id)) { on ? this.speaking.add(id) : this.speaking.delete(id); changed = true; }
    }
    if (changed) {
      paintSpeaking();
      // let everyone else (sidebar, their overlays) know when I start/stop talking
      const meOn = this.speaking.has(S.me.id);
      if (meOn !== this._sentSpeak && this.socket?.connected !== false && typeof socket !== 'undefined' && socket) { this._sentSpeak = meOn; socket.emit('voice:speaking', { on: meOn }); }
    }
    // a timer instead of requestAnimationFrame: animation frames stop when Orbit is behind a game, timers keep going
    this._raf = this._analysers.size ? setTimeout(() => this.tick(), 50) : null;
  },

  // one place that ends an incoming call ring: sound + popup
  stopRing() { Ringtone.stop(); this.ringing = null; clearTimeout(this._ringTimer); $$('.ring-modal').forEach(m => m.closest('.modal-wrap')?.remove()); },
  ring(channelId, from) {
    if (this.channel === channelId || this.ringing === channelId) return;   // already in it, or already ringing for it
    if (this.ringing) this.stopRing();
    S.users[from.id] = { ...S.users[from.id], ...from };
    this.ringing = channelId;
    Ringtone.start();
    const stop = () => this.stopRing();
    this._ringTimer = setTimeout(() => { if (this.ringing === channelId) this.stopRing(); }, 30000);
    modal(`<div class="ring-modal">${avatar(from, 's96')}<h2>${esc(from.display_name)}</h2><p class="ring-sub">Incoming call</p>
      <div class="btns"><button class="vbtn leave" data-no title="Decline">${I.hangup}</button><button class="vbtn ring-accept" data-yes title="Accept">${I.phone}</button></div></div>`, (m, close) => {
      $('[data-yes]', m).onclick = () => { stop(); close(); if (!S.dms.find(d => d.id === channelId)) S.dms.unshift({ id: channelId, type: 'dm', user: from, last_at: Date.now() }); selectChannel(channelId); this.join(channelId); };
      $('[data-no]', m).onclick = () => { stop(); close(); this.socket.emit('call:decline', { channel_id: channelId }); };
    });
  },
};
window.Voice = Voice;

function rerenderVoiceUi() { renderSidebar(); renderVoiceArea(); }

/* voice channel view + DM call strip */
// cached <video> elements so re-renders don't recreate streams (prevents flicker / fullscreen drops)
Voice.videoEls = Voice.videoEls || new Map();
function stateOf(id) { return (S.voice[Voice.channel] || []).find(p => p.user_id === id); }
function videoFor(id) {
  let el = Voice.videoEls.get(id);
  if (!el) { el = document.createElement('video'); el.autoplay = true; el.playsInline = true; el.muted = true; Voice.videoEls.set(id, el); }
  let stream = null;
  if (id === S.me.id) {
    if (Voice.videoTrack) { if (!Voice._localPreview) Voice._localPreview = new MediaStream([Voice.videoTrack]); stream = Voice._localPreview; }
  } else stream = Voice.peers.get(id)?.videoStream || null;
  if (stream && el.srcObject !== stream) { el.srcObject = stream; el.play().catch(() => {}); }
  el.classList.toggle('mirror', id === S.me.id && Voice.video);  // mirror own camera only, never a screen share
  return el;
}
function hasVideoOf(id) {
  if (id === S.me.id) return !!Voice.videoTrack;
  const p = Voice.peers.get(id), st = stateOf(id);
  // trust the server's state: a stopped remote track can linger frozen on the last frame otherwise
  return !!(p && p.videoStream && (!st || st.video || st.screen) && !p.videoStream.getVideoTracks()[0]?.muted);
}

function renderVoiceArea() {
  const ch = curChannel(); if (!ch) return;
  // never rebuild while a tile is fullscreen — it would exit fullscreen and drop the stream
  if (document.fullscreenElement && document.fullscreenElement.closest('.voice-view, .call-slot')) { refreshStreams(); return; }
  if (ch.type === 'voice') {
    const view = $('.voice-view'); if (!view) return;
    const inThis = Voice.channel === ch.id;
    const people = S.voice[ch.id] || [];
    if (!inThis) {
      view.innerHTML = `<div class="voice-empty"><div class="vc-bubble">${I.speaker}</div><h2>${esc(ch.name)}</h2>
        <p>${people.length ? `${people.map(p => esc(nameIn(ch.server_id, p.user_id))).join(', ')} ${people.length === 1 ? 'is' : 'are'} in voice.` : 'No one’s here yet. Be the first to hop in.'}</p>
        <button class="btn green" data-joinv>${I.phone} Join Voice</button></div>`;
      $('[data-joinv]', view).onclick = () => { if (!can(PERM.CONNECT, ch.server_id)) return toast('You don’t have permission to connect here', true); Voice.join(ch.id); };
      return;
    }
    view.innerHTML = `<div class="stage-wrap"></div>${voiceControlsHtml(false)}`;
    drawStage($('.stage-wrap', view), ch.id, ch.server_id);
    bindVoiceControls(view);
  } else if (ch.type === 'dm' || ch.type === 'group') {
    const slot = $('.call-slot'); if (!slot) return;
    const chat = slot.closest('.chat');
    const people = S.voice[ch.id] || [];
    if (Voice.channel === ch.id) {
      slot.className = 'call-slot call-strip' + (Voice.expanded ? ' expanded' : '');
      chat?.classList.toggle('call-expanded', Voice.expanded);
      slot.style.height = !Voice.expanded && S.prefs.callHeight ? `min(${S.prefs.callHeight}px, calc(100% - 150px))` : '';
      slot.innerHTML = `<div class="stage-wrap"></div>${voiceControlsHtml(true)}${Voice.expanded ? '' : '<div class="call-resize" title="Drag to resize · double-click to reset"></div>'}`;
      drawStage($('.stage-wrap', slot), ch.id, null);
      bindVoiceControls(slot);
      bindCallResize(slot);
    } else {
      chat?.classList.remove('call-expanded');
      slot.style.height = '';
      if (people.length) {
        slot.className = 'call-slot call-strip ringing';
        slot.innerHTML = `<div class="call-join"><div class="cj-avatars">${people.slice(0, 4).map(p => avatar(user(p.user_id), 's32', true)).join('')}</div><div class="cj-text"><b>${esc(people.map(p => user(p.user_id).display_name).join(', '))}</b><span>${people.length === 1 ? 'is' : 'are'} in a call</span></div><button class="btn green" data-joinv>${I.phone} Join</button></div>`;
        $('[data-joinv]', slot).onclick = () => Voice.join(ch.id);
      } else { slot.className = 'call-slot'; slot.innerHTML = ''; }
    }
  }
}
// drag the bottom edge of a DM/group call to make it taller or shorter (like Discord); remembered between sessions
function bindCallResize(slot) {
  const handle = $('.call-resize', slot); if (!handle) return;
  handle.onpointerdown = (e) => {
    e.preventDefault();
    const chat = slot.closest('.chat'), startY = e.clientY, startH = slot.getBoundingClientRect().height;
    const max = () => Math.max(200, (chat?.clientHeight || innerHeight) - 150);
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-call');
    handle.onpointermove = (ev) => { const hgt = Math.round(Math.min(max(), Math.max(180, startH + ev.clientY - startY))); slot.style.height = hgt + 'px'; S.prefs.callHeight = hgt; };
    handle.onpointerup = handle.onpointercancel = () => {
      handle.onpointermove = handle.onpointerup = handle.onpointercancel = null;
      document.body.classList.remove('resizing-call');
      savePrefs();
    };
  };
  handle.ondblclick = () => { delete S.prefs.callHeight; savePrefs(); slot.style.height = ''; };
}
function fmtCallTime(ms) { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; }
setInterval(() => { if (Voice.joinedAt) $$('[data-vtime]').forEach(el => (el.textContent = fmtCallTime(Date.now() - Voice.joinedAt))); }, 1000);
function refreshStreams() { $$('[data-tile]').forEach(t => { const id = t.dataset.tile; if (hasVideoOf(id)) { const holder = $('.vid-holder', t) || t; const ex = $('video', holder); const el = videoFor(id); if (ex !== el) { if (ex) ex.remove(); holder.appendChild(el); } } }); }

function participants(cid) {
  const people = (S.voice[cid] || []).slice();
  if (!people.find(p => p.user_id === S.me.id)) people.unshift({ user_id: S.me.id, muted: Voice.muted, deaf: Voice.deaf, video: Voice.video, screen: Voice.screen });
  return people;
}
function tileColor(u) {
  // solid, muted card colour from the user's profile colour (no gradients)
  const c = u.theme_primary || u.banner_color || u.accent || '#8b6dff';
  return `background:color-mix(in oklab,${c} 34%,var(--tile-bg))`;
}
function tileInner(p, sid, where) {
  const u = user(p.user_id);
  const isMe = p.user_id === S.me.id;
  const vid = hasVideoOf(p.user_id);
  const onStage = where === 'stage';
  const tools = [];
  if (onStage) tools.push(`<button data-strip title="${Voice.stripHidden ? 'Show members' : 'Hide members'}">${Voice.stripHidden ? I.users : I.usersOff}</button>`);
  tools.push(`<button data-focus title="${onStage ? 'Back to grid' : 'Focus'}">${onStage ? I.shrink : I.expand}</button>`);
  if (vid) tools.push(`<button data-fs title="Full screen">${I.fs}</button>`);
  return `<div class="tile ${vid ? 'has-video' : ''} ${Voice.speaking.has(p.user_id) ? 'speaking' : ''}" data-speak="${p.user_id}" data-tile="${p.user_id}" style="${vid ? '' : tileColor(u)}">
      <div class="vid-holder"></div>${vid ? '' : avatar(u, 's96')}
      <span class="label">${p.deaf ? srIcon(I.deaf, 'Deafened') : p.muted ? srIcon(I.micOff, 'Muted') : ''}<span class="ln">${esc(sid ? nameIn(sid, p.user_id) : u.display_name)}${isMe ? ' (you)' : ''}</span>${p.screen ? '<span class="live">LIVE</span>' : ''}</span>
      <div class="tile-tools">${tools.join('')}</div></div>`;
}
// Fit n 16:9 tiles into a box as large as possible without overlap (Discord-style grid)
function fitTiles(W, H, n, gap) {
  let best = { w: 0, cols: 1 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const w = Math.min((W - gap * (cols - 1)) / cols, ((H - gap * (rows - 1)) / rows) * 16 / 9);
    if (w > best.w) best = { w, cols };
  }
  return Math.max(80, Math.floor(best.w));
}
function layoutGrid(grid) {
  if (!grid || !grid.isConnected) return;
  const n = grid.children.length; if (!n) return;
  const cs = getComputedStyle(grid);
  const W = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const H = grid.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  if (W <= 0 || H <= 0) return;
  grid.style.setProperty('--tw', fitTiles(W, H, n, 10) + 'px');
}
function drawStage(wrap, cid, sid) {
  const people = participants(cid);
  // stage = explicit focus; otherwise auto-focus someone else's screen share (Discord-style). 'grid' forces the grid.
  let stageId = null;
  if (Voice.focus && Voice.focus !== 'grid' && people.find(p => p.user_id === Voice.focus)) stageId = Voice.focus;
  else if (!Voice.focus) stageId = (people.find(p => p.screen && p.user_id !== S.me.id && hasVideoOf(p.user_id)) || {}).user_id || null;
  if (stageId && people.length > 0) {
    const stageP = people.find(p => p.user_id === stageId);
    const others = people.filter(p => p.user_id !== stageId);
    wrap.className = 'stage-wrap theater' + (Voice.stripHidden || !others.length ? ' no-strip' : '');
    const sh = Math.max(70, Math.min(280, S.prefs.stripH || 116));
    wrap.style.setProperty('--strip-h', sh + 'px');
    wrap.innerHTML = `<div class="stage">${tileInner(stageP, sid, 'stage')}</div>
      ${Voice.stripHidden || !others.length ? '' : `<div class="strip-resize" title="Drag to resize · double-click to reset" role="separator" aria-orientation="horizontal"></div><div class="strip">${others.map(p => tileInner(p, sid, 'strip')).join('')}</div>`}`;
    bindStripResize(wrap);
  } else {
    wrap.className = 'stage-wrap grid-mode';
    wrap.innerHTML = `<div class="voice-grid">${people.map(p => tileInner(p, sid, 'grid')).join('')}</div>`;
    const grid = $('.voice-grid', wrap);
    layoutGrid(grid);
    Voice._ro?.disconnect();
    Voice._ro = new ResizeObserver(() => layoutGrid(grid));
    Voice._ro.observe(grid);
  }
  // attach cached video elements
  $$('[data-tile]', wrap).forEach(t => { const id = t.dataset.tile; if (hasVideoOf(id)) $('.vid-holder', t).appendChild(videoFor(id)); });
  const setFocus = (id) => { Voice.focus = id; renderVoiceArea(); };
  wrap.onclick = (e) => {
    const t = e.target.closest('[data-tile]'); if (!t) return;
    const id = t.dataset.tile, onStage = !!t.closest('.stage');
    if (e.target.closest('[data-fs]')) return toggleFullscreen(t);
    if (e.target.closest('[data-strip]')) { Voice.stripHidden = !Voice.stripHidden; return renderVoiceArea(); }
    if (e.target.closest('[data-focus]')) return setFocus(onStage ? 'grid' : id);
    if (e.target.closest('button')) return;
    // like Discord: click anyone to put them on the big stage, click the big tile to go back to the grid
    if (onStage) return setFocus('grid');
    return setFocus(id);
  };
  wrap.ondblclick = (e) => { const t = e.target.closest('[data-tile]'); if (t && hasVideoOf(t.dataset.tile)) toggleFullscreen(t); };
  wrap.oncontextmenu = (e) => { const t = e.target.closest('[data-tile]'); if (t) { e.preventDefault(); callUserMenu(e, t.dataset.tile); } };
}
// drag the bar between the big tile and the row of small ones to make the row bigger or smaller
function bindStripResize(wrap) {
  const bar = $('.strip-resize', wrap); if (!bar) return;
  bar.onpointerdown = (e) => {
    e.preventDefault(); bar.setPointerCapture(e.pointerId); document.body.classList.add('resizing-call');
    const y0 = e.clientY, h0 = $('.strip', wrap)?.offsetHeight || 116;
    const max = () => Math.min(280, wrap.clientHeight * 0.45);
    bar.onpointermove = (ev) => { const nh = Math.round(Math.max(70, Math.min(max(), h0 - (ev.clientY - y0)))); wrap.style.setProperty('--strip-h', nh + 'px'); S.prefs.stripH = nh; };
    bar.onpointerup = () => { bar.onpointermove = null; document.body.classList.remove('resizing-call'); savePrefs(); };
  };
  bar.ondblclick = () => { S.prefs.stripH = 116; savePrefs(); wrap.style.setProperty('--strip-h', '116px'); };
}
// fill the whole screen with the call (all tiles + controls), like the button at the bottom right in Discord
function toggleCallFullscreen(btn) {
  const area = btn.closest('.voice-view, .call-slot'); if (!area) return;
  if (document.fullscreenElement) return document.exitFullscreen().catch(() => {});
  (area.requestFullscreen ? area.requestFullscreen() : area.webkitRequestFullscreen?.())?.catch?.(() => {});
}
function toggleFullscreen(tile) {
  if (!tile) return;
  if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
  (tile.requestFullscreen ? tile.requestFullscreen() : tile.webkitRequestFullscreen?.()) ?.catch?.(() => {});
}
document.addEventListener('fullscreenchange', () => {
  $$('.tile').forEach(t => t.classList.toggle('is-fs', document.fullscreenElement === t));
  if (!document.fullscreenElement) renderVoiceArea();   // catch up on anything that changed while fullscreen
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.fullscreenElement || !Voice.channel || document.querySelector('.modal-wrap, .layer')) return;
  if (Voice.focus && Voice.focus !== 'grid') { Voice.focus = 'grid'; renderVoiceArea(); }
  else if (Voice.expanded) { Voice.expanded = false; renderVoiceArea(); }
});

function voiceControlsHtml(isDm) {
  return `<div class="voice-controls">
    <div class="vc-group">
      <button class="vbtn ${Voice.muted ? 'off' : ''}" data-v="mute" title="${Voice.muted ? 'Unmute' : 'Mute'}">${Voice.muted ? I.micOff : I.mic}</button>
      <button class="vbtn ${Voice.deaf ? 'off' : ''}" data-v="deaf" title="${Voice.deaf ? 'Undeafen' : 'Deafen'}">${Voice.deaf ? I.deaf : I.headphones}</button>
    </div>
    <div class="vc-group">
      <button class="vbtn ${Voice.video ? 'on' : ''}" data-v="cam" title="${Voice.video ? 'Turn off camera' : 'Turn on camera'}">${Voice.video ? I.video : I.videoOff}</button>
      <button class="vbtn ${Voice.screen ? 'on' : ''}" data-v="screen" title="${Voice.screen ? 'Stop sharing' : 'Share your screen'}">${I.screen}</button>
    </div>
    <button class="vbtn leave" data-v="leave" title="Disconnect">${I.hangup}</button>
    <div class="vc-right">${isDm ? `<button class="vbtn ghost" data-v="expand" title="${Voice.expanded ? 'Collapse call' : 'Make the call take up the chat'}">${Voice.expanded ? I.shrink : I.expand}</button>` : ''}
      <button class="vbtn ghost" data-v="fullcall" title="${document.fullscreenElement ? 'Exit full screen' : 'Full screen'}">${document.fullscreenElement ? I.shrink : I.fullscreen || I.expand}</button></div></div>`;
}
function bindVoiceControls(root) {
  $('.voice-controls', root).onclick = (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    if (v === 'cam') Voice.toggleCamera(); if (v === 'screen') Voice.toggleScreen();
    if (v === 'mute') Voice.toggleMute(); if (v === 'deaf') Voice.toggleDeaf(); if (v === 'leave') Voice.leave();
    if (v === 'expand') { Voice.expanded = !Voice.expanded; renderVoiceArea(); }
    if (v === 'fullcall') toggleCallFullscreen(e.target.closest('[data-v]'));
  };
}

/* Discord-style screen/window picker (desktop app only; browsers use their native picker) */
async function pickScreenSource() {
  let sources = [];
  try { sources = await window.orbitDesktop.getScreenSources(); } catch { toast('Couldn’t list your screens.', true); return null; }
  if (!sources.length) { toast('No screens or windows found to share.', true); return null; }
  return new Promise((resolve) => {
    let tab = 'app', quality = { label: '1080p 30', w: 1920, h: 1080, fps: 30 }, chosen = null;
    const QUAL = [{ label: '720p 30', w: 1280, h: 720, fps: 30 }, { label: '1080p 30', w: 1920, h: 1080, fps: 30 }, { label: '1080p 60', w: 1920, h: 1080, fps: 60 }, { label: '1440p 60', w: 2560, h: 1440, fps: 60 }];
    const screens = sources.filter(s => s.type === 'screen');
    const apps = sources.filter(s => s.type === 'window');
    const { close } = modal(`<div class="screen-picker">
      <div class="sp-tabs"><button data-t="app" class="on">${I.screen} Applications</button><button data-t="screen">${I.screen} Entire Screen</button></div>
      <div class="sp-grid"></div>
      <div class="sp-foot"><div class="sp-qual"></div><label class="sp-audio"><span class="toggle"><input type="checkbox" data-audio checked><span></span></span>Share sound</label><div class="sp-actions"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-go disabled>Go Live</button></div></div>
    </div>`, (m, closeFn) => {
      const grid = $('.sp-grid', m);
      const draw = () => {
        const list = tab === 'screen' ? screens : apps;
        grid.innerHTML = list.length ? list.map(s => `<button class="sp-item ${chosen === s.id ? 'sel' : ''}" data-id="${esc(s.id)}"><div class="sp-thumb"><img src="${esc(s.thumb)}" alt=""></div><div class="sp-label">${s.icon ? `<img class="sp-ico" src="${esc(s.icon)}">` : ''}<span>${esc(s.name)}</span></div></button>`).join('') : `<div class="sp-empty">Nothing here to share.</div>`;
      };
      $$('[data-t]', m).forEach(b => b.onclick = () => { tab = b.dataset.t; chosen = null; $$('[data-t]', m).forEach(x => x.classList.toggle('on', x === b)); $('[data-go]', m).disabled = true; draw(); });
      $('.sp-qual', m).innerHTML = QUAL.map(q => `<button class="${q.label === quality.label ? 'on' : ''}" data-q="${q.label}">${q.label}</button>`).join('');
      $('.sp-qual', m).onclick = (e) => { const b = e.target.closest('[data-q]'); if (!b) return; quality = QUAL.find(q => q.label === b.dataset.q); $$('.sp-qual button', m).forEach(x => x.classList.toggle('on', x === b)); };
      grid.onclick = (e) => { const it = e.target.closest('[data-id]'); if (!it) return; chosen = it.dataset.id; $$('.sp-item', m).forEach(x => x.classList.toggle('sel', x === it)); $('[data-go]', m).disabled = false; };
      grid.ondblclick = (e) => { const it = e.target.closest('[data-id]'); if (it) { chosen = it.dataset.id; done(); } };
      const done = () => { if (!chosen) return; const audio = $('[data-audio]', m).checked; closeFn(); resolve({ id: chosen, quality, audio }); };
      $('[data-go]', m).onclick = done;
      $('[data-cancel]', m).onclick = () => { closeFn(); resolve(null); };
      draw();
    }, 'sp-modal');
  });
}

/* green rings / names for whoever is talking — in your call, the sidebar, and the overlay */
const isSpeaking = (id) => Voice.speaking.has(id) || Voice.remoteSpeaking.has(id);
function paintSpeaking() {
  $$('[data-speak]').forEach(el => el.classList.toggle('speaking', isSpeaking(el.dataset.speak)));
  $$('.vc-user').forEach(el => { const on = isSpeaking(el.dataset.uid); el.classList.toggle('speaking', on); $('.av', el)?.classList.toggle('speaking', on); });
  Overlay.sync();
}

/* In-game overlay (Orbit for Windows): a small always-on-top list of who's in your call, lit up green when they talk.
   It floats over borderless/windowed games and never takes clicks. Shift+` hides or shows it. */
const Overlay = {
  ok: !!window.orbitDesktop?.overlay,
  last: '',
  state() {
    if (!Voice.channel || Voice.state !== 'connected' || S.prefs.overlay === false) return { show: false };
    const ch = findChannel(Voice.channel); const sid = ch?.server_id;
    const users = (S.voice[Voice.channel] || []).map(u => {
      const usr = user(u.user_id);
      return { id: u.user_id, name: sid ? nameIn(sid, u.user_id) : usr.display_name, avatar: usr.avatar ? new URL(usr.avatar, location.origin).href : null,
        color: usr.accent || '#8b6dff', initial: (usr.display_name || '?')[0].toUpperCase(), speaking: isSpeaking(u.user_id), muted: !!u.muted, deaf: !!u.deaf, live: !!u.screen, me: u.user_id === S.me.id };
    });
    return { show: true, channel: ch ? (ch.type === 'voice' ? ch.name : (ch.name || ch.user?.display_name || 'Call')) : 'Call', users, corner: S.prefs.overlayCorner || 'top-left', size: S.prefs.overlaySize || 'normal' };
  },
  sync() {
    if (!this.ok) return;
    const st = this.state(), key = JSON.stringify(st);
    if (key === this.last) return; this.last = key;
    try { window.orbitDesktop.overlay(st); } catch {}
  },
};
if (Overlay.ok) setInterval(() => Overlay.sync(), 1000);
// Settings → Voice & Video → In-game overlay (desktop app only)
window.addEventListener('load', () => {
  if (typeof userVoice !== 'function') return;
  const _uv = userVoice;
  userVoice = async function (body) {
    await _uv(body);
    if (!Overlay.ok) {   // website, or a Windows app from before the overlay existed
      body.insertAdjacentHTML('beforeend', `<h3>In-game overlay</h3><p class="hint">${window.orbitDesktop ? 'Your Orbit app is out of date. Download the newest version from the download page to get the overlay.' : 'The overlay is part of the Orbit app for Windows. It shows who’s in your call on top of your games.'}</p><a class="btn secondary sm" href="/download" target="_blank" rel="noopener" style="display:inline-flex;margin-top:8px">${I.download} Get the Windows app</a>`);
      return;
    }
    const P = S.prefs, pick = (k, opts, cur) => `<div class="chip-select">${opts.map(([v, l]) => `<button data-ov-${k}="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    body.insertAdjacentHTML('beforeend', `<h3>In-game overlay</h3>
      <label class="row-toggle"><span class="rt">Show the overlay in calls<small>A small list of who’s in your call floats over your games, and lights up green when someone talks. Works with games in windowed or borderless mode. Press <b>Shift + \`</b> to hide or show it.</small></span><span class="toggle"><input type="checkbox" data-ov-on ${P.overlay !== false ? 'checked' : ''}><span></span></span></label>
      <p class="hint" style="margin:10px 0 6px">Corner</p>${pick('corner', [['top-left', 'Top left'], ['top-right', 'Top right'], ['bottom-left', 'Bottom left'], ['bottom-right', 'Bottom right']], P.overlayCorner || 'top-left')}
      <p class="hint" style="margin:10px 0 6px">Size</p>${pick('size', [['small', 'Small'], ['normal', 'Normal'], ['large', 'Large']], P.overlaySize || 'normal')}`);
    $('[data-ov-on]', body).onchange = (e) => { S.prefs.overlay = e.target.checked; savePrefs(); Overlay.sync(); };
    for (const k of ['corner', 'size']) $$(`[data-ov-${k}]`, body).forEach(b => b.onclick = () => {
      S.prefs[k === 'corner' ? 'overlayCorner' : 'overlaySize'] = b.dataset[k === 'corner' ? 'ovCorner' : 'ovSize']; savePrefs();
      $$(`[data-ov-${k}]`, body).forEach(x => x.classList.toggle('on', x === b)); Overlay.sync();
    });
  };
});

// browsers only let audio start after a click or key press: wake the talking detector on the next one
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => { if (Voice._speakCtx?.state === 'suspended') Voice._speakCtx.resume().catch(() => {}); }, true));

// AFK auto-move: idle too long in a voice channel → get moved to the server's AFK channel
(() => {
  let lastActive = Date.now();
  const bump = () => { lastActive = Date.now(); };
  ['mousemove', 'keydown', 'mousedown', 'touchstart'].forEach(ev => addEventListener(ev, bump, { passive: true }));
  setInterval(() => {
    const cid = Voice.channel; if (!cid) return;
    if (Voice.speaking && Voice.speaking.has(S.me.id)) { lastActive = Date.now(); return; } // talking counts as active
    const ch = typeof findChannel === 'function' ? findChannel(cid) : null;
    if (!ch || !ch.server_id) return;
    const sd = S.serverData[ch.server_id];
    if (!sd || !sd.afk_channel_id || sd.afk_channel_id === cid) return;
    if (Date.now() - lastActive >= (sd.afk_timeout || 300) * 1000) {
      lastActive = Date.now();
      Voice.join(sd.afk_channel_id);
      try { toast('Moved to the AFK channel — you were idle.'); } catch {}
    }
  }, 5000);
})();
