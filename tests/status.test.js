'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readTranscript, planView } = require('../app/status');

const NL = String.fromCharCode(10);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-status-'));
const add = (f, ...objs) => fs.appendFileSync(f, objs.map((o) => JSON.stringify(o)).join(NL) + NL);
const you = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const claude = (content) => ({ type: 'assistant', uuid: Math.random().toString(36), message: { role: 'assistant', model: 'claude-x', content } });

test('interrumpir la deja parada; un mensaje nuevo la vuelve a poner en marcha', () => {
  const f = path.join(dir, 'a.jsonl');
  add(f, you('arregla el login por favor'), claude([{ type: 'tool_use', name: 'Bash', input: { command: 'sleep 99' } }]));
  assert.strictEqual(readTranscript(f).intr, false);
  add(f, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } });
  assert.strictEqual(readTranscript(f).intr, true);
  add(f, you('mejor haz otra cosa'));
  assert.strictEqual(readTranscript(f).intr, false);
});

test('la lista de tareas sigue a update_plan (avanzar y terminar)', () => {
  const f = path.join(dir, 'b.jsonl');
  const items = [{ content: 'Leer', status: 'in_progress' }, { content: 'Editar', status: 'pending' }];
  add(f, you('haz esto en dos pasos'), claude([{ type: 'tool_use', name: 'mcp__ccd_turn__update_plan', input: { items } }]));
  assert.deepStrictEqual(readTranscript(f).plan.map((p) => p.s), ['doing', 'todo']);
  add(f, claude([{ type: 'tool_use', name: 'mcp__ccd_turn__update_plan', input: { advance: true } }]));
  assert.deepStrictEqual(readTranscript(f).plan.map((p) => p.s), ['done', 'doing']);
  add(f, claude([{ type: 'tool_use', name: 'mcp__ccd_turn__wrap_up', input: {} }]));
  assert.deepStrictEqual(readTranscript(f).plan.map((p) => p.s), ['done', 'done']);
});

test('lo que dice Claude se guarda sin markdown, solo los últimos 3', () => {
  const f = path.join(dir, 'c.jsonl');
  add(f, you('cuéntame algo largo'));
  for (const t of ['uno', 'dos', '**tres**', 'cuatro']) add(f, claude([{ type: 'text', text: t }]));
  assert.deepStrictEqual(readTranscript(f).says.map((s) => s.text), ['dos', 'tres', 'cuatro']);
});

test('planView: con muchas tareas muestra la que va y resume las hechas', () => {
  const plan = Array.from({ length: 10 }, (_, i) => ({ t: 'paso ' + i, s: i < 7 ? 'done' : i === 7 ? 'doing' : 'todo' }));
  const v = planView(plan);
  assert.ok(v.length <= 7);
  assert.ok(v[0].more);
  assert.ok(v.some((p) => p.s === 'doing'));
});

test('lo que escribes en la sesión queda como "ask"; la marca de interrupción no cuenta', () => {
  const f = path.join(dir, 'd.jsonl');
  add(f, you('prueba /btw por favor'));
  assert.strictEqual(readTranscript(f).ask.text, 'prueba /btw por favor');
  add(f, { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
  assert.strictEqual(readTranscript(f).ask.text, 'prueba /btw por favor');
  add(f, you('otra cosa distinta'));
  assert.strictEqual(readTranscript(f).ask.text, 'otra cosa distinta');
});
