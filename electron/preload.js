const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orbitDesktop', {
  isDesktop: true,
  // the window has no system title bar: the page draws one (see public/js/titlebar.js)
  frame: process.platform === 'darwin' ? 'mac' : 'overlay',
  // in-game overlay: send who's in the call (see Overlay in public/js/voice.js)
  overlay: (state) => ipcRenderer.invoke('orbit:overlay', state),
  setTitleBarColors: (color, symbolColor) => ipcRenderer.invoke('orbit:titlebar', { color, symbolColor }),
  getScreenSources: () => ipcRenderer.invoke('orbit:get-sources'),
  // pick what the next getDisplayMedia() call shares (and whether to include the computer's sound)
  setShareSource: (id, audio) => ipcRenderer.invoke('orbit:set-share', { id, audio: !!audio }),
  // which known game is running right now (null if none), and a callback for when that changes
  currentGame: () => ipcRenderer.invoke('orbit:current-game'),
  onGame: (cb) => { const h = (e, g) => cb(g); ipcRenderer.on('orbit:game', h); return () => ipcRenderer.removeListener('orbit:game', h); },
});
