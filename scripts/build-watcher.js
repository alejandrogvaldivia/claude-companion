// Compila el vigilante (watcher/watcher.cs → bin/clawd.exe) con el compilador de C# que ya trae Windows
// (.NET Framework 4). Avisa al proceso principal cuando Claude Desktop se abre o se cierra.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'win32') { console.log('build-watcher: solo en Windows; se omite.'); process.exit(0); }
const root = path.join(__dirname, '..');
const src = path.join(root, 'watcher', 'watcher.cs');
const out = path.join(root, 'bin', 'clawd.exe');
const win = process.env.WINDIR || 'C:\Windows';
const csc = [
  path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
].find((p) => fs.existsSync(p));
if (!csc) { console.error('build-watcher: no encontré csc.exe (.NET Framework 4).'); process.exit(1); }
fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(csc, ['-nologo', '-optimize', '-platform:x64', `-out:${out}`, src], { stdio: 'inherit' });
console.log('build-watcher: listo →', path.relative(root, out));
