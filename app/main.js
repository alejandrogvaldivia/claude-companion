// Claude Companion — Clawds en tu pantalla, uno por cada sesión de Claude Code.
// Proyecto de fans, NO oficial de Anthropic. Vive en segundo plano (arranca con Windows),
// aparece cuando abres Claude Desktop y se va cuando lo cierras. Cada sesión activa
// (identificada por su session_id real, que anota hook/hook.js) tiene su propio Clawd con su
// estado, nombre, color y tamaño según el modelo, y una plática propia contigo.
// Modos: "escritorio" (una ventana por Clawd), "escritorio en grupo" (juntitos, pasean y
// conviven) y "barra de tareas" (minis que pasean sobre la barra).
'use strict';
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const setup = require('./setup');

const BASE = setup.BASE;                    // ~/.claude/claude-companion
// (las variables COMPANION_* son solo para pruebas: carpeta de sesiones, config y registro aparte)
const DIR_SES = process.env.COMPANION_SES_DIR || path.join(BASE, 'sesiones');
const CFG = process.env.COMPANION_CFG || path.join(BASE, 'config.json');
const VIVO = path.join(BASE, 'vivo');
const APAGADA = path.join(BASE, 'apagada');
let CHAT_DIR = path.join(BASE, 'chat');     // (si venías del prototipo, sigue en su carpeta: ver config.chatDir)
const LOG = process.env.COMPANION_LOG || path.join(BASE, 'companion.log');
// Claude Code: el más nuevo que haya en la compu. El de la terminal (~/.local/bin) se puede quedar
// viejo; Claude Desktop trae el suyo y lo actualiza solo (%APPDATA%\Claude\claude-code\<versión>\…\claude.exe).
// Los modelos nuevos (y su compactación automática) piden versiones recientes.
const CLAUDE_CLI = path.join(os.homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude');
const verNum = (v) => String(v || '').split('.').map((n) => parseInt(n, 10) || 0).reduce((a, n) => a * 10000 + n, 0);
function pickClaude() {
  const found = [];
  // la de la terminal: su versión es el nombre del archivo en ~/.local/share/claude/versions
  try {
    const vs = fs.readdirSync(path.join(os.homedir(), '.local', 'share', 'claude', 'versions')).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
    if (fs.existsSync(CLAUDE_CLI)) found.push({ exe: CLAUDE_CLI, v: vs.sort((a, b) => verNum(b) - verNum(a))[0] || '0.0.0' });
  } catch (_) { if (fs.existsSync(CLAUDE_CLI)) found.push({ exe: CLAUDE_CLI, v: '0.0.0' }); }
  // las que trae Claude Desktop
  const root = path.join(process.env.APPDATA || '', 'Claude', 'claude-code');
  try {
    for (const v of fs.readdirSync(root)) {
      if (!/^\d+\.\d+\.\d+$/.test(v)) continue;
      for (const sub of fs.readdirSync(path.join(root, v))) {
        const exe = path.join(root, v, sub, 'claude.exe');
        if (fs.existsSync(exe)) found.push({ exe, v });
      }
    }
  } catch (_) { /* no hay */ }
  found.sort((a, b) => verNum(b.v) - verNum(a.v));
  return found[0] || { exe: CLAUDE_CLI, v: '?' };
}
let claudePick = pickClaude();
let CLAUDE = claudePick.exe;
setInterval(() => { const n = pickClaude(); if (n.exe !== CLAUDE) { claudePick = n; CLAUDE = n.exe; log(`Claude Code ahora: ${n.v}`); } }, 30 * 60000);
// ya instalado, el vigilante y el hook van fuera del .asar (en resources/); en desarrollo, en la raíz del repo
const RES = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const WATCHER = path.join(RES, 'bin', 'clawd.exe');
const HOOK_SRC = path.join(RES, 'hook', 'hook.js');
const ICON = path.join(__dirname, 'assets', 'icon.ico');
const APP_ID = 'com.claudecompanion.app';
const APP_NAME = 'Claude Companion';
// cómo se abre al iniciar Windows (instalado: el .exe; en desarrollo: electron + la carpeta)
const loginArgs = () => (app.isPackaged ? ['--background'] : [path.join(__dirname, '..'), '--background']);

// --- chat en segundo plano: solo platicar, leer y buscar ---
const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', hint: 'rápido y muy capaz' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', hint: 'el más listo, más lento' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'rapidísimo, para cosas simples' },
];
const modelInfo = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
const TOOLS = 'Read,Grep,Glob,WebSearch,WebFetch';
const SYSTEM = [
  'Estás hablando a través de una mascota de escritorio: un mini Claude que flota en la pantalla del usuario.',
  'Tus respuestas aparecen en globitos de cómic pequeños que se desvanecen solos, así que responde en español,',
  'breve y directo (de 1 a 4 frases), sin tablas, sin encabezados y con muy poco markdown. Si te piden algo largo, da lo esencial.',
  'Puedes leer archivos y buscar en la web, pero no puedes editar archivos ni ejecutar comandos;',
  'si te piden eso, sugiere hacerlo en Claude Code.',
].join(' ');

// --- medidas (en px de diseño; se multiplican por el tamaño de ventana elegido) ---
const DIMS = { desktop: { w: 430, h: 480 }, taskbar: { w: 340, h: 480 } };
const PET_LEFT_IN_WIN = 22;     // escritorio: el mini Claude a 22 px de la orilla (lado volteado)
const PET_BOX_W = 186;          // escritorio: ancho de la caja del mini Claude
const PET_BOTTOM = 50;          // escritorio: de la orilla de abajo de la ventana a sus pies
const PET_SHIFT = 200;          // escritorio: cuánto se recorre al voltear la interfaz
const TB_PET_X = 188;           // barra de tareas: dónde está el mini Clawd dentro de su ventana
const TB_BOX_W = 112;
const CLAWD_FROM = 0.268;       // Clawd empieza al 26.8 % de su caja (arte oficial: x 736 de 2750)
const CLAWD_MID = 0.486;        // el centro de Clawd dentro de su caja
const CLAWD_H = 0.432;          // alto de Clawd respecto a su caja (8 de 18.5 cuadros)
const WALK_SPEED = 150;         // px/s al llegar caminando a su lugar
const WANDER_SPEED = { taskbar: 40, group: 55 };

// nombres y colores para cada Clawd (el color es un filtro sobre los sprites originales)
const NAMES = ['Clawd', 'Pixel', 'Chispa', 'Migas', 'Canela', 'Tostón', 'Bit', 'Nube', 'Coco', 'Lumo', 'Gajo', 'Pepa'];
const COLORS = [
  { id: 'naranja', label: 'Naranja (original)', hue: 0 },
  { id: 'azul', label: 'Azul', hue: 200 },
  { id: 'turquesa', label: 'Turquesa', hue: 160 },
  { id: 'verde', label: 'Verde', hue: 105 },
  { id: 'morado', label: 'Morado', hue: 255 },
  { id: 'rosa', label: 'Rosa', hue: 315 },
  { id: 'amarillo', label: 'Amarillo', hue: 30, bright: 1.15 },
  { id: 'gris', label: 'Gris', sat: 0, bright: 1.1 },
];
const colorOf = (id) => COLORS.find((c) => c.id === id) || COLORS[0];
const FAMILY_SCALE = { opus: 1, sonnet: 0.75, haiku: 0.5 };
function familyOf(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return null;
}

// --- argumentos ---
const argv = process.argv.slice(1);
function arg(name) { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] || '') : null; }
const SHOT = arg('--shot');
const BACKGROUND = argv.includes('--background');
const OPTS = {
  demo: arg('--demo'),
  hover: argv.includes('--hover'),
  fakeChat: argv.includes('--fake-chat'),
  hang: argv.includes('--hang'),
  idleNow: argv.includes('--idle-now'),
  nap: argv.includes('--nap'),
  trace: argv.includes('--trace'),
  fakeBusyAt: Number(arg('--fake-busy-at') || 0),
  ask: arg('--ask'),
  wait: Number(arg('--wait') || 2500),
  noIntro: argv.includes('--no-intro') || !!SHOT,
};

function log(m) { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); } catch (_) { /* nada */ } }
// un error inesperado se anota en el registro en lugar de mostrarte una ventana de error
process.on('uncaughtException', (e) => log('error: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)));

if (argv.includes('--uninstall')) {
  app.whenReady().then(() => {
    try { setup.uninstallHooks(); log('desinstalación: hooks quitados'); } catch (e) { log('desinstalación: ' + e); }
    // (en pruebas no se toca el inicio con Windows: lo comparte con la app instalada)
    if (!process.env.COMPANION_CFG) { try { app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: loginArgs(), name: APP_NAME }); } catch (_) { /* nada */ } }
    app.exit(0);
  });
  return;
}
const PRIMARY = SHOT ? true : app.requestSingleInstanceLock();
if (!PRIMARY) { app.exit(0); return; }
app.setAppUserModelId(APP_ID);

// =====================================================================
//  Configuración (todo se guarda solo)
// =====================================================================
// si venías del prototipo (~/.claude/mascota), sus datos se pasan aquí la primera vez
if (!SHOT && !process.env.COMPANION_CFG) setup.migrateOld(log);
function readCfg() { try { return JSON.parse(fs.readFileSync(CFG, 'utf8').replace(/^﻿/, '')); } catch (_) { return {}; } }
const num = (v, d, a = -Infinity, b = Infinity) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.max(a, Math.min(b, Number(v))) : d);
const cfg0 = readCfg();
const T0 = cfg0.timing || {};
const cfg = {
  mode: ['desktop', 'group', 'taskbar'].includes(cfg0.mode) ? cfg0.mode : 'desktop',
  desktop: cfg0.desktop || (cfg0.v === 3 ? { left: cfg0.left, bottom: cfg0.bottom, side: cfg0.side } : {}),
  taskbar: cfg0.taskbar || {},
  group: cfg0.group || {},
  model: modelInfo(cfg0.model).id,
  chatDir: cfg0.chatDir || null,
  hooksAsked: !!cfg0.hooksAsked,
  hooksOn: !!cfg0.hooksOn,                       // los conectaste tú (si faltan, se vuelven a poner)
  petScale: num(cfg0.petScale, 1, 0.6, 1.6),     // tamaño general de los Clawds
  winScale: num(cfg0.winScale, 1, 0.7, 1.5),     // tamaño general de las ventanas
  maxPets: num(cfg0.maxPets, 6, 1, 10),
  timing: {
    sleepMs: num(T0.sleepMs, 60000, 5000),             // sin actividad: se duerme
    hideMs: num(T0.hideMs, 300000, 30000),             // sin actividad: se despide y se oculta
    staleWorkMs: num(T0.staleWorkMs, 45 * 60000, 60000), // "trabajando" sin ninguna señal por tanto tiempo = sesión colgada
  },
  social: Object.assign({ enabled: true, greet: 60, talk: 20, jump: 15, ride: 5, minGapMs: 45000, maxGapMs: 90000 }, cfg0.social || {}),
  home: cfg0.home || {},             // el Clawd sin sesión (cuando no hay ninguna)
  clawds: cfg0.clawds || {},         // por sesión: nombre, color, lugar (los invocados: "x:<id>")
  extras: Array.isArray(cfg0.extras) ? cfg0.extras : [],   // los Clawds que invocaste (siguen ahí al reiniciar)
  projects: cfg0.projects || {},     // por proyecto: el último nombre y color que elegiste
};
if (cfg.chatDir && fs.existsSync(cfg.chatDir)) CHAT_DIR = cfg.chatDir;
let mode = ['desktop', 'group', 'taskbar'].includes(arg('--mode')) ? arg('--mode') : cfg.mode;
const isBar = () => mode === 'taskbar';
let saveT = null;
function saveCfg() {
  if (SHOT) return;
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 400);
}
function saveNow() {
  if (SHOT) return;
  clearTimeout(saveT);
  try {
    cfg.mode = mode;
    // olvida los Clawds de sesiones que no se ven hace más de 30 días
    const old = Date.now() - 30 * 86400000;
    for (const [k, v] of Object.entries(cfg.clawds)) if (!v || (v.seen || 0) < old) delete cfg.clawds[k];
    fs.writeFileSync(CFG, JSON.stringify({ v: 5, ...cfg }, null, 2));
  } catch (e) { log('config: ' + e); }
}

// =====================================================================
//  Geometría
// =====================================================================
const Z = () => cfg.winScale;
const zr = (v) => Math.round(v * Z());
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function dims() { const d = DIMS[isBar() ? 'taskbar' : 'desktop']; return { w: zr(d.w), h: zr(d.h) }; }
const petLeftInWin = (s) => zr(s === 'left' ? PET_LEFT_IN_WIN : PET_LEFT_IN_WIN + PET_SHIFT);
const petOff = (p, s) => (isBar() ? zr(TB_PET_X) : petLeftInWin(s || p.side));   // orilla izquierda de su caja, dentro de la ventana
const petBoxW = () => zr(isBar() ? TB_BOX_W : PET_BOX_W);
const feetDy = () => (isBar() ? 0 : zr(PET_BOTTOM));
function workAreaAt(x, y) { const { w, h } = dims(); return screen.getDisplayMatching({ x, y, width: w, height: h }).workArea; }
// dónde están los pies de Clawd en la pantalla, y la ventana que los pone en un punto
function feetOf(p) {
  const [x, y] = posOf(p);
  return { x: x + petOff(p) + petBoxW() * CLAWD_MID, y: y + dims().h - feetDy() };
}
function winForFeet(p, fx, fy, s) {
  return { x: Math.round(fx - petOff(p, s) - petBoxW() * CLAWD_MID), y: Math.round(fy - dims().h + feetDy()) };
}
function desktopDefault() {
  const wa = screen.getPrimaryDisplay().workArea;
  const { w, h } = dims();
  return { x: wa.x + wa.width - w - 2, y: wa.y + wa.height - h + 2, side: 'right' };
}
function desktopValid(d) {
  const { w, h } = dims();
  if (!d || !Number.isFinite(d.left) || !Number.isFinite(d.bottom)) return null;
  const cand = { x: d.left, y: d.bottom - h, side: d.side === 'left' ? 'left' : 'right' };
  const wa = screen.getDisplayMatching({ x: cand.x, y: cand.y, width: w, height: h }).workArea;
  const ok = cand.x > wa.x - w + 120 && cand.x < wa.x + wa.width - 120 && cand.y > wa.y - h + 150 && cand.y < wa.y + wa.height - 100;
  return ok ? cand : null;
}
// barra de tareas: las ventanas se paran justo encima de la barra (abajo de la pantalla principal)
function taskbarGeom() {
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea, b = d.bounds;
  return { top: wa.y + wa.height, minX: b.x, maxX: b.x + b.width - dims().w, b };
}
// grupo: un área donde conviven (sus pies se mueven dentro), anclada abajo a la derecha
const GROUP_W = 600, GROUP_H = 230;
function groupArea() {
  const wa = screen.getPrimaryDisplay().workArea;
  let ax = num(cfg.group.x, wa.x + wa.width - 140);
  let ay = num(cfg.group.y, wa.y + wa.height - zr(PET_BOTTOM) + 2);
  const gw = zr(GROUP_W), gh = zr(GROUP_H);
  const disp = screen.getDisplayNearestPoint({ x: Math.round(ax), y: Math.round(ay) }).workArea;
  ax = clamp(ax, disp.x + gw - 40, disp.x + disp.width - 40);
  ay = clamp(ay, disp.y + gh + 120, disp.y + disp.height + 10);
  return { x0: ax - gw, x1: ax, y0: ay - gh, y1: ay, ax, ay };
}

