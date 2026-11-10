'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('train', {
  get: () => ipcRenderer.invoke('train:get'),
  save: (d) => ipcRenderer.invoke('train:save', d),
  close: () => ipcRenderer.send('train:close'),
});
