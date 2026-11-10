'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
// las animaciones oficiales de Clawd no vienen con la app: se preparan la primera vez en tu carpeta de datos
const ASSETS = path.join(process.env.COMPANION_HOME || path.join(os.homedir(), '.claude', 'claude-companion'), 'assets');

// La página puede tener uno o varios Clawds: casi todo lleva el id del Clawd que habla.
let laptop = null;
contextBridge.exposeInMainWorld('companion', {
  // ---- de la página ----
  init: () => ipcRenderer.invoke('page:init'),
  summon: () => ipcRenderer.invoke('pet:summon'),
  setInteractive: (on) => ipcRenderer.send('interactive', on),
  on: (ch, fn) => ipcRenderer.on(ch, (_e, data) => fn(data)),
  assetUrl: (name) => pathToFileURL(path.join(ASSETS, name)).href,
  // ---- de cada Clawd ----
  getOpts: (id) => ipcRenderer.invoke('opts:get', id),
  dragStart: (id) => ipcRenderer.invoke('drag:start', id),
  dragEnd: (id) => ipcRenderer.invoke('drag:end', id),
  menu: (id) => ipcRenderer.send('menu', id),
  send: (id, text, opts) => ipcRenderer.invoke('chat:send', id, text, opts),
  cancel: (id) => ipcRenderer.send('chat:cancel', id),
  newChat: (id) => ipcRenderer.send('chat:new', id),
  focusClaude: () => ipcRenderer.send('focus-claude'),
  openSession: (id) => ipcRenderer.send('pet:open-session', id),
  modelMenu: (id) => ipcRenderer.send('model:menu', id),
  openInApp: (id) => ipcRenderer.send('chat:open-in-app', id),
  toSession: (id) => ipcRenderer.send('chat:to-session', id),
  dictate: (id) => ipcRenderer.send('dictate', id),
  trace: (id, m) => ipcRenderer.send('trace', id, m),
  entranceWalk: (id) => ipcRenderer.send('entrance:walk', id),
  rename: (id, name) => ipcRenderer.send('pet:rename', id, name),
  openFile: (file) => ipcRenderer.send('file:open', file),       // un archivo que creó un Clawd
  hold: (id, on) => ipcRenderer.send('pet:hold', id, on),        // que se detenga (cursor encima o chat abierto)
  // animación oficial de Clawd con su laptop (la de la pantalla de "nuevo chat"); se lee una vez
  laptopAnim: () => {
    if (!laptop) laptop = fs.readFileSync(path.join(ASSETS, 'clawd-laptop.json'), 'utf8');
    return JSON.parse(laptop);
  },
});
