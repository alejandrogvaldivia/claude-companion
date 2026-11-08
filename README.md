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
git clone https://github.com/alesito-gv/claude-companion
cd claude-companion
npm install        # también compila el vigilante (bin/clawd.exe) con el compilador de C# de Windows
npm start
```

Para generar el instalador: `npm run dist`. Queda en `dist/`.

## Cómo funciona (y privacidad)

- **Los hooks** (`hook/hook.js`) solo anotan el estado de cada sesión en `~/.claude/claude-companion/sesiones/`. No mandan nada a ningún lado.
- **Para la lista de tareas y los mensajes**, la app **lee** (nunca escribe) el historial de cada sesión en `~/.claude/projects/`.
- **Las pláticas con los Clawds** usan **tu** Claude Code (`claude -p`), así que cuentan para tu uso de Claude. Solo pueden leer archivos y buscar en la web: no editan ni ejecutan nada.
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
- It has desktop, group and taskbar modes, plus occasional social interactions between Clawds.

Install it from Releases. On first run it downloads the Clawd animations from claude.ai and your local Claude Desktop (they are Anthropic's art and are not redistributed here), and asks before adding hooks to `~/.claude/settings.json`. Uninstalling removes the hooks. Not affiliated with Anthropic.