// =====================================================================
//  Los Clawds (uno por sesión)
// =====================================================================
let petSeq = 0;
const pets = new Map();               // id -> Pet
class Pet {
  constructor(sid) {
    this.id = ++petSeq;
    this.sid = sid || null;           // sesión de Claude Code que representa (null = anfitrión sin sesión)
    this.extra = null;                // id si lo invocaste tú (botón Clawd+): sin sesión, se queda hasta que lo despidas
    this.win = null;
    this.side = 'right';
    this.entranceInfo = null;
    this.walking = false;             // llegando a su lugar (entrada)
    this.walkTimer = null;
    this.byeTimer = null;
    this.drag = null;
    this.leaving = false;
    this.createdAt = Date.now();
    this.mode = 'sleep';
    this.modeSince = Date.now();
    this.missing = 0;
    this.social = null;               // interacción en curso (reservado)
    this.move = null;                 // paseo/salto que mueve su ventana
    this.depth = 1;
    this.identityKey = '';
    this.nextWander = Date.now() + 8000 + Math.random() * 8000;
    this.homeX = null;                // barra de tareas: su lugar de siempre
    this.scaleNow = 1;
  }
  get alive() { return !!(this.win && !this.win.isDestroyed()) && !this.removed; }
  // todo lo que va a su página lleva su id (la página puede tener varios Clawds)
  send(ch, d) { if (this.alive) this.win.webContents.send('pet', { id: this.id, ch, d }); }
}
const livePets = () => [...pets.values()].filter((p) => p.alive && !p.leaving);
function leadPet() {
  let best = null;
  for (const p of livePets()) if (!best || p.createdAt < best.createdAt) best = p;
  return best;
}
// el chat (globitos) siempre va con el anfitrión
function petOf(e, id) { const p = pets.get(Number(id)); return p && p.alive && p.win.webContents === e.sender ? p : null; }
const anyWin = () => { const p = leadPet() || [...pets.values()].find((q) => q.alive); return p ? p.win : null; };

// identidad: nombre y color por sesión (y lo que elegiste para su proyecto)
function isScratch(cwd) { return !cwd || /scratch-workspaces|[\\/]Temp[\\/]/i.test(cwd); }
function recOf(p) {
  if (p.extra) { const k = 'x:' + p.extra; if (!cfg.clawds[k]) cfg.clawds[k] = {}; return cfg.clawds[k]; }
  if (!p.sid) return cfg.home;
  if (!cfg.clawds[p.sid]) cfg.clawds[p.sid] = {};
  return cfg.clawds[p.sid];
}
function ensureIdentity(p, info) {
  const rec = recOf(p);
  if (info && info.cwd) rec.cwd = info.cwd;
  rec.seen = Date.now();
  if (rec.name) return;
  const used = new Set(livePets().filter((q) => q !== p).map((q) => recOf(q).name));
  const proj = rec.cwd && !isScratch(rec.cwd) ? cfg.projects[rec.cwd] : null;
  if (proj && proj.name && !used.has(proj.name)) { rec.name = proj.name; rec.color = proj.color; }
  else rec.name = NAMES.find((n) => !used.has(n)) || `Clawd ${pets.size}`;
  saveCfg();
}
function setLook(p, change) {
  const rec = recOf(p);
  Object.assign(rec, change);
  if (rec.cwd && !isScratch(rec.cwd)) cfg.projects[rec.cwd] = { name: rec.name, color: rec.color };
  saveCfg();
  sendIdentity(p, true);
}

// =====================================================================
//  Ventanas
// =====================================================================
function moveWin(p, x, y) {
  if (!p.alive) return;
  // "|| 0" convierte el -0 (cero negativo, que sale al cruzar la orilla) en 0: Electron no acepta -0
  const nx = Math.round(Number(x)) || 0, ny = Math.round(Number(y)) || 0;
  if (!Number.isFinite(nx) || !Number.isFinite(ny)) { log(`movimiento inválido ignorado: x=${x} y=${y}`); return; }
  if (p.shared) { p.pos = [nx, ny]; queuePlace(p); return; }
  try { p.win.setPosition(nx, ny); } catch (e) { log(`no pude mover la ventana a ${nx},${ny}: ${e.message}`); }
}
// dónde está su "ventana" (propia, o su escenario dentro de la ventana compartida), en px de pantalla
function posOf(p) { return p.shared ? p.pos : p.win.getPosition(); }

// =====================================================================
//  Ventana compartida: en grupo y en la barra de tareas todos viven en UNA ventana
// =====================================================================
let sharedWin = null, sharedReady = false, sharedRect = null;
const isShared = () => !SHOT && (mode === 'group' || isBar());
function sharedBounds() {
  if (isBar()) { const g = taskbarGeom(); const h = dims().h; return { x: g.b.x, y: g.top - h, width: g.b.width, height: h }; }
  const a = groupArea();
  const wa = screen.getDisplayNearestPoint({ x: Math.round(a.ax - 20), y: Math.round(a.ay - 20) }).workArea;
  return { x: wa.x, y: wa.y, width: wa.width, height: wa.height };
}
function sendShared(ch, d) { if (sharedWin && !sharedWin.isDestroyed() && sharedReady) sharedWin.webContents.send(ch, d); }
function ensureShared() {
  if (sharedWin && !sharedWin.isDestroyed()) return sharedWin;
  sharedRect = sharedBounds();
  sharedReady = false;
  const win = new BrowserWindow({
    ...sharedRect,
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, focusable: true, title: APP_NAME, icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false, spellcheck: false, zoomFactor: Z(),
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('console-message', (_e, level, message, line) => { if (level >= 3 || OPTS.trace) log(`renderer(compartida)[${level}]: ${message} (línea ${line})`); });
  win.webContents.on('render-process-gone', (_e, d) => log(`renderer compartido cayó: ${d.reason}`));
  win.webContents.on('did-finish-load', () => { try { win.webContents.setZoomFactor(Z()); } catch (_) { /* nada */ } });
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
  win.on('closed', () => {
    if (sharedWin !== win) return;
    sharedWin = null; sharedReady = false;
    for (const p of [...pets.values()]) if (p.shared && p.win === win) { stopEntranceWalk(p); stopMove(p); endSocialOf(p); pets.delete(p.id); p.win = null; }
    refreshTray();
  });
  sharedWin = win;
  log(`ventana compartida (${mode}): ${sharedRect.width}x${sharedRect.height} en ${sharedRect.x},${sharedRect.y}`);
  return win;
}
function layoutShared() {
  if (!sharedWin || sharedWin.isDestroyed()) return;
  sharedRect = sharedBounds();
  try { sharedWin.setBounds(sharedRect); } catch (e) { log('ventana compartida: ' + e); }
  for (const p of pets.values()) if (p.shared && p.alive) queuePlace(p);
  groupKey = '';
}
function closeShared() {
  if (sharedWin && !sharedWin.isDestroyed()) { const w = sharedWin; sharedWin = null; sharedReady = false; w.destroy(); }
  sharedWin = null; sharedReady = false;
}
function addToShared(p, pos) {
  const w = ensureShared();
  p.win = w; p.shared = true; p.removed = false;
  p.pos = [Math.round(pos.x), Math.round(pos.y)];
  p.identityKey = '';
  pets.set(p.id, p);
  if (sharedReady) { sendShared('page:add', { id: p.id }); queuePlace(p); }
}
const placeQ = new Set();
let placeT = null;
function queuePlace(p) {
  placeQ.add(p);
  if (!placeT) placeT = setImmediate(() => {
    placeT = null;
    const z = Z();
    const list = [...placeQ].filter((q) => q.shared && q.alive).map((q) => ({ id: q.id, x: Math.round((q.pos[0] - sharedRect.x) / z * 10) / 10, y: Math.round((q.pos[1] - sharedRect.y) / z * 10) / 10 }));
    placeQ.clear();
    if (list.length) sendShared('page:place', list);
  });
}
// la página avisa que ya cargó: qué Clawds le tocan
ipcMain.handle('page:init', (e) => {
  if (sharedWin && !sharedWin.isDestroyed() && e.sender === sharedWin.webContents) {
    sharedReady = true;
    const ids = [...pets.values()].filter((p) => p.shared && p.alive).map((p) => p.id);
    for (const id of ids) pets.get(id).identityKey = '';
    setTimeout(() => { for (const id of ids) { const p = pets.get(id); if (p) queuePlace(p); } groupKey = ''; }, 0);
    return { shared: true, mode, ids };
  }
  const p = [...pets.values()].find((q) => !q.shared && q.win && !q.win.isDestroyed() && q.win.webContents === e.sender);
  return { shared: false, mode, ids: p ? [p.id] : [] };
});

// lugar de un Clawd (sin estorbar a los demás)
function overlaps(x, y, except) {
  const { w } = dims();
  return livePets().some((q) => {
    if (q === except || !q.alive) return false;
    // si viene llegando, cuenta el lugar a donde va (no donde va pasando)
    const [qx, qy] = q.entranceInfo && q.spot ? [q.spot.x, q.spot.y] : posOf(q);
    const fq = qx + petOff(q), fx = x + petOff(except);
    return Math.abs(fq - fx) < (isBar() ? zr(95) : zr(150)) && Math.abs(qy - y) < (isBar() ? 1 : zr(110)) && w > 0;
  });
}
function spotFor(p) {
  const rec = recOf(p);
  if (isBar()) {
    const g = taskbarGeom();
    const y = g.top - dims().h;
    let x = Number.isFinite(rec.taskbar && rec.taskbar.left) ? rec.taskbar.left
      : (!p.sid || livePets().filter((q) => q !== p).length === 0) && Number.isFinite(cfg.taskbar.left) ? cfg.taskbar.left : g.maxX - 2;
    x = clamp(x, g.minX, g.maxX);
    for (let k = 0; k < 14 && overlaps(x, y, p); k++) x = clamp(x - zr(125), g.minX, g.maxX);
    return { x, y, side: 'right' };
  }
  if (mode === 'group') {
    const a = groupArea();
    const k = livePets().filter((q) => q !== p).length;
    const fx = a.x1 - zr(70) - ((k * zr(150)) % (a.x1 - a.x0 - zr(60)));
    const fy = a.y1 - (k % 2) * zr(80);
    const s = fx - petBoxW() < a.x0 + zr(120) ? 'left' : 'right';
    const w = winForFeet(p, fx, fy, s);
    return { x: w.x, y: w.y, side: s };
  }
  const own = desktopValid(p.sid ? rec.desktop : cfg.desktop);
  if (own) return own;
  const d = desktopDefault();
  if (!p.sid && !livePets().some((q) => q !== p)) return d;
  let x = d.x;
  for (let k = 0; k < 10 && overlaps(x, d.y, p); k++) x -= zr(170);
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: Math.max(x, wa.x - zr(PET_LEFT_IN_WIN)), y: d.y, side: x < wa.x ? 'left' : 'right' };
}
// su lugar solo se guarda cuando TÚ lo mueves (o cuando termina de llegar caminando)
function savePos(p) {
  if (SHOT || !p.alive || p.walking || p.entranceInfo || p.move || p.social) return;
  const [x, y] = posOf(p);
  const rec = recOf(p);
  if (isBar()) {
    rec.taskbar = { left: x };
    p.homeX = x;
    if (p === leadPet()) cfg.taskbar = { left: x };
  } else if (mode === 'desktop') {
    rec.desktop = { left: x, bottom: y + dims().h, side: p.side };
    if (p === leadPet()) cfg.desktop = rec.desktop;
  }
  rec.seen = Date.now();
  saveCfg();
}

// lado de la interfaz (escritorio): globos y barrita a la izquierda del mini Claude; junto a la
// orilla izquierda se voltean hacia la derecha. La ventana se recorre lo mismo, así no brinca.
function applySide(p, next) {
  if (next === p.side || !p.alive || isBar()) return;
  p.side = next;
  p.send('side', next);
  const dx = next === 'left' ? zr(PET_SHIFT) : -zr(PET_SHIFT);
  if (p.drag) { p.drag.wx += dx; return; }
  const [x, y] = posOf(p);
  setTimeout(() => { if (p.alive) { moveWin(p, x + dx, y); savePos(p); } }, 25);
}
function checkSide(p) {
  if (!p.alive || isBar() || p.walking) return;
  const [x, y] = posOf(p);
  const { w } = dims();
  const wa = workAreaAt(x, y);
  if (p.side === 'right' && x < wa.x - 4) applySide(p, 'left');
  else if (p.side === 'left' && (x + w > wa.x + wa.width + 4 || x - zr(PET_SHIFT) >= wa.x + 40)) applySide(p, 'right');
}
function taskbarSide(p) {
  if (!p.alive) return 'right';
  const [x] = posOf(p);
  const b = screen.getPrimaryDisplay().bounds;
  return x + dims().w / 2 < b.x + b.width / 2 ? 'left' : 'right';
}

function createPetWindow(p, entrance) {
  const { w, h } = dims();
  p.entranceInfo = null;
  let pos;
  if (SHOT) {
    pos = { x: -3000, y: 100 };
    if (!isBar() && arg('--side')) p.side = arg('--side');
  } else {
    const s = spotFor(p);
    p.side = s.side;
    pos = { x: s.x, y: s.y };
    p.spot = { x: s.x, y: s.y };
    if (isBar()) p.homeX = s.x;
    if (entrance) {
      // se asoma desde la orilla de la pantalla más cercana a su lugar y luego camina hasta ahí
      const wa = isBar() ? (() => { const b = screen.getPrimaryDisplay().bounds; return { x: b.x, y: b.y, width: b.width, height: b.height }; })()
        : screen.getDisplayMatching({ x: s.x, y: s.y, width: w, height: h }).workArea;
      const petX = s.x + petOff(p, s.side);
      const fromRight = petX + petBoxW() / 2 > wa.x + wa.width / 2;
      p.entranceInfo = { from: fromRight ? 'right' : 'left', targetPetX: petX, y: s.y, wa };
      if (!isBar()) p.side = fromRight ? 'right' : 'left';
      pos = fromRight
        ? { x: wa.x + wa.width - petBoxW() - petOff(p), y: s.y }     // su caja pegada a la orilla derecha
        : { x: wa.x - petOff(p), y: s.y };                          // su caja pegada a la orilla izquierda
    }
  }
  if (isShared()) {
    addToShared(p, pos);
    log(`Clawd #${p.id} aparece${p.sid ? ` (sesión ${p.sid.slice(0, 8)}, ${recOf(p).name})` : p.extra ? ` (invocado, ${recOf(p).name})` : ' (anfitrión)'} [compartida]`);
    refreshTray();
    return;
  }
  const win = new BrowserWindow({
    width: w, height: h, x: Math.round(pos.x), y: Math.round(pos.y),
    frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, focusable: true, title: APP_NAME, icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false, spellcheck: false, zoomFactor: Z(),
    },
  });
  p.win = win;
  p.identityKey = '';
  pets.set(p.id, p);
  win.setAlwaysOnTop(true, 'floating');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.webContents.on('console-message', (_e, level, message, line) => {
    if (level >= 3 || OPTS.trace) log(`renderer#${p.id}[${level}]: ${message} (línea ${line})`);
  });
  win.webContents.on('render-process-gone', (_e, d) => log(`renderer#${p.id} cayó: ${d.reason}`));
  // el zoom de Chromium se recuerda por origen (file://): se fija siempre al tamaño elegido
  win.webContents.on('did-finish-load', () => { try { win.webContents.setZoomFactor(Z()); } catch (_) { /* nada */ } p.identityKey = ''; sendIdentity(p); });
  win.once('ready-to-show', () => {
    if (!p.alive) return;
    win.showInactive();
    if (SHOT) setTimeout(() => takeShot(p), OPTS.wait);
    else if (!isBar() && !p.entranceInfo) setTimeout(() => checkSide(p), 300);
  });
  win.on('closed', () => {
    if (p.win !== win) return;            // ya tiene otra ventana (cambio de modo)
    stopEntranceWalk(p); stopMove(p); endSocialOf(p); pets.delete(p.id); p.win = null; refreshTray();
  });
  log(`Clawd #${p.id} aparece${p.sid ? ` (sesión ${p.sid.slice(0, 8)}, ${recOf(p).name})` : p.extra ? ` (invocado, ${recOf(p).name})` : ' (anfitrión)'}`);
  refreshTray();
}
function destroyPet(p) {
  clearTimeout(p.byeTimer);
  stopEntranceWalk(p);
  stopMove(p);
  endSocialOf(p);
  if (p.drag) { clearInterval(p.drag.timer); p.drag = null; }
  const wasShared = p.shared;
  if (p.alive) { saveCfg(); if (p.shared) { sendShared('page:remove', { id: p.id }); p.removed = true; } else p.win.destroy(); }
  p.win = null; p.shared = false;
  pets.delete(p.id);
  if (wasShared && ![...pets.values()].some((q) => q.shared)) closeShared();
  refreshTray();
}
// se despide con la manita y se va
function byePet(p, why) {
  if (!p || !p.alive || p.leaving) return;
  const wasLead = p === leadPet();
  p.leaving = true;
  stopChat(p);
  endSocialOf(p);
  stopMove(p);
  if (p.walking) {                                  // venía caminando a su lugar: que se quede donde va
    stopEntranceWalk(p);
    p.entranceInfo = null;
    if (!isBar()) {
      const [x, y] = posOf(p);
      const wa = workAreaAt(x, y);
      const off = petOff(p);
      moveWin(p, clamp(x + off, wa.x, wa.x + wa.width - petBoxW()) - off, y);
    }
  }
  log(`Clawd #${p.id} se despide${why ? ` (${why})` : ''}`);
  p.send('bye');
  clearTimeout(p.byeTimer);
  p.byeTimer = setTimeout(() => destroyPet(p), 3400);
  if (wasLead) for (const q of livePets()) sendIdentity(q, true);   // el chat pasa al siguiente
}

