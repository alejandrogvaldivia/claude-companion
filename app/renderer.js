'use strict';
// =====================================================================
//  Un Clawd (su página puede tener uno o varios: cada uno es una copia de la plantilla)
// =====================================================================
function createClawd(root, ID) {
const api = petApi(ID);
const $ = (id) => root.querySelector('#' + id);
let dead = false;
const el = {
  pet: $('pet'), gif: $('gif'), gif2: $('gif2'), lot: $('lottie'), fx: $('fx'), strip: $('strip'),
  status: $('status'), dot: $('dot'), title: $('title'), sub: $('sub'), extra: $('extra'),
  talk: $('talk'), thread: $('thread'),
  ask: $('ask'), input: $('input'), send: $('btnSend'),
};
let MODE = 'desktop';                       // desktop | taskbar
const isBar = () => MODE === 'taskbar';

// =====================================================================
//  Animaciones oficiales de Clawd
// =====================================================================
const ART = {
  still: api0.assetUrl('Clawd-Still.png'),
  waving: api0.assetUrl('Clawd-Waving.gif'),
  dancing: api0.assetUrl('Clawd-Dancing.gif'),
  cloudOnce: api0.assetUrl('Clawd-Cloud-once.gif'),
  lurking: api0.assetUrl('Clawd-Lurking.gif'),
  racing: api0.assetUrl('Clawd-RacingCar.gif'),
};
// duración de una vuelta de cada GIF (para no cortarlos a la mitad)
const LOOP_MS = { waving: 1410, dancing: 3330, cloudOnce: 5160, lurking: 5580, racing: 4010 };
const ONCE_MS = { ...LOOP_MS };

// Rato libre: animaciones al azar con ~5 s de pausa. En la barra de tareas también pasea.
const IDLE_POOL = [
  { name: 'cloudOnce', w: 3 },
  { name: 'racing', w: 3 },
  { name: 'waving', w: 2, ms: LOOP_MS.waving * 2 },
  { name: 'dancing', w: 2 },
  { name: 'lurking', w: 1 },
];
const IDLE_GAP_MS = [5000, 7000];
let DEEP_SLEEP_MS = 1 * 60 * 1000;         // tras 1 min sin nada se queda dormido (configurable)
const BAR_HOVER_MS = 350;                   // barra de tareas: espera antes de abrir el chat

// ---- capas que se cruzan con un fundido: así ningún cambio es de golpe ----
const NC = $('nap');                        // lienzo de pixel art: dormido y caminando
const IMG = [el.gif, el.gif2];
let front = null;
function fadeTo(layer) {
  for (const L of [el.gif, el.gif2, el.lot, NC]) L.classList.toggle('layer-on', L === layer);
  front = layer;
}

let TRACE = false, T0 = Date.now();
function trace(m) { if (TRACE) api.trace(`${((Date.now() - T0) / 1000).toFixed(2)}s ${m}`); }

// ---- laptop oficial (Clawd-Laptop, 12 fps, cuadro por cuadro) ----
//   4-16 la saca · 17-19 teclea (ciclo perfecto) · 32-42 la guarda
const LAP = { intro: [4, 17], type: [17, 20], outro: [32, 43] };
let anim = null;
let lapState = 'off';            // off | intro | typing | outro
let lapAfterOutro = null;
try {
  anim = lottie.loadAnimation({
    container: el.lot, renderer: 'svg', loop: false, autoplay: false,
    animationData: api.laptopAnim(),
    rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
  });
  anim.addEventListener('complete', () => {
    trace(`laptop ${lapState} terminó`);
    if (lapState === 'intro') {
      lapState = 'typing';
      anim.loop = true;
      anim.playSegments(LAP.type, true);          // teclea sin parar hasta que acabe
    } else if (lapState === 'outro') {
      lapState = 'off';
      const next = lapAfterOutro; lapAfterOutro = null;
      if (next) next();
    }
  });
} catch (e) { console.error('lottie', e); }

function laptopStart() {
  if (!anim) return;
  lapState = 'intro';
  anim.loop = false;
  anim.playSegments(LAP.intro, true);
}
function laptopStop(then) {
  if (!anim || lapState === 'off') { if (then) then(); return; }
  if (lapState === 'outro') { lapAfterOutro = then; return; }
  lapState = 'outro';
  lapAfterOutro = then;
  anim.loop = false;
  anim.playSegments(LAP.outro, true);
}
function afterLaptop(fn) {
  if (visual === 'laptop' && lapState !== 'off') laptopStop(fn);
  else fn();
}

let visual = null, visualStart = 0, waitUntil = 0;
let oneShot = null;              // { name, until, idle, then }
function show(name, restart) {
  if (name === visual && !restart) return;
  trace(`${visual || '-'} -> ${name}${lapState !== 'off' ? ' (laptop ' + lapState + ')' : ''}`);
  visual = name;
  visualStart = Date.now();
  waitUntil = 0;
  if (name === 'laptop' && anim) {
    fadeTo(el.lot);
    if (restart || lapState === 'off' || lapState === 'outro') laptopStart();
    else anim.play();
    return;
  }
  if (name === 'nap' || name === 'walk') { procStart(name); fadeTo(NC); return; }
  if (proc.raf) setTimeout(() => { if (visual !== 'nap' && visual !== 'walk') procHalt(); }, 320);
  if (anim && lapState !== 'off') {
    lapState = 'off'; lapAfterOutro = null;
    setTimeout(() => { if (visual !== 'laptop') anim.stop(); }, 320);
  }
  const layer = front === IMG[0] ? IMG[1] : IMG[0];
  layer.onload = () => { if (visual === name) { visualStart = Date.now(); fadeTo(layer); } };
  layer.src = `${ART[name]}?r=${Date.now()}`;      // siempre desde el primer cuadro
}
function playOnce(name, ms, opts) {
  const o = opts || {};
  oneShot = { name, until: Date.now() + (ms || ONCE_MS[name]), idle: !!o.idle, then: o.then || null };
  show(name, true);
}
function setFx(text, cls) {
  if (el.fx.textContent !== text) el.fx.textContent = text;
  const c = cls || '';
  if (el.fx.className !== c) el.fx.className = c;
}

// =====================================================================
//  Estado
// =====================================================================
let st = { mode: 'sleep', hasInfo: false, key: '' };
let modeSince = Date.now();
let statusReady = false;
let statusKey = null;
let chatBusy = false, talkVisible = false, hovering = false, talkHover = false;
let idleNextAt = Date.now() + 6000, lastIdle = '', inactiveSince = Date.now(), forceNap = false;
let walkDir = 0;                 // -1 izquierda · 0 quieto · 1 derecha
const entrance = { active: false };
// quién es este Clawd (lo manda el proceso principal): nombre, color, tamaño, si lleva el chat
let ident = { name: 'Clawd', model: '', hue: 0, sat: 1, bright: 1, scale: 1, lead: true, mainWalk: false };
// convivencia con otros Clawds: símbolo de plática y si está encima de otro
const social = { fx: null, perch: false, faceT: null, busy: false, busyT: null };
let leaving = false;

function convoOpen() { return hovering || talkHover || talkVisible || el.ask.classList.contains('show'); }
function wantedMode() { return chatBusy ? 'working' : st.mode; }

// =====================================================================
//  Pixel art propio (misma cuadrícula y colores que el arte oficial)
//  Clawd mide 12 x 8 celdas de 100 px en un lienzo de 2750 x 1850; aquí trabajo a 1/5
//  (celdas de 20) y dibujo a la resolución real de la pantalla, alineado a pixeles.
// =====================================================================
const HANG = {
  body: '#D97757', eye: '#000000', ink: '#1F1E1D', sparks: ['#E4EFFC', '#BFD6F6', '#8FB4EC'],
  artW: 550, cell: 20, ox: 147, oy: 210, lift: 34,
};
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutBounce = (x) => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) { x -= 1.5 / d; return n * x * x + 0.75; }
  if (x < 2.5 / d) { x -= 2.25 / d; return n * x * x + 0.9375; }
  x -= 2.625 / d; return n * x * x + 0.984375;
};
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
function fitCanvas(c) {
  const r = el.pet.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr);
  c.height = Math.round(r.height * dpr);
}
function rectOn(ctx, c, x, y, w, h) {
  const k = c.width / HANG.artW;
  const x0 = Math.round(x * k), y0 = Math.round(y * k);
  ctx.fillRect(x0, y0, Math.round((x + w) * k) - x0, Math.round((y + h) * k) - y0);
}

// ---------- colgado / levitando mientras lo arrastras ----------
const HC = $('hang');
const hctx = HC.getContext('2d');
const hrect = (x, y, w, h) => rectOn(hctx, HC, x, y, w, h);
const hang = { on: false, raf: 0, t0: 0, last: 0, releaseAt: 0, liftAtRelease: 1, parts: [], spawn: 0 };
const liftAt = (now) => easeOutBack(Math.min(1, (now - hang.t0) / 320));

