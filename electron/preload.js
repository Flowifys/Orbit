const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orbitDesktop', {
  isDesktop: true,
  getScreenSources: () => ipcRenderer.invoke('orbit:get-sources'),
});
