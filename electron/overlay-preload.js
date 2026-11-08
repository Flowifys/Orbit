const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orbitOverlay', {
  onState: (cb) => ipcRenderer.on('overlay:state', (e, st) => cb(st)),
  size: (w, h) => ipcRenderer.send('overlay:size', { w, h }),
});