function drawHang(now) {
  const t = (now - hang.t0) / 1000;
  const dt = Math.min(0.05, hang.last ? (now - hang.last) / 1000 : 0);
  hang.last = now;
  let amp;
  let landed = false;
  if (hang.releaseAt) {
    const r = Math.min(1, (now - hang.releaseAt) / 450);
    amp = hang.liftAtRelease * (1 - easeOutBounce(r));
    landed = r >= 1;
  } else amp = liftAt(now);
  if (landed && hang.parts.length === 0) { finishHang(); return; }

  const C = HANG.cell;
  const a1 = Math.max(0, Math.min(1, amp));
  const ox = HANG.ox + Math.sin(t * Math.PI * 0.8) * 3 * a1;
  const oy = HANG.oy - HANG.lift * amp + Math.sin(t * Math.PI * 1.5) * 5 * a1;
  const swing = Math.sin(t * Math.PI * 1.5 - 0.7) * a1;
  const armL = 2 - a1 * (2.1 + 0.55 * Math.sin(t * Math.PI * 2.4));
  const armR = 2 - a1 * (2.1 + 0.55 * Math.sin(t * Math.PI * 2.4 + 1.1));
  const legLen = 2 + a1;
  const k = HC.width / HANG.artW;
  hctx.clearRect(0, 0, HC.width, HC.height);

  hctx.fillStyle = `rgba(0,0,0,${0.2 * a1})`;
  hctx.beginPath();
  hctx.ellipse((HANG.ox + 6 * C) * k, (HANG.oy + 8.3 * C) * k, (4.4 - 1.5 * a1) * C * k, 0.42 * C * k, 0, 0, Math.PI * 2);
  hctx.fill();

  if (!hang.releaseAt) {
    hang.spawn += dt * 18 * a1;
    while (hang.spawn >= 1) {
      hang.spawn -= 1;
      hang.parts.push({
        x: ox + C * (2.2 + Math.random() * 7.6), y: oy + C * (6 + legLen) + Math.random() * 4,
        vx: (Math.random() - 0.5) * 14, vy: 26 + Math.random() * 34,
        life: 0.6 + Math.random() * 0.5, age: 0, s: C * (0.32 + Math.random() * 0.33),
        c: HANG.sparks[(Math.random() * HANG.sparks.length) | 0],
      });
    }
  }
  for (const p of hang.parts) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  hang.parts = hang.parts.filter((p) => p.age < p.life);
  for (const p of hang.parts) {
    const f = p.age / p.life;
    hctx.globalAlpha = 1 - f * f;
    hctx.fillStyle = p.c;
    const s = p.s * (1 - 0.45 * f);
    hrect(p.x - s / 2, p.y - s / 2, s, s);
  }
  hctx.globalAlpha = 1;

  hctx.fillStyle = HANG.body;
  for (const c of [2, 4, 7, 9]) {
    for (let r = 0; r < 3; r++) {
      const h = Math.max(0, Math.min(1, legLen - r));
      if (h <= 0) continue;
      hrect(ox + c * C + swing * C * [0.06, 0.28, 0.6][r], oy + (6 + r) * C, C, C * h);
    }
  }
  hrect(ox + 2 * C, oy, 8 * C, 6 * C);
  hrect(ox, oy + armL * C, 2 * C, 2 * C);
  hrect(ox + 10 * C, oy + armR * C, 2 * C, 2 * C);

  const bp = ((t + 0.6) % 2.7) / 0.16;
  const open = bp < 1 ? Math.abs(1 - 2 * bp) : 1;
  const eh = C * Math.max(0.18, open);
  hctx.fillStyle = HANG.eye;
  hrect(ox + 3 * C, oy + C + (C - eh) / 2, C, eh);
  hrect(ox + 8 * C, oy + C + (C - eh) / 2, C, eh);

  hang.raf = requestAnimationFrame(drawHang);
}
function setHanging(on) {
  const now = performance.now();
  if (on) {
    if (hang.on && !hang.releaseAt) return;
    if (hang.on && hang.releaseAt) {
      hang.releaseAt = 0;
      hang.t0 = now - 320;
    } else {
      hang.on = true; hang.t0 = now; hang.last = 0; hang.parts = []; hang.spawn = 0;
    }
    stopWalk();
    el.pet.classList.add('hanging');
    if (anim && lapState !== 'off') anim.pause();
    if (proc.raf) procHalt();
    for (const L of [el.gif, el.gif2, el.lot, NC]) L.classList.remove('layer-on');
    fitCanvas(HC);
    HC.style.display = 'block';
    setFx('', '');
    cancelAnimationFrame(hang.raf);
    hang.raf = requestAnimationFrame(drawHang);
  } else if (hang.on && !hang.releaseAt) {
    hang.liftAtRelease = liftAt(now);
    hang.releaseAt = now;
  }
}
function finishHang() {
  cancelAnimationFrame(hang.raf);
  hang.on = false; hang.releaseAt = 0; hang.parts = [];
  el.pet.classList.remove('hanging');
  HC.style.display = 'none';
  oneShot = null;
  if (visual === 'laptop' && lapState !== 'off') { fadeTo(el.lot); anim.play(); }
  else { visual = null; }
  tick();
}
api.on('drag:moving', (on) => setHanging(!!on));

// ---------- lienzo propio: dormido y caminando ----------
const nctx = NC.getContext('2d');
const nrect = (x, y, w, h) => rectOn(nctx, NC, x, y, w, h);
const proc = { kind: null, raf: 0, t0: 0, wakeAt: 0, then: null };

// "z" en pixel art: blancas con orilla de tinta, cuadrito por cuadrito
const ZPAT = {
  4: ['####', '..#.', '.#..', '####'],
  5: ['#####', '...#.', '..#..', '.#...', '#####'],
  6: ['######', '....#.', '...#..', '..#...', '.#....', '######'],
};
function pixelZ(x0, y0, n, px, alpha) {
  const pat = ZPAT[n];
  nctx.globalAlpha = alpha;
  // sombrita de un pixel (se ve en fondos claros) y la letra blanca encima (se ve en oscuros)
  nctx.fillStyle = HANG.ink;
  pat.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') nrect(x0 + (c + 1) * px, y0 + (r + 1) * px, px, px); }));
  nctx.fillStyle = '#FFFFFF';
  pat.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === '#') nrect(x0 + c * px, y0 + r * px, px, px); }));
  nctx.globalAlpha = 1;
}

function drawNap(now) {
  const t = (now - proc.t0) / 1000;
  let s = easeInOut(Math.min(1, t / 1.4));                 // 0 despierto → 1 dormido
  let woke = false;
  if (proc.wakeAt) {
    const w = Math.min(1, (now - proc.wakeAt) / 380);
    s *= 1 - easeInOut(w);
    woke = w >= 1;
  }
  const C = HANG.cell, ox = HANG.ox, oy = HANG.oy;
  const breath = ((1 - Math.cos((t * Math.PI * 2) / 3.6)) / 2) * s;
  const b = breath * C * 0.3;
  nctx.clearRect(0, 0, NC.width, NC.height);
  nctx.fillStyle = HANG.body;
  for (const c of [2, 4, 7, 9]) nrect(ox + c * C, oy + 6 * C, C, 2 * C);
  nrect(ox + 2 * C, oy + b, 8 * C, 6 * C - b);
  const ay = oy + (2 + 1 * s) * C + b * 0.8;               // bracitos cuadrados que bajan una celda
  nrect(ox, ay, 2 * C, 2 * C);
  nrect(ox + 10 * C, ay, 2 * C, 2 * C);
  const eh = C * (1 - 0.66 * s);
  const ey = oy + C + (C - eh) * 0.8 + b * 0.9;
  nctx.fillStyle = HANG.eye;
  nrect(ox + 3 * C, ey, C, eh);
  nrect(ox + 8 * C, ey, C, eh);
  // zzz que suben en saltitos de pixel desde su cabeza
  if (s > 0.85 && !proc.wakeAt) {
    // en la barra de tareas son 2 y más gorditas para que se lean a tamaño mini
    const px = isBar() ? 15 : 9;
    const sizes = isBar() ? [4, 5] : [4, 5, 6];
    const cycle = 2.7, rise = isBar() ? 150 : 170, steps = 10;
    sizes.forEach((n, i) => {
      const p = ((t + (i * cycle) / sizes.length) % cycle) / cycle;
      const step = Math.floor(p * steps);
      const x = ox + 9.6 * C + step * 5;
      const y = oy - n * px - step * (rise / steps);
      const a = p < 0.06 ? 0.5 : p < 0.7 ? 1 : p < 0.85 ? 0.6 : 0.3;
      pixelZ(x, y, n, px, a);
    });
  }
  if (woke) {
    proc.raf = 0;
    const then = proc.then; proc.then = null; proc.wakeAt = 0;
    if (then) then();
    return;
  }
  proc.raf = requestAnimationFrame(drawNap);
}

// caminando: pasos alternados, sube un poquito con cada paso y mira hacia donde va
function drawWalk(now) {
  const t = (now - proc.t0) / 1000;
  const C = HANG.cell, ox = HANG.ox, oy = HANG.oy;
  const ph = (t * Math.PI * 2) / 0.52;
  const bob = Math.abs(Math.sin(ph)) * 0.16 * C;
  const liftA = Math.max(0, Math.sin(ph)), liftB = Math.max(0, -Math.sin(ph));
  const dir = walkDir || 1;
  nctx.clearRect(0, 0, NC.width, NC.height);
  nctx.fillStyle = HANG.body;
  [[2, liftA], [7, liftA], [4, liftB], [9, liftB]].forEach(([c, l]) => {
    const top = oy + 6 * C - bob;
    const bottom = oy + 8 * C - l * 0.55 * C;
    nrect(ox + c * C, top, C, bottom - top);
  });
  nrect(ox + 2 * C, oy - bob, 8 * C, 6 * C);
  const sw = Math.sin(ph) * 0.22 * C;
  nrect(ox, oy + 2 * C - bob + sw, 2 * C, 2 * C);
  nrect(ox + 10 * C, oy + 2 * C - bob - sw, 2 * C, 2 * C);
  nctx.fillStyle = HANG.eye;
  const look = dir * 0.3 * C;
  nrect(ox + 3 * C + look, oy + C - bob, C, C);
  nrect(ox + 8 * C + look, oy + C - bob, C, C);
  proc.raf = requestAnimationFrame(drawWalk);
}
function procStart(kind) {
  cancelAnimationFrame(proc.raf);
  fitCanvas(NC);
  proc.kind = kind; proc.t0 = performance.now(); proc.wakeAt = 0; proc.then = null;
  proc.raf = requestAnimationFrame(kind === 'nap' ? drawNap : drawWalk);
}
function napWake(then) {
  if (!proc.raf || proc.kind !== 'nap') { if (then) then(); return; }
  proc.then = then;
  if (!proc.wakeAt) proc.wakeAt = performance.now();
}
function procHalt() { cancelAnimationFrame(proc.raf); proc.raf = 0; proc.wakeAt = 0; proc.then = null; }

