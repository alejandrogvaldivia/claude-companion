// Claude Companion — mini extensión (servidor MCP por stdio) que le da a un Clawd sus herramientas:
//   "crear_archivo": guarda un archivo (texto, Markdown, HTML, PDF o imagen) en Documentos\Claude Companion.
//   "delegar": reparte tareas entre Clawds ayudantes, cada uno con el modelo adecuado (los ayudantes no la tienen).
// La lanza Claude Code (claude -p) al platicar con un Clawd; habla con la app de Claude Companion
// solo dentro de tu compu (127.0.0.1, con una contraseña que cambia en cada arranque).
'use strict';
const http = require('http');

const PORT = Number(process.env.COMPANION_PORT || 0);
const TOKEN = process.env.COMPANION_TOKEN || '';
const PET = process.env.COMPANION_PET || '';
const CAN_DELEGATE = process.env.COMPANION_CAN_DELEGATE === '1';

const CREATE = {
  name: 'crear_archivo',
  description:
    'Crea un archivo en la compu del usuario, dentro de su carpeta Documentos\\Claude Companion (no puede escribir en otro lado ni cambiar archivos que ya existen). ' +
    'Formatos: "txt" (bloc de notas), "md" (Markdown), "html" (página), "pdf" y "png" (imagen). ' +
    'Para "pdf" y "png" escribe el contenido como una página HTML completa con su CSS (sin JavaScript): la app la convierte. ' +
    'Úsalo para documentos, notas, infografías, etc. Si abrir es true, se le abre al usuario al terminar (úsalo cuando te pidan verlo, por ejemplo "anótalo en un bloc de notas"). ' +
    'Devuelve la ruta del archivo; menciónasela al usuario.',
  inputSchema: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre del archivo, sin carpeta (por ejemplo "Historia del Barça"). La extensión se pone sola.' },
      formato: { type: 'string', enum: ['txt', 'md', 'html', 'pdf', 'png'] },
      contenido: { type: 'string', description: 'El texto del archivo; para html, pdf y png, una página HTML completa.' },
      abrir: { type: 'boolean', description: 'Abrirlo al usuario al terminar.' },
    },
    required: ['nombre', 'formato', 'contenido'],
  },
};

const TOOL = {
  name: 'delegar',
  description:
    'Reparte tareas entre Clawds ayudantes (otros mini Claudes que aparecen en la pantalla del usuario y trabajan en paralelo). ' +
    'Úsala cuando te pidan varias cosas que se pueden hacer por separado, o una tarea grande que conviene dividir. ' +
    'Elige el modelo de cada tarea: "haiku" para lo sencillo y rápido (buscar un dato, resumir algo corto), ' +
    '"sonnet" para lo normal (investigar, comparar, redactar), "opus" para lo difícil (razonar a fondo, planear algo complejo). ' +
    'Cada ayudante puede leer archivos, buscar en la web, crear archivos nuevos (crear_archivo) y usar las extensiones que le pases; no puede volver a delegar. ' +
    'Si la tarea pide un archivo (PDF, nota, infografía…), dile al ayudante que lo cree él con crear_archivo. ' +
    'Escribe cada tarea completa y clara, con todo el contexto que necesite (el ayudante no ve esta plática). ' +
    'Devuelve el resultado de cada ayudante; después tú le das al usuario la respuesta final.',
  inputSchema: {
    type: 'object',
    properties: {
      tareas: {
        type: 'array', minItems: 1, maxItems: 4,
        items: {
          type: 'object',
          properties: {
            tarea: { type: 'string', description: 'Lo que debe hacer el ayudante, completo y con contexto.' },
            modelo: { type: 'string', enum: ['haiku', 'sonnet', 'opus'], description: 'Modelo del ayudante.' },
            nombre: { type: 'string', description: 'Nombre corto para el ayudante (opcional).' },
            extensiones: { type: 'array', items: { type: 'string' }, description: 'Extensiones que puede usar (por ejemplo "obsidian"), si las necesita.' },
          },
          required: ['tarea', 'modelo'],
        },
      },
    },
    required: ['tareas'],
  },
};

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n'); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

function askApp(route, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(Object.assign({ token: TOKEN, from: PET }, payload));
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: route, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { const j = JSON.parse(data); if (res.statusCode !== 200) reject(new Error(j.error || `HTTP ${res.statusCode}`)); else resolve(j); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15 * 60 * 1000, () => req.destroy(new Error('Los ayudantes tardaron demasiado.')));
    req.end(body);
  });
}

async function handle(m) {
  const { id, method, params } = m;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'claude-companion', version: '1.0.0' },
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: CAN_DELEGATE ? [CREATE, TOOL] : [CREATE] });
  if (method === 'tools/call' && params && params.name === 'crear_archivo') {
    try {
      const r = await askApp('/crear', { archivo: params.arguments || {} });
      return reply(id, { content: [{ type: 'text', text: `Listo, guardé ${r.ruta}${r.abierto ? ' y se lo abrí al usuario' : ''}.` }] });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'No pude crear el archivo: ' + e.message }], isError: true });
    }
  }
  if (method === 'tools/call') {
    if (!params || params.name !== 'delegar' || !CAN_DELEGATE) return fail(id, -32602, 'Herramienta desconocida');
    try {
      const r = await askApp('/delegar', { tareas: (params.arguments || {}).tareas || [] });
      const text = (r.resultados || []).map((x, i) =>
        `### Ayudante ${i + 1}: ${x.nombre} (${x.modelo})${x.error ? ' — no pudo terminar' : ''}\n${x.texto || '(sin respuesta)'}`).join('\n\n');
      return reply(id, { content: [{ type: 'text', text: text || 'Ningún ayudante contestó.' }], isError: !(r.resultados || []).some((x) => !x.error) });
    } catch (e) {
      return reply(id, { content: [{ type: 'text', text: 'No pude invocar ayudantes: ' + e.message }], isError: true });
    }
  }
  if (id !== undefined && id !== null) fail(id, -32601, 'Método no soportado: ' + method);
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch (_) { continue; }
    handle(m).catch(() => {});
  }
});
process.stdin.on('end', () => process.exit(0));