async function takeShot(p) {
  try {
    const bg = (arg('--bg') || '#55657A').replace(/[^#0-9a-fA-F]/g, '');
    await p.win.webContents.executeJavaScript(`document.documentElement.style.background='${bg}'`);
    if (process.env.COMPANION_SHOT_DEBUG) {
      const r = await p.win.webContents.executeJavaScript(`JSON.stringify(['body','#stage','.clawd','#pet','#work','#ask'].map((q) => { const n = document.querySelector(q); if (!n) return q + ':-'; const b = n.getBoundingClientRect(); return q + ':' + [b.x, b.y, b.width, b.height].map(Math.round).join(','); }).concat([innerWidth + 'x' + innerHeight, devicePixelRatio]))`);
      log('shot: ' + r);
    }
    await new Promise((r) => setTimeout(r, 150));
    const img = await p.win.webContents.capturePage();
    fs.writeFileSync(SHOT, img.toPNG());
  } catch (e) { log('shot: ' + e); }
  app.exit(0);
}

// la página pide la configuración cuando ya cargó (así no se pierde al arrancar)
ipcMain.handle('opts:get', (e, id) => {
  const p = petOf(e, id);
  const lead = p === leadPet();
  return {
    ...OPTS,
    hover: OPTS.hover && lead, fakeChat: OPTS.fakeChat && lead, ask: lead ? OPTS.ask : null,
    model: modelInfo(p ? chatOf(p).model : cfg.model),
    history: p ? chatOf(p).history : [],
    mode: isBar() ? 'taskbar' : 'desktop',
    side: !p ? 'right' : isBar() ? taskbarSide(p) : p.side,
    entrance: !p ? null
      : p.entranceInfo ? { mode: 'walk', from: p.entranceInfo.from }
        : (SHOT && arg('--entrance') ? { mode: 'walk', from: arg('--entrance') } : null),
    identity: p ? identityOf(p) : null,
  };
});
ipcMain.on('trace', (e, id, m) => { if (OPTS.trace) { const p = petOf(e, id); log(`trace#${p ? p.id : '?'} ${m}`); } });
// ratón: transparente salvo donde hay algo
ipcMain.on('interactive', (e, on) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(!on, { forward: true }); });

// ---------- entrada: camina desde la orilla hasta su lugar ----------
function stopEntranceWalk(p) { if (p.walkTimer) { clearInterval(p.walkTimer); p.walkTimer = null; } p.walking = false; }
ipcMain.on('entrance:walk', (ev, id) => {
  const p = petOf(ev, id);
  if (!p) return;
  if (!p.entranceInfo) { p.send('walk', { dir: 0 }); return; }
  if (p.walkTimer) return;                                  // ya va caminando: nunca dos caminatas a la vez
  const e = p.entranceInfo;
  const off = petOff(p);
  const fromRight = e.from === 'right';
  const startX = fromRight
    ? e.wa.x + e.wa.width - Math.round(petBoxW() * CLAWD_FROM) - off
    : e.wa.x - off - Math.round(petBoxW() * 0.72);
  const endX = fromRight ? Math.min(startX, e.targetPetX - off) : Math.max(startX, e.targetPetX - off);
  const dir = fromRight ? -1 : 1;
  if (!Number.isFinite(startX) || !Number.isFinite(endX) || !Number.isFinite(e.y)) {
    log('caminata cancelada: coordenadas inválidas');
    p.entranceInfo = null; p.send('walk', { dir: 0 });
    return;
  }
  let x = startX;
  p.walking = true;
  moveWin(p, x, e.y);
  p.send('walk', { dir });
  let last = Date.now();
  const speed = isBar() ? WALK_SPEED * 0.6 : WALK_SPEED;
  const me = setInterval(() => {
    if (p.walkTimer !== me) { clearInterval(me); return; }   // una caminata vieja que quedó colgada: se apaga sola
    if (!p.alive) { stopEntranceWalk(p); return; }
    const now = Date.now();
    x += dir * speed * (now - last) / 1000;
    if (dir > 0 ? x > endX : x < endX) x = endX;
    last = now;
    moveWin(p, x, e.y);
    if (x === endX) {
      stopEntranceWalk(p);
      p.entranceInfo = null;
      p.send('walk', { dir: 0 });
      setTimeout(() => { checkSide(p); savePos(p); }, 60);
    }
  }, 16);
  p.walkTimer = me;
});

// ---------- arrastrar ----------
ipcMain.handle('drag:start', (ev, id) => {
  const p = petOf(ev, id);
  if (!p || p.walking) return;
  stopMove(p);
  endSocialOf(p);
  const c = screen.getCursorScreenPoint();
  const [wx, wy] = posOf(p);
  if (p.drag) clearInterval(p.drag.timer);
  // en grupo se mueve todo el grupo junto
  const group = mode === 'group' ? livePets().filter((q) => q !== p).map((q) => { stopMove(q); endSocialOf(q); const [x, y] = posOf(q); return { q, x, y }; }) : [];
  const g0 = mode === 'group' ? groupArea() : null;
  p.drag = { sx: c.x, sy: c.y, wx, wy, moved: false, t0: Date.now(), group, g0 };
  p.drag.timer = setInterval(() => {
    const d = p.drag;
    if (!p.alive || !d) return;
    const pt = screen.getCursorScreenPoint();
    const dx = pt.x - d.sx, dy = pt.y - d.sy;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 4) { d.moved = true; p.send('drag:moving', true); }
    if (d.moved) {
      if (isBar()) {
        // en la barra de tareas solo se mueve de lado a lado, siempre parado sobre la barra
        const g = taskbarGeom();
        moveWin(p, clamp(d.wx + dx, g.minX, g.maxX), g.top - dims().h);
        p.send('side', taskbarSide(p));
      } else {
        moveWin(p, d.wx + dx, d.wy + dy);
        for (const o of d.group) moveWin(o.q, o.x + dx, o.y + dy);
        checkSide(p);
      }
      d.dx = dx; d.dy = dy;
    }
    if (Date.now() - d.t0 > 60000) { clearInterval(d.timer); p.drag = null; }
  }, 16);
});
ipcMain.handle('drag:end', (ev, id) => {
  const p = petOf(ev, id);
  if (!p || !p.drag) return false;
  clearInterval(p.drag.timer);
  const d = p.drag;
  p.drag = null;
  if (d.moved) {
    p.send('drag:moving', false);
    if (mode === 'group' && d.g0) { cfg.group = { x: d.g0.ax + (d.dx || 0), y: d.g0.ay + (d.dy || 0) }; saveCfg(); }
    savePos(p);
  }
  return d.moved;
});

// =====================================================================
//  Estado de las sesiones de Claude Code
// =====================================================================
function hace(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return '';
  if (min < 60) return `hace ${min} min`;
  return `hace ${Math.floor(min / 60)} h`;
}
function readSessions() {
  const now = Date.now();
  const out = [];
  let files = [];
  try { files = fs.readdirSync(DIR_SES).filter((f) => f.endsWith('.json')); } catch (_) { return out; }
  for (const f of files) {
    const full = path.join(DIR_SES, f);
    try {
      const o = JSON.parse(fs.readFileSync(full, 'utf8'));
      const age = now - Number(o.ts || 0);
      if (age > 86400000) { try { fs.unlinkSync(full); } catch (_) { /* nada */ } continue; }
      o.age = age; o.sid = f.replace(/\.json$/, '');
      out.push(o);
    } catch (_) { /* archivo a medio escribir */ }
  }
  return out;
}

