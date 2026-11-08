// Claude Companion — mini extensión (servidor MCP por stdio) que le da a un Clawd la herramienta
// "delegar": reparte tareas entre Clawds ayudantes, cada uno con el modelo adecuado.
// La lanza Claude Code (claude -p) al platicar con un Clawd; habla con la app de Claude Companion
// solo dentro de tu compu (127.0.0.1, con una contraseña que cambia en cada arranque).
'use strict';
const http = require('http');

const PORT = Number(process.env.COMPANION_PORT || 0);
const TOKEN = process.env.COMPANION_TOKEN || '';
const PET = process.env.COMPANION_PET || '';

const TOOL = {
  name: 'delegar',
  description:
    'Reparte tareas entre Clawds ayudantes (otros mini Claudes que aparecen en la pantalla del usuario y trabajan en paralelo). ' +
    'Úsala cuando te pidan varias cosas que se pueden hacer por separado, o una tarea grande que conviene dividir. ' +
    'Elige el modelo de cada tarea: "haiku" para lo sencillo y rápido (buscar un dato, resumir algo corto), ' +
    '"sonnet" para lo normal (investigar, comparar, redactar), "opus" para lo difícil (razonar a fondo, planear algo complejo). ' +
    'Cada ayudante solo puede leer archivos, buscar en la web y usar las extensiones que le pases; no puede volver a delegar. ' +
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

function askApp(tareas) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ token: TOKEN, from: PET, tareas });
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: '/delegar', method: 'POST',
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
  if (method === 'tools/list') return reply(id, { tools: [TOOL] });
  if (method === 'tools/call') {
    if (!params || params.name !== 'delegar') return fail(id, -32602, 'Herramienta desconocida');
    try {
      const r = await askApp((params.arguments || {}).tareas || []);
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
