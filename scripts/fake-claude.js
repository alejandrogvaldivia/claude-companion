// Prueba: simula que Claude Desktop se abre, se cierra y se vuelve a abrir.
// uso: MASCOTA_FAKE_WATCHER=tools/fake-claude.js electron.exe app --background
// FAKE_CLOSE_AT / FAKE_OPEN_AT (ms) cambian cuándo se cierra y se vuelve a abrir.
const say = (v) => process.stdout.write(v + '\n');
const closeAt = Number(process.env.FAKE_CLOSE_AT || 6000);
const openAt = Number(process.env.FAKE_OPEN_AT || 13000);
say(1);                                   // Claude ya estaba abierto
setTimeout(() => say(0), closeAt);        // lo cierras del todo  → Clawd se despide
setTimeout(() => say(1), openAt);         // lo vuelves a abrir   → Clawd regresa con su entrada
setTimeout(() => process.exit(0), openAt + 30000);
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