// ---------- lo que Claude va haciendo, leído del historial de la sesión (solo lectura) ----------
// Lista de tareas (update_plan de la app, TodoWrite o TaskCreate/TaskUpdate de la terminal) y los
// mensajes que Claude manda mientras trabaja. Se lee por partes: solo lo nuevo de cada archivo.
const tCache = new Map();
const TAIL_FIRST = 4 * 1024 * 1024;
function mdPlain(t) {
  return String(t || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, '$1$2')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function promptText(c) {
  let s = '';
  if (typeof c === 'string') s = c;
  else if (Array.isArray(c)) {
    if (c.some((b) => b && b.type === 'tool_result')) return '';
    s = c.filter((b) => b && b.type === 'text').map((b) => b.text).join(' ');
  }
  return s.replace(/<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').trim();
}
// solo los últimos mensajes de la sesión (lo que se le pasa a la plática con su Clawd)
function pushRecent(c, who, text) {
  c.recent.push({ who, text: String(text).slice(0, 1200) });
  if (c.recent.length > 16) c.recent.shift();
}
function applyLine(c, m) {
  if (m.isSidechain) return;
  if (m.type === 'user') {
    if (m.isMeta || m.isCompactSummary) return;
    const msg = m.message || {};
    const pt = promptText(msg.content);
    if (pt) { c.says = []; c.plan = []; c.turn++; pushRecent(c, 'Usuario', pt); } // mensaje tuyo: empieza otra vuelta
    return;
  }
  if (m.type !== 'assistant' || !m.message || !Array.isArray(m.message.content)) return;
  if (/^claude-/.test(String(m.message.model || ''))) c.model = m.message.model; // el modelo real de la sesión (cambia si lo cambias)
  m.message.content.forEach((b, i) => {
    if (!b) return;
    if (b.type === 'text') {
      const t = mdPlain(b.text);
      if (t) pushRecent(c, 'Claude', t);
      if (t) { c.says.push({ id: `${m.uuid || m.message.id}:${i}`, text: t.slice(0, 1600), ts: Date.parse(m.timestamp) || Date.now() }); if (c.says.length > 3) c.says.shift(); }
      return;
    }
    if (b.type !== 'tool_use') return;
    const inp = b.input || {};
    const name = String(b.name || '');
    if (/__update_plan$/.test(name)) {
      if (Array.isArray(inp.items)) {
        c.plan = inp.items.map((it) => ({ t: String(it.content || ''), s: it.status === 'completed' ? 'done' : it.status === 'in_progress' ? 'doing' : 'todo' }));
      } else if (c.plan.length) {
        if (inp.advance) {
          const k = c.plan.findIndex((p) => p.s === 'doing');
          if (k >= 0) c.plan[k].s = 'done';
          const n = c.plan.findIndex((p, j) => j > k && p.s === 'todo');
          if (n >= 0) c.plan[n].s = 'doing';
        }
        if (Array.isArray(inp.done)) for (const d of inp.done) if (c.plan[d - 1]) c.plan[d - 1].s = 'done';
        if (inp.start && c.plan[inp.start - 1]) {
          for (const p of c.plan) if (p.s === 'doing') p.s = 'done';
          c.plan[inp.start - 1].s = 'doing';
        }
      }
    } else if (/__wrap_up$/.test(name)) {
      for (const p of c.plan) p.s = 'done';
    } else if (name === 'TodoWrite' && Array.isArray(inp.todos)) {
      c.plan = inp.todos.map((it) => ({ t: String(it.content || ''), s: it.status === 'completed' ? 'done' : it.status === 'in_progress' ? 'doing' : 'todo' }));
    } else if (name === 'TaskCreate' && inp.subject) {
      c.plan.push({ t: String(inp.subject), s: 'todo' });
    } else if (name === 'TaskUpdate' && inp.taskId) {
      const p = c.plan[Number(inp.taskId) - 1];
      if (p && inp.status === 'deleted') p.gone = true;
      else if (p && inp.status) p.s = inp.status === 'completed' ? 'done' : inp.status === 'in_progress' ? 'doing' : 'todo';
    }
  });
}
function readTranscript(tp) {
  if (!tp) return null;
  let size;
  try { size = fs.statSync(tp).size; } catch (_) { return null; }
  let c = tCache.get(tp);
  if (!c || size < c.off) {
    c = { off: Math.max(0, size - TAIL_FIRST), skipFirst: size > TAIL_FIRST, rest: null, plan: [], says: [], turn: 0, used: 0, model: null, recent: [] };
    tCache.set(tp, c);
  }
  c.used = Date.now();
  if (size > c.off) {
    let buf;
    try {
      const fd = fs.openSync(tp, 'r');
      buf = Buffer.alloc(size - c.off);
      fs.readSync(fd, buf, 0, buf.length, c.off);
      fs.closeSync(fd);
    } catch (_) { return c; }
    c.off = size;
    if (c.rest) buf = Buffer.concat([c.rest, buf]);
    const end = buf.lastIndexOf(10);
    c.rest = end < buf.length - 1 ? buf.subarray(end + 1) : null;
    if (end >= 0) {
      const lines = buf.subarray(0, end).toString('utf8').split('\n');
      if (c.skipFirst) { lines.shift(); c.skipFirst = false; }
      for (const l of lines) {
        if (l.length < 20 || !(l.includes('"type":"assistant"') || l.includes('"type":"user"'))) continue;
        let m; try { m = JSON.parse(l); } catch (_) { continue; }
        try { applyLine(c, m); } catch (_) { /* línea rara */ }
      }
    }
  }
  if (tCache.size > 8) { // olvida historiales viejos
    const old = [...tCache.entries()].sort((a, b) => a[1].used - b[1].used)[0];
    if (old && old[0] !== tp) tCache.delete(old[0]);
  }
  return c;
}
function planView(plan) {
  const all = plan.filter((p) => !p.gone && p.t);
  if (all.length <= 6) return all;
  // muchas tareas: la que va, una antes y las que siguen (máximo 6)
  let k = all.findIndex((p) => p.s === 'doing');
  if (k < 0) k = all.findIndex((p) => p.s === 'todo');
  if (k < 0) k = all.length - 1;
  const from = Math.max(0, Math.min(k - 1, all.length - 6));
  const view = all.slice(from, from + 6);
  if (from > 0) view.unshift({ t: `${from} hecha${from > 1 ? 's' : ''}`, s: 'done', more: true });
  return view;
}
const actSeen = new Map(); // sid -> { act, since }

const DOT = { gray: '#9A9A9A', orange: '#D97757', yellow: '#F2C94C', green: '#4CC38A', red: '#EB5757' };
function demoStatus(m) {
  const acts = {
    working: ['working', 'Listando sesiones'], thinking: ['working', 'Pensando…'],
    attention: ['attention', 'Necesito tu permiso · Ejecutar un comando'], done: ['done', '¡Listo! Te toca'],
    error: ['error', 'Algo falló y me detuve'], idle: ['idle', 'Esperando tu mensaje'],
  };
  if (!acts[m]) return [];
  const done = m === 'done';
  return [{
    sid: 'demo', state: acts[m][0], activity: acts[m][1], title: 'Rehaz la mascota con Clawd', age: 0, since: Date.now() - 51000,
    plan: [
      { t: 'Ver de dónde sale "General coding session"', s: 'done' },
      { t: 'Ponerle título a cada plática antes de abrirla', s: done ? 'done' : 'doing' },
      { t: 'Renombrar las 4 sesiones que ya existen', s: done ? 'done' : 'todo' },
      { t: 'Probar y reiniciar', s: done ? 'done' : 'todo' },
    ],
    says: [
      { id: 'd1', text: 'Ya encontré la causa: las pláticas del mini Claude no tienen título dentro del archivo, así que la app no lo puede importar.' },
      { id: 'd2', text: 'Son 4 sesiones que llegaron sin título; la app les pone “General coding session” de relleno. Ya vi qué platicaste en cada una, así que les pongo nombre:' },
    ],
  }];
}
function computeStatus(list, single) {
  const vig = list.filter((s) => s.age < 1800000);
  const vivas = vig.filter((s) => s.state === 'working' || s.state === 'attention').length;
  const by = (st) => vig.filter((s) => s.state === st).sort((a, b) => a.age - b.age)[0];
  const info = by('attention') || by('working') || list.filter((s) => s.age < 3600000).sort((a, b) => a.age - b.age)[0];
  if (!info) return { mode: 'sleep', key: '', hasInfo: false, showBubble: false, title: '', sub: '', dot: DOT.gray, extra: '' };
  let m = 'idle', dot = DOT.gray;
  const sub0 = String(info.activity || '');
  switch (info.state) {
    case 'attention': m = 'attention'; dot = DOT.yellow; break;
    case 'working':
      if (info.age > cfg.timing.staleWorkMs) { m = 'sleep'; dot = DOT.gray; }
      else { m = /^Pensando/.test(sub0) ? 'thinking' : 'working'; dot = DOT.orange; }
      break;
    case 'done': m = info.age < 45000 ? 'done' : 'sleep'; dot = DOT.green; break;
    case 'error': m = info.age < 300000 ? 'error' : 'sleep'; dot = DOT.red; break;
    default: m = info.age < 30000 ? 'idle' : 'sleep';
  }
  const h = hace(info.age);
  // la acción principal arriba (como "Listando sesiones 51s" en la app), con su tiempo
  const now = Date.now();
  let seen = actSeen.get(info.sid);
  if (!seen || seen.act !== sub0) {
    seen = { act: sub0, since: info.since || (seen ? now : now - Math.min(info.age, 600000)) };
    actSeen.set(info.sid, seen);
  }
  const secs = Math.floor((now - seen.since) / 1000);
  const busy = m === 'working' || m === 'thinking';
  let plan = [], says = [];
  if (info.plan) { plan = info.plan; says = info.says || []; }
  else {
    const tr = readTranscript(info.tp);
    if (tr) { plan = planView(tr.plan); says = tr.says.slice(-2); }
  }
  // sin nada en curso (dormido o esperando), no se muestran tareas viejas
  if (m === 'sleep' || m === 'idle') { plan = []; says = []; }
  return {
    mode: m, dot, hasInfo: true, age: info.age,
    key: `${info.sid}|${info.state}`,
    showBubble: info.state !== 'idle',
    title: sub0 || 'Trabajando…',
    time: busy && secs >= 2 ? (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`) : '',
    sub: busy ? '' : (info.title ? String(info.title) : '') + (h ? `${info.title ? ' · ' : ''}${h}` : ''),
    extra: !single && vivas > 1 ? `+${vivas - 1} más` : '',
    plan, says,
  };
}

// =====================================================================
//  Administrador de sesiones: un Clawd por cada sesión activa
// =====================================================================
let claudeOpen = null;                 // Claude Desktop abierto (lo dice bin/clawd.exe)
let manualShow = false;                // lo abriste a mano (menú Inicio / "Mostrar a Clawd")
let userHidden = false;                // "Cerrar": se van todos hasta que vuelvas a abrir Claude
const dismissed = {};                  // sid -> ts: "Ocultar este Clawd" (vuelve cuando su sesión trabaje)
const URGENT = new Set(['working', 'thinking', 'attention', 'error']);

let assetsReady = false;              // sin las animaciones no aparece nadie (se preparan la primera vez)
function petsAllowed() { return !SHOT && assetsReady && !userHidden && (claudeOpen === true || manualShow); }
// ¿la sesión merece un Clawd en pantalla? (inactividad REAL: trabajando nunca cuenta como inactiva)
function sessionVisible(s) {
  if (dismissed[s.sid] && Number(s.ts) <= dismissed[s.sid]) return false;
  const busy = (s.state === 'working' || s.state === 'attention') && s.age < cfg.timing.staleWorkMs;
  if (busy) return true;
  return s.age < cfg.timing.hideMs;
}
const prio = (s) => (s.state === 'attention' ? 0 : s.state === 'working' ? 1 : 2);

function reconcile(list) {
  const allow = petsAllowed();
  const want = allow ? list.filter(sessionVisible).sort((a, b) => prio(a) - prio(b) || a.age - b.age).slice(0, cfg.maxPets) : [];
  const wantIds = new Set(want.map((s) => s.sid));
  // los que sobran: se despiden (con unos segundos de gracia por si la lectura falló)
  const extra = [];
  for (const p of livePets()) {
    if (!allow) { byePet(p, 'Claude cerrado'); continue; }
    if (p.sid && !wantIds.has(p.sid)) { if (++p.missing >= 3) extra.push(p); }
    else p.missing = 0;
  }
  if (allow && extra.length) {
    // si se iría el último, se queda uno (dormido) para que siempre tengas a Clawd mientras Claude está abierto
    const remaining = livePets().filter((p) => !extra.includes(p));
    if (!remaining.length) extra.sort((a, b) => b.createdAt - a.createdAt).shift();
    for (const p of extra) byePet(p, 'sesión inactiva o terminada');
  }
  if (!allow) return;
  for (const s of want) {
    if ([...pets.values()].some((p) => p.sid === s.sid && p.alive)) continue;   // nunca dos para la misma sesión (ni mientras se despide)
    // el anfitrión sin sesión adopta la primera que aparezca
    const host = livePets().find((p) => !p.sid && !p.extra);
    if (host) {
      if (host.chat) { saveChat(host); host.chat = null; }   // su plática sin sesión se queda guardada como la del anfitrión
      host.sid = s.sid; ensureIdentity(host, s); sendIdentity(host, true);
      host.send('chat:history', chatOf(host).history); host.send('model', modelInfo(chatOf(host).model)); log(`Clawd #${host.id} ahora es la sesión ${s.sid.slice(0, 8)}`); continue; }
    if (livePets().length >= cfg.maxPets) break;
    const p = new Pet(s.sid);
    ensureIdentity(p, s);
    createPetWindow(p, !OPTS.noIntro);
  }
  // los que invocaste regresan (hasta que los despidas)
  for (const x of cfg.extras) {
    if ([...pets.values()].some((p) => p.extra === x && p.alive)) continue;
    const p = new Pet(null); p.extra = x; ensureIdentity(p); createPetWindow(p, !OPTS.noIntro);
  }
  // un Clawd siempre, aunque no haya sesiones (para platicar con él)
  if (!livePets().length && ![...pets.values()].some((p) => p.alive)) {
    const p = new Pet(null);
    createPetWindow(p, !OPTS.noIntro);
  }
}

function statusFor(p, list) {
  if (OPTS.demo) return computeStatus(demoStatus(OPTS.demo), true);
  // sin sesión (invocado o el anfitrión): NO copia el estado de ninguna sesión. Solo trabaja cuando
  // le escribes tú (eso lo maneja su página) y en reposo se duerme como los demás.
  if (!p.sid) return { mode: 'sleep', key: '', hasInfo: false, showBubble: false, title: '', sub: '', dot: DOT.gray, extra: '' };
  const info = list.find((s) => s.sid === p.sid);
  if (!info) return { mode: 'sleep', key: '', hasInfo: false, showBubble: false, title: '', sub: '', dot: DOT.gray, extra: '' };
  return computeStatus([info], true);
}
// identidad que ve la página: nombre, color, tamaño (según el modelo) y si lleva el chat
function modelFor(p, info) {
  if (!p.sid) return { fam: familyOf(chatOf(p).model), sure: true };
  const tr = info && info.tp ? readTranscript(info.tp) : null;
  const m = (tr && tr.model) || (info && info.model) || null;
  return { fam: familyOf(m), sure: !!familyOf(m) };
}
function crowd() {
  const n = livePets().length;
  if (mode === 'group') return n > 1 ? 0.8 : 1;
  if (isBar()) return n > 4 ? 0.85 : 1;
  return 1;
}
function identityOf(p, info) {
  const rec = recOf(p);
  const c = colorOf(rec.color);
  // su tamaño es el del modelo con el que te contesta; si no lo has elegido tú, ese sigue al de su sesión
  const ch = chatOf(p);
  if (p.sid && !ch.pinned) { const d = defaultChatModel(p); if (d !== ch.model) { ch.model = d; saveChat(p); p.send('model', modelInfo(d)); } }
  const mf = { fam: familyOf(ch.model), sure: !!familyOf(ch.model) };
  const fam = mf.fam || 'sonnet';                           // sin certeza: tamaño de Sonnet (sin decir que lo es)
  const scale = Math.max(0.4, FAMILY_SCALE[fam] * cfg.petScale * crowd() * p.depth);
  p.scaleNow = scale;
  return {
    name: rec.name || 'Clawd',
    model: mf.sure ? fam[0].toUpperCase() + fam.slice(1) : '',
    hue: c.hue || 0, sat: c.sat === undefined ? 1 : c.sat, bright: c.bright || 1,
    scale: Math.round(scale * 1000) / 1000,
    lead: p === leadPet(),
    mainWalk: isBar() || mode === 'group',
    session: !!p.sid,
    sleepMs: cfg.timing.sleepMs,
  };
}
let lastList = [];
function sendIdentity(p, force) {
  if (!p.alive) return;
  const id = identityOf(p, lastList.find((s) => s.sid === p.sid));
  const k = JSON.stringify(id);
  if (!force && k === p.identityKey) return;
  p.identityKey = k;
  p.send('identity', id);
}

let dumpN = 0;
// ---------- chat grupal: los Clawds, sus pláticas y lo que dicen en sus sesiones ----------
let groupDirty = true, groupKey = '';
function groupPos() {
  const z = Z();
  if (isBar()) return { right: 10, bottom: 52 };
  const a = groupArea();
  return { right: Math.max(4, Math.round((sharedRect.x + sharedRect.width - a.x1) / z)), bottom: Math.round((sharedRect.y + sharedRect.height - a.y0) / z) + 150 };
}
function sendGroup() {
  const live = livePets();
  const petsInfo = live.map((p) => {
    const info = lastList.find((x) => x.sid === p.sid);
    const rec = recOf(p);
    const col = colorOf(rec.color);
    const mf = modelFor(p, info);
    const c = chatOf(p);
    const d = p.sid ? deskSession(p.sid) : null;
    const last = c.history[c.history.length - 1];
    return {
      id: p.id, name: rec.name || 'Clawd', hue: col.hue || 0, sat: col.sat === undefined ? 1 : col.sat, bright: col.bright || 1,
      model: mf.sure ? mf.fam[0].toUpperCase() + mf.fam.slice(1) : '', chatModel: modelInfo(c.model).label.split(' ')[0],
      chatBusy: !!c.proc, hasSession: !!p.sid, hasChat: !!(last && last.who !== 'sep'),
      session: (p.sid ? String((d && d.title) || (info && info.title) || '').slice(0, 40) : p.helper ? 'ayudante' : 'sin sesión') + (petExtensions(p).length ? ' · ' + petExtensions(p).map(extLabel).join(', ') : ''),
    };
  });
  const feed = [];
  for (const p of live) {
    const c = chatOf(p);
    let lastClaude = -1;
    c.history.forEach((h, i) => { if (h.who === 'Claude') lastClaude = i; });
    c.history.forEach((h, i) => feed.push({
      k: `h${p.id}-${h.ts || 0}-${i}`, id: p.id, who: h.who === 'Yo' ? 'you' : h.who === 'sep' ? 'sep' : 'claude',
      text: h.text || '', err: !!h.err, ts: h.ts || 0, last: i === lastClaude && !c.proc && !!c.cur && !p.helper,
      from: h.from || null,                       // si se lo pidió otro Clawd (delegar)
    }));
    if (p.sid) {
      const info = lastList.find((x) => x.sid === p.sid);
      const tr = info && info.tp ? readTranscript(info.tp) : null;
      if (tr) for (const x of tr.says.slice(-3)) feed.push({ k: 's' + x.id, id: p.id, who: 'say', text: x.text, ts: x.ts || 0 });
    }
  }
  feed.sort((a, b) => a.ts - b.ts);
  const out = { pets: petsInfo, feed: feed.slice(-50), pos: groupPos() };
  const k = JSON.stringify(out);
  if (k === groupKey && !groupDirty) return;
  groupKey = k; groupDirty = false;
  sendShared('page:group', out);
}
function managerTick() {
  let list = [];
  try { list = OPTS.demo ? [] : readSessions(); } catch (e) { log('sesiones: ' + e); }
  lastList = list;
  if (!SHOT) try { reconcile(list); } catch (e) { log('reconcile: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
  const now = Date.now();
  for (const p of pets.values()) {
    if (!p.alive) continue;
    let s;
    try { s = statusFor(p, list); } catch (e) { log('status: ' + e); continue; }
    if (s.mode !== p.mode) {
      const was = p.mode;
      p.mode = s.mode; p.modeSince = now;
      if (s.mode === 'done' && (was === 'working' || was === 'thinking')) onFinished(p);
      if (URGENT.has(s.mode) && p.social) abortSocial(p.social, 'trabajo');
      if (URGENT.has(s.mode) && p.move && !p.move.keep) stopMove(p, true);
    }
    p.send('status', s);
    sendIdentity(p);
  }
  // pruebas: cada ~6 s anota dónde está cada Clawd y en qué anda
  if (process.env.COMPANION_DUMP && (++dumpN % 10 === 0)) {
    log('estado: ' + [...pets.values()].filter((p) => p.alive).map((p) => {
      const f = feetOf(p);
      return `#${p.id}${p === leadPet() ? '*' : ''} ${p.sid ? p.sid.slice(0, 8) : 'anfitrión'} ${recOf(p).name} ${p.mode} pies=${Math.round(f.x)},${Math.round(f.y)} esc=${p.scaleNow.toFixed(2)}${p.leaving ? ' (saliendo)' : ''}${p.social ? ' [' + p.social.kind + ']' : ''}${p.move ? ' (moviéndose)' : ''}`;
    }).join(' | '));
  }
  try { if (sharedWin && sharedReady) sendGroup(); } catch (e) { log('chat grupal: ' + e); }
  try { wanderTick(now); socialTick(now); } catch (e) { log('convivencia: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e)); }
}
setInterval(managerTick, 600);

// =====================================================================
//  Movimiento hecho por el proceso principal (barra de tareas y grupo)
// =====================================================================
// Un solo temporizador mueve todas las ventanas que van caminando o saltando.
let moveTimer = null;
function stopMove(p, settle) {
  if (!p.move) return;
  const m = p.move;
  p.move = null;
  if (m.kind === 'walk') p.send('walk', { dir: 0 });
  if (settle && m.onAbort) m.onAbort();
}
function startMove(p, m) {
  stopMove(p);
  const [x, y] = posOf(p);
  p.move = Object.assign({ x0: x, y0: y, t0: Date.now() }, m);
  if (m.kind === 'walk') {
    const dist = Math.hypot(m.x1 - x, m.y1 - y);
    p.move.dur = Math.max(250, dist / (m.speed || 50) * 1000);
    p.send('walk', { dir: m.x1 >= x ? 1 : -1 });
  }
  if (!moveTimer) moveTimer = setInterval(moveStep, 33);
}
function moveStep() {
  const now = Date.now();
  let any = false;
  for (const p of pets.values()) {
    const m = p.move;
    if (!m) continue;
    if (!p.alive) { p.move = null; continue; }
    any = true;
    const t = Math.min(1, (now - m.t0) / m.dur);
    let x, y;
    if (m.kind === 'walk') { x = m.x0 + (m.x1 - m.x0) * t; y = m.y0 + (m.y1 - m.y0) * t; }
    else { // salto en arco
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      x = m.x0 + (m.x1 - m.x0) * e;
      y = m.y0 + (m.y1 - m.y0) * e - m.height * 4 * t * (1 - t);
    }
    moveWin(p, x, y);
    if (mode === 'group') updateDepth(p);
    if (t >= 1) {
      const done = m.onArrive;
      p.move = null;
      if (m.kind === 'walk') p.send('walk', { dir: 0 });
      if (done) done();
    }
  }
  if (mode === 'group') sortDepth();
  if (!any) { clearInterval(moveTimer); moveTimer = null; }
}
// grupo: los de más arriba se ven "más lejos" (un poquito más chicos y detrás)
function updateDepth(p) {
  if (mode !== 'group' || !p.alive) return;
  const a = groupArea();
  const f = feetOf(p);
  const d = 0.88 + 0.12 * clamp((f.y - a.y0) / Math.max(1, a.y1 - a.y0), 0, 1);
  if (Math.abs(d - p.depth) > 0.02) { p.depth = d; sendIdentity(p); }
}
let depthOrder = '';
function sortDepth() {
  const list = livePets().map((p) => ({ p, y: feetOf(p).y + (p.social && p.social.rider === p ? 1000 : 0) })).sort((a, b) => a.y - b.y);
  const k = list.map((o) => o.p.id).join(',');
  if (k === depthOrder) return;
  depthOrder = k;
  if (sharedWin) { sendShared('page:z', list.map((o) => o.p.id)); return; }
  for (const o of list) { try { o.p.win.moveTop(); } catch (_) { /* nada */ } }
}

function availableFor(p, now) {
  if (!p.alive || p.leaving || p.entranceInfo || p.walking || p.drag || p.social || p.move) return false;
  if (p.chat && p.chat.proc) return false;                        // platicando contigo
  if (p.mode === 'idle') return true;
  if (p.mode === 'sleep') return now - p.modeSince < Math.max(4000, cfg.timing.sleepMs - 8000); // aún no se queda dormido
  if (p.mode === 'done') return now - p.modeSince > 8000;
  return false;
}
// paseos: en la barra cerca de su lugar; en grupo por toda el área (y a veces a dormir junto a otro)
function wanderTick(now) {
  if (!(isBar() || mode === 'group')) return;
  const live = livePets();
  for (const p of live) {
    if (now < p.nextWander || !availableFor(p, now)) continue;
    p.nextWander = now + 9000 + Math.random() * 9000 + live.length * 1500;
    if (Math.random() < 0.45) continue;                            // a veces mejor se queda donde está
    const [x, y] = posOf(p);
    if (isBar()) {
      const g = taskbarGeom();
      const home = Number.isFinite(p.homeX) ? p.homeX : x;
      const span = zr(live.length > 1 ? 115 : 230);
      let tx = null;
      for (let k = 0; k < 5 && tx === null; k++) {
        const c = clamp(home - span + Math.random() * span * (live.length > 1 ? 2 : 1), g.minX, g.maxX);
        if (Math.abs(c - x) < zr(30)) continue;
        // no se encima con los demás
        if (live.some((q) => q !== p && (Math.abs(posOf(q)[0] - c) < zr(75) || (q.move && Math.abs(q.move.x1 - c) < zr(75))))) continue;
        tx = c;
      }
      if (tx !== null) startMove(p, { kind: 'walk', x1: tx, y1: y, speed: zr(WANDER_SPEED.taskbar) });
    } else {
      const a = groupArea();
      let fx = a.x0 + Math.random() * (a.x1 - a.x0), fy = a.y0 + Math.random() * (a.y1 - a.y0);
      if (p.mode === 'sleep') {                                    // descanso conjunto: se acerca a otro que también descansa
        const buddy = live.find((q) => q !== p && q.mode === 'sleep' && !q.move);
        if (buddy && Math.random() < 0.6) { const f = feetOf(buddy); fx = f.x + (Math.random() < 0.5 ? -1 : 1) * zr(70) * buddy.scaleNow; fy = f.y; }
      }
      fx = clamp(fx, a.x0, a.x1); fy = clamp(fy, a.y0, a.y1);
      const w = winForFeet(p, fx, fy);
      startMove(p, { kind: 'walk', x1: w.x, y1: w.y, speed: zr(WANDER_SPEED.group) });
    }
  }
}

// =====================================================================
//  Convivencia entre Clawds
// =====================================================================
// Reglas: el trabajo real manda (un Clawd trabajando o esperando permiso nunca convive);
// cada interacción reserva a sus dos participantes; si uno se va o le llega trabajo, se corta
// con cuidado y el otro vuelve a lo suyo.
let socialNext = Date.now() + 20000;
let socialSeq = 0;
const socials = new Set();
const canMove = () => isBar() || mode === 'group';

function pickKind() {
  const w = cfg.social;
  const opts = [['greet', w.greet], ['talk', w.talk], ['jump', w.jump], ['ride', w.ride]].filter((o) => o[1] > 0);
  let r = Math.random() * opts.reduce((s, o) => s + o[1], 0);
  for (const o of opts) { r -= o[1]; if (r <= 0) return o[0]; }
  return 'greet';
}
async function socialOk(p) {
  try { return !!(await p.win.webContents.executeJavaScript(`window.__socialOk ? window.__socialOk(${p.id}) : false`)); } catch (_) { return false; }
}
function socialTick(now) {
  // si uno ya no puede seguir (se fue, se cerró, le llegó trabajo), se corta
  for (const s of [...socials]) {
    if (s.aborting) continue;
    const gone = s.members.find((p) => !p.alive || p.leaving || URGENT.has(p.mode));
    if (gone) abortSocial(s, gone.leaving || !gone.alive ? 'se fue' : 'trabajo');
  }
  if (!cfg.social.enabled || now < socialNext || socials.size) return;
  const free = livePets().filter((p) => availableFor(p, now));
  const n = livePets().length;
  socialNext = now + 8000;
  if (free.length < 2) return;
  // con muchos Clawds, menos seguido
  if (Math.random() > 0.5 / Math.max(1, n - 1)) return;
  const a = free[Math.floor(Math.random() * free.length)];
  const fa = feetOf(a);
  const b = free.filter((q) => q !== a).sort((q, r) => Math.abs(feetOf(q).x - fa.x) - Math.abs(feetOf(r).x - fa.x))[0];
  let kind = pickKind();
  if ((kind === 'jump' || kind === 'ride') && !canMove()) kind = kind === 'jump' ? 'hop' : 'greet';  // en ventanas separadas no se salen de su ventana
  const gap = cfg.social.minGapMs + Math.random() * (cfg.social.maxGapMs - cfg.social.minGapMs);
  socialNext = now + gap * (1 + 0.35 * Math.max(0, n - 2));
  startSocial(a, b, kind);
}
function face(p, toward) { if (p.alive) p.send('social', { act: 'face', dir: feetOf(toward).x >= feetOf(p).x ? 'right' : 'left' }); }
async function startSocial(a, b, kind) {
  const s = { id: ++socialSeq, kind, members: [a, b], timers: [], rider: null, under: null };
  a.social = b.social = s;
  socials.add(s);
  const [okA, okB] = await Promise.all([socialOk(a), socialOk(b)]);
  if (!socials.has(s)) return;
  if (!okA || !okB) { endSocial(s); return; }
  log(`convivencia: ${kind} entre #${a.id} y #${b.id}`);
  const at = (ms, fn) => s.timers.push(setTimeout(() => { if (socials.has(s)) fn(); }, ms));
  face(a, b); face(b, a);
  if (kind === 'greet') {
    a.send('social', { act: 'wave', loops: 2 });
    at(500, () => b.send('social', { act: 'wave', loops: 2 }));
    at(3800, () => endSocial(s));
  } else if (kind === 'talk') {
    const lines = [[a, '…'], [b, '?'], [a, '!'], [b, '♪'], [a, '…'], [b, '♥']];
    lines.forEach(([p, sym], i) => at(300 + i * 1150, () => p.send('social', { act: 'say', sym, ms: 1000 })));
    at(300 + lines.length * 1150 + 300, () => endSocial(s));
  } else if (kind === 'hop') {                           // a distancia: brinquitos de gusto, uno y luego el otro
    a.send('social', { act: 'hop' });
    at(650, () => b.send('social', { act: 'hop' }));
    at(1300, () => a.send('social', { act: 'hop' }));
    at(2200, () => endSocial(s));
  } else if (kind === 'jump' || kind === 'ride') {
    // primero se acerca caminando
    const fb = feetOf(b);
    const fa = feetOf(a);
    const dir = fb.x >= fa.x ? 1 : -1;
    const near = { x: fb.x - dir * zr(64) * Math.max(a.scaleNow, b.scaleNow), y: fb.y };
    const w = winForFeet(a, near.x, near.y);
    startMove(a, {
      kind: 'walk', x1: isBar() ? clamp(w.x, taskbarGeom().minX, taskbarGeom().maxX) : w.x, y1: isBar() ? posOf(a)[1] : w.y,
      speed: zr(60),
      onArrive: () => {
        if (!socials.has(s)) return;
        face(a, b);
        const hb = zr(isBar() ? 75 : 125) * CLAWD_H * b.scaleNow;   // alto de Clawd b
        if (kind === 'jump') {
          // brinca por encima del otro y cae del otro lado
          const land = winForFeet(a, fb.x + dir * zr(64) * Math.max(a.scaleNow, b.scaleNow), fb.y);
          const g = isBar() ? taskbarGeom() : null;
          a.send('social', { act: 'jump', ms: 900 });
          startMove(a, {
            kind: 'arc', x1: g ? clamp(land.x, g.minX, g.maxX) : land.x, y1: g ? posOf(a)[1] : land.y,
            height: hb * 1.9 + zr(18), dur: 900, keep: true,
            onArrive: () => { face(a, b); face(b, a); a.send('social', { act: 'wave', loops: 1 }); at(1600, () => endSocial(s)); },
          });
        } else {
          // se sube encima del otro un ratito y luego se baja
          s.rider = a; s.under = b;
          const top = winForFeet(a, fb.x, fb.y - hb + zr(2));
          a.send('social', { act: 'jump', ms: 700 });
          startMove(a, {
            kind: 'arc', x1: top.x, y1: top.y, height: zr(26), dur: 700, keep: true,
            onArrive: () => {
              if (mode === 'group') sortDepth();
              a.send('social', { act: 'perch', on: true });
              b.send('social', { act: 'say', sym: '!', ms: 900 });
              at(4200, () => hopDown(s));
            },
          });
        }
      },
    });
  } else endSocial(s);
}
// el de arriba se baja (también si la interacción se corta a la mitad)
function hopDown(s, then) {
  const a = s.rider, b = s.under;
  s.rider = null;
  if (!a || !a.alive) { endSocial(s); return; }
  a.send('social', { act: 'perch', on: false });
  const f = b && b.alive ? feetOf(b) : feetOf(a);
  const dir = Math.random() < 0.5 ? -1 : 1;
  const land = winForFeet(a, f.x + dir * zr(95) * Math.max(a.scaleNow, b && b.alive ? b.scaleNow : 0), b && b.alive ? f.y : f.y + zr(40));
  const y1 = isBar() ? taskbarGeom().top - dims().h : land.y;
  a.send('social', { act: 'jump', ms: 650 });
  startMove(a, { kind: 'arc', x1: land.x, y1, height: zr(22), dur: 650, keep: true, onArrive: () => { endSocial(s); if (then) then(); } });
}
function endSocial(s) {
  if (!socials.has(s)) return;
  socials.delete(s);
  if (process.env.COMPANION_DUMP) log(`convivencia ${s.kind} terminó`);
  for (const t of s.timers) clearTimeout(t);
  for (const p of s.members) {
    if (p.social === s) p.social = null;
    p.send('social', { act: 'stop' });
    if (p.alive) p.nextWander = Date.now() + 6000 + Math.random() * 6000;
  }
}
function abortSocial(s, why) {
  if (!socials.has(s) || s.aborting) return;     // ya se está cortando (p. ej. el de arriba va bajando)
  s.aborting = true;
  log(`convivencia ${s.kind} cortada (${why})`);
  for (const t of s.timers) clearTimeout(t);
  s.timers = [];
  if (s.rider && s.rider.alive && !s.rider.leaving) { const r = s.rider; stopMove(r); hopDown(s); return; }
  for (const p of s.members) { if (p.move && p.move.keep && p.alive) { const m = p.move; p.move = null; if (isBar()) moveWin(p, posOf(p)[0], taskbarGeom().top - dims().h); void m; } }
  endSocial(s);
}
function endSocialOf(p) { if (p.social) abortSocial(p.social, 'se interrumpió'); }
// celebraciones: cuando una sesión termina, los demás que estén libres festejan con ella
function onFinished(p) {
  const now = Date.now();
  for (const q of livePets()) {
    if (q === p || !availableFor(q, now) || Math.random() > 0.6) continue;
    const s = { id: ++socialSeq, kind: 'cheer', members: [q], timers: [] };
    q.social = s; socials.add(s);
    s.timers.push(setTimeout(async () => {
      if (!socials.has(s)) return;
      if (!(await socialOk(q))) { endSocial(s); return; }
      face(q, p);
      q.send('social', { act: 'cheer' });
      log(`convivencia: #${q.id} festeja que #${p.id} terminó`);
      s.timers.push(setTimeout(() => endSocial(s), 3600));
    }, 400 + Math.random() * 900));
  }
}

// =====================================================================
//  Chat: cada Clawd tiene SU plática (se guarda y continúa hasta que le das al lápiz)
// =====================================================================
// - El Clawd sin sesión platica en una sesión propia de Claude Code (carpeta chat/).
// - El Clawd de una sesión platica en una plática aparte que lleva SOLO lo más reciente de esa sesión
//   (título, tareas y últimos mensajes; se actualiza en cada mensaje). Antes copiaba la sesión entera:
//   eso era lento, caro y fallaba con sesiones enormes. La sesión original nunca se toca.
// - Si abres la plática en Claude ("Abrir en Claude"), la app se queda con esa sesión; si le
//   vuelves a escribir al Clawd, sigue en una rama nueva de ella (con todo y lo que llevaban).
const SYSTEM_BRANCH = 'Esta plática es aparte de una sesión de Claude Code del usuario (la sesión original sigue en la app de Claude y no se toca).' +
  ' Abajo tienes lo más reciente de esa sesión para que sepas de qué va; si necesitas más, puedes leer sus archivos. Aquí solo platicas, lees y buscas.';
const HISTORY_MAX = 60;
function defaultChatModel(p) {
  if (p.sid) {
    const info = lastList.find((s) => s.sid === p.sid);
    const tr = info && info.tp ? readTranscript(info.tp) : null;
    const m = (tr && tr.model) || (info && info.model);
    const found = m && MODELS.find((x) => familyOf(x.id) === familyOf(m));
    if (found) return found.id;
  }
  return cfg.model;
}
function chatOf(p) {
  if (!p.chat) {
    const s = recOf(p).chat || {};
    p.chat = {
      // las pláticas de antes copiaban la sesión entera (pesadas): esas se reinician, el historial se queda
      base: p.sid && !s.lite ? null : s.base || null, cur: p.sid && !s.lite ? null : s.cur || null, cwd: s.cwd || null,
      history: Array.isArray(s.history) ? s.history.slice(-HISTORY_MAX) : [],
      model: s.model ? modelInfo(s.model).id : defaultChatModel(p),
      title: s.title || null, savedTitle: s.savedTitle || null, aiTitled: !!s.aiTitled,
      // (si ya habías cambiado el modelo antes de que existiera esta opción, cuenta como elegido por ti)
      pinned: s.pinned !== undefined ? !!s.pinned : !!(p.sid && s.model && modelInfo(s.model).id !== defaultChatModel(p)),
      proc: null,
    };
  }
  return p.chat;
}
function saveChat(p) {
  const c = chatOf(p);
  if (c.history.length > HISTORY_MAX) c.history = c.history.slice(-HISTORY_MAX);
  recOf(p).chat = { lite: true, base: c.base, cur: c.cur, cwd: c.cwd, history: c.history, model: c.model, pinned: !!c.pinned, title: c.title, savedTitle: c.savedTitle, aiTitled: c.aiTitled };
  saveCfg();
  groupDirty = true;
}
function describeTool(name, input) {
  input = input || {};
  if (name === 'WebSearch') return 'Buscando en la web…';
  if (name === 'WebFetch') return 'Leyendo una página…';
  if (name === 'Read') return 'Leyendo ' + (input.file_path ? path.basename(String(input.file_path)) : 'un archivo') + '…';
  if (name === 'Grep' || name === 'Glob') return 'Buscando en tus archivos…';
  if (/^mcp__companion__/.test(name)) return 'Repartiendo el trabajo entre Clawds…';
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(name || '');
  if (m) return `Usando ${extLabel(m[1])}…`;
  return 'Usando ' + name + '…';
}
function stopChat(p) {
  const c = p && p.chat;
  if (c && c.proc) { try { c.proc.kill(); } catch (_) { /* nada */ } c.proc = null; }
}
const stopAllChats = () => { for (const p of pets.values()) stopChat(p); };

// lo más reciente de su sesión: título, carpeta, tareas y los últimos mensajes (recortados)
const CTX_MSGS = 10, CTX_CHARS = 700;
function sessionContext(p) {
  const info = lastList.find((s) => s.sid === p.sid);
  const tr = info && info.tp ? readTranscript(info.tp) : null;
  const d = deskSession(p.sid);
  const title = (d && d.title) || (info && info.title) || '';
  const lines = [SYSTEM_BRANCH];
  if (title) lines.push(`Título de la sesión: ${title}.`);
  if (recOf(p).cwd) lines.push(`Carpeta de la sesión: ${recOf(p).cwd}`);
  if (info && info.activity) lines.push(`Lo que está haciendo ahorita: ${info.activity}.`);
  if (tr && tr.plan.length) lines.push('Su lista de tareas: ' + tr.plan.filter((x) => !x.gone).map((x) => `[${x.s === 'done' ? 'hecha' : x.s === 'doing' ? 'en curso' : 'pendiente'}] ${x.t}`).join(' · '));
  const recent = tr ? tr.recent.slice(-CTX_MSGS) : [];
  if (recent.length) {
    lines.push('Últimos mensajes de esa sesión (los más recientes al final):');
    for (const r of recent) lines.push(`${r.who}: ${r.text.length > CTX_CHARS ? r.text.slice(0, CTX_CHARS) + '…' : r.text}`);
  }
  return '\n\n' + lines.join('\n');
}
// =====================================================================
//  Extensiones (servidores MCP) y la mini extensión propia "delegar"
// =====================================================================
// Las extensiones son las que ya tienes en Claude Desktop o en Claude Code; cada Clawd usa solo
// las que le prendas (clic derecho → Extensiones).
const COMPANION_MCP = path.join(RES, 'mcp', 'companion-mcp.js');
function readExtensions() {
  const out = {};
  const files = [
    path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json'),
    path.join(os.homedir(), '.claude.json'),
  ];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
      for (const [k, v] of Object.entries(j.mcpServers || {})) if (k !== 'companion' && v && !out[k]) out[k] = v;
    } catch (_) { /* no está */ }
  }
  return out;
}
const extLabel = (n) => n.charAt(0).toUpperCase() + n.slice(1);
function petExtensions(p) {
  const all = readExtensions();
  return (recOf(p).ext || []).filter((n) => all[n]);
}
// arma la configuración MCP de una plática: sus extensiones + "delegar" (los ayudantes no delegan)
function mcpConfigFor(p, helper) {
  const all = readExtensions();
  const servers = {};
  for (const n of petExtensions(p)) servers[n] = all[n];
  if (!helper && api.port) {
    servers.companion = {
      type: 'stdio', command: process.execPath, args: [COMPANION_MCP],
      env: { ELECTRON_RUN_AS_NODE: '1', COMPANION_PORT: String(api.port), COMPANION_TOKEN: api.token, COMPANION_PET: String(p.id) },
    };
  }
  if (!Object.keys(servers).length) return null;
  const dir = path.join(BASE, 'mcp');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `clawd-${p.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ mcpServers: servers }, null, 2));
  return { file, names: Object.keys(servers) };
}

// ---------- servidor local para "delegar" (solo 127.0.0.1, con contraseña de un solo arranque) ----------
const http = require('http');
const crypto = require('crypto');
const api = { port: 0, token: crypto.randomBytes(16).toString('hex') };
function startApi() {
  const srv = http.createServer((req, res) => {
    const done = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.method !== 'POST' || req.url !== '/delegar') return done(404, { error: 'no' });
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let j; try { j = JSON.parse(body); } catch (_) { return done(400, { error: 'json' }); }
      if (j.token !== api.token) return done(403, { error: 'contraseña' });
      const from = pets.get(Number(j.from));
      try { done(200, { resultados: await delegate(from, Array.isArray(j.tareas) ? j.tareas : []) }); }
      catch (e) { done(500, { error: String(e.message || e) }); }
    });
  });
  srv.listen(0, '127.0.0.1', () => { api.port = srv.address().port; log(`delegar: escuchando en 127.0.0.1:${api.port}`); });
  srv.on('error', (e) => log('delegar: ' + e));
}

// ---------- ayudantes: llegan, hacen su parte, la entregan y se van ----------
const HELPER_MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' };
async function delegate(from, tareas) {
  tareas = tareas.filter((t) => t && String(t.tarea || '').trim()).slice(0, 4);
  if (!tareas.length) throw new Error('No hay tareas.');
  const boss = from && from.alive ? recOf(from).name || 'Clawd' : 'Clawd';
  log(`delegar: ${boss} reparte ${tareas.length} tarea(s)`);
  return Promise.all(tareas.map((t, i) => new Promise((resolve) => setTimeout(() => runHelper(from, boss, t, resolve), i * 700))));
}
function runHelper(from, boss, t, resolve) {
  const fam = HELPER_MODELS[String(t.modelo || '').toLowerCase()] ? String(t.modelo).toLowerCase() : 'sonnet';
  const p = new Pet(null);
  p.extra = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  p.helper = true;
  const rec = recOf(p);
  ensureIdentity(p);                               // nombre de Clawd (Chispa, Migas…), como los demás
  // usa las extensiones que pidió (o las de quien lo invocó), si existen
  const all = readExtensions();
  const ext = (Array.isArray(t.extensiones) && t.extensiones.length ? t.extensiones : (from ? recOf(from).ext || [] : []))
    .map((n) => String(n).toLowerCase()).filter((n) => all[n]);
  rec.ext = ext;
  rec.chat = { lite: true, model: HELPER_MODELS[fam], pinned: true, history: [] };
  p.chat = null;
  createPetWindow(p, !OPTS.noIntro);
  log(`delegar: ${rec.name} (${fam}) llega para: ${String(t.tarea).slice(0, 80)}`);
  let finished = false;
  const finish = (r) => {
    if (finished) return;
    finished = true;
    resolve({ nombre: rec.name, modelo: fam, texto: r.text, error: !!r.error });
    // entregó: se queda unos segundos (para que lo leas) y se despide
    setTimeout(() => { byePet(p, 'terminó su parte'); setTimeout(() => { delete cfg.clawds['x:' + p.extra]; saveCfg(); }, 4000); }, 7000);
  };
  const timer = setTimeout(() => { stopChat(p); finish({ text: 'Se tardó demasiado y lo detuve.', error: true }); }, 12 * 60 * 1000);
  setTimeout(() => {
    if (!p.alive) { clearTimeout(timer); finish({ text: 'No pudo aparecer.', error: true }); return; }
    p.send('chat:external', { text: t.tarea, from: boss });
    chatSend(p, String(t.tarea), { from: boss, helper: true, onDone: (r) => { clearTimeout(timer); finish(r); } });
  }, OPTS.noIntro ? 300 : 1800);
}

function chatSend(p, text, opts) {
  opts = opts || {};
  const c = chatOf(p);
  stopChat(p);
  text = String(text || '').trim();
  if (!text) return false;
  c.history.push(Object.assign({ who: 'Yo', text, ts: Date.now() }, opts.from ? { from: opts.from } : {}));
  saveChat(p);
  try { fs.mkdirSync(CHAT_DIR, { recursive: true }); } catch (_) { /* nada */ }
  const linked = !!p.sid;
  // dónde vive la plática: las sesiones se buscan por su carpeta, así que la rama corre ahí mismo
  if (!c.cwd) c.cwd = linked && recOf(p).cwd && fs.existsSync(recOf(p).cwd) ? recOf(p).cwd : CHAT_DIR;
  if (!fs.existsSync(c.cwd)) { c.cwd = CHAT_DIR; c.cur = null; c.base = null; }
  // Ligera: no carga la sesión completa (puede ser enorme), solo lo más reciente de ella,
  // y se actualiza en cada mensaje (así sabe lo último que pasó allá).
  // extensiones de este Clawd (+ "delegar" si no es ayudante): todas sus herramientas quedan permitidas
  let mcp = null;
  try { mcp = mcpConfigFor(p, !!opts.helper); } catch (e) { log('extensiones: ' + e); }
  const allowed = [TOOLS, ...(mcp ? mcp.names.map((n) => `mcp__${n}`) : [])].join(',');
  const extNames = petExtensions(p);
  let sys = SYSTEM + (linked ? sessionContext(p) : '');
  if (extNames.length) sys += `\n\nTienes estas extensiones y puedes usarlas libremente: ${extNames.map(extLabel).join(', ')}.`;
  if (opts.helper) sys += `\n\nEres ${recOf(p).name}, un Clawd ayudante que invocó ${opts.from || 'otro Clawd'} para UNA tarea. Hazla completa y entrega el resultado directo, sin hacer preguntas (nadie te va a contestar).`;
  else if (mcp && mcp.names.includes('companion')) sys += '\n\nSi te piden varias cosas que se pueden hacer por separado (o algo grande que conviene dividir), puedes usar la herramienta "delegar" para repartirlas entre Clawds ayudantes con el modelo adecuado. Úsala solo cuando valga la pena; para preguntas sencillas contesta tú.';
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', c.model, '--tools', TOOLS, '--allowedTools', allowed, '--permission-mode', 'default',
    '--append-system-prompt', sys];
  if (mcp) args.push('--mcp-config', mcp.file, '--strict-mcp-config');
  if (c.cur) args.push('--resume', c.cur);
  else if (c.base) args.push('--resume', c.base, '--fork-session');
  // nombre de la plática (lo guarda Claude Code mismo): provisional con tu primer mensaje, luego el de Haiku
  if (!c.title) c.title = provisionalTitle(text);
  args.push('--name', c.title);
  c.savedTitle = c.title;
  let proc;
  try {
    // (MCP_TOOL_TIMEOUT: "delegar" espera a que terminen los ayudantes)
    proc = spawn(CLAUDE, args, { cwd: c.cwd, env: { ...process.env, COMPANION_CHAT: '1', MASCOTA_CHAT: '1', MCP_TOOL_TIMEOUT: '900000' }, windowsHide: true });
  } catch (e) {
    c.history.push({ who: 'Claude', text: 'No encontré Claude Code en tu compu.', err: true, ts: Date.now() });
    saveChat(p);
    p.send('chat:done', { text: 'No encontré Claude Code en tu compu.', error: true });
    if (opts.onDone) opts.onDone({ text: 'No encontré Claude Code.', error: true });
    return false;
  }
  c.proc = proc;
  const t0 = Date.now();
  let buf = '', gotResult = false, errTxt = '';
  const handle = (line) => {
    let m; try { m = JSON.parse(line); } catch (_) { return; }
    if (m.session_id && c.proc === proc) { if (c.cur !== m.session_id) { c.cur = m.session_id; c.base = null; saveChat(p); } }
    if (m.parent_tool_use_id) return;
    if (m.type === 'stream_event') {
      const ev = m.event || {};
      if (ev.type === 'message_start') p.send('chat:reset');
      else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') {
        p.send('chat:tool', describeTool(ev.content_block.name));
      } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') p.send('chat:delta', ev.delta.text);
    } else if (m.type === 'assistant' && m.message && Array.isArray(m.message.content)) {
      for (const b of m.message.content) if (b.type === 'tool_use') p.send('chat:tool', describeTool(b.name, b.input));
    } else if (m.type === 'result') {
      gotResult = true;
      log(`chat #${p.id}: ${m.is_error ? 'error' : 'ok'} ${c.model} (${String(m.result || '').length} letras, ${Math.round((Date.now() - t0) / 1000)} s)`);
      c.history.push({ who: 'Claude', text: String(m.result || (m.is_error ? 'Algo falló. Intenta otra vez.' : '…')), err: !!m.is_error, ts: Date.now() });
      saveChat(p);
      if (!m.is_error && !c.aiTitled && !opts.helper) { c.aiTitled = true; makeTitle(p); }   // título bonito tras la primera respuesta
      p.send('chat:done', { text: String(m.result || ''), error: !!m.is_error });
      if (opts.onDone) opts.onDone({ text: String(m.result || ''), error: !!m.is_error });
    }
  };
  proc.stdout.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
  });
  proc.stderr.on('data', (d) => { errTxt += d.toString('utf8'); });
  proc.on('error', (e) => { log('chat spawn: ' + e); });
  proc.on('close', (code) => {
    if (buf.trim()) handle(buf.trim());
    if (c.proc === proc) c.proc = null;
    groupDirty = true;
    if (!gotResult) {
      if (errTxt) log(`chat #${p.id} stderr: ` + errTxt.slice(0, 800));
      // si la rama no se pudo crear (sesión que ya no existe), la siguiente vez empieza de cero
      if (/No conversation found|not found/i.test(errTxt)) { c.cur = null; c.base = null; c.cwd = CHAT_DIR; }
      const msg = code === null ? 'Cancelado.' : 'No pude contestar esta vez. Intenta de nuevo.';
      c.history.push({ who: 'Claude', text: msg, err: true, ts: Date.now() });
      saveChat(p);
      p.send('chat:done', { text: msg, error: true });
      if (opts.onDone) opts.onDone({ text: msg, error: true });
    }
  });
  proc.stdin.end(text, 'utf8');
  groupDirty = true;
  return true;
}
ipcMain.handle('chat:send', (e, id, text) => { const p = petOf(e, id); return p ? chatSend(p, text) : false; });

// ---------- título de la plática (como el resto de las sesiones de la app) ----------
function provisionalTitle(text) {
  let t = String(text).replace(/\s+/g, ' ').replace(/^[¿¡"'\s]+/, '').replace(/[?!.,;:"'\s]+$/, '').trim();
  if (t.length > 48) t = t.slice(0, 48).replace(/\s+\S*$/, '');
  return t ? t[0].toUpperCase() + t.slice(1) : 'Plática con el mini Claude';
}
const TITLE_PROMPT = 'Ponle un título a esta conversación, como los títulos de las sesiones de Claude: en español, ' +
  'de 2 a 6 palabras, sin comillas y sin punto final, que diga de qué trata (ejemplos: "Desinstalar asistente Clicky", ' +
  '"Configuración del monitor a 165Hz", "Formulario de la mamá de Rafa"). Responde solo con el título.';
function makeTitle(p) {
  const c = chatOf(p);
  const sid = c.cur;
  if (c.titleJob && c.titleJob.sid === sid) return c.titleJob.promise;
  const convo = c.history.filter((h) => h.who !== 'sep').slice(-6).map((h) => `${h.who}: ${String(h.text).slice(0, 400)}`).join('\n');
  if (!sid || !convo) return Promise.resolve(null);
  const promise = new Promise((resolve) => {
    let out = '';
    let proc;
    try {
      // solo genera el texto del título: sin herramientas y sin guardar esta consulta como sesión
      proc = spawn(CLAUDE, ['-p', '--model', 'claude-haiku-5-5', '--no-session-persistence', '--tools', '', '--output-format', 'text'],
        { cwd: CHAT_DIR, env: { ...process.env, COMPANION_CHAT: '1', MASCOTA_CHAT: '1' }, windowsHide: true });
    } catch (_) { resolve(null); return; }
    const timer = setTimeout(() => { try { proc.kill(); } catch (_) { /* nada */ } }, 25000);
    proc.stdout.on('data', (d) => { out += d.toString('utf8'); });
    proc.on('error', () => {});
    proc.on('close', () => {
      clearTimeout(timer);
      const line = out.split(/\r?\n/).map((s) => s.trim()).find(Boolean) || '';
      const title = line.replace(/^["'«“]+|["'»”.]+$/g, '').replace(/^t[ií]tulo:\s*/i, '').trim().slice(0, 60);
      if (title && sid === c.cur) { c.title = title; saveChat(p); }
      if (title) log(`título de la plática #${p.id}: ${title}`);
      if (c.titleJob && c.titleJob.promise === promise) c.titleJob = null;
      resolve(title || null);
    });
    proc.stdin.end(`${TITLE_PROMPT}\n\nConversación:\n${convo}\n`, 'utf8');
  });
  c.titleJob = { sid, promise };
  return promise;
}

function chatNew(p) {
  const c = chatOf(p);
  stopChat(p);
  c.cur = null; c.base = null; c.cwd = null; c.title = null; c.savedTitle = null; c.aiTitled = false;
  if (c.history.length && c.history[c.history.length - 1].who !== 'sep') c.history.push({ who: 'sep', ts: Date.now() });
  saveChat(p);
  p.send('chat:cleared');
}
ipcMain.on('chat:cancel', (e, id) => { const p = petOf(e, id); if (p) stopChat(p); });
ipcMain.on('chat:new', (e, id) => { const p = petOf(e, id); if (p) chatNew(p); });

// Antes de abrirla en la app: si el título de Haiku todavía no quedó guardado, lo guarda con /rename
// (comando oficial de Claude Code; no llama al modelo y tarda ~2 s).
function renameSession(id, title, cwd) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(CLAUDE, ['-p', '--resume', id, '--output-format', 'text', '--tools', ''],
        { cwd: cwd || CHAT_DIR, env: { ...process.env, COMPANION_CHAT: '1', MASCOTA_CHAT: '1' }, windowsHide: true });
    } catch (_) { resolve(); return; }
    const timer = setTimeout(() => { try { proc.kill(); } catch (_) { /* nada */ } }, 15000);
    proc.on('error', () => {});
    proc.on('close', () => { clearTimeout(timer); resolve(); });
    proc.stdin.end(`/rename ${title}\n`, 'utf8');
    log(`título guardado antes de abrir: ${title}`);
  });
}

function setChatModel(p, id) {
  const c = chatOf(p);
  c.model = modelInfo(id).id;
  c.pinned = true;                           // lo elegiste tú: ya no sigue al de su sesión
  if (!p.sid) cfg.model = c.model;           // el del Clawd sin sesión es el modelo de siempre
  saveChat(p);
  p.send('model', modelInfo(c.model));
  sendIdentity(p, true);                     // se reescala de inmediato
}
function modelMenuItems(p) {
  const c = chatOf(p);
  return MODELS.map((m) => ({
    label: `${m.label}  —  ${m.hint}`, type: 'radio', checked: m.id === c.model, click: () => setChatModel(p, m.id),
  }));
}
ipcMain.on('model:menu', (e, id) => { const p = petOf(e, id); if (p) Menu.buildFromTemplate(modelMenuItems(p)).popup({ window: p.win }); });

// ---------- abrir en Claude Desktop ----------
// La app guarda qué sesión suya corresponde a cada sesión de Claude Code (claude-code-sessions/…/local_*.json).
const DESK_SES = path.join(process.env.APPDATA || '', 'Claude', 'claude-code-sessions');
let deskMap = new Map(), deskScanAt = 0;
function scanDesk() {
  const m = new Map();
  const walk = (dir, depth) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const d of ents) {
      const f = path.join(dir, d.name);
      if (d.isDirectory() && depth < 3) walk(f, depth + 1);
      else if (d.isFile() && /^local_.*\.json$/.test(d.name)) {
        try {
          const o = JSON.parse(fs.readFileSync(f, 'utf8'));
          if (o.cliSessionId && o.sessionId) m.set(o.cliSessionId, { local: o.sessionId, title: o.title || '', archived: !!o.isArchived });
        } catch (_) { /* nada */ }
      }
    }
  };
  walk(DESK_SES, 0);
  deskMap = m;
  deskScanAt = Date.now();
}
function deskSession(cli) {
  if (!cli) return null;
  if (!deskMap.has(cli) && Date.now() - deskScanAt > 4000) scanDesk();
  return deskMap.get(cli) || null;
}
function openConversation(cli) {
  if (!cli) { focusClaude(); return; }
  const d = deskSession(cli);
  const url = d ? `claude://code/continue?session=${d.local}` : `claude://resume?session=${cli}`;
  shell.openExternal(url).catch((e) => log('abrir conversación: ' + e));
  log(`abre en Claude: ${d ? d.local : cli}`);
}
// clic en un Clawd: abre la conversación a la que está vinculado
function openSession(p) {
  if (p.sid) { openConversation(p.sid); return; }
  const c = chatOf(p);
  if (c.cur) { openInApp(p); return; }
  if (c.base) { openConversation(c.base); return; }
  focusClaude();
}
ipcMain.on('pet:open-session', (e, id) => { const p = petOf(e, id); if (p) openSession(p); });

