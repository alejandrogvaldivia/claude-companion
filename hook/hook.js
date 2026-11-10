// Claude Companion — hook que anota qué está haciendo Claude Code en cada sesión.
// Lo ejecutan los hooks de ~/.claude/settings.json (en segundo plano, sin frenar a Claude).
// Escribe ~/.claude/claude-companion/sesiones/<session_id>.json, que lee la app (Claude Companion).
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const TS = Date.now();
const BASE = process.env.COMPANION_HOME || path.join(os.homedir(), '.claude', 'claude-companion');
const DIR = path.join(BASE, 'sesiones');

// Herramientas internas que no cambian el texto de la burbuja.
const SILENT = /^(TodoWrite|ToolSearch|Task(Create|Update|List|Get|Output|Stop)|mcp__ccd_turn__.*|mcp__ccd_session__mark_chapter|mcp__visualize__read_me)$/;
// Herramientas que significan "te necesito".
const ATTENTION = {
  AskUserQuestion: 'Tengo una pregunta para ti',
  ExitPlanMode: 'Tengo un plan listo para que lo revises',
};

// Las pláticas que abre la propia app (claude -p en segundo plano) no se reportan.
if (process.env.COMPANION_CHAT === '1' || process.env.MASCOTA_CHAT === '1') process.exit(0);

setTimeout(() => process.exit(0), 5000); // por si stdin nunca se cierra
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { raw += c; });
process.stdin.on('end', () => {
  try { main(JSON.parse(raw || '{}')); } catch (_) { /* nunca romper a Claude */ }
  process.exit(0);
});

function clip(s, n) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function file(p) { return p ? path.basename(String(p)) : 'un archivo'; }

function cleanPrompt(p) {
  // quita bloques internos (avisos del sistema, notificaciones de tareas, comandos) y deja solo lo que escribiste
  const s = String(p || '')
    .replace(/<([a-zA-Z][\w-]*)[^>]*>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return clip(s, 70);
}

function describeTool(name, input) {
  input = input || {};
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return input.description ? clip(input.description, 60) : 'Ejecutando un comando';
    case 'Read': return 'Leyendo ' + file(input.file_path);
    case 'Edit':
    case 'MultiEdit': return 'Editando ' + file(input.file_path);
    case 'Write': return 'Escribiendo ' + file(input.file_path);
    case 'NotebookEdit': return 'Editando ' + file(input.notebook_path);
    case 'Grep': return 'Buscando "' + clip(input.pattern, 28) + '"';
    case 'Glob': return 'Buscando archivos';
    case 'WebSearch': return 'Buscando en la web: ' + clip(input.query, 40);
    case 'WebFetch':
      try { return 'Leyendo ' + new URL(input.url).hostname; } catch (_) { return 'Leyendo una página web'; }
    case 'Agent':
    case 'Task': return 'Delegando: ' + clip(input.description || 'una subtarea', 40);
    case 'Skill': return 'Usando la skill ' + clip(input.skill, 30);
    case 'Workflow': return 'Coordinando varios agentes';
    case 'Artifact': return 'Preparando una página';
    case 'SendUserFile': return 'Enviándote un archivo';
  }
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    const server = parts[1] || '';
    const tool = parts.slice(2).join(' ').replace(/[_-]+/g, ' ');
    if (/browser|chrome/i.test(server)) return 'Usando el navegador';
    if (/computer-use/i.test(server)) return 'Usando tu computadora';
    if (/obsidian/i.test(server)) return 'Revisando Obsidian';
    if (/^ccd_/i.test(server)) return 'Organizando la sesión';
    return 'Usando ' + clip(tool || server, 40);
  }
  return 'Usando ' + name;
}

function save(target, obj) {
  const data = JSON.stringify(obj);
  const tmp = target + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, target);
  } catch (_) {
    try { fs.writeFileSync(target, data); } catch (_) { /* ignorar */ }
    try { fs.unlinkSync(tmp); } catch (_) { /* ignorar */ }
  }
}


// ---------- subagentes que lanza Claude Code (herramienta Agent/Task): uno por archivo, para que la app
// los muestre como Clawds ayudantes. Un archivo por agente (sin carreras entre hooks que corren a la vez).
const safeKey = (k) => String(k || '').replace(/[^\w.-]/g, '_').slice(0, 80);
function agentsDir(sid) { return path.join(DIR, sid + '.agents'); }
function agentFiles(dir) {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { return []; }
}
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (_) { return null; } }
function agentLaunch(sid, d) {                         // PreToolUse de Agent/Task: llega uno
  const i = d.tool_input || {};
  const key = safeKey(d.tool_use_id) || 't' + TS + Math.random().toString(36).slice(2, 6);
  const dir = agentsDir(sid);
  fs.mkdirSync(dir, { recursive: true });
  const o = { key, desc: clip(i.description || 'una subtarea', 60), type: String(i.subagent_type || ''), model: String(i.model || ''), bg: !!i.run_in_background, t0: TS };
  fs.writeFileSync(path.join(dir, key + '.json'), JSON.stringify(o));
}
function agentClaim(sid, d) {                          // SubagentStart: a cuál de los que se lanzaron le toca este id
  const id = safeKey(d.agent_id);
  if (!id) return;
  const dir = agentsDir(sid);
  fs.mkdirSync(dir, { recursive: true });
  const list = agentFiles(dir).map((f) => ({ f, o: readJson(path.join(dir, f)) })).filter((x) => x.o && !x.o.agent_id).sort((a, b) => a.o.t0 - b.o.t0);
  for (const x of list) {
    try { fs.closeSync(fs.openSync(path.join(dir, x.o.key + '.claim'), 'wx')); } catch (_) { continue; }   // ya lo tomó otro
    x.o.agent_id = id;
    fs.writeFileSync(path.join(dir, x.f), JSON.stringify(x.o));
    return;
  }
  // no vimos cuando lo lanzaron: se anota igual
  fs.writeFileSync(path.join(dir, 'a_' + id + '.json'), JSON.stringify({ key: 'a_' + id, agent_id: id, desc: clip(d.agent_type || 'una subtarea', 60), type: String(d.agent_type || ''), model: '', bg: true, t0: TS }));
}
function agentGone(sid, match) {
  const dir = agentsDir(sid);
  for (const f of agentFiles(dir)) {
    const o = readJson(path.join(dir, f));
    if (!o || !match(o)) continue;
    try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ya no estaba */ }
    try { fs.unlinkSync(path.join(dir, o.key + '.claim')); } catch (_) { /* no había */ }
  }
}

