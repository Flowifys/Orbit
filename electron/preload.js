const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orbitDesktop', {
  isDesktop: true,
  getScreenSources: () => ipcRenderer.invoke('orbit:get-sources'),
  // pick what the next getDisplayMedia() call shares (and whether to include the computer's sound)
  setShareSource: (id, audio) => ipcRenderer.invoke('orbit:set-share', { id, audio: !!audio }),
});