// "Abrir en Claude" en el globo: su plática con el Clawd se va a la app (importada con todo su historial)
async function openInApp(p) {
  const c = chatOf(p);
  if (!c.cur) { if (c.base) openConversation(c.base); return; }
  stopChat(p);
  const id = c.cur;
  const pending = c.titleJob && c.titleJob.sid === id ? c.titleJob.promise : null;
  let title = c.title;
  const saved = c.savedTitle;
  // la app se queda con esta sesión; si le vuelves a escribir al Clawd, sigue en una rama de ella
  c.base = id; c.cur = null;
  saveChat(p);
  p.send('chat:handed-off');
  if (pending) title = (await Promise.race([pending, new Promise((r) => setTimeout(r, 6000))])) || title;
  if (title && title !== saved) await renameSession(id, title, c.cwd);
  openConversation(id);
}
ipcMain.on('chat:open-in-app', (e, id) => { const p = petOf(e, id); if (p) openInApp(p); });

// ---------- "Mandar a su sesión": lo platicado con el Clawd, pegado en su sesión original ----------
// Claude Desktop no deja que otro programa le mande mensajes a una sesión. Así que se hace igual que
// tú: se abre la sesión, se pega el texto en su caja y TÚ le das Enter (nada se envía solo).
// Antes de pegar se confirma que la ventana de enfrente sea Claude Desktop; si no, solo queda copiado.
const PASTE_PS = `
Add-Type @"
using System; using System.Runtime.InteropServices;
public class MCW {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern void keybd_event(byte a, byte b, uint c, UIntPtr d);
}
"@
$procs = @(Get-Process claude -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path -like '*\\AnthropicClaude\\*' -or $_.Path -like '*\\WindowsApps\\*Claude*') -and $_.MainWindowHandle -ne 0 })
if ($procs.Count -eq 0) { exit 2 }
$h = $procs[0].MainWindowHandle
if ([MCW]::IsIconic($h)) { [MCW]::ShowWindow($h, 9) | Out-Null }
[MCW]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 400
$fg = [MCW]::GetForegroundWindow(); $fp = [uint32]0
[MCW]::GetWindowThreadProcessId($fg, [ref]$fp) | Out-Null
if (-not ($procs | Where-Object { $_.Id -eq $fp })) { exit 3 }
[MCW]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero); [MCW]::keybd_event(0x56, 0, 0, [UIntPtr]::Zero)
[MCW]::keybd_event(0x56, 0, 2, [UIntPtr]::Zero); [MCW]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero)
exit 0
`;
function pasteIntoClaude() {
  return new Promise((resolve) => {
    const enc = Buffer.from(PASTE_PS, 'utf16le').toString('base64');
    let done = false;
    const pr = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { windowsHide: true, stdio: 'ignore' });
    const t = setTimeout(() => { if (!done) { done = true; try { pr.kill(); } catch (_) { /* nada */ } resolve(9); } }, 12000);
    pr.on('error', () => { if (!done) { done = true; clearTimeout(t); resolve(8); } });
    pr.on('exit', (code) => { if (!done) { done = true; clearTimeout(t); resolve(code); } });
  });
}
function toSessionText(p) {
  const h = chatOf(p).history.filter((x) => x.who !== 'sep');
  let i = h.length - 1;
  while (i >= 0 && h[i].who !== 'Claude') i--;
  const ans = i >= 0 && !h[i].err ? h[i].text : '';
  let j = i - 1;
  while (j >= 0 && h[j].who !== 'Yo') j--;
  const mine = j >= 0 ? h[j].text : (h.length && h[h.length - 1].who === 'Yo' ? h[h.length - 1].text : '');
  if (!mine && !ans) return '';
  const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);
  const name = recOf(p).name || 'Clawd';
  return ans
    ? `${mine}\n\n(Lo platiqué aparte con ${name}, mi mini Claude, y me contestó:\n"${clip(ans, 2500)}")`
    : mine;
}
let toSessionBusy = false;
async function sendToSession(p) {
  if (!p.sid || toSessionBusy) return;
  const text = toSessionText(p);
  if (!text) return;
  toSessionBusy = true;
  const before = clipboard.readText();
  clipboard.writeText(text);
  openConversation(p.sid);
  await new Promise((r) => setTimeout(r, 1600));         // que la app abra la sesión
  const code = await pasteIntoClaude();
  log(`mandar a su sesión #${p.id}: ${code === 0 ? 'pegado (falta tu Enter)' : code === 3 ? 'Claude no quedó enfrente: se quedó copiado' : 'no encontré la ventana de Claude: se quedó copiado'}`);
  // tu portapapeles vuelve a como estaba (si se pegó)
  if (code === 0) setTimeout(() => { try { if (clipboard.readText() === text) clipboard.writeText(before); } catch (_) { /* nada */ } }, 2500);
  toSessionBusy = false;
}
ipcMain.on('chat:to-session', (e, id) => { const p = petOf(e, id); if (p) sendToSession(p); });


