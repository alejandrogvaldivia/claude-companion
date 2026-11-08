# Claude Companion

> **Proyecto de fans, no oficial.** No está afiliado, patrocinado ni aprobado por Anthropic.
> "Claude", "Claude Code" y Clawd son de Anthropic.

Clawds en tu escritorio: **uno por cada sesión de Claude Code**. Te dejan ver de un vistazo qué está haciendo cada sesión mientras tú haces otras cosas, y puedes platicar con cada uno en globitos de cómic.

*English summary below.*

## Qué hace

- **Un Clawd por sesión.** Cada sesión de Claude Code (en Claude Desktop o en la terminal) tiene su propio Clawd, con su estado:
  - Trabaja en su laptop mientras la sesión trabaja.
  - Levanta la mano cuando necesita tu permiso.
  - Baila cuando termina.
  - Se duerme después de un rato sin actividad y se despide a los 5 minutos.
- **Lo que está haciendo**, encima de cada Clawd:
  - Su lista de tareas.
  - La acción del momento con su tiempo (como "Editando main.js 12s").
  - Lo que va diciendo, en globitos de una línea que se abren al pasar el cursor.
- **Nombre, color y tamaño.** A cada Clawd le pones nombre y color con clic derecho. Su tamaño depende del modelo: Opus 100 %, Sonnet 75 %, Haiku 50 %.
- **Platica con cada Clawd.** Le escribes y te contesta en segundo plano, con lo más reciente de su sesión como contexto (sin tocar la sesión original). Las pláticas se guardan.
  - **"Mandar a su sesión"** abre la sesión en Claude Desktop con lo platicado ya pegado en su caja de texto. Tú le das Enter.
  - **Clic en un Clawd** abre su sesión en Claude Desktop.
- **Crean archivos.** Pídele a un Clawd un PDF, una nota, una infografía o una página y la crea de verdad:
  - Formatos: bloc de notas (`.txt`), Markdown, HTML, **PDF** e imagen **PNG**.
  - Se guardan en **Documentos\Claude Companion**. Un Clawd solo puede crear archivos nuevos ahí: no cambia ni borra nada que ya exista.
  - En el globo aparece un botoncito con cada archivo para abrirlo. Si se lo pides ("anótalo en un bloc de notas"), te lo abre al terminar.
- **Invoca Clawds.** El botón del Clawd con **+** trae un Clawd nuevo, con su propio nombre, color y plática, aunque no haya una sesión. Se queda hasta que lo despides con clic derecho; "Nueva conversación" también está en ese menú.
- **Extensiones.** Clic derecho en un Clawd → **Extensiones** para prenderle las que ya tienes en Claude Desktop o Claude Code (por ejemplo, Obsidian). Así puedes tener un Clawd dedicado a tus notas. Con una extensión prendida, el Clawd puede leer **y cambiar** cosas en ella.
- **Delegan entre ellos.** Pídele a cualquier Clawd varias cosas a la vez ("necesito X, Y y Z").
  - Él reparte el trabajo e invoca **ayudantes**, uno por tarea, con el modelo adecuado: Haiku para lo sencillo, Sonnet para lo normal, Opus para lo difícil.
  - Los ves llegar y trabajar. Los ayudantes también pueden crear archivos.
  - Al terminar le entregan su parte y se despiden, y él te da la respuesta final con los archivos que crearon.
  - Cada ayudante es una plática aparte con Claude, así que también cuenta para tu uso.
- **Tres modos**, que se cambian desde el ícono de la bandeja:
  - **Escritorio:** cada Clawd en su ventana.
  - **Escritorio en grupo:** pasean juntos, conviven y tienen un **chat grupal** tipo WhatsApp con "Responder a ▾".
  - **Barra de tareas:** minis que pasean sobre la barra.
- **Convivencia.** De vez en cuando se saludan, platican, se brincan, se suben uno encima del otro o festejan cuando otro termina. El trabajo real siempre tiene prioridad.

## Requisitos

- **Windows 10 u 11.**
- **Claude Desktop y/o Claude Code.** Claude Companion usa el Claude Code más nuevo que encuentre: el de la terminal o el que trae Claude Desktop.
- **Internet la primera vez**, para preparar las animaciones de Clawd (ver abajo).

## Instalación

1. Descarga `Claude-Companion-Setup-x.y.z.exe` de [Releases](../../releases).
2. Ábrelo. Windows puede mostrar "Windows protegió su PC", porque el instalador no está firmado. Dale **Más información → Ejecutar de todas formas**.
3. La primera vez, Claude Companion:
   - **prepara las animaciones de Clawd:** las baja de claude.ai y saca la de la laptop de tu Claude Desktop;
   - **te pregunta si puede conectarse a Claude Code.** Si aceptas, agrega unos *hooks* a `~/.claude/settings.json` y guarda un respaldo antes.
