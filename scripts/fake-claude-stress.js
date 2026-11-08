// Prueba de estrés: Claude Desktop se abre y se cierra muchas veces, a ratos muy seguido
// (incluso a media entrada o media despedida), para cazar carreras.
const say = (v) => process.stdout.write(v + '\n');
const pattern = [0, 1, 2500, 0, 3800, 1, 1200, 0, 1500, 1, 9000, 0, 600, 1, 7000, 0, 4000, 1, 11000, 0, 2000, 1];
let t = 0;
for (let i = 0; i < pattern.length; i += 2) {
  t += pattern[i];
  const v = pattern[i + 1];
  setTimeout(() => say(v), t);
}
setTimeout(() => process.exit(0), t + 30000);
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