// ---------- utilidades de Windows ----------
function ps(script) {
  const enc = Buffer.from(script, 'utf16le').toString('base64');
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { windowsHide: true, stdio: 'ignore' })
    .on('error', () => {});
}
function focusClaude() { ps("$w = New-Object -ComObject WScript.Shell; [void]$w.AppActivate('Claude')"); }
ipcMain.on('focus-claude', focusClaude);
ipcMain.on('dictate', (e, id) => {
  const p = petOf(e, id); const w = p ? p.win : anyWin(); if (w) w.focus();
  ps(`Add-Type -Name K -Namespace M -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte a, byte b, uint c, System.UIntPtr d);'
[M.K]::keybd_event(0x5B,0,0,[System.UIntPtr]::Zero); [M.K]::keybd_event(0x48,0,0,[System.UIntPtr]::Zero)
[M.K]::keybd_event(0x48,0,2,[System.UIntPtr]::Zero); [M.K]::keybd_event(0x5B,0,2,[System.UIntPtr]::Zero)`);
});

// =====================================================================
//  Modos, tamaños, ícono en la bandeja y menús
// =====================================================================
const MODE_LABEL = { desktop: 'Escritorio (cada uno en su ventana)', group: 'Escritorio en grupo', taskbar: 'Barra de tareas' };
function setMode(next) {
  if (!MODE_LABEL[next]) return;
  if (next === mode) { refreshTray(); return; }
  for (const p of livePets()) savePos(p);
  for (const s of [...socials]) endSocial(s);
  const keep = livePets().sort((a, b) => a.createdAt - b.createdAt);
  for (const p of keep) { stopMove(p); stopEntranceWalk(p); p.entranceInfo = null; if (p.alive && !p.shared) { p.win.destroy(); } p.win = null; p.shared = false; pets.delete(p.id); }
  closeShared();
  mode = next;
  saveNow();
  log(`modo: ${mode}`);
  // los mismos Clawds (mismas sesiones, nombres y colores) en el nuevo modo, sin reiniciar nada
  for (const p of keep) {
    p.leaving = false; p.depth = 1; p.move = null; p.social = null;
    createPetWindow(p, isBar() && !OPTS.noIntro);
  }
  refreshTray();
}
function setWinScale(v) {
  // dónde está parado cada uno, medido con el tamaño de antes
  const feet = new Map(livePets().map((p) => { stopMove(p); return [p, feetOf(p)]; }));
  cfg.winScale = v;
  saveCfg();
  if (sharedWin && !sharedWin.isDestroyed()) { sharedWin.webContents.setZoomFactor(v); layoutShared(); }
  // todas las ventanas cambian de tamaño a la vez; los Clawds quedan parados donde estaban
  for (const p of livePets()) {
    if (!p.alive) continue;
    const f = feet.get(p);
    if (!p.shared) p.win.webContents.setZoomFactor(v);
    const { w, h } = dims();
    const pos = isBar() ? { x: clamp(f.x - petOff(p) - petBoxW() * CLAWD_MID, taskbarGeom().minX, taskbarGeom().maxX), y: taskbarGeom().top - h } : winForFeet(p, f.x, f.y);
    if (p.shared) moveWin(p, pos.x, pos.y);
    else try { p.win.setBounds({ x: Math.round(pos.x) || 0, y: Math.round(pos.y) || 0, width: w, height: h }); } catch (e) { log('tamaño: ' + e); }
    if (isBar()) p.homeX = pos.x;
  }
  refreshTray();
}
function setPetScale(v) {
  cfg.petScale = v;
  saveCfg();
  for (const p of livePets()) sendIdentity(p);
  refreshTray();
}
function modeItems() {
  return Object.keys(MODE_LABEL).map((m) => ({ label: MODE_LABEL[m], type: 'checkbox', checked: mode === m, click: () => setMode(m) }));
}
function sizeItems() {
  const pet = [[0.8, 'Chicos'], [1, 'Normales'], [1.2, 'Grandes']];
  const win = [[0.85, 'Chicas'], [1, 'Normales'], [1.2, 'Grandes']];
  return [
    { label: 'Tamaño de los Clawds', submenu: pet.map(([v, l]) => ({ label: l, type: 'radio', checked: Math.abs(cfg.petScale - v) < 0.01, click: () => setPetScale(v) })) },
    { label: 'Tamaño de las ventanas', submenu: win.map(([v, l]) => ({ label: l, type: 'radio', checked: Math.abs(cfg.winScale - v) < 0.01, click: () => setWinScale(v) })) },
  ];
}
let quitting = false;
function hideAll() {
  userHidden = true;
  manualShow = false;
  for (const p of livePets()) byePet(p, 'Cerrar');
  refreshTray();
}
function showAll() {
  userHidden = false;
  manualShow = true;
  managerTick();
  refreshTray();
}

