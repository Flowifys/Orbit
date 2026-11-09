/* Orbit end-to-end encryption for DMs.
   Native WebCrypto only. The server only ever holds public keys and a
   passphrase-wrapped private key it can't open. Algorithm matches the
   server-side test vector: ECDH P-256 -> HKDF-SHA256 -> AES-GCM-256,
   private key backed up with PBKDF2(210k)->AES-GCM. */
(function () {
  const SUB = window.crypto && window.crypto.subtle;
  const te = new TextEncoder(), td = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const ub64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  // --- tiny IndexedDB (stores the private CryptoKey on this device) ---
  const DB = 'orbit-e2e', STORE = 'keys';
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbSet(k, v) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
  async function idbGet(k) { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction(STORE, 'readonly'); const rq = t.objectStore(STORE).get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); }); }
  async function idbDel(k) { const d = await idb(); return new Promise((res) => { const t = d.transaction(STORE, 'readwrite'); t.objectStore(STORE).delete(k); t.oncomplete = res; t.onerror = res; }); }

  // --- primitives ---
  const genIdentity = () => SUB.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const exportPub = (kp) => SUB.exportKey('raw', kp.publicKey).then(b64);
  const importPub = (s) => SUB.importKey('raw', ub64(s), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  async function sharedKey(priv, pub) {
    const bits = await SUB.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
    const base = await SUB.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
    return SUB.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('dm'), info: te.encode('orbit-dm-v1') }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encFor(priv, pub, text) { const iv = crypto.getRandomValues(new Uint8Array(12)); const k = await sharedKey(priv, pub); return { iv: b64(iv), ct: b64(await SUB.encrypt({ name: 'AES-GCM', iv }, k, te.encode(text))) }; }
  async function decFrom(priv, pub, blob) { const k = await sharedKey(priv, pub); return td.decode(await SUB.decrypt({ name: 'AES-GCM', iv: ub64(blob.iv) }, k, ub64(blob.ct))); }
  async function wrapPriv(privKey, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const base = await SUB.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const wk = await SUB.deriveKey({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const pkcs8 = await SUB.exportKey('pkcs8', privKey);
    return { salt: b64(salt), iv: b64(iv), ct: b64(await SUB.encrypt({ name: 'AES-GCM', iv }, wk, pkcs8)) };
  }
  async function unwrapPriv(blob, passphrase) {
    const base = await SUB.importKey('raw', te.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    const wk = await SUB.deriveKey({ name: 'PBKDF2', salt: ub64(blob.salt), iterations: 210000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const pkcs8 = await SUB.decrypt({ name: 'AES-GCM', iv: ub64(blob.iv) }, wk, ub64(blob.ct));
    return SUB.importKey('pkcs8', pkcs8, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  }

  const E2E = {
    supported: !!SUB && !!window.indexedDB,
    enabled: false,   // the account has encryption set up (server has a pubkey)
    locked: false,    // set up, but this device doesn't hold the private key yet
    priv: null, myPub: null, _blob: null,
    _pub: new Map(),  // userId -> imported public CryptoKey
    _pubRaw: new Map(),

    async init() {
      if (!this.supported || !window.S || !S.me) return;
      try {
        const info = await api('GET', '/api/e2e/me');
        this.enabled = !!info.ready;
        this.myPub = info.pubkey || null;
        this._blob = info.enc_priv || null;
        if (info.pubkey) this._pubRaw.set(S.me.id, info.pubkey);
        if (this.enabled) {
          const stored = await idbGet('priv-' + S.me.id);
          if (stored) { this.priv = stored; this.locked = false; }
          else this.locked = true;   // needs passphrase unlock on this device
        }
      } catch {}
    },
    get ready() { return this.enabled && !this.locked && !!this.priv; },

    async setup(passphrase) {
      const kp = await genIdentity();
      const pub = await exportPub(kp);
      const enc_priv = await wrapPriv(kp.privateKey, passphrase);
      await api('POST', '/api/e2e/setup', { pubkey: pub, enc_priv });
      await idbSet('priv-' + S.me.id, kp.privateKey);
      this.priv = kp.privateKey; this.myPub = pub; this.enabled = true; this.locked = false;
      this._pubRaw.set(S.me.id, pub); this._pub.delete(S.me.id);
    },
    async unlock(passphrase) {
      if (!this._blob) { const info = await api('GET', '/api/e2e/me'); this._blob = info.enc_priv; this.myPub = info.pubkey; }
      const priv = await unwrapPriv(this._blob, passphrase);   // throws on wrong passphrase
      await idbSet('priv-' + S.me.id, priv);
      this.priv = priv; this.locked = false;
    },
    async changePassphrase(newPass) {
      if (!this.ready) throw new Error('Unlock encryption first');
      const enc_priv = await wrapPriv(this.priv, newPass);
      await api('POST', '/api/e2e/setup', { pubkey: this.myPub, enc_priv });
    },
    async forgetDevice() { await idbDel('priv-' + S.me.id); this.priv = null; this.locked = this.enabled; },

    async _pubKey(userId) {
      if (this._pub.has(userId)) return this._pub.get(userId);
      let raw = this._pubRaw.get(userId);
      if (!raw) { const r = await api('GET', '/api/e2e/keys?ids=' + encodeURIComponent(userId)); raw = r[userId]; if (raw) this._pubRaw.set(userId, raw); }
      if (!raw) return null;
      const key = await importPub(raw); this._pub.set(userId, key); return key;
    },
    // Do all these members have keys (so we can encrypt to them)?
    async canEncryptTo(ids) {
      if (!this.ready) return false;
      const need = ids.filter(id => !this._pubRaw.has(id));
      if (need.length) { const r = await api('GET', '/api/e2e/keys?ids=' + need.map(encodeURIComponent).join(',')); Object.entries(r).forEach(([k, v]) => this._pubRaw.set(k, v)); }
      return ids.every(id => this._pubRaw.has(id));
    },
    // Encrypt one message to every member (including self, so the sender can read it back)
    async encryptFor(memberIds, text) {
      const map = {};
      for (const id of memberIds) { const pub = await this._pubKey(id); if (pub) map[id] = await encFor(this.priv, pub, text); }
      if (!map[S.me.id]) throw new Error('Encryption key missing');
      return map;
    },
    // Decrypt a message in place: sets m._dec (plaintext) or m._decFail
    async decrypt(m) {
      if (!m || !m.enc || m._dec != null || m._decFail) return;
      if (!this.ready) { m._decFail = 'locked'; return; }
      const entry = m.enc[S.me.id];
      if (!entry) { m._decFail = 'nokey'; return; }
      try { const pub = await this._pubKey(m.author_id); if (!pub) { m._decFail = 'nosender'; return; } m._dec = await decFrom(this.priv, pub, entry); }
      catch { m._decFail = 'fail'; }
    },
    async decryptBatch(rows) { await Promise.all((rows || []).filter(m => m && m.enc && m._dec == null && !m._decFail).map(m => this.decrypt(m))); },
  };
  window.E2E = E2E;
})();
