'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-hook-'));
const HOOK = path.join(__dirname, '..', 'hook', 'hook.js');
const file = (sid) => path.join(HOME, 'sesiones', sid + '.json');
function fire(ev) {
  const env = { ...process.env, COMPANION_HOME: HOME };
  delete env.COMPANION_CHAT; delete env.MASCOTA_CHAT;
  spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: 't1', cwd: 'C:/x', ...ev }), env });
}
const state = () => JSON.parse(fs.readFileSync(file('t1'), 'utf8'));

test('un mensaje tuyo la pone a trabajar; una herramienta cambia lo que dice', () => {
  fire({ hook_event_name: 'UserPromptSubmit', prompt: 'arregla el login por favor' });
  assert.strictEqual(state().state, 'working');
  fire({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'C:/x/app.js' } });
  assert.strictEqual(state().activity, 'Leyendo app.js');
});

test('una pregunta para ti la pone en "te necesito"', () => {
  fire({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: {} });
  assert.strictEqual(state().state, 'attention');
});

test('Stop la deja en "¡Listo!" y SessionEnd borra su archivo', () => {
  fire({ hook_event_name: 'Stop' });
  assert.strictEqual(state().state, 'done');
  assert.strictEqual(state().activity, '¡Listo!');
  fire({ hook_event_name: 'SessionEnd' });
  assert.strictEqual(fs.existsSync(file('t1')), false);
});

test('al terminar, un subagente en primer plano que no avisó se borra; uno en segundo plano se queda', () => {
  fire({ hook_event_name: 'UserPromptSubmit', prompt: 'reparte esto entre agentes' });
  fire({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'fg1', tool_input: { description: 'primer plano' } });
  fire({ hook_event_name: 'PreToolUse', tool_name: 'Agent', tool_use_id: 'bg1', tool_input: { description: 'segundo plano', run_in_background: true } });
  const dir = path.join(HOME, 'sesiones', 't1.agents');
  const left = () => fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  assert.deepStrictEqual(left(), ['bg1.json', 'fg1.json']);
  fire({ hook_event_name: 'Stop' });
  assert.deepStrictEqual(left(), ['bg1.json']);
});

test('las pláticas que abre la propia app no se reportan', () => {
  const env = { ...process.env, COMPANION_HOME: HOME, COMPANION_CHAT: '1' };
  spawnSync('node', [HOOK], { input: JSON.stringify({ session_id: 't2', hook_event_name: 'UserPromptSubmit', prompt: 'hola hola hola hola' }), env });
  assert.strictEqual(fs.existsSync(file('t2')), false);
});