// =====================================================================
//  Actualizaciones automáticas (desde los Releases de GitHub)
// =====================================================================
// Al abrirse y cada 6 horas revisa si hay versión nueva; la baja en segundo plano y se instala
// sola al cerrar la app (o al momento, desde el ícono de la bandeja).
const update = { ready: null, checking: false, notified: false };
let autoUpdater = null;
function initUpdates() {
  if (!app.isPackaged || process.env.COMPANION_CFG) return;          // en desarrollo y en pruebas, no
  try { ({ autoUpdater } = require('electron-updater')); } catch (e) { log('actualizador: ' + e); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = { info: () => {}, warn: (m) => log('actualizador: ' + m), error: (m) => log('actualizador: ' + m), debug: () => {} };
  autoUpdater.on('update-available', (i) => log(`actualizador: hay versión ${i.version}, bajándola`));
  autoUpdater.on('update-downloaded', (i) => {
    update.ready = i.version;
    log(`actualizador: versión ${i.version} lista`);
    refreshTray();
    if (tray && !update.notified) {
      update.notified = true;
      try {
        tray.displayBalloon({
          iconType: 'info', title: `Claude Companion ${i.version}`,
          content: 'Hay una versión nueva lista. Se instala sola al cerrar, o ahora desde el ícono de la bandeja.',
        });
      } catch (_) { /* nada */ }
    }
  });
  setTimeout(() => checkUpdates(false), 15000);
  setInterval(() => checkUpdates(false), 6 * 3600 * 1000);
}
async function checkUpdates(manual) {
  if (!autoUpdater || update.checking) return;
  update.checking = true; refreshTray();
  try {
    const r = await autoUpdater.checkForUpdates();
    const v = r && r.updateInfo && r.updateInfo.version;
    if (manual && (!v || v === app.getVersion())) {
      dialog.showMessageBox({ type: 'info', title: APP_NAME, message: `Ya tienes la versión más nueva (${app.getVersion()}).` }).catch(() => {});
    }
  } catch (e) {
    log('actualizador: ' + String(e && e.message || e).split('\n')[0]);
    if (manual) dialog.showMessageBox({ type: 'warning', title: APP_NAME, message: 'No pude revisar si hay actualizaciones.', detail: 'Revisa tu internet e intenta de nuevo.' }).catch(() => {});
  }
  update.checking = false; refreshTray();
}
function installUpdate() {
  if (!autoUpdater || !update.ready) return;
  quitting = true;
  for (const p of livePets()) destroyPet(p);
  autoUpdater.quitAndInstall(true, true);           // instalación silenciosa y se vuelve a abrir
}

let tray = null;
// "Cerrar" los despide y los oculta; regresan solos la próxima vez que abras Claude.
function trayMenu() {
  const last = livePets().length
    ? { label: 'Cerrar', click: hideAll }
    : { label: 'Mostrar a Clawd', click: showAll };
  const hooked = setup.hooksInstalled();
  const upd = update.ready
    ? [{ label: `Actualizar a la versión ${update.ready} (reinicia)`, click: installUpdate }, { type: 'separator' }]
    : [];
  return Menu.buildFromTemplate([
    ...upd,
    ...modeItems(), { type: 'separator' }, ...sizeItems(), { type: 'separator' },
    { label: 'Conectado a Claude Code', type: 'checkbox', checked: hooked, click: () => (hooked ? disconnectHooks() : connectHooks(true)) },
    { label: `Buscar actualizaciones (versión ${app.getVersion()})`, enabled: app.isPackaged && !update.checking, click: () => checkUpdates(true) },
    { type: 'separator' }, last,
    { label: 'Salir de Claude Companion', click: () => { quitting = true; for (const p of livePets()) destroyPet(p); app.quit(); } },
  ]);
}
function refreshTray() { if (tray) tray.setContextMenu(trayMenu()); }
function createTray() {
  tray = new Tray(ICON);
  tray.setToolTip(APP_NAME);
  refreshTray();
  tray.on('click', () => tray.popUpContextMenu());
}

// menú de clic derecho sobre un Clawd
ipcMain.on('menu', (e, id) => {
  const p = petOf(e, id);
  if (!p) return;
  const rec = recOf(p);
  const lead = p === leadPet();
  const info = lastList.find((s) => s.sid === p.sid);
  const many = livePets().length > 1;
  const items = [
    { label: `${rec.name || 'Clawd'}${info && info.title ? ' · ' + String(info.title).slice(0, 36) : p.sid ? '' : ' · sin sesión'}`, enabled: false },
    { label: 'Cambiar nombre…', click: () => { try { p.win.focus(); } catch (_) { /* nada */ } p.send('rename'); } },
    { label: 'Color', submenu: COLORS.map((c) => ({ label: c.label, type: 'radio', checked: (rec.color || 'naranja') === c.id, click: () => setLook(p, { color: c.id }) })) },
    { label: 'Restaurar apariencia', click: () => { const keepName = NAMES.find((n) => !livePets().some((q) => q !== p && recOf(q).name === n)) || 'Clawd'; setLook(p, { color: 'naranja', name: keepName }); } },
    { type: 'separator' },
  ];
  void lead;
  items.push(
    { label: p.sid ? 'Abrir su sesión en Claude' : 'Abrir en Claude', click: () => openSession(p) },
    ...(p.sid ? [{ label: 'Mandar lo último que platicamos a su sesión', enabled: chatOf(p).history.some((h) => h.who === 'Yo'), click: () => sendToSession(p) }] : []),
    { label: 'Nueva conversación con este Clawd', click: () => chatNew(p) },
    { label: 'Abrir su plática contigo en Claude', enabled: !!(chatOf(p).cur || chatOf(p).base), click: () => openInApp(p) },
    { label: 'Modelo con el que te contesta', submenu: modelMenuItems(p) },
    { label: 'Extensiones', submenu: extensionMenuItems(p) },
  );
  if (p.extra) items.push({ label: 'Despedir a este Clawd', click: () => dismissExtra(p) });
  if (p.sid && many) {
    items.push({
      label: 'Ocultar este Clawd (vuelve cuando su sesión trabaje)',
      click: () => { const s = lastList.find((x) => x.sid === p.sid); dismissed[p.sid] = s ? Number(s.ts) : Date.now(); byePet(p, 'lo ocultaste'); },
    });
  }
  items.push(
    { type: 'separator' },
    ...modeItems(),
    { label: 'Tamaños', submenu: sizeItems() },
    { type: 'separator' },
    { label: 'Dejar fijo el estado (o volver a ocultarlo)', click: () => p.send('toggle-status') },
    {
      label: isBar() ? 'Regresar a la esquinita' : mode === 'group' ? 'Regresar al grupo a la esquina' : 'Regresar a la esquina',
      click: () => {
        stopMove(p);
        if (isBar()) { const g = taskbarGeom(); moveWin(p, g.maxX - 2, g.top - dims().h); p.send('side', taskbarSide(p)); savePos(p); }
        else if (mode === 'group') { cfg.group = {}; saveCfg(); for (const q of livePets()) { const s = spotFor(q); q.side = s.side; q.send('side', s.side); moveWin(q, s.x, s.y); } }
        else { p.side = 'right'; p.send('side', 'right'); const d = desktopDefault(); moveWin(p, d.x, d.y); savePos(p); }
      },
    },
    { type: 'separator' },
    { label: 'Cerrar todos (regresan cuando vuelvas a abrir Claude)', click: hideAll },
  );
  Menu.buildFromTemplate(items).popup({ window: p.win });
});
// ---------- extensiones de un Clawd (clic derecho) ----------
function extensionMenuItems(p) {
  const all = Object.keys(readExtensions());
  if (!all.length) return [{ label: 'No tienes extensiones (se agregan en Claude Desktop o Claude Code)', enabled: false }];
  const rec = recOf(p);
  const on = new Set(rec.ext || []);
  return [
    ...all.map((n) => ({
      label: extLabel(n), type: 'checkbox', checked: on.has(n),
      click: () => {
        if (on.has(n)) on.delete(n); else on.add(n);
        rec.ext = [...on];
        saveCfg(); groupDirty = true; sendIdentity(p, true);
        log(`Clawd #${p.id} extensiones: ${rec.ext.join(', ') || 'ninguna'}`);
      },
    })),
    { type: 'separator' },
    { label: 'Puede leer y cambiar cosas en las que prendas', enabled: false },
  ];
}

// ---------- invocar un Clawd nuevo (botón Clawd+) ----------
// Llega caminando con su propio nombre, color y una plática nueva; no tiene sesión de Claude Code.
function summonClawd() {
  if (!petsAllowed()) showAll();
  const x = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  cfg.extras.push(x);
  saveCfg();
  const p = new Pet(null);
  p.extra = x;
  ensureIdentity(p);
  createPetWindow(p, !OPTS.noIntro);
  log(`Clawd #${p.id} invocado (${recOf(p).name})`);
  // cuando termine de llegar, su barrita queda lista para escribirle
  setTimeout(() => {
    if (!p.alive) return;
    if (p.shared) sendShared('page:target', { id: p.id });
    else { try { p.win.focus(); } catch (_) { /* nada */ } p.send('focus-chat'); }
  }, OPTS.noIntro ? 600 : 3200);
  return p.id;
}
function dismissExtra(p) {
  cfg.extras = cfg.extras.filter((x) => x !== p.extra);
  delete cfg.clawds['x:' + p.extra];
  saveCfg();
  stopChat(p);
  byePet(p, 'lo despediste');
}
ipcMain.handle('pet:summon', () => summonClawd());

// nombre nuevo escrito en su etiqueta
ipcMain.on('pet:rename', (e, id, name) => {
  const p = petOf(e, id);
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 24);
  if (p && n) { setLook(p, { name: n }); log(`Clawd #${p.id} se llama ahora ${n}`); }
});

