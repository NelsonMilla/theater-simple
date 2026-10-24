'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('theaterDesktop', Object.freeze({
  openWebsite: url => ipcRenderer.invoke('theater:open-website', url),
  focusWebsite: () => ipcRenderer.invoke('theater:focus-website'),
  closeWebsite: () => ipcRenderer.invoke('theater:close-website'),
}));
