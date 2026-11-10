// Claude Companion — lo que se prepara en cada compu (la primera vez y al desinstalar):
//  1. Las animaciones oficiales de Clawd. NO vienen en el repo (son arte de Anthropic): se bajan
//     de claude.ai y la de la laptop se saca de la instalación de Claude Desktop de cada quien.
//  2. Los hooks de Claude Code (en ~/.claude/settings.json), que avisan qué hace cada sesión.
//  3. Pasar los datos del prototipo anterior (~/.claude/mascota), si existe.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const HOME = os.homedir();
const BASE = process.env.COMPANION_HOME || path.join(HOME, '.claude', 'claude-companion');
const ASSETS = path.join(BASE, 'assets');
const SETTINGS = process.env.COMPANION_SETTINGS || path.join(HOME, '.claude', 'settings.json');

// ---------------------------------------------------------------------
//  1. Animaciones oficiales de Clawd
// ---------------------------------------------------------------------
const GIFS = {
  'Clawd-Waving.gif': 'https://claude.ai/images/clawd/core/Clawd-Waving.gif',
  'Clawd-Lurking.gif': 'https://claude.ai/images/clawd/core/Clawd-Lurking.gif',
  'Clawd-Cloud-once.gif': 'https://claude.ai/images/clawd/persona/Clawd-Cloud-once.gif',
  'Clawd-RacingCar.gif': 'https://claude.ai/images/clawd/persona/Clawd-RacingCar.gif',
  'Clawd-Dancing.gif': 'https://claude.ai/images/spotlights/claude-code-celebration/Clawd-Dancing.gif',
};
const NEEDED = [...Object.keys(GIFS), 'Clawd-Still.png', 'clawd-laptop.json'];
function missingAssets() { return NEEDED.filter((f) => !fs.existsSync(path.join(ASSETS, f))); }

// Claude Desktop guarda su interfaz en resources/ion-dist.asar; ahí viene la animación "Clawd-Laptop".
// (Electron lee dentro de los .asar con fs normal.)
function desktopAsars() {
  const out = [];
  const local = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'AnthropicClaude') : null;
  try {
    for (const d of fs.readdirSync(local)) {
      const a = path.join(local, d, 'resources', 'ion-dist.asar');
      if (/^app-/.test(d) && fs.existsSync(a)) out.push(a);
    }
  } catch (_) { /* no está instalado así */ }
  return out.sort().reverse();                       // la versión más nueva primero
}
function findLaptopLottie() {
  for (const asar of desktopAsars()) {
    for (const dir of ['assets/v1', 'assets']) {
      let files = [];
      try { files = fs.readdirSync(path.join(asar, dir)); } catch (_) { continue; }
      for (const f of files) {
        if (!f.endsWith('.json')) continue;
        const full = path.join(asar, dir, f);
        try {
          const st = fs.statSync(full);
          if (st.size < 2000 || st.size > 3e6) continue;
          const txt = fs.readFileSync(full, 'utf8');
          if (txt.includes('"nm":"Clawd-Laptop"')) return txt;
        } catch (_) { /* siguiente */ }
      }
    }
  }
  return null;
}
async function download(net, url, dest) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ClaudeCompanion' } });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const type = r.headers.get('content-type') || '';
  if (!/image\/gif/.test(type)) throw new Error(`${url}: no es un GIF (${type})`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}
// la pose quieta = primer cuadro de "Waving" (se saca con una ventana invisible)
async function makeStill(BrowserWindow) {
  const gif = path.join(ASSETS, 'Clawd-Waving.gif');
  const w = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { offscreen: true } });
  try {
    await w.loadURL('data:text/html,<html><body></body></html>');
    const data = fs.readFileSync(gif).toString('base64');
    const png = await w.webContents.executeJavaScript(`new Promise((ok, no) => {
      const i = new Image();
      i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
        c.getContext('2d').drawImage(i, 0, 0); ok(c.toDataURL('image/png').split(',')[1]); };
      i.onerror = () => no('no pude leer el GIF');
      i.src = 'data:image/gif;base64,${data}';
    })`);
    fs.writeFileSync(path.join(ASSETS, 'Clawd-Still.png'), Buffer.from(png, 'base64'));
  } finally { w.destroy(); }
}
async function ensureAssets({ net, BrowserWindow, log }) {
  fs.mkdirSync(ASSETS, { recursive: true });
  const problems = [];
  for (const [name, url] of Object.entries(GIFS)) {
    if (fs.existsSync(path.join(ASSETS, name))) continue;
    try { await download(net, url, path.join(ASSETS, name)); log(`assets: ${name} listo`); } catch (e) { problems.push(String(e.message || e)); }
  }
  if (!fs.existsSync(path.join(ASSETS, 'clawd-laptop.json'))) {
    const lot = findLaptopLottie();
    if (lot) { fs.writeFileSync(path.join(ASSETS, 'clawd-laptop.json'), lot); log('assets: laptop sacada de Claude Desktop'); }
    else problems.push('No encontré la animación de la laptop: instala o abre Claude Desktop y vuelve a abrir Claude Companion.');
  }
  if (!fs.existsSync(path.join(ASSETS, 'Clawd-Still.png')) && fs.existsSync(path.join(ASSETS, 'Clawd-Waving.gif'))) {
    try { await makeStill(BrowserWindow); log('assets: pose quieta lista'); } catch (e) { problems.push('pose quieta: ' + e); }
  }
  return { missing: missingAssets(), problems };
}

