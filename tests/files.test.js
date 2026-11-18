'use strict';
// node --test tests/   (sin dependencias)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

function make() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-files-'));
  process.env.COMPANION_OUT = out;
  const calls = [];
  const F = require('../app/files')({
    app: { getPath: () => out }, BrowserWindow: class {}, BASE: out, log: () => {}, recOf: () => ({ name: 'x' }),
    shell: { openPath: async (f) => { calls.push(['open', path.basename(f)]); return ''; }, showItemInFolder: (f) => calls.push(['show', path.basename(f)]) },
  });
  return { F, out, calls };
}

test('dos ayudantes con el mismo nombre no se pisan', async () => {
  const { F } = make();
  const rs = await Promise.all([1, 2, 3, 4].map((i) => F.createFile(null, { nombre: 'Resumen', formato: 'md', contenido: 'doc ' + i })));
  assert.strictEqual(new Set(rs.map((r) => r.ruta)).size, 4);
  assert.deepStrictEqual(rs.map((r) => fs.readFileSync(r.ruta, 'utf8')).sort(), ['doc 1', 'doc 2', 'doc 3', 'doc 4']);
});

test('una página html no se abre sola en el navegador; un txt sí', async () => {
  const { F, calls } = make();
  await F.createFile(null, { nombre: 'p', formato: 'html', contenido: '<b>x</b>', abrir: true });
  await F.createFile(null, { nombre: 't', formato: 'txt', contenido: 'a', abrir: true });
  assert.deepStrictEqual(calls, [['show', 'p.html'], ['open', 't.txt']]);
});

test('rechaza contenido vacío, formato raro y demasiado grande', async () => {
  const { F } = make();
  await assert.rejects(F.createFile(null, { nombre: 'a', formato: 'md', contenido: '  ' }), /vacío/);
  await assert.rejects(F.createFile(null, { nombre: 'a', formato: 'exe', contenido: 'x' }), /Formato/);
  await assert.rejects(F.createFile(null, { nombre: 'a', formato: 'md', contenido: 'x'.repeat(F.MAX_CONTENT + 1) }), /grande/);
});

test('si falla al armar el archivo, no queda uno vacío reservado', async () => {
  const { F, out } = make();
  await assert.rejects(F.createFile(null, { nombre: 'z', formato: 'pdf', contenido: '<p>x</p>' }));   // aquí no hay Electron
  assert.deepStrictEqual(fs.readdirSync(out).filter((f) => f.startsWith('z')), []);
});

test('safeName: sin rutas ni nombres reservados de Windows', () => {
  const { F } = make();
  assert.strictEqual(F.safeName('../../etc/passwd'), '.. .. etc passwd');
  assert.strictEqual(F.safeName('con.txt'), '_con');
  assert.strictEqual(F.safeName(''), 'Archivo');
});