// =====================================================================
//  Caminar (barra de tareas: dentro de su franja · escritorio: entrada)
// =====================================================================
const wander = { x: 0, target: null, speed: 40, last: 0, raf: 0, onArrive: null };
const boxW = () => el.pet.offsetWidth;
const stripW = () => root.offsetWidth || (isBar() ? 430 : 520);   // el ancho de SU escenario (no de la ventana)
function setPetX(x) { wander.x = x; if (isBar()) el.pet.style.transform = `translateX(${Math.round(x)}px)`; }
function walkTo(x, speed, onArrive) {
  wander.target = x; wander.speed = speed || 40; wander.onArrive = onArrive || null;
  walkDir = Math.sign(x - wander.x) || 1;
  show('walk');
  if (!wander.raf) { wander.last = 0; wander.raf = requestAnimationFrame(wanderStep); }
}
function wanderStep(now) {
  const dt = wander.last ? Math.min(0.05, (now - wander.last) / 1000) : 0;
  wander.last = now;
  if (wander.target === null || hang.on) { wander.raf = 0; return; }
  const d = wander.target - wander.x;
  const step = wander.speed * dt;
  if (Math.abs(d) <= step) {
    setPetX(wander.target);
    wander.target = null; wander.raf = 0; walkDir = 0;
    visual = null;
    const f = wander.onArrive; wander.onArrive = null;
    if (f) f();
    tick();
    return;
  }
  setPetX(wander.x + Math.sign(d) * step);
  wander.raf = requestAnimationFrame(wanderStep);
}
function stopWalk() {
  if (idleNextAt === Infinity) idleNextAt = Date.now() + IDLE_GAP_MS[0];   // que siga su rutina después
  if (wander.target === null && !walkDir) return;
  wander.target = null; wander.onArrive = null; walkDir = 0;
  cancelAnimationFrame(wander.raf); wander.raf = 0;
}
// escritorio: la ventana la mueve el proceso principal; aquí solo se anima
api.on('walk', (d) => {
  walkDir = d.dir;
  trace(`caminar ${d.dir}`);
  if (d.dir) { show('walk'); return; }
  endEntrance();
  idleNextAt = Date.now() + IDLE_GAP_MS[0];
  visual = null;
  tick();
});

// =====================================================================
//  Entrada y despedida
// =====================================================================
function endEntrance() {
  entrance.active = false;
  el.pet.classList.remove('entering', 'mirror');
}
function runEntrance(e) {
  entrance.active = true;
  trace(`entrada ${e.mode} desde ${e.from || 'izquierda'}`);
  // quieto y sin flotecito mientras se asoma, para que la animación oficial se vea limpia
  el.pet.classList.remove('bob');
  el.pet.classList.add('entering');
  setFx('', '');
  if (e.mode === 'desktop' || e.mode === 'walk') {
    // se asoma desde la orilla más cercana a donde estaba y luego camina hasta su lugar
    el.pet.classList.toggle('mirror', e.from === 'right');
    playOnce('lurking', null, { then: () => { el.pet.classList.remove('mirror'); api.entranceWalk(); } });
    return;
  }
  // barra de tareas: se asoma desde la orilla de su franja y entra caminando
  const fromRight = e.from === 'right';
  const W = stripW(), bw = boxW();
  setPetX(fromRight ? W - bw : 0);
  el.pet.classList.toggle('mirror', fromRight);
  playOnce('lurking', null, {
    then: () => {
      el.pet.classList.remove('mirror');
      setPetX(fromRight ? W - bw * 0.22 : -bw * 0.74);
      const tx = fromRight ? W - bw - 30 - Math.random() * 60 : 30 + Math.random() * 60;
      walkTo(tx, 55, () => { endEntrance(); idleNextAt = Date.now() + IDLE_GAP_MS[0]; });
    },
  });
}
api.on('bye', () => {
  leaving = true;
  endEntrance();
  stopWalk();
  // si venía entrando (medio fuera de la vista), primero se pone donde se vea
  if (isBar()) setPetX(Math.max(0, Math.min(stripW() - boxW(), wander.x)));
  hideConvo();
  oneShot = null;
  el.pet.classList.remove('sleeping');
  const wave = () => playOnce('waving', LOOP_MS.waving * 2, { then: () => { el.pet.classList.add('gone'); } });
  if (visual === 'nap') napWake(() => { visual = null; wave(); });
  else afterLaptop(wave);
});

// =====================================================================
//  Qué animación toca
// =====================================================================
function pickIdle() {
  const pool = IDLE_POOL.filter((a) => a.name !== lastIdle);
  let r = Math.random() * pool.reduce((s, a) => s + a.w, 0);
  for (const a of pool) { r -= a.w; if (r <= 0) return a; }
  return pool[0];
}
function idleVisual(now, mode) {
  if (mode === 'sleep' && (forceNap || now - inactiveSince > DEEP_SLEEP_MS) && !convoOpen()) {
    return { v: 'nap', fx: '', cls: '' };
  }
  if (!convoOpen() && now >= idleNextAt && !social.busy) {
    // (los paseos ahora los hace el proceso principal, que mueve su ventana y sabe dónde están los demás)
    if (isBar() && !ident.mainWalk && Math.random() < 0.55) {
      const maxX = stripW() - boxW();
      let tx = Math.random() * maxX;
      if (Math.abs(tx - wander.x) < 40) tx = wander.x > maxX / 2 ? tx * 0.4 : maxX - tx * 0.4;
      lastIdle = 'walk';
      idleNextAt = Infinity;                           // se programa al llegar
      return { walk: tx };
    }
    const a = pickIdle();
    lastIdle = a.name;
    const ms = a.ms || ONCE_MS[a.name];
    idleNextAt = now + ms + IDLE_GAP_MS[0] + Math.random() * (IDLE_GAP_MS[1] - IDLE_GAP_MS[0]);
    return { once: a.name, ms };
  }
  return { v: 'still', fx: '', cls: '' };
}

function tick() {
  if (hang.on) return;
  const now = Date.now();
  const mode = wantedMode();
  const urgent = mode === 'working' || mode === 'thinking' || mode === 'attention' || mode === 'error';

  if (oneShot) {
    const left = oneShot.until - now;
    const yields = urgent && oneShot.idle && left > 2500 && !entrance.active && !leaving;
    if (left > 0 && !yields) return;
    const then = left <= 0 ? oneShot.then : null;
    if (oneShot.idle && left <= 0) { visualStart = now - (LOOP_MS[visual] || 0); }
    oneShot = null;
    if (then) { then(); return; }
  }
  if (leaving) return;
  if (entrance.active) { if (walkDir) show('walk'); return; }
  // caminando porque el proceso principal mueve su ventana (paseo o convivencia)
  if (walkDir && wander.target === null) {
    if (visual === 'laptop' && lapState !== 'off') { if (lapState !== 'outro') laptopStop(() => { visual = null; tick(); }); return; }
    if (visual === 'nap') { napWake(() => { visual = null; tick(); }); return; }
    setFx('', ''); el.pet.classList.remove('bob'); show('walk');
    return;
  }
  if (social.perch) { show('still'); setFx(social.fx && now < social.fx.until ? social.fx.t : '', social.fx && now < social.fx.until ? 'talk' : ''); el.pet.classList.remove('bob'); return; }

  // paseando por la barra: si llega trabajo, se detiene donde va
  if (walkDir && wander.target !== null) {
    if (!urgent && mode !== 'done') return;
    stopWalk();
    idleNextAt = now + IDLE_GAP_MS[0];
  }

  let v = 'still', fx = '', cls = '';
  switch (mode) {
    case 'working':
    case 'thinking': v = 'laptop'; break;
    case 'attention': v = 'waving'; fx = '!'; cls = 'bang'; break;
    case 'done':
      if (now - modeSince < 6660) v = 'dancing';
      else { v = 'still'; fx = '♪'; cls = 'note'; }
      break;
    case 'error': v = 'still'; fx = '?'; cls = 'err'; break;
    default: {
      const r = idleVisual(now, mode);
      if ((r.once || r.walk !== undefined) && visual === 'nap') { napWake(() => { visual = null; tick(); }); return; }
      if (r.walk !== undefined) {
        setFx('', '');
        el.pet.classList.remove('bob');
        afterLaptop(() => walkTo(r.walk, 40, () => {
          idleNextAt = Date.now() + IDLE_GAP_MS[0] + Math.random() * (IDLE_GAP_MS[1] - IDLE_GAP_MS[0]);
        }));
        return;
      }
      if (r.once) {
        const name = r.once, ms = r.ms;
        if (visual === 'laptop' && lapState !== 'off') { afterLaptop(() => playOnce(name, ms, { idle: true })); return; }
        if (!waitLoop(now)) return;
        setFx('', '');
        el.pet.classList.remove('bob');
        playOnce(name, ms, { idle: true });
        return;
      }
      v = r.v; fx = r.fx; cls = r.cls;
    }
  }

  if (visual === 'nap' && v !== 'nap') {
    napWake(() => { visual = null; tick(); });
    return;
  }
  if (visual === 'laptop' && v !== 'laptop' && lapState !== 'off') {
    if (lapState !== 'outro') laptopStop(() => { visual = null; tick(); });
    return;
  }
  if (v !== visual && !waitLoop(now)) return;

  show(v);
  // un símbolo de plática con otro Clawd manda sobre los efectos de rato libre
  if (social.fx && now < social.fx.until && !urgent) setFx(social.fx.t, 'talk');
  else setFx(fx, cls);
  el.pet.classList.toggle('bob', v === 'still');
}
function waitLoop(now) {
  const loop = LOOP_MS[visual];
  if (!loop) return true;
  if (!waitUntil) {
    const k = Math.max(1, Math.ceil((now - visualStart - 200) / loop));
    waitUntil = visualStart + k * loop;
    if (waitUntil > now) setTimeout(tick, waitUntil - now + 5);
  }
  return now >= waitUntil - 40;
}
const tickTimer = setInterval(() => { if (!dead) { tick(); if (elWork.classList.contains('show')) placeCompact(); } }, 150);

