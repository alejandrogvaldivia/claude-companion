'use strict';
// Claude Companion — crear archivos que piden los Clawds: solo nuevos y solo en Documentos\Claude Companion.
const fs = require('fs');
const path = require('path');

module.exports = function files({ app, BrowserWindow, shell, BASE, log, recOf }) {
  const OUT_DIR = () => process.env.COMPANION_OUT || path.join(app.getPath('documents'), 'Claude Companion');
  const MAX_CONTENT = 3e6;                                              // el servidor local acepta un poco más (JSON)
  const FORMATS = ['txt', 'md', 'html', 'pdf', 'png'];
  function safeName(n) {
    n = String(n || '').replace(/\.(txt|md|html?|pdf|png)$/i, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80);
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n)) n = '_' + n;
    return n || 'Archivo';
  }
  // elige un nombre libre y lo reserva creando el archivo vacío (flag wx): dos ayudantes a la vez no se pisan
  function freePath(dir, base, ext) {
    for (let i = 1; ; i++) {
      const f = path.join(dir, i === 1 ? `${base}.${ext}` : `${base} (${i}).${ext}`);
      try { fs.closeSync(fs.openSync(f, 'wx')); return f; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
  // convierte una página HTML en PDF o PNG en una ventana oculta, sin JavaScript y sin poder navegar
  async function renderHtml(html, fmt, file) {
    const tmpDir = path.join(BASE, 'render');
    fs.mkdirSync(tmpDir, { recursive: true });
    const tmp = path.join(tmpDir, `r-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.html`);
    if (!/<meta[^>]+charset/i.test(html)) html = '<meta charset="utf-8">' + html;
    fs.writeFileSync(tmp, html, 'utf8');
    // PNG: ventana "offscreen" (Windows no pinta las ventanas ocultas normales y la foto nunca llegaba)
    const w = new BrowserWindow({
      show: false, width: fmt === 'png' ? 1080 : 900, height: fmt === 'png' ? 400 : 1200, useContentSize: true,
      webPreferences: { offscreen: fmt === 'png', javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'companion-render' },
    });
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const work = (async () => {
      await w.loadFile(tmp);
      await w.webContents.insertCSS('::-webkit-scrollbar{display:none!important}');
      await wait(400);                                // fuentes e imágenes
      if (fmt === 'pdf') {
        fs.writeFileSync(file, await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'default' } }));
        return;
      }
      // mide lo que ocupa de verdad el contenido (sin espacio sobrante a la derecha ni abajo)
      const dbg = w.webContents.debugger;
      dbg.attach('1.3');
      let size;
      try {
        const r = await dbg.sendCommand('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          let w = 0, h = 0;
          for (const el of document.body.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.width && b.height) { w = Math.max(w, b.right); h = Math.max(h, b.bottom); } }
          const cs = getComputedStyle(document.body);
          return { w: w + parseFloat(cs.marginRight || 0) + parseFloat(cs.paddingRight || 0), h: h + parseFloat(cs.marginBottom || 0) + parseFloat(cs.paddingBottom || 0) };
        })()` });
        size = r && r.result && r.result.value;
      } finally { try { dbg.detach(); } catch (_) { /* nada */ } }
      const width = Math.min(4000, Math.max(200, Math.ceil((size && size.w) || 1080)));
      const height = Math.min(16000, Math.max(200, Math.ceil((size && size.h) || 1200) + 24));
      w.setContentSize(width, height);
      await wait(600);
      w.webContents.invalidate();
      await wait(300);
      fs.writeFileSync(file, (await w.webContents.capturePage()).toPNG());
    })();
    try {
      await Promise.race([work, wait(60000).then(() => { throw new Error('Tardó demasiado en armar el archivo.'); })]);
    } finally {
      w.destroy();
      fs.unlink(tmp, () => {});
    }
  }
  async function createFile(p, a) {
    const fmt = String(a.formato || '').toLowerCase().replace(/^\./, '').replace(/^htm$/, 'html');
    if (!FORMATS.includes(fmt)) throw new Error('Formato no soportado. Usa: ' + FORMATS.join(', ') + '.');
    const content = String(a.contenido || '');
    if (!content.trim()) throw new Error('El contenido está vacío.');
    if (content.length > MAX_CONTENT) throw new Error('El contenido es demasiado grande.');
    const dir = OUT_DIR();
    fs.mkdirSync(dir, { recursive: true });
    const file = freePath(dir, safeName(a.nombre), fmt);
    try {
      if (fmt === 'txt') fs.writeFileSync(file, '\uFEFF' + content.replace(/\r?\n/g, '\r\n'), 'utf8');   // con BOM: el bloc de notas lo abre bien
      else if (fmt === 'md' || fmt === 'html') fs.writeFileSync(file, content, 'utf8');
      else await renderHtml(content, fmt, file);
    } catch (e) { try { fs.unlinkSync(file); } catch (_) { /* nada */ } throw e; }   // no deja el archivo vacío reservado
    const who = p && p.alive ? recOf(p).name || 'Clawd' : 'Clawd';
    log(`crear: ${who} guardó ${file}`);
    // lo anota en su plática (y en la de quien lo invocó, si es ayudante) para mostrarlo en el globo
    for (const q of [p, p && p.helperOf]) if (q && q.alive && q.chat && q.chat.proc) (q.madeFiles = q.madeFiles || []).push(file);
    let abierto = false;
    if (a.abrir && fmt === 'html') { shell.showItemInFolder(file); abierto = true; }   // una página puede traer scripts: no se abre en el navegador sola
    else if (a.abrir) { const err = await shell.openPath(file); abierto = !err; if (err) log('crear: no se pudo abrir: ' + err); }
    return { ruta: file, abierto };
  }

  return { OUT_DIR, createFile, safeName, freePath, MAX_CONTENT };
};
