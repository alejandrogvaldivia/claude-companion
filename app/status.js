'use strict';
const fs = require('fs');
// Claude Companion — lo que Claude va haciendo, leído del historial de la sesión (solo lectura).
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
  // al interrumpir, Claude Code no manda "Stop": solo deja esta marca en el historial; cualquier línea posterior la anula
  c.intr = m.type === 'user' && /\[Request interrupted by user/.test(JSON.stringify((m.message || {}).content || ''));
  if (m.type === 'user') {
    if (m.isMeta || m.isCompactSummary) return;
    const msg = m.message || {};
    const pt = promptText(msg.content);
    if (pt) {                                                       // mensaje tuyo: empieza otra vuelta
      c.says = []; c.plan = []; c.turn++; pushRecent(c, 'Usuario', pt);
      if (!c.intr) c.ask = { id: 'u' + (m.uuid || c.turn), text: pt.replace(/\s+/g, ' ').slice(0, 600), ts: Date.parse(m.timestamp) || Date.now() };   // para mostrarlo en el chat
    }
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

module.exports = { readTranscript, planView, applyLine, mdPlain, promptText };
