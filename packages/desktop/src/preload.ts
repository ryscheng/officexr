import { contextBridge, ipcRenderer } from 'electron';

// Expose a minimal, safe API to the renderer (web app).
// The web app runs in a sandboxed renderer and communicates
// with the main process only through this bridge.
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke('app:version'),
  onUpdateAvailable: (cb: () => void) =>
    ipcRenderer.on('update-available', cb),
  onUpdateDownloaded: (cb: () => void) =>
    ipcRenderer.on('update-downloaded', cb),
  installUpdate: () => ipcRenderer.send('install-update'),
});
