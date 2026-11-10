// Instala la versión actual del repo SOLO en esta compu (no publica nada) y dice en una línea cómo quedó.
//
//   npm run local            rápido: arma la app sin instalador y reemplaza sus archivos en la instalación
//   npm run local -- --full  arma el instalador completo y lo corre en modo actualización (/S --updated)
//
// En los dos casos tu configuración, tus Clawds, sus pláticas, los hooks y el arranque con Windows se quedan como están.
// Si cambió la versión de Electron (el .exe), el modo rápido no basta y se usa el completo solo.
'use strict';
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = require(path.join(ROOT, 'package.json'));
const NAME = pkg.build.productName;                                         // "Claude Companion"
const INST = path.join(process.env.LOCALAPPDATA, 'Programs', NAME);
const UNP = path.join(ROOT, 'dist', 'win-unpacked');
const LNK = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${NAME}.lnk`);
const LOG = path.join(os.homedir(), '.claude', 'claude-companion', 'companion.log');
const t0 = Date.now();
let full = process.argv.includes('--full');

function run(cmd) {
  try { execSync(cmd, { cwd: ROOT, stdio: 'pipe', maxBuffer: 64 << 20 }); }
  catch (e) {
    const out = String((e.stdout || '') + (e.stderr || '')).trim().split(/\r?\n/).slice(-15).join('\n');
    console.log(`✗ falló: ${cmd}\n${out}`);
    process.exit(1);
  }
}
const quiet = (cmd) => { try { execSync(cmd, { stdio: 'ignore' }); } catch (_) { /* no estaba corriendo */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const size = (p) => { try { return fs.statSync(p).size; } catch (_) { return -1; } };

(async () => {
  if (!fs.existsSync(INST)) full = true;                                    // no está instalada: hace falta el instalador
  run('node scripts/build-watcher.js');
  if (!full) {
    run('npx electron-builder --win dir --publish never');
    // otro Electron (otro .exe): el modo rápido no alcanza
    if (size(path.join(UNP, `${NAME}.exe`)) !== size(path.join(INST, `${NAME}.exe`))) full = true;
  }
  if (full) run('npx electron-builder --win nsis --publish never');

  // cierra la app (y su vigilante) para poder reemplazar sus archivos
  quiet(`taskkill /F /IM "${NAME}.exe"`);
  quiet('taskkill /F /IM clawd.exe');
  await sleep(1500);

  if (full) {
    const setup = path.join(ROOT, 'dist', pkg.build.nsis.artifactName.replace('${version}', pkg.version));
    run(`"${setup}" /S --updated`);
  } else {
    const files = ['app.asar', ...pkg.build.extraResources.map((r) => r.to)];
    for (const f of files) {
      const dst = path.join(INST, 'resources', f);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(path.join(UNP, 'resources', f), dst);
    }
  }

  // la abre como tú (con su acceso del menú Inicio) y revisa su registro
  const since = Date.now();
  spawn('explorer.exe', [LNK], { detached: true, stdio: 'ignore' }).unref();
  let lines = [];
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    lines = (fs.existsSync(LOG) ? fs.readFileSync(LOG, 'utf8').split(/\r?\n/) : [])
      .filter((l) => { const t = Date.parse(l.slice(0, 24)); return t >= since - 1000; });
    if (lines.some((l) => l.includes('arranque'))) { await sleep(4000); break; }
  }
  lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter((l) => Date.parse(l.slice(0, 24)) >= since - 1000);
  const started = lines.some((l) => l.includes('arranque'));
  const errs = lines.filter((l) => /renderer.*\[3\]|cayó|Error|error:/.test(l));
  const pets = lines.filter((l) => / aparece/.test(l)).map((l) => (l.match(/, ([^)]+)\)/) || l.match(/\(([^)]+)\)/) || [])[1]).filter(Boolean);
  const secs = Math.round((Date.now() - t0) / 1000);
  const how = full ? 'instalador completo' : 'rápido';
  if (!started) { console.log(`✗ instalado (${how}, ${secs}s) pero no arrancó: revisa ${LOG}`); process.exit(1); }
  console.log(`${errs.length ? '⚠' : '✓'} instalado (${how}, ${secs}s) · ${errs.length ? `${errs.length} error(es):` : 'sin errores'}${pets.length ? ` · aparecieron: ${pets.join(', ')}` : ''}`);
  for (const e of errs.slice(0, 5)) console.log('  ' + e.slice(25, 240));
  if (errs.length) process.exit(1);
})();