// =====================================================================
//  Pastilla de estado de Claude Code
// =====================================================================
const STATUS_FLASH_MS = 8000;
let statusFlashUntil = 0, statusPinned = false, statusFlashT = null;
const busyNow = () => st.mode === 'working' || st.mode === 'thinking';
// lo completo (tareas + lo que va diciendo + la pastilla): al pasar el cursor, al decir algo nuevo, al pedir permiso
function statusFull() {
  if (statusPinned || st.mode === 'attention') return true;
  return el.ask.classList.contains('show') || Date.now() < statusFlashUntil;
}
// mientras trabaja, la pastilla ("Editando main.js 12s") siempre está arriba de él, para saber qué hace
function statusVisible() {
  if (!st.hasInfo || talkVisible || leaving) return false;
  return statusFull() || busyNow();
}
// barra de tareas: lo de arriba (la pastilla o todo el panel) va centrado sobre el Clawd y lo sigue al caminar;
// solo se recorre cuando centrado se saldría de la pantalla
function placeCompact(vis) {
  if (vis === undefined) vis = elWork.classList.contains('show');
  if (!isBar()) { elWork.style.left = ''; elWork.style.right = ''; elWork.style.bottom = ''; return; }
  if (!vis) return;                      // escondido: se queda donde estaba (así, al volver, no brinca)
  const compact = elWork.classList.contains('compact');
  const w = compact ? (el.status.offsetWidth || 160) : (elWork.offsetWidth || 420);
  const rootLeft = root.getBoundingClientRect().left;          // dónde está su franja dentro de la ventana
  const minX = 6 - rootLeft, maxX = window.innerWidth - rootLeft - w - 6;
  const x = Math.max(minX, Math.min(maxX, wander.x + boxW() / 2 - w / 2));
  elWork.style.right = 'auto';
  elWork.style.left = `${Math.round(x)}px`;
  elWork.style.bottom = compact ? `${Math.round(8 + 44 * (ident.scale || 1))}px` : '';   // la pastilla, justo arriba de su cabeza
}
function flashStatus(ms) {
  statusFlashUntil = Date.now() + ms;
  clearTimeout(statusFlashT);
  statusFlashT = setTimeout(renderStatus, ms + 30);
}
const elWork = $('work'), elPlan = $('plan'), elSays = $('says'), elTime = $('time');
let planKey = '', saysKey = '', lastSayId = null, sayOpen = null;
function renderPlan() {
  const plan = st.plan || [];
  const k = JSON.stringify(plan);
  if (k === planKey) return;
  planKey = k;
  elPlan.innerHTML = plan.map((p) => `<div class="it ${p.s}${p.more ? ' more' : ''}"><i class="ic"></i><span>${esc(p.t)}</span></div>`).join('');
}
function renderSays() {
  const says = st.says || [];
  const k = says.map((s) => s.id).join('|');
  if (k === saysKey || sayOpen) return; // no cambia el globo mientras lo estás leyendo
  saysKey = k;
  const known = new Set([...elSays.querySelectorAll('.say-wrap')].map((n) => n.dataset.id));
  elSays.innerHTML = '';
  says.forEach((s, i) => {
    const w = document.createElement('div');
    const latest = i === says.length - 1;
    w.className = 'say-wrap' + (latest ? ' latest' : '') + (known.has(s.id) ? '' : ' pop');
    w.dataset.id = s.id;
    const b = document.createElement('div');
    b.className = 'say hit' + (latest ? '' : ' old');
    b.textContent = s.text;
    b.addEventListener('mouseenter', () => { sayOpen = b; b.classList.add('open'); elWork.classList.add('reading'); });
    b.addEventListener('mouseleave', () => { sayOpen = null; b.classList.remove('open'); b.scrollTop = 0; elWork.classList.remove('reading'); renderSays(); });
    b.addEventListener('click', () => api.openSession());
    w.appendChild(b);
    elSays.appendChild(w);
  });
  const newest = says.length ? says[says.length - 1].id : null;
  if (newest && newest !== lastSayId && lastSayId !== null && (st.mode === 'working' || st.mode === 'thinking' || st.mode === 'done')) flashStatus(STATUS_FLASH_MS);
  lastSayId = newest || lastSayId || '';
}
function renderStatus() {
  const busy = st.mode === 'working' || st.mode === 'thinking';
  el.title.textContent = st.title || '';
  el.sub.textContent = st.sub || '';
  el.extra.textContent = st.extra || '';
  elTime.textContent = st.time || '';
  el.dot.style.background = st.dot || '#9a9a9a';
  el.dot.classList.toggle('pulse', busy);
  el.status.classList.toggle('busy', busy);
  renderPlan();
  renderSays();
  const vis = statusVisible();
  const compact = vis && !statusFull();
  // al aparecer o al cambiar entre pastilla y panel completo: se acomoda de golpe (sin deslizarse) en su lugar
  const jump = (vis && !elWork.classList.contains('show')) || compact !== elWork.classList.contains('compact');
  if (jump) elWork.classList.add('placing');
  elWork.classList.toggle('compact', compact);
  placeCompact(vis);
  if (jump) { void elWork.offsetWidth; requestAnimationFrame(() => requestAnimationFrame(() => elWork.classList.remove('placing'))); }
  elWork.classList.toggle('show', vis);
}
elPlan.addEventListener('click', () => api.openSession());
api.on('status', (s) => {
  if (s.mode !== st.mode || !statusReady) modeSince = Date.now();
  if (s.mode === 'sleep' && (st.mode !== 'sleep' || !statusReady)) inactiveSince = Date.now();
  statusReady = true;
  st = s;
  if (s.key !== statusKey) {
    statusKey = s.key;
    if (s.showBubble) flashStatus(STATUS_FLASH_MS);
  }
  renderStatus();
});
api.on('toggle-status', () => { statusPinned = !statusPinned; renderStatus(); });
el.status.addEventListener('click', () => api.openSession());

// ---------- ratón: la ventana es "transparente" salvo sobre lo que se ve ----------
// (el ratón lo maneja la página: ver setInteractive)

// =====================================================================
//  Conversación: la barrita, los globos y el estado aparecen y se van JUNTOS
// =====================================================================
let hideT = null, readUntil = 0, talkFadeT = null;
let sessionActive = false, lastChatAt = 0;
const inputFocused = () => document.activeElement === el.input && document.hasFocus();

function showConvo() {
  if (leaving) return;
  clearTimeout(hideT);
  clearTimeout(talkFadeT);
  // su plática sigue siempre la misma hasta que le des al lápiz (Clawd con +)
  el.input.placeholder = sessionActive ? `Sigue la plática con ${ident.name}…` : `Escríbele a ${ident.name}…`;
  if (PAGE.shared) groupShow(ID);
  el.ask.classList.add('show');
  // la plática sigue ahí: al volver a pasar el cursor reaparece con todo y sus globos anteriores
  if (!talkVisible && sessionActive && !threadDismissed && el.thread.childElementCount) openTalk(false);
  if (talkVisible) el.talk.classList.remove('fade');
  renderStatus();
}
function hideConvo() {
  clearTimeout(hideT);
  el.ask.classList.remove('show');
  statusFlashUntil = 0;
  renderStatus();
  if (talkVisible) {
    el.talk.classList.add('fade');
    clearTimeout(talkFadeT);
    talkFadeT = setTimeout(() => {
      if (!el.talk.classList.contains('fade')) return;
      el.talk.style.display = 'none';
      talkVisible = false;
      renderStatus();
    }, 460);
  }
}
function scheduleHide() {
  if (PAGE.shared) groupScheduleHide();
  clearTimeout(hideT);
  const busy = () => hovering || talkHover || chatBusy || inputFocused();
  if (busy()) return;
  const delay = Math.max(700, talkVisible ? readUntil - Date.now() : 0);
  hideT = setTimeout(() => { if (!busy()) hideConvo(); }, delay);
}
for (const n of [el.pet, el.ask, $('work')]) {
  n.addEventListener('mouseenter', () => { hovering = true; showConvo(); });
  n.addEventListener('mouseleave', () => { hovering = false; scheduleHide(); });
}
// barra de tareas: toda la franja abre el chat al pasar el cursor (con una espera cortita)
let stripT = null;
el.strip.addEventListener('mouseenter', () => {
  clearTimeout(stripT);
  stripT = setTimeout(() => { hovering = true; showConvo(); }, BAR_HOVER_MS);
});
el.strip.addEventListener('mouseleave', () => { clearTimeout(stripT); hovering = false; scheduleHide(); });
el.talk.addEventListener('mouseenter', () => { talkHover = true; showConvo(); });
el.talk.addEventListener('mouseleave', () => { talkHover = false; scheduleHide(); });
el.input.addEventListener('blur', () => setTimeout(scheduleHide, 50));
window.addEventListener('blur', () => setTimeout(scheduleHide, 50));

// clic: escribir · arrastrar: mover · doble clic: carrito · clic derecho: menú
function startDrag(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  api.dragStart();
  const up = async () => {
    window.removeEventListener('mouseup', up);
    const moved = await api.dragEnd();
    if (!moved) api.openSession();               // clic: abre su conversación en Claude Desktop
  };
  window.addEventListener('mouseup', up);
}
el.pet.addEventListener('mousedown', startDrag);
el.strip.addEventListener('mousedown', startDrag);
el.pet.addEventListener('dblclick', () => {
  if (chatBusy || st.mode === 'working' || st.mode === 'thinking' || entrance.active) return;
  stopWalk();
  afterLaptop(() => playOnce('racing', null, { idle: true }));
});
for (const n of [el.pet, el.strip, el.thread]) n.addEventListener('contextmenu', (e) => { e.preventDefault(); api.menu(); });