function main(d) {
  const ev = d.hook_event_name || '';
  const sid = String(d.session_id || 'sesion').replace(/[^\w.-]/g, '_').slice(0, 80);
  fs.mkdirSync(DIR, { recursive: true });
  const target = path.join(DIR, sid + '.json');
  const tool = d.tool_name || '';
  // subagentes: van aparte (no cambian lo que dice la sesión)
  if (ev === 'SubagentStart') { agentClaim(sid, d); return; }
  if (ev === 'SubagentStop') { const id = safeKey(d.agent_id); if (id) agentGone(sid, (o) => o.agent_id === id); return; }
  if ((tool === 'Agent' || tool === 'Task') && ev === 'PreToolUse') { try { agentLaunch(sid, d); } catch (_) { /* nada */ } }
  if ((tool === 'Agent' || tool === 'Task') && (ev === 'PostToolUse' || ev === 'PostToolUseFailure')) {
    const k = safeKey(d.tool_use_id);
    // el que corre en primer plano ya terminó; el que sigue en segundo plano (o del que Claude Code avisa
    // cuándo arranca y termina) se queda hasta su SubagentStop
    const resp = (() => { try { return JSON.stringify(d.tool_response || ''); } catch (_) { return ''; } })();
    const async = /async|background|segundo plano/i.test(resp);
    if (k) agentGone(sid, (o) => o.key === k && (ev === 'PostToolUseFailure' || (!o.bg && !o.agent_id && !async)));
  }

  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (_) { /* sesión nueva */ }
  if (cur.ts && cur.ts > TS) return; // ya llegó un evento más nuevo

  if (ev === 'SessionEnd') {
    try { fs.unlinkSync(target); } catch (_) { /* ignorar */ }
    try { fs.rmSync(agentsDir(sid), { recursive: true, force: true }); } catch (_) { /* ignorar */ }
    return;
  }

  const s = Object.assign({}, cur, { ts: TS });
  if (d.cwd) s.cwd = d.cwd;
  // el historial de la sesión: de ahí la app saca la lista de tareas y lo que Claude va diciendo
  if (d.transcript_path) s.tp = String(d.transcript_path);
  if (d.model) s.model = String(typeof d.model === 'object' ? (d.model.id || '') : d.model); // modelo de la sesión (al iniciar)

  switch (ev) {
    case 'SessionStart':
      if (d.source === 'compact' && cur.state) break; // sigue en lo que estaba
      s.state = 'idle';
      s.activity = 'Esperando tu mensaje';
      break;

    case 'UserPromptSubmit': {
      const p = cleanPrompt(d.prompt);
      if (p && (p.length >= 12 || !cur.title)) s.title = p;
      s.state = 'working';
      s.activity = 'Pensando…';
      delete s.prev;
      break;
    }

    case 'PreToolUse': {
      const name = d.tool_name || '';
      if (ATTENTION[name]) {
        if (cur.state !== 'attention') s.prev = cur.activity;
        s.state = 'attention';
        s.activity = ATTENTION[name];
        break;
      }
      s.state = 'working';
      if (!SILENT.test(name)) s.activity = describeTool(name, d.tool_input);
      else if (cur.state === 'attention') s.activity = cur.prev || 'Trabajando…';
      break;
    }

    case 'PostToolUse':
    case 'PostToolUseFailure':
      if (cur.state !== 'attention') return; // solo sirve para salir de "te necesito"
      s.state = 'working';
      s.activity = cur.prev || 'Trabajando…';
      break;

    case 'PermissionRequest':
      if (cur.state !== 'attention') s.prev = cur.activity;
      s.state = 'attention';
      s.activity = 'Necesito tu permiso · ' + describeTool(d.tool_name || '', d.tool_input);
      break;

    case 'Notification': {
      const t = d.notification_type || '';
      const m = String(d.message || '');
      if (t === 'permission_prompt' || (!t && /permission/i.test(m))) {
        if (cur.state === 'attention') return; // ya lo sabe
        s.prev = cur.activity;
        s.state = 'attention';
        s.activity = 'Necesito tu permiso para seguir';
      } else if (t === 'elicitation_dialog') {
        if (cur.state !== 'attention') s.prev = cur.activity;
        s.state = 'attention';
        s.activity = 'Necesito que me respondas algo';
      } else {
        return;
      }
      break;
    }

    case 'Stop':
      s.state = 'done';
      s.activity = '¡Listo! Te toca';
      delete s.prev;
      break;

    case 'StopFailure':
      s.state = 'error';
      s.activity = 'Algo falló y me detuve';
      break;

    default:
      return;
  }
  save(target, s);
}
