'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('theaterPicker', Object.freeze({
  sources: () => ipcRenderer.invoke('theater:picker-sources'),
  choose: id => ipcRenderer.invoke('theater:picker-choose', id),
}));