el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
  else if (e.key === 'Escape') {
    if (chatBusy) api.cancel();
    el.input.value = ''; el.input.blur(); hideConvo();
  }
});
el.send.addEventListener('click', () => { if (chatBusy) api.cancel(); else sendMsg(); });
// Clawd con +: invoca un Clawd nuevo (llega caminando, con su propia plática)
$('btnNew').addEventListener('click', () => api0.summon());
// recién invocado: su barrita queda lista para escribirle
api.on('focus-chat', () => { showConvo(); el.input.focus(); });
$('btnMic').addEventListener('click', () => { showConvo(); el.input.focus(); api.dictate(); });
// "Delegar": se queda marcada hasta que la quites
let delegOn = false;
$('btnDeleg').addEventListener('click', () => {
  delegOn = !delegOn;
  $('btnDeleg').classList.toggle('on', delegOn);
  $('btnDeleg').setAttribute('aria-pressed', String(delegOn));
  el.input.focus();
});
// botones dentro de los globos (se crean al vuelo)
el.thread.addEventListener('click', (e) => {
  const f = e.target.closest('[data-file]');
  if (f) { api0.openFile(f.dataset.file); return; }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.classList.contains('open-app')) api.openInApp();
  else if (b.classList.contains('to-session')) { api.toSession(); sentFeedback(b); }
  else if (b.classList.contains('model-tag')) { e.stopPropagation(); api.modelMenu(); }
  else if (b.classList.contains('x')) { threadDismissed = true; closeTalk(); scheduleHide(); }
});
el.thread.addEventListener('scroll', () => el.thread.classList.toggle('scrolled', el.thread.scrollTop > 4));   // (los degradados los pone fadeEdges)

// ---------- modelo ----------
let model = { label: 'Sonnet 5.5' };
function renderModel() {
  el.thread.querySelectorAll('.bubble-claude.latest .model-tag').forEach((n) => { n.innerHTML = `${esc(model.label)} &#x25BE;`; });
  $('modelChip').textContent = model.label.split(' ')[0];
}
api.on('model', (m) => { model = m; renderModel(); });
$('modelChip').addEventListener('click', () => api.modelMenu());

function setBusy(on) {
  chatBusy = on;
  if (cur) cur.foot.classList.toggle('hide', on);
  el.send.classList.toggle('stop', on);
  el.send.innerHTML = on ? '&#xE71A;' : '&#xE74A;';
  el.send.title = on ? 'Detener' : 'Enviar (Enter)';
}

async function sendMsg() {
  const text = el.input.value.trim();
  if (!text) return;
  el.input.value = '';
  startExchange(text);
  setBusy(true);
  showConvo();
  sessionActive = true; lastChatAt = Date.now();
  tick();
  try { await api.send(text, delegOn ? { delegar: true } : undefined); } catch (e) { onDone({ text: String(e), error: true }); }
}

// ---------- globitos: la plática completa, con scroll ----------
let answerText = '';
let cur = null;                  // el globo de Claude que se está escribiendo
let threadDismissed = false;     // la cerraste con la ×: no reaparece hasta el siguiente mensaje
const DOTS = '<span class="dots"><i></i><i></i><i></i></span>';
function nearBottom() { return el.thread.scrollHeight - el.thread.scrollTop - el.thread.clientHeight < 40; }
function toBottom() { el.thread.scrollTop = el.thread.scrollHeight; }
function openTalk(pop) {
  clearTimeout(talkFadeT);
  talkVisible = true;
  el.talk.classList.remove('fade');
  el.talk.style.display = 'block';
  if (pop !== false) toBottom();
  renderStatus();
}
function closeTalk() {
  clearTimeout(talkFadeT);
  el.talk.style.display = 'none';
  talkVisible = false;
  renderStatus();
}
function clearThread() { el.thread.innerHTML = ''; cur = null; el.thread.classList.remove('scrolled'); }
function addYou(text) {
  const b = document.createElement('div');
  b.className = 'bubble-you pop';
  b.textContent = text;
  el.thread.appendChild(b);
}
function addClaude() {
  el.thread.querySelectorAll('.bubble-claude.latest').forEach((n) => n.classList.remove('latest'));
  const b = document.createElement('div');
  b.className = 'bubble-claude latest pop';
  b.innerHTML =
    '<button class="x" title="Ocultar la plática">&#xE711;</button>' +
    `<div class="who"><span class="spark">&#x2733;</span> Claude <button class="model-tag" title="Cambiar el modelo">${esc(model.label)} &#x25BE;</button></div>` +
    '<div class="tool"></div><div class="answer"></div>' +
    '<div class="foot hide"><button class="to-session" title="Abre su sesión en Claude Desktop con tu mensaje y esta respuesta ya pegados (sin enviar)">Mandar a su sesión &#x21AA;</button><button class="open-app" title="Abrir esta plática, con todo su historial, en la app de Claude">Abrir en Claude &#x2197;</button></div>';
  el.thread.appendChild(b);
  cur = { box: b, tool: b.querySelector('.tool'), answer: b.querySelector('.answer'), foot: b.querySelector('.foot') };
}
// tu globo + el de Claude (con puntitos mientras piensa); los anteriores se quedan arriba
function startExchange(question) {
  threadDismissed = false;
  readUntil = 0;
  answerText = '';
  if (question) addYou(question);
  addClaude();
  cur.toolLabel = 'Pensando…'; cur.toolT0 = Date.now();
  cur.tool.innerHTML = livePill(cur.toolLabel, cur.toolT0);   // igual que arriba del Clawd
  openTalk();
  toBottom();
}