4. Abre Claude Desktop: tus Clawds llegan caminando. Claude Companion arranca solo con Windows y aparece cada vez que abres Claude.

### Desde el código

```bash
git clone https://github.com/alejandrogvaldivia/claude-companion
cd claude-companion
npm install        # también compila el vigilante (bin/clawd.exe) con el compilador de C# de Windows
npm start
```

Para generar el instalador: `npm run dist`. Queda en `dist/`.

## Actualizaciones

Claude Companion **se actualiza solo**:
- Al abrirse, y cada 6 horas, revisa si hay una versión nueva en [Releases](../../releases).
- Si la hay, la baja en segundo plano y la instala cuando cierras la app. También puedes instalarla al momento desde el ícono de la bandeja: **"Actualizar a la versión…"**.
- Tus Clawds, pláticas y hooks se conservan.
- Para revisar a mano: ícono de la bandeja → **Buscar actualizaciones**.

### Publicar una versión (para quien mantiene el proyecto)

Requiere [GitHub CLI](https://cli.github.com/) con sesión iniciada (`gh auth login`).

```bash
npm run release              # arreglos:       1.2.3 → 1.2.4
npm run release -- minor     # cosas nuevas:   1.2.3 → 1.3.0
npm run release -- major     # cambio grande:  1.2.3 → 2.0.0
npm run release -- minor "Qué cambió"   # con notas propias (si no, se arman con los commits)
```

El comando:
1. Sube la versión en `package.json`.
2. Genera el instalador.
3. Hace commit y push.
4. Crea el Release con lo que necesita el actualizador: el `.exe`, su `.blockmap` y `latest.yml`.

## Cómo funciona (y privacidad)

- **Los hooks** (`hook/hook.js`) solo anotan el estado de cada sesión en `~/.claude/claude-companion/sesiones/`. No mandan nada a ningún lado.
- **Para la lista de tareas y los mensajes**, la app **lee** (nunca escribe) el historial de cada sesión en `~/.claude/projects/`.
- **Las pláticas con los Clawds** usan **tu** Claude Code (`claude -p`), así que cuentan para tu uso de Claude.
  - Pueden leer archivos y buscar en la web.
  - Pueden **crear archivos nuevos** solo en `Documentos\Claude Companion`. Los PDF e imágenes se arman en una ventana oculta sin JavaScript.
  - No editan archivos que ya existen ni ejecutan comandos (salvo lo que hagan las extensiones que tú les prendas).
- **Un vigilante muy pequeño** (`watcher/watcher.cs` → `bin/clawd.exe`) avisa cuando Claude Desktop se abre o se cierra.
- **Tus datos** (nombres, colores, lugares, pláticas y animaciones) se quedan en `~/.claude/claude-companion/`.

## Desinstalar

Desinstálalo desde **Configuración → Aplicaciones**. El desinstalador quita los hooks de `settings.json` y el inicio con Windows.

También puedes desconectar los hooks sin desinstalar: ícono de la bandeja → **Conectado a Claude Code**.

Si quieres borrar también tus datos, elimina `~/.claude/claude-companion/`.

## Sobre el arte de Clawd

Las animaciones de Clawd son de Anthropic y **no vienen en este repositorio**. Cada instalación las prepara en tu propia compu: las baja de claude.ai y saca la de la laptop de tu Claude Desktop. El código de este proyecto es MIT; el arte de Clawd no.

## Licencia

[MIT](LICENSE) (solo el código de este repositorio).

---

## English summary

**Claude Companion** is an unofficial, fan-made Windows desktop companion: one pixel Clawd per Claude Code session.

- Each Clawd shows what its session is doing: task list, current action, interim messages, and permission requests.
- Its size follows the model.
- You can chat with each Clawd in comic bubbles, with recent session context. The original session is never modified.
- Clawds can create new files (txt, Markdown, HTML, PDF, PNG) in `Documents\Claude Companion`, and delegate work to temporary helper Clawds (Haiku, Sonnet or Opus).
- It has desktop, group and taskbar modes, plus occasional social interactions between Clawds.

Install it from Releases. On first run it downloads the Clawd animations from claude.ai and your local Claude Desktop (they are Anthropic's art and are not redistributed here), and asks before adding hooks to `~/.claude/settings.json`. Uninstalling removes the hooks. Not affiliated with Anthropic.
