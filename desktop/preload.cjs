'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('theaterDesktop', Object.freeze({
  openPowerPoint: id => ipcRenderer.invoke('theater:open-powerpoint', id),
  powerPointCommand: action => ipcRenderer.invoke('theater:powerpoint-command', action),
  powerPointError: () => ipcRenderer.invoke('theater:powerpoint-error'),
  closePowerPoint: token => ipcRenderer.invoke('theater:close-powerpoint', token),
  openWebsite: url => ipcRenderer.invoke('theater:open-website', url),
  focusWebsite: () => ipcRenderer.invoke('theater:focus-website'),
  closeWebsite: () => ipcRenderer.invoke('theater:close-website'),
}));