// =====================================================================
//  Vigilante de Claude Desktop (bin/clawd.exe)
// =====================================================================
let watcher = null;
function startWatcher() {
  // prueba: un "Claude simulado" (script de node que imprime 1/0) en lugar del vigilante real
  const fake = process.env.COMPANION_FAKE_WATCHER;
  if (fake) {
    watcher = spawn('node', [fake], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  } else {
    if (!fs.existsSync(WATCHER)) { log('no encontré el vigilante clawd.exe'); return; }
    watcher = spawn(WATCHER, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  }
  watcher.stdout.on('data', (d) => {
    for (const line of String(d).split(/\r?\n/)) if (line === '0' || line === '1') onClaude(line === '1');
  });
  watcher.on('error', (e) => log('vigilante: ' + e));
  watcher.on('exit', () => { watcher = null; if (!quitting) setTimeout(startWatcher, 5000); });
}
function onClaude(open) {
  const was = claudeOpen;
  claudeOpen = open;
  log(`Claude Desktop ${open ? 'abierto' : 'cerrado'}`);
  if (open && was !== true) userHidden = false;            // abriste Claude: regresan
  if (!open && was === true) manualShow = false;           // cerraste Claude del todo: se despiden
  managerTick();
}

// =====================================================================
//  Primera vez: animaciones de Clawd y conexión con Claude Code
// =====================================================================
const { dialog, net } = require('electron');
async function firstRun() {
  // 1) animaciones (se bajan de claude.ai y de tu Claude Desktop; no vienen en el repo)
  const r = await setup.ensureAssets({ net, BrowserWindow, log });
  if (r.missing.length) {
    log('faltan animaciones: ' + r.missing.join(', ') + ' · ' + r.problems.join(' | '));
    dialog.showMessageBox({
      type: 'warning', title: APP_NAME, message: 'No pude preparar todas las animaciones de Clawd',
      detail: r.problems.join('\n') + '\n\nRevisa tu internet y que Claude Desktop esté instalado, y vuelve a abrir Claude Companion.',
    }).catch(() => {});
  }
  assetsReady = !r.missing.length;
  // 2) hooks de Claude Code: se piden una sola vez; si ya están, se actualizan (por si cambió de lugar)
  try {
    if (setup.hooksInstalled()) { setup.installHooks(process.execPath, HOOK_SRC); if (!cfg.hooksOn) { cfg.hooksOn = true; saveCfg(); } }
    else if (cfg.hooksOn) { setup.installHooks(process.execPath, HOOK_SRC); log('hooks restaurados'); }
    else if (!cfg.hooksAsked) await connectHooks(process.env.COMPANION_TEST_AUTOCONNECT === '1');   // (en pruebas: sin preguntar)
  } catch (e) { log('hooks: ' + e); }
  refreshTray();
}
async function connectHooks(fromMenu) {
  cfg.hooksAsked = true; saveCfg();
  if (!fromMenu) {
    const { response } = await dialog.showMessageBox({
      type: 'question', title: APP_NAME, buttons: ['Conectar', 'Ahora no'], defaultId: 0, cancelId: 1,
      message: '¿Conectar Claude Companion con Claude Code?',
      detail: 'Para saber qué hace cada sesión, Claude Companion agrega unos "hooks" a ~/.claude/settings.json ' +
        '(se guarda un respaldo antes). Solo anotan el estado de cada sesión en tu compu; no mandan nada a ningún lado.\n\n' +
        'Puedes quitarlos cuando quieras desde el ícono de la bandeja ("Conectado a Claude Code").',
    });
    if (response !== 0) { refreshTray(); return; }
  }
  try { const cmd = setup.installHooks(process.execPath, HOOK_SRC); cfg.hooksOn = true; saveCfg(); log('hooks instalados: ' + cmd); }
  catch (e) { dialog.showErrorBox(APP_NAME, 'No pude conectar con Claude Code: ' + e.message); }
  refreshTray();
}
function disconnectHooks() {
  try { setup.uninstallHooks(); cfg.hooksOn = false; saveCfg(); log('hooks quitados'); } catch (e) { dialog.showErrorBox(APP_NAME, 'No pude quitar los hooks: ' + e.message); }
  refreshTray();
}

// arranca con Windows (en segundo plano) y tiene acceso en el menú Inicio
function ensureIntegration() {
  if (process.env.COMPANION_CFG) return;                       // en pruebas no se toca nada de Windows
  try {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath, args: loginArgs(), name: APP_NAME });
  } catch (e) { log('inicio con Windows: ' + e); }
  if (app.isPackaged) return;                                  // instalado: el instalador ya crea su acceso en el menú Inicio
  try {
    const lnk = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${APP_NAME}.lnk`);
    shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', {
      target: process.execPath, args: `"${path.join(__dirname, '..')}"`, description: 'Clawds de Claude Code en tu escritorio',
      icon: ICON, iconIndex: 0, appUserModelId: APP_ID, cwd: path.join(__dirname, '..'),
    });
  } catch (e) { log('acceso directo: ' + e); }
}

// =====================================================================
//  Ciclo de vida
// =====================================================================
app.whenReady().then(async () => {
  if (SHOT) { const p = new Pet(null); createPetWindow(p, !!arg('--entrance')); return; }
  log(`arranque: modo ${mode}${BACKGROUND ? ' (segundo plano)' : ''} · Claude Code ${claudePick.v}`);
  try { fs.unlinkSync(APAGADA); } catch (_) { /* no existía */ }
  try { fs.unlinkSync(VIVO); } catch (_) { /* no existía */ }
  ensureIntegration();
  createTray();
  startWatcher();
  startApi();                                   // para que los Clawds puedan delegar
  // los ayudantes no se guardan: si quedó alguno de una vez anterior, se olvida
  for (const k of Object.keys(cfg.clawds)) if (/^x:h/.test(k)) delete cfg.clawds[k];
  await firstRun();
  initUpdates();
  // si lo abriste a mano aparece de inmediato; al iniciar Windows espera a que abras Claude
  if (!BACKGROUND) manualShow = true;
  managerTick();
  // prueba: simula que eliges "Cerrar" en el menú a los N ms
  if (process.env.COMPANION_TEST_CLOSE_AT) setTimeout(hideAll, Number(process.env.COMPANION_TEST_CLOSE_AT));
  // pruebas: nombre/color ("sid:color:nombre;...") y pasos ("ms:modo;ms:win=1.2;ms:pet=0.8;ms:close;ms:show")
  if (process.env.COMPANION_TEST_LOOK) setTimeout(() => {
    for (const part of process.env.COMPANION_TEST_LOOK.split(';')) {
      const [sid, color, name] = part.split(':');
      const p = livePets().find((q) => q.sid && q.sid.startsWith(sid));
      if (p) setLook(p, Object.assign({}, color ? { color } : {}, name ? { name } : {}));
    }
  }, 6000);
  if (process.env.COMPANION_TEST_STEPS) {
    for (const part of process.env.COMPANION_TEST_STEPS.split(';')) {
      const [ms, what] = part.split(':');
      setTimeout(() => {
        log('prueba: ' + what);
        if (what.startsWith('win=')) setWinScale(Number(what.slice(4)));
        else if (what.startsWith('pet=')) setPetScale(Number(what.slice(4)));
        else if (what === 'close') hideAll();
        else if (what === 'show') showAll();
        else if (what === 'summon') summonClawd();
        else if (what.startsWith('chat=')) { const [, sid, text] = what.split('='); const p = livePets().find((q) => (q.sid || 'anfitrion').startsWith(sid)); if (p) chatSend(p, text); }
        else if (what === 'gshow') { if (sharedWin) sharedWin.webContents.executeJavaScript('groupShow()').catch(() => {}); }
        else if (what.startsWith('js64=')) { const w = sharedWin || anyWin(); const code = Buffer.from(what.slice(5), 'base64').toString('utf8'); if (w) w.webContents.executeJavaScript(code).then((r) => log('js: ' + JSON.stringify(r) + ' visible=' + w.isVisible() + ' bounds=' + JSON.stringify(w.getBounds()))).catch((e) => log('js error: ' + e)); }
        else if (what.startsWith('js=')) { const w = sharedWin || anyWin(); if (w) w.webContents.executeJavaScript(what.slice(3)).then((r) => log('js: ' + JSON.stringify(r))).catch((e) => log('js error: ' + e)); }
        else setMode(what);
      }, Number(ms));
    }
  }
  screen.on('display-metrics-changed', () => {
    for (const p of livePets()) {
      stopMove(p);
      if (isBar()) { const g = taskbarGeom(); const [x] = posOf(p); moveWin(p, clamp(x, g.minX, g.maxX), g.top - dims().h); p.send('side', taskbarSide(p)); continue; }
      const [x, y] = posOf(p);
      const wa = workAreaAt(x, y);
      if (x > wa.x + wa.width - 100 || y > wa.y + wa.height - 100) {
        const s = spotFor(p); p.side = s.side; p.send('side', s.side); moveWin(p, s.x, s.y);
      } else checkSide(p);
    }
  });
});
// otra vez desde el menú Inicio mientras ya vive en segundo plano: que aparezcan
app.on('second-instance', showAll);
// no se cierra al ocultar las ventanas: sigue vigilando en segundo plano
app.on('window-all-closed', () => { if (SHOT) app.quit(); });
app.on('before-quit', () => { quitting = true; saveNow(); stopAllChats(); if (watcher) { try { watcher.kill(); } catch (_) { /* nada */ } } });
