const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orbitDesktop', {
  isDesktop: true,
  getScreenSources: () => ipcRenderer.invoke('orbit:get-sources'),
  // pick what the next getDisplayMedia() call shares (and whether to include the computer's sound)
  setShareSource: (id, audio) => ipcRenderer.invoke('orbit:set-share', { id, audio: !!audio }),
  // which known game is running right now (null if none), and a callback for when that changes
  currentGame: () => ipcRenderer.invoke('orbit:current-game'),
  onGame: (cb) => { const h = (e, g) => cb(g); ipcRenderer.on('orbit:game', h); return () => ipcRenderer.removeListener('orbit:game', h); },
});
