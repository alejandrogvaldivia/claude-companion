'use strict';
// Preload de la ventanita "Modelo y esfuerzo": solo puede pedir el estado, cambiar modelo/esfuerzo y cerrarse.
const { contextBridge, ipcRenderer } = require('electron');
const arg = process.argv.find((a) => a.startsWith('--mm-pet='));
const PET = Number(arg ? arg.slice('--mm-pet='.length) : 0);
contextBridge.exposeInMainWorld('mm', {
  state: () => ipcRenderer.invoke('mm:state', PET),
  set: (patch) => ipcRenderer.invoke('mm:set', PET, patch),
  size: (h) => ipcRenderer.send('mm:size', PET, h),
  close: () => ipcRenderer.send('mm:close', PET),
});