// ---------------------------------------------------------------------
//  2. Hooks de Claude Code
// ---------------------------------------------------------------------
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd', 'SubagentStart', 'SubagentStop'];
const WITH_MATCHER = new Set(['PreToolUse', 'PostToolUse', 'PermissionRequest']);
const HOOK_FILE = path.join(BASE, 'hook.js');
const fwd = (p) => p.replace(/\\/g, '/');
// es nuestro (o del prototipo anterior, "mascota")
const norm = (cmd) => String(cmd || '').replace(/\\/g, '/').toLowerCase();
const isMine = (cmd) => norm(cmd).includes(fwd(HOOK_FILE).toLowerCase());
const isOurs = (cmd) => isMine(cmd) || /claude-companion\/+hook\.js|\.claude\/+mascota\/+hook\.js/.test(norm(cmd));
function hasNode() {
  try { execFileSync(process.platform === 'win32' ? 'where' : 'which', ['node'], { stdio: 'ignore', windowsHide: true }); return true; } catch (_) { return false; }
}
// el hook es un script de Node; si no hay Node instalado, lo corre el propio Claude Companion en modo Node
function hookCommand(exe) {
  if (hasNode()) return `node "${fwd(HOOK_FILE)}"`;
  return `ELECTRON_RUN_AS_NODE=1 "${fwd(exe)}" "${fwd(HOOK_FILE)}"`;
}
function copyHook(src) {
  fs.mkdirSync(BASE, { recursive: true });
  const now = fs.readFileSync(src, 'utf8');
  let old = '';
  try { old = fs.readFileSync(HOOK_FILE, 'utf8'); } catch (_) { /* no había */ }
  if (old !== now) fs.writeFileSync(HOOK_FILE, now);
}
function readSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8').replace(/^﻿/, '')); } catch (e) {
    if (fs.existsSync(SETTINGS)) throw new Error('No pude leer ~/.claude/settings.json (¿tiene un error de formato?).');
    return {};
  }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(SETTINGS), { recursive: true });
  // respaldo (uno por día), por si acaso
  if (fs.existsSync(SETTINGS)) {
    const bak = `${SETTINGS}.antes-de-claude-companion`;
    if (!fs.existsSync(bak)) fs.copyFileSync(SETTINGS, bak);
  }
  const tmp = SETTINGS + '.tmp-companion';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, SETTINGS);
}
function stripOurs(s) {
  let changed = false;
  if (!s.hooks || typeof s.hooks !== 'object') return false;
  for (const ev of Object.keys(s.hooks)) {
    const groups = Array.isArray(s.hooks[ev]) ? s.hooks[ev] : [];
    const kept = [];
    for (const g of groups) {
      const hooks = Array.isArray(g.hooks) ? g.hooks.filter((h) => !isOurs(h.command)) : g.hooks;
      if (Array.isArray(g.hooks) && hooks.length !== g.hooks.length) changed = true;
      if (!Array.isArray(hooks) || hooks.length) kept.push({ ...g, hooks });
    }
    if (kept.length) s.hooks[ev] = kept; else { delete s.hooks[ev]; changed = true; }
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  return changed;
}
function hooksInstalled() {
  try {
    const s = readSettings();
    return HOOK_EVENTS.every((ev) => (s.hooks && Array.isArray(s.hooks[ev]) ? s.hooks[ev] : [])
      .some((g) => (g.hooks || []).some((h) => isMine(h.command))));
  } catch (_) { return false; }
}
function installHooks(exe, hookSrc) {
  copyHook(hookSrc);
  const s = readSettings();
  stripOurs(s);
  s.hooks = s.hooks || {};
  const command = hookCommand(exe);
  for (const ev of HOOK_EVENTS) {
    const entry = { hooks: [{ type: 'command', command, async: true, timeout: 10 }] };
    if (WITH_MATCHER.has(ev)) entry.matcher = '*';
    s.hooks[ev] = [...(Array.isArray(s.hooks[ev]) ? s.hooks[ev] : []), entry];
  }
  writeSettings(s);
  return command;
}
function uninstallHooks() {
  const s = readSettings();
  if (stripOurs(s)) writeSettings(s);
}

// ---------------------------------------------------------------------
//  3. Datos del prototipo anterior (~/.claude/mascota)
// ---------------------------------------------------------------------
function migrateOld(log) {
  const old = path.join(HOME, '.claude', 'mascota');
  const cfgNew = path.join(BASE, 'config.json');
  if (fs.existsSync(cfgNew) || !fs.existsSync(path.join(old, 'config.json'))) return;
  try {
    fs.mkdirSync(BASE, { recursive: true });
    const c = JSON.parse(fs.readFileSync(path.join(old, 'config.json'), 'utf8').replace(/^﻿/, ''));
    // las pláticas viejas viven en su carpeta original (Claude Code busca las sesiones por carpeta)
    if (fs.existsSync(path.join(old, 'chat'))) c.chatDir = path.join(old, 'chat');
    fs.writeFileSync(cfgNew, JSON.stringify(c, null, 2));
    const oldAssets = path.join(old, 'app', 'assets');
    fs.mkdirSync(ASSETS, { recursive: true });
    for (const f of NEEDED) {
      const a = path.join(oldAssets, f);
      if (fs.existsSync(a) && !fs.existsSync(path.join(ASSETS, f))) fs.copyFileSync(a, path.join(ASSETS, f));
    }
    log('datos del prototipo anterior copiados');
  } catch (e) { log('migración: ' + e); }
}

module.exports = { BASE, ASSETS, SETTINGS, ensureAssets, missingAssets, installHooks, uninstallHooks, hooksInstalled, migrateOld };