function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function md(s) {
  let h = esc(s);
  h = h.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_m, c) => `<code>${c.trim()}</code>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s.,;:!?)]|$)/g, '$1<i>$2</i>');
  h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1');
  h = h.replace(/^#{1,6}\s*(.+)$/gm, '<b>$1</b>');
  h = h.replace(/^\s*[-*]\s+/gm, '• ');
  return h.replace(/\n/g, '<br>');
}

api.on('chat:reset', () => { answerText = ''; });
api.on('chat:tool', (d) => {
  if (!cur) return;
  const stick = nearBottom();
  if (cur.toolLabel !== d) { cur.toolLabel = d; cur.toolT0 = Date.now(); }   // cada acción cuenta su tiempo
  cur.tool.innerHTML = livePill(d, cur.toolT0);
  if (stick) toBottom();
});
api.on('chat:delta', (t) => {
  if (!cur) return;
  const stick = nearBottom();                // si estás leyendo arriba, no te jala hacia abajo
  answerText += t;
  cur.tool.textContent = '';
  cur.answer.innerHTML = md(answerText) + '<span class="caret"></span>';
  if (stick) toBottom();
});
function onDone(r) {
  if (!chatBusy && !talkVisible) return;
  setBusy(false);
  lastChatAt = Date.now();
  inactiveSince = Date.now();                // platicar cuenta como actividad: se duerme 1 min después
  const text = String((r && r.text) || answerText || '').trim();
  if (cur) {
    const stick = nearBottom();
    cur.tool.textContent = '';
    if (r && r.error) cur.answer.innerHTML = `<span class="err">${esc(text || 'Algo falló. Intenta otra vez.')}</span>`;
    else cur.answer.innerHTML = md(text || '…') + fileChips(r && r.files);
    if (stick) toBottom();
  }
  if (!(r && r.error)) afterLaptop(() => playOnce('dancing'));
  readUntil = Date.now() + Math.max(8000, Math.min(45000, 8000 + text.length * 60));
  idleNextAt = Math.max(idleNextAt === Infinity ? 0 : idleNextAt, Date.now() + ONCE_MS.dancing + IDLE_GAP_MS[0]);
  scheduleHide();
}
api.on('chat:done', onDone);
api.on('chat:cleared', () => { setBusy(false); sessionActive = false; addSep(); el.input.placeholder = `Escríbele a ${ident.name}…`; });
// tu historial con este Clawd (se guarda): al aparecer, los globos vuelven a estar ahí
function addSep() {
  if (!el.thread.childElementCount || el.thread.lastElementChild.classList.contains('sep')) return;
  el.thread.querySelectorAll('.bubble-claude.latest').forEach((n) => n.classList.remove('latest'));
  const d = document.createElement('div');
  d.className = 'sep';
  d.textContent = 'Nueva plática';
  el.thread.appendChild(d);
  cur = null;
}
function restoreHistory(items) {
  clearThread();
  for (const h of items || []) {
    if (h.who === 'sep') addSep();
    else if (h.who === 'Yo') addYou(h.text);
    else {
      addClaude();
      cur.answer.innerHTML = h.err ? `<span class="err">${esc(h.text)}</span>` : md(h.text || '…') + fileChips(h.files);
      cur.foot.classList.remove('hide');
    }
    el.thread.lastElementChild && el.thread.lastElementChild.classList.remove('pop');
  }
  const last = (items || []).filter((h) => h.who !== 'sep');
  sessionActive = !!(items && items.length && items[items.length - 1].who !== 'sep' && last.length);
  toBottom();
}
api.on('chat:history', (items) => restoreHistory(items));
// le escribiste desde el chat grupal: aquí también trabaja (laptop) y guarda el globo
api.on('chat:external', (d) => { startExchange(d && d.text); setBusy(true); sessionActive = true; lastChatAt = Date.now(); tick(); });
// la plática se fue a la app de Claude: aquí empieza una nueva
api.on('chat:handed-off', () => { setBusy(false); hideConvo(); });

// =====================================================================
//  Arranque (y modos de prueba)
// =====================================================================
function setSide(s) { root.classList.toggle('left', s === 'left'); }
api.on('side', setSide);

// =====================================================================
//  Identidad: nombre, color y tamaño (cada Clawd es una sesión)
// =====================================================================
const tagName = $('tagName'), tagModel = $('tagModel'), tagInput = $('tagInput'), body = $('body');
// el botón avisa que ya lo mandó (y vuelve a la normalidad)
function sentFeedback(b) {
  const was = b.innerHTML;
  b.innerHTML = 'Pegado en Claude: revisa y dale Enter &#x2713;';
  b.disabled = true;
  setTimeout(() => { b.innerHTML = was; b.disabled = false; }, 4000);
}
function applyIdentity(d) {
  if (!d) return;
  const wasLead = ident.lead;
  ident = Object.assign(ident, d);
  tagName.textContent = ident.name;
  tagModel.textContent = ident.model || '';
  root.classList.toggle('has-session', !!ident.session);   // solo los Clawds con sesión pueden mandarle cosas
  el.pet.style.setProperty('--s', String(ident.scale || 1));
  const f = [];
  if (ident.hue) f.push(`hue-rotate(${ident.hue}deg)`);
  if (ident.sat !== 1) f.push(`saturate(${ident.sat})`);
  if (ident.bright !== 1) f.push(`brightness(${ident.bright})`);
  el.pet.style.setProperty('--tint', f.length ? f.join(' ') : 'none');
  root.style.setProperty('--ctint', f.length ? f.join(' ') : 'none');   // tus globos y su botón de enviar, de su color
  if (ident.sleepMs) DEEP_SLEEP_MS = ident.sleepMs;
  if (ident.mainWalk && isBar() && wander.target !== null) stopWalk();
}
api.on('identity', applyIdentity);
// el nombre aparece al pasar el cursor por Clawd
el.pet.addEventListener('mouseenter', () => root.classList.add('tag-on'));
el.pet.addEventListener('mouseleave', () => root.classList.remove('tag-on'));
// renombrar: se escribe ahí mismo, en su etiqueta
let renaming = false;
api.on('rename', () => {
  renaming = true;
  root.classList.add('renaming');
  tagInput.value = ident.name;
  setInteractive(true);
  setTimeout(() => { tagInput.focus(); tagInput.select(); }, 30);
});
function endRename(save) {
  if (!renaming) return;
  renaming = false;
  root.classList.remove('renaming');
  const v = tagInput.value.trim();
  if (save && v && v !== ident.name) { api.rename(v); tagName.textContent = v; }
  tagInput.blur();
}
tagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); endRename(true); }
  else if (e.key === 'Escape') { e.preventDefault(); endRename(false); }
});
tagInput.addEventListener('blur', () => endRename(true));

// =====================================================================
//  Convivencia (la coordina el proceso principal)
// =====================================================================
// ¿puede convivir ahorita? Nunca si trabaja, si te espera, si platica contigo o si ya se va.
const socialOk = () => {
  const m = wantedMode();
  if (URGENT_MODES.has(m) || chatBusy || leaving || entrance.active || hang.on || renaming) return false;
  if (convoOpen()) return false;
  return true;
};
const URGENT_MODES = new Set(['working', 'thinking', 'attention', 'error']);
function socialHop(cls, ms) {
  body.classList.remove('hop', 'hop-big');
  void body.offsetWidth;                      // reinicia la animación
  body.classList.add(cls);
  setTimeout(() => body.classList.remove(cls), ms);
}
api.on('social', (d) => {
  if (!d) return;
  const busy = URGENT_MODES.has(wantedMode()) || leaving;
  switch (d.act) {
    case 'face':                               // voltea a ver al otro (empieza la interacción)
      social.busy = true;                      // mientras dure, nada de animaciones de rato libre
      clearTimeout(social.busyT);
      social.busyT = setTimeout(() => { social.busy = false; }, 15000);   // por si nunca llega el "stop"
      if (oneShot && oneShot.idle && !busy) { oneShot = null; visual = null; show('still'); }   // deja lo que hacía por su cuenta
      if (busy || visual === 'nap') return;
      el.pet.classList.toggle('mirror', d.dir === 'left');
      clearTimeout(social.faceT);
      social.faceT = setTimeout(() => { if (!entrance.active) el.pet.classList.remove('mirror'); }, 9000);
      return;
    case 'wave':
      if (busy) return;
      stopWalk();
      if (visual === 'nap') { napWake(() => { visual = null; playOnce('waving', LOOP_MS.waving * (d.loops || 1), { idle: true }); }); return; }
      afterLaptop(() => playOnce('waving', LOOP_MS.waving * (d.loops || 1), { idle: true }));
      return;
    case 'cheer':
      if (busy) return;
      if (visual === 'nap') { napWake(() => { visual = null; playOnce('dancing', LOOP_MS.dancing, { idle: true }); }); return; }
      afterLaptop(() => playOnce('dancing', LOOP_MS.dancing, { idle: true }));
      return;
    case 'say':                                // un simbolito de plática
      if (busy) return;
      social.fx = { t: d.sym || '…', until: Date.now() + (d.ms || 1000) };
      tick();
      return;
    case 'hop': if (!busy) socialHop('hop', 600); return;
    case 'jump': socialHop('hop-big', d.ms || 900); return;
    case 'perch':
      social.perch = !!d.on;
      el.pet.classList.toggle('perch', social.perch);
      tick();
      return;
    case 'stop':
      social.fx = null; social.perch = false; social.busy = false;
      clearTimeout(social.busyT);
      idleNextAt = Math.max(idleNextAt, Date.now() + IDLE_GAP_MS[0]);
      el.pet.classList.remove('perch');
      clearTimeout(social.faceT);
      if (!entrance.active) el.pet.classList.remove('mirror');
      tick();
      return;
  }
});

api.getOpts().then((o) => {
  MODE = o.mode === 'taskbar' ? 'taskbar' : 'desktop';
  root.classList.toggle('mode-taskbar', isBar());
  root.classList.toggle('mode-desktop', !isBar());
  if (isBar()) setPetX(Math.max(0, stripW() - boxW() - 40));
  if (o.identity) applyIdentity(o.identity);
  if (o.history) restoreHistory(o.history);
  if (o.model) { model = o.model; renderModel(); }
  setSide(o.side);
  if (o.trace) { TRACE = true; T0 = Date.now(); }
  if (o.entrance) runEntrance(o.entrance);
  if (o.hang) setHanging(true);
  if (o.hover) { showConvo(); root.classList.add('tag-on'); }
  if (o.fakeChat) {
    // plática de prueba de varios mensajes, para ver el scroll
    const demo = [
      ['hola, ¿qué tal?', '¡Hola! Todo bien por aquí. ¿En qué te ayudo?'],
      ['¿qué es git?', 'Es un sistema para **guardar versiones** de tu código: cada cambio queda registrado y puedes regresar a cualquier punto.'],
      ['¿qué es un pull request, en corto?', 'Es una **propuesta de cambios**: subes tu rama y pides que alguien la revise antes de unirla a `main`. Ahí se comenta, se corrige y al final se hace *merge*.'],
    ];
    sessionActive = true; lastChatAt = Date.now();
    for (const [q, a] of demo) { startExchange(q); cur.answer.innerHTML = md(a); }
    if (cur) cur.foot.classList.remove('hide');
    showConvo(); toBottom();
    setTimeout(() => {      // prueba: ¿quién recibe el clic en el centro de "Abrir en Claude"?
      const r = cur.foot.querySelector('.open-app').getBoundingClientRect();
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      trace(`clic en el centro de "Abrir en Claude" → ${t ? (t.className || t.id || t.tagName) : 'nada'}`);
    }, 400);
  }
  if (o.idleNow) idleNextAt = 0;
  if (o.nap) forceNap = true;
  if (o.fakeBusyAt) {
    setTimeout(() => { trace('** llega un mensaje'); startExchange('prueba'); setBusy(true); showConvo(); tick(); }, o.fakeBusyAt);
    setTimeout(() => { trace('** respuesta lista'); onDone({ text: 'Listo, esta es una respuesta de prueba.' }); }, o.fakeBusyAt + 6000);
  }
  if (o.ask) { el.input.value = o.ask; sendMsg(); }
});
tick();
function destroy() {
  dead = true;
  clearInterval(tickTimer);
  cancelAnimationFrame(proc.raf); cancelAnimationFrame(hang.raf); cancelAnimationFrame(wander.raf);
  try { if (anim) anim.destroy(); } catch (_) { /* nada */ }
  root.remove();
}
return { root, emit: api._emit, destroy, socialOk, hovering: () => hovering || talkHover };
} // fin de createClawd

// =====================================================================
//  La página: uno o varios Clawds, y el chat grupal cuando comparten ventana
// =====================================================================
const api0 = window.companion;
// la foto de perfil usa la pose quieta de Clawd (de tu carpeta de datos)
document.documentElement.style.setProperty('--still-url', `url("${api0.assetUrl('Clawd-Still.png')}")`);
const PAGE = { shared: false, mode: 'desktop', pets: new Map() };
const esc0 = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// degradado donde se corta lo que se puede scrollear: arriba si hay más arriba, abajo si hay más abajo
const FADE_SEL = '#thread, #gfeed, .say.open, .gmsg.gsay .gb.open';
function fadeEdges(n) {
  const top = n.scrollTop > 2, bot = n.scrollHeight - n.scrollTop - n.clientHeight > 2;
  if (n.classList.contains('fade-top') !== top) n.classList.toggle('fade-top', top);
  if (n.classList.contains('fade-bot') !== bot) n.classList.toggle('fade-bot', bot);
}
let fadeQueued = false;
function fadeAll() {
  if (fadeQueued) return;
  fadeQueued = true;
  requestAnimationFrame(() => {
    fadeQueued = false;
    document.querySelectorAll(FADE_SEL).forEach(fadeEdges);
    document.querySelectorAll('.fade-top, .fade-bot').forEach((n) => { if (!n.matches(FADE_SEL)) n.classList.remove('fade-top', 'fade-bot'); });
  });
}
document.addEventListener('scroll', (e) => { if (e.target instanceof Element && e.target.matches(FADE_SEL)) fadeEdges(e.target); }, true);
new MutationObserver(fadeAll).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
window.addEventListener('resize', fadeAll);

// "Pensando… 3s": el mismo indicador que sale arriba del Clawd (triángulo de puntitos + acción + segundos)
const fmtSecs = (ms) => { const s = Math.floor(ms / 1000); return s < 2 ? '' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
function livePill(label, t0) {
  t0 = t0 || Date.now();
  return `<span class="lpill"><span class="spin3"><i></i><i></i><i></i><i></i></span><b>${esc0(label || 'Pensando…')}</b>` +
    `<span class="lsec" data-t0="${t0}">${fmtSecs(Date.now() - t0)}</span></span>`;
}
setInterval(() => {
  const now = Date.now();
  document.querySelectorAll('.lsec[data-t0]').forEach((n) => { const t = fmtSecs(now - Number(n.dataset.t0)); if (n.textContent !== t) n.textContent = t; });
}, 1000);

// archivos que creó un Clawd: botoncitos para abrirlos
const FILE_ICON = { pdf: '\u{1F4D5}', txt: '\u{1F4DD}', md: '\u{1F4DD}', html: '\u{1F310}', png: '\u{1F5BC}\uFE0F' };
function fileChips(files) {
  if (!files || !files.length) return '';
  return '<div class="files">' + files.map((f) => {
    const name = String(f).split(/[\\/]/).pop();
    const ext = (name.split('.').pop() || '').toLowerCase();
    return `<button class="file-chip" data-file="${esc0(f)}" title="Abrir ${esc0(f)}">${FILE_ICON[ext] || '\u{1F4C4}'} ${esc0(name)}</button>`;
  }).join('') + '</div>';
}

// lo que cada Clawd usa para hablar con el proceso principal (todo lleva su id)
function petApi(ID) {
  const handlers = {};
  return {
    on: (ch, fn) => { (handlers[ch] = handlers[ch] || []).push(fn); },
    _emit: (ch, d) => { for (const f of handlers[ch] || []) { try { f(d); } catch (e) { console.error(ch, e); } } },
    getOpts: () => api0.getOpts(ID),
    dragStart: () => api0.dragStart(ID),
    dragEnd: () => api0.dragEnd(ID),
    menu: () => api0.menu(ID),
    send: (text, opts) => api0.send(ID, text, opts),
    cancel: () => api0.cancel(ID),
    newChat: () => api0.newChat(ID),
    focusClaude: () => api0.focusClaude(),
    openSession: () => api0.openSession(ID),
    modelMenu: () => api0.modelMenu(ID),
    openInApp: () => api0.openInApp(ID),
    toSession: () => api0.toSession(ID),
    dictate: () => api0.dictate(ID),
    trace: (m) => api0.trace(ID, m),
    entranceWalk: () => api0.entranceWalk(ID),
    rename: (name) => api0.rename(ID, name),
    laptopAnim: () => api0.laptopAnim(),
  };
}

// ratón: la ventana es "transparente" salvo sobre lo que se ve
let interactive = false;
function setInteractive(on) { if (on !== interactive) { interactive = on; api0.setInteractive(on); } }
document.addEventListener('mousemove', (e) => setInteractive(!!(e.target.closest && e.target.closest('.hit'))));
document.addEventListener('mouseleave', () => setInteractive(false));

const TPL = document.getElementById('tpl-clawd');
const STAGE = document.getElementById('stage');
function addClawd(id) {
  if (PAGE.pets.has(id)) return;
  const root = TPL.content.firstElementChild.cloneNode(true);
  root.dataset.id = id;
  STAGE.appendChild(root);
  const inst = createClawd(root, id);
  PAGE.pets.set(id, inst);
}
function removeClawd(id) {
  const p = PAGE.pets.get(id);
  if (!p) return;
  PAGE.pets.delete(id);
  p.destroy();
  G.live.delete(id);
  if (G.target === id) G.target = null;
  renderGroup(true);
}
// ¿puede convivir ahorita? (lo pregunta el proceso principal antes de una interacción)
window.__socialOk = (id) => { const p = PAGE.pets.get(id); return p ? p.socialOk() : false; };

api0.on('pet', (m) => {
  if (!m) return;
  const p = PAGE.pets.get(m.id);
  if (p) p.emit(m.ch, m.d);
  if (PAGE.shared) groupOnPet(m.id, m.ch, m.d);
});
api0.on('page:add', (d) => addClawd(d.id));
api0.on('page:remove', (d) => removeClawd(d.id));
api0.on('page:place', (list) => {
  for (const d of list) {
    const p = PAGE.pets.get(d.id);
    if (p) p.root.style.transform = `translate(${d.x}px, ${d.y}px)`;
  }
});
api0.on('page:z', (ids) => ids.forEach((id, i) => { const p = PAGE.pets.get(id); if (p) p.root.style.zIndex = String(i + 1); }));
api0.on('page:group', (d) => { Object.assign(G, { pets: d.pets || G.pets, feed: d.feed || G.feed }); if (d.pos) placeGroup(d.pos); applyPending(); renderGroup(); });

api0.init().then((o) => {
  PAGE.shared = !!o.shared;
  PAGE.mode = o.mode;
  document.body.classList.toggle('shared', PAGE.shared);
  for (const id of o.ids || []) addClawd(id);
});

// =====================================================================
//  Chat grupal (como un grupo de WhatsApp)
// =====================================================================
const G = {
  pets: [], feed: [], live: new Map(), target: null,
  hover: false, hideT: null, key: '', openSay: null, listOpen: false,
};
const gEl = {
  box: document.getElementById('group'), feed: document.getElementById('gfeed'),
  input: document.getElementById('gInput'), send: document.getElementById('gSend'),
  to: document.getElementById('gToBtn'), toName: document.getElementById('gToName'),
  list: document.getElementById('gList'), nu: document.getElementById('gNew'), mic: document.getElementById('gMic'),
};
const petInfo = (id) => G.pets.find((p) => p.id === id);
function tintOf(p) {
  if (!p) return 'none';
  const f = [];
  if (p.hue) f.push(`hue-rotate(${p.hue}deg)`);
  if (p.sat !== undefined && p.sat !== 1) f.push(`saturate(${p.sat})`);
  if (p.bright && p.bright !== 1) f.push(`brightness(${p.bright})`);
  return f.length ? f.join(' ') : 'none';
}
const avHtml = (p, cls) => `<span class="av${cls ? ' ' + cls : ''}" style="--tint:${tintOf(p)}"></span>`;
function mdG(s) {
  let h = esc0(s);
  h = h.replace(/```[a-z]*\n?([\s\S]*?)```/g, (_m, c) => `<code>${c.trim()}</code>`);
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1');
  h = h.replace(/^\s*[-*]\s+/gm, '• ');
  return h.replace(/\n/g, '<br>');
}
function placeGroup(pos) {
  gEl.box.style.right = pos.right != null ? `${pos.right}px` : 'auto';
  gEl.box.style.left = pos.left != null ? `${pos.left}px` : 'auto';
  gEl.box.style.bottom = `${pos.bottom}px`;
}
function currentTarget() {
  if (G.target && G.pets.some((p) => p.id === G.target)) return G.target;
  G.target = G.pets.length ? G.pets[0].id : null;
  return G.target;
}
function renderTo() {
  const solo = G.pets.length <= 1;
  gEl.box.style.setProperty('--ctint', tintOf(petInfo(currentTarget())));
  gFloor.style.setProperty('--ctint', tintOf(petInfo(currentTarget())));   // enviar y "Delegar": del color del Clawd elegido
  document.getElementById('gTo').classList.toggle('hide', solo);
  // con uno solo no hay a quién elegir: en su lugar va el botón del modelo (como en la barrita normal)
  const gm = document.getElementById('gModel');
  gm.classList.toggle('hide', !solo);
  if (solo && G.listOpen) { G.listOpen = false; gEl.list.classList.remove('open'); }
  const p = petInfo(currentTarget());
  gEl.to.innerHTML = `${p ? avHtml(p) : '<span class="av"></span>'}<span id="gToName">${p ? 'Responder a ' + esc0(p.name) : 'Responder a'}</span> &#x25BE;`;
  if (p) gm.innerHTML = esc0(p.chatModel || 'Sonnet');
  gEl.input.placeholder = p ? (p.hasChat ? `Sigue la plática con ${p.name}…` : `Escríbele a ${p.name}…`) : 'Escríbele…';
  const busy = p && (p.chatBusy || G.live.has(p.id));
  gEl.send.classList.toggle('stop', !!busy);
  gEl.send.innerHTML = busy ? '&#xE71A;' : '&#xE74A;';
}
function renderList() {
  const t = currentTarget();
  gEl.list.innerHTML = '<div class="ttl">Responder a…</div>' + G.pets.map((p) =>
    `<div class="grow${p.id === t ? ' sel' : ''}" data-id="${p.id}">${avHtml(p)}` +
    `<span class="nm">${esc0(p.name)}${p.session ? ` <small>· ${esc0(p.session)}</small>` : ''}</span>` +
    `${p.chatBusy || G.live.has(p.id) ? '<span class="busy"></span>' : ''}` +
    `<button class="chip" data-model="${p.id}" title="Modelo con el que te contesta">${esc0(p.chatModel || 'Sonnet')} &#x25BE;</button></div>`).join('');
}
function feedItems() {
  const out = [];
  for (const it of G.feed) out.push(it);
  for (const [id, l] of G.live) out.push({ k: 'live-' + id, id, who: 'live', text: l.text, tool: l.tool, t0: l.t0, ts: Infinity });
  return out;
}
function renderGroup(force) {
  if (!PAGE.shared) return;
  renderTo();
  if (G.listOpen) renderList();
  const items = feedItems();
  const key = JSON.stringify(items.map((i) => [i.k, i.text && i.text.length, i.tool])) + JSON.stringify(G.pets.map((p) => [p.id, p.name, p.hue, p.chatModel, p.model]));
  if (!force && (key === G.key || G.openSay)) return;
  G.key = key;
  const stick = gEl.feed.scrollHeight - gEl.feed.scrollTop - gEl.feed.clientHeight < 40;
  const known = new Set([...gEl.feed.children].map((n) => n.dataset.k));
  gEl.feed.innerHTML = items.map((i) => {
    const p = petInfo(i.id) || { name: i.name || 'Clawd' };
    const pop = known.has(i.k) ? '' : ' pop';
    if (i.who === 'sep') return `<div class="gsep" data-k="${i.k}">Nueva plática con ${esc0(p.name)}</div>`;
    if (i.who === 'you' && i.from) {
      // se lo encargó otro Clawd (delegar): se ve como mensaje de ese Clawd al ayudante
      return `<div class="gmsg claude${pop}" data-k="${i.k}"><span class="av" style="--tint:none"></span><div class="gcol">` +
        `<span class="gname">${esc0(i.from)} <i>→ le encarga a ${esc0(p.name)}</i></span><div class="gb">${esc0(i.text)}</div></div></div>`;
    }
    if (i.who === 'you') {
      return `<div class="gmsg you${pop}" data-k="${i.k}"><div class="gcol"><span class="gto">a ${esc0(p.name)}</span>` +
        `<div class="gb" style="--ctint:${tintOf(p)}">${esc0(i.text)}</div></div></div>`;
    }
    const label = i.who === 'say' ? (p.model || '') : (p.chatModel || '');
    const head = `<span class="gname">${esc0(p.name)}${label ? ` <i>· ${esc0(label)}</i>` : ''}${i.who === 'say' ? ' <i>· en su sesión</i>' : ''}</span>`;
    let bub;
    if (i.who === 'say') bub = `<div class="gb" data-say="${i.id}">${esc0(i.text)}</div>`;
    else if (i.who === 'live') bub = `<div class="gb" style="--ctint:${tintOf(p)}">${i.text ? mdG(i.text) + '<span class="caret"></span>' : ''}${!i.text || i.tool ? `<div class="tool">${livePill(i.tool || 'Pensando…', i.t0)}</div>` : ''}</div>`;
    else bub = `<div class="gb">${i.err ? `<span class="err">${esc0(i.text)}</span>` : mdG(i.text) + fileChips(i.files)}${i.last ? `<div class="gfoot">${p.hasSession ? `<button class="to-session" data-tosession="${i.id}" title="Abre su sesión en Claude Desktop con tu mensaje y esta respuesta ya pegados (sin enviar)">Mandar a su sesión &#x21AA;</button>` : ''}<button class="open-app" data-open="${i.id}" title="Abrir esta plática, con todo su historial, en la app de Claude">Abrir en Claude &#x2197;</button></div>` : ''}</div>`;
    return `<div class="gmsg ${i.who === 'say' ? 'gsay' : i.who}${pop}" data-k="${i.k}">${avHtml(p)}<div class="gcol">${head}${bub}</div></div>`;
  }).join('');
  if (stick || force) gEl.feed.scrollTop = gEl.feed.scrollHeight;
}
gEl.feed.addEventListener('mouseover', (e) => {
  const b = e.target.closest('.gmsg.gsay .gb');
  if (b && G.openSay !== b) { if (G.openSay) G.openSay.classList.remove('open'); G.openSay = b; b.classList.add('open'); }
});
gEl.feed.addEventListener('mouseout', (e) => {
  const b = e.target.closest('.gmsg.gsay .gb');
  if (b && !b.contains(e.relatedTarget)) { b.classList.remove('open'); b.scrollTop = 0; G.openSay = null; renderGroup(); }
});
gEl.feed.addEventListener('click', (e) => {
  const fc = e.target.closest('[data-file]');
  if (fc) { api0.openFile(fc.dataset.file); return; }
  const ts = e.target.closest('[data-tosession]');
  if (ts) { api0.toSession(Number(ts.dataset.tosession)); ts.textContent = 'Pegado en Claude: revisa y dale Enter ✓'; return; }
  const o = e.target.closest('[data-open]');
  if (o) { api0.openInApp(Number(o.dataset.open)); return; }
  const s = e.target.closest('[data-say]');
  if (s) api0.openSession(Number(s.dataset.say));
});
// lo que va pasando en las pláticas, en vivo
function groupOnPet(id, ch, d) {
  if (ch === 'chat:reset' || ch === 'chat:external') { if (!G.live.has(id) || ch === 'chat:external') G.live.set(id, { text: '', tool: '', t0: Date.now() }); else G.live.get(id).text = ''; }
  else if (ch === 'chat:tool') { const l = G.live.get(id) || { text: '', t0: Date.now() }; if (l.tool !== d) l.t0 = Date.now(); l.tool = d; G.live.set(id, l); }
  else if (ch === 'chat:delta') { const l = G.live.get(id) || { text: '' }; l.text += d; if (l.tool) l.t0 = Date.now(); l.tool = ''; G.live.set(id, l); }
  else if (ch === 'chat:done' || ch === 'chat:cleared' || ch === 'chat:handed-off') G.live.delete(id);
  else return;
  renderGroup();
}
// mostrar / esconder (igual que la barrita de cada Clawd)
function groupShow(id) {
  if (!PAGE.shared) return;
  clearTimeout(G.hideT);
  if (id && document.activeElement !== gEl.input && !G.listOpen) { G.target = id; }
  gEl.box.classList.add('show');
  renderGroup();
}
// barra de tareas: brillo del piso bajo el chat (mismo ancho y lugar que el chat, al ras de la barra)
const gFloor = document.getElementById('gfloor');
function syncFloor() {
  const on = PAGE.shared && PAGE.mode === 'taskbar' && gEl.box.classList.contains('show');
  if (on) {
    const any = [...PAGE.pets.values()].find((p) => p.root && p.root.offsetHeight);
    const g = gEl.box.getBoundingClientRect();
    if (any && g.width) {
      const r = any.root.getBoundingClientRect();
      gFloor.style.left = `${Math.round(g.left)}px`;
      gFloor.style.width = `${Math.round(g.width)}px`;
      gFloor.style.top = `${Math.round(r.bottom - (gFloor.offsetHeight || 64))}px`;
    }
  }
  gFloor.classList.toggle('show', on);
  document.body.classList.toggle('gopen', on);   // con el chat abierto, las pastillas de arriba se esconden (si no, quedan tras la barra)
}
new MutationObserver(syncFloor).observe(gEl.box, { attributes: true, attributeFilter: ['class', 'style'] });
function groupBusy() { return G.hover || G.listOpen || (document.activeElement === gEl.input && document.hasFocus()) || G.live.size > 0; }
function groupScheduleHide() {
  if (!PAGE.shared) return;
  clearTimeout(G.hideT);
  G.hideT = setTimeout(() => {
    if (groupBusy()) return;
    if ([...PAGE.pets.values()].some((p) => p.hovering())) return;
    gEl.box.classList.remove('show');
    G.listOpen = false; gEl.list.classList.remove('open');
  }, 900);
}
gEl.box.addEventListener('mouseenter', () => { G.hover = true; clearTimeout(G.hideT); });
gEl.box.addEventListener('mouseleave', () => { G.hover = false; groupScheduleHide(); });
gEl.input.addEventListener('blur', () => setTimeout(groupScheduleHide, 60));
window.addEventListener('blur', () => setTimeout(groupScheduleHide, 60));
// elegir a quién le escribes
gEl.to.addEventListener('click', () => {
  G.listOpen = !G.listOpen;
  gEl.list.classList.toggle('open', G.listOpen);
  if (G.listOpen) renderList();
});
gEl.list.addEventListener('click', (e) => {
  const m = e.target.closest('[data-model]');
  if (m) { e.stopPropagation(); api0.modelMenu(Number(m.dataset.model)); return; }
  const r = e.target.closest('.grow');
  if (!r) return;
  G.target = Number(r.dataset.id);
  G.listOpen = false; gEl.list.classList.remove('open');
  renderTo();
  gEl.input.focus();
});
function groupSend() {
  const text = gEl.input.value.trim();
  const id = currentTarget();
  if (!text || !id) return;
  gEl.input.value = '';
  const p = PAGE.pets.get(id);
  if (p) p.emit('chat:external', { text });       // su laptop y sus animaciones
  G.live.set(id, { text: '', tool: '', t0: Date.now() });
  renderGroup();
  api0.send(id, text, G.deleg ? { delegar: true } : undefined);
}
// "Delegar" del chat grupal: se queda marcada hasta que la quites
document.getElementById('gDeleg').addEventListener('click', (e) => {
  G.deleg = !G.deleg;
  e.currentTarget.classList.toggle('on', G.deleg);
  e.currentTarget.setAttribute('aria-pressed', String(G.deleg));
  gEl.input.focus();
});
gEl.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); groupSend(); }
  else if (e.key === 'Escape') { gEl.input.value = ''; gEl.input.blur(); gEl.box.classList.remove('show'); }
});
gEl.send.addEventListener('click', () => {
  const id = currentTarget();
  if (id && G.live.has(id)) api0.cancel(id); else groupSend();
});
// Clawd con +: invoca un Clawd nuevo; cuando llega, "Responder a" queda en él
gEl.nu.addEventListener('click', () => { api0.summon().then((id) => { G.pending = id; }); });
api0.on('page:target', (d) => { G.pending = d.id; G.hover = true; groupShow(); applyPending(); gEl.input.focus(); setTimeout(() => { G.hover = false; }, 400); });
function applyPending() { if (G.pending && G.pets.some((p) => p.id === G.pending)) { G.target = G.pending; G.pending = null; renderTo(); } }
document.getElementById('gModel').addEventListener('click', () => { const id = currentTarget(); if (id) api0.modelMenu(id); });
gEl.mic.addEventListener('click', () => { gEl.input.focus(); api0.dictate(currentTarget()); });
