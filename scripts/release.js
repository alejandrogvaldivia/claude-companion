// Publica una versión nueva de Claude Companion en GitHub (las apps instaladas se actualizan solas).
//
//   npm run release              → 1.2.3 → 1.2.4   (arreglos)
//   npm run release -- minor     → 1.2.3 → 1.3.0   (cosas nuevas)
//   npm run release -- major     → 1.2.3 → 2.0.0   (cambios grandes)
//   npm run release -- 1.5.0     → esa versión exacta
//   … -- minor "Qué cambió"      → notas de la versión (si no, GitHub las arma con los commits)
//
// Hace: sube la versión en package.json → genera el instalador → commit + push → crea el Release
// con el instalador, su .blockmap y latest.yml (lo que lee el actualizador automático).
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const run = (cmd, args, opts) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' && cmd === 'npm', ...opts });
const out = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8' }).trim();
function gh() {
  for (const c of ['gh', path.join(process.env.ProgramFiles || 'C:/Program Files', 'GitHub CLI', 'gh.exe')]) {
    try { execFileSync(c, ['--version'], { stdio: 'ignore' }); return c; } catch (_) { /* siguiente */ }
  }
  throw new Error('No encontré GitHub CLI (gh). Instálalo y corre "gh auth login".');
}
function bump(v, how) {
  if (/^\d+\.\d+\.\d+$/.test(how || '')) return how;
  const [a, b, c] = v.split('.').map(Number);
  if (how === 'major') return `${a + 1}.0.0`;
  if (how === 'minor') return `${a}.${b + 1}.0`;
  return `${a}.${b}.${c + 1}`;
}

// (npm puede partir las notas en palabras: se vuelven a juntar)
const [how, ...rest] = process.argv.slice(2);
const notes = rest.join(' ').trim();
const GH = gh();
execFileSync(GH, ['auth', 'status'], { stdio: 'ignore' });               // falla si no has iniciado sesión
const pkgFile = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
const version = bump(pkg.version, how);
const tag = `v${version}`;
if (out('git', ['tag', '--list', tag])) throw new Error(`Ya existe la versión ${tag}.`);
console.log(`\n== Claude Companion ${pkg.version} → ${version} ==\n`);

pkg.version = version;
fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
try {
  run('npm', ['run', 'dist']);
} catch (e) {
  console.error('\nNo se pudo generar el instalador; regreso la versión.');
  execFileSync('git', ['checkout', '--', 'package.json'], { cwd: root });
  process.exit(1);
}
const dist = path.join(root, 'dist');
const exe = `Claude-Companion-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'].map((f) => path.join(dist, f));
for (const f of files) if (!fs.existsSync(f)) throw new Error('Falta ' + f);

run('git', ['add', '-A']);
run('git', ['commit', '-m', `Versión ${version}`]);
run('git', ['tag', tag]);
run('git', ['push']);
run('git', ['push', 'origin', tag]);
const args = ['release', 'create', tag, ...files, '--title', `Claude Companion ${version}`];
if (notes) args.push('--notes', notes); else args.push('--generate-notes');
run(GH, args);
console.log(`\n✓ Publicada ${tag}. Las apps instaladas la bajarán solas (si el repo es público).`);
