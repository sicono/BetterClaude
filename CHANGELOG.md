# Changelog

## 2.4.1 - 2026-10-04
- `blender-gui` ya no salta cuando `blender` solo aparece como texto: el comando se parte en tramos por `;`, `&`, `|`, `(` y saltos de línea **fuera de comillas**, y solo cuenta el programa que ejecuta cada tramo (tras `VAR=…`, `sudo`, `env`, `timeout N`, `xvfb-run`…). Antes, `tasklist | grep -iE "UnrealEditor|blender"` se bloqueaba: el `|` del patrón de grep se tomaba por una tubería (y lo mismo un mensaje de commit o un `echo` que nombraran blender tras un `;` o un `|`).
- El `-b`/`--background` se busca en los argumentos del propio Blender, no en toda la línea: con un `-b` de otro programa en la misma línea ya no pasa.
- La limpieza de salida de Blender (`post.js`) usa la misma detección (`blenderRuns` en `lib.js`).
- El autotest pasa de 184 a 195 comprobaciones.

## 2.4.0 - 2026-10-04
- Regla `blender-gui`: bloquea `blender` sin `-b`/`--background` (abre la interfaz y cuelga la shell). Es una regla de las que no terminan: solo pasa con `timeout N` o `# ts-allow`.
- Regla `read-binary`: bloquea Read de `.blend`, `.glb`, `.fbx`, `.exr`, `.hdr`, `.psd`, `.usdc`, `.abc`, archivos comprimidos, ejecutables y bases de datos, aunque lleven `limit`. `cat-binary` cubre ahora también esas extensiones y `.bmp`/`.tiff`.
- `BLENDER_CMD` se comparte desde `lib.js` entre `guard.js` y `post.js`.

## 2.3.0 - 2026-10-04
- Imágenes: regla `dup-image`, que bloquea (una vez) releer una imagen sin cambios que ya está en el contexto. Antes las imágenes pasaban por el anti re-lectura de texto y no se controlaban bien. Nueva opción `imgWindow`.
- Blender (MCP): regla `blender-shot`, que bloquea (una vez) repetir la misma captura del viewport si la escena no ha cambiado desde la anterior. El matcher de `PreToolUse` ahora incluye `mcp__*blender*`.
- Blender (terminal): `blender ...` entra en la limpieza de salida; los avisos de progreso del render se colapsan a la última línea de cada tanda y se conservan avisos, errores y `Saved:`. El patrón va anclado al inicio del comando: `grep blender x` no se toca.
- Opcional y apagado: `imgMaxEdge` reduce imágenes grandes antes de enviarlas (regla `img-fit`). Pierde detalle, así que no actúa por defecto. Nuevo `img.js` (dimensiones sin dependencias para PNG, JPEG, GIF y WebP; reescalado con `magick`, `convert`, `sips` o Python+Pillow).
- `session.js` limpia también las copias reducidas (subcarpeta `img`).
- `/better-claude:stats` cuenta tokens de imagen evitados (aproximado).
- El autotest pasa de 139 a 170 comprobaciones.

## 2.2.0 - 2026-10-04
- Omisión de diffs de archivos generados en `git diff`, `git show`, `git log -p` y `git stash show`: lockfiles, `*.min.*` y `*.map` (más tus `extraNoisy`) se reducen a una línea con el recuento de líneas. El diff de código no se toca, el texto posterior (por ejemplo la cabecera del siguiente commit) se conserva y la salida completa se guarda en un archivo. Con un `package-lock.json` real, 66 KB pasaron a 342 caracteres. Regla `diff-omit`.
- Reglas nuevas: `cat-binary` (cat de zip, db, imágenes, pdf, etc.) y `ls-noise` (`ls`/`find` sobre `node_modules` entero).
- `/better-claude:audit` avisa si CLAUDE.md pasa de 200 líneas. `/better-claude:stats` cuenta los diffs omitidos.
- El autotest pasa de 122 a 139 comprobaciones.

## 2.1.0 - 2026-10-04
- Los seis comandos llevan `disable-model-invocation: true` y descripciones más cortas: son solo para el usuario, así que ya no ocupan contexto en cada sesión.
- Anti re-lectura por rangos: también bloquea leer un rango contenido en una lectura anterior (ej. las líneas 10-30 tras leer el archivo entero). Las lecturas sin `limit` de archivos de más de 80 KB no se registran, porque pudieron fallar por tamaño. Nueva opción `dupWindow`.
- Los comandos que no terminan (`tail -f`, `pm2 logs`, `docker logs -f`...) ya no se libran por ir con `| head` o `| grep`. Se permiten con `timeout N`.
- Reglas nuevas: `kubectl logs` (con y sin `-f`), `adb logcat`, `ping` sin `-c`, `git log` sin límite y `npm/pnpm/yarn ls` completo.
- Limpieza sin pérdida de la salida de comandos ruidosos: quita colores ANSI y barras de progreso y colapsa líneas idénticas repetidas, incluso por debajo de 12 KB. Más comandos reconocidos (terraform, poetry, uv, next/vite build, cmake, cypress, rspec...).
- Handoff automático más compacto (tope `handoffMaxChars`, 2000 por defecto) y con lo más útil primero. Corrige que se descartaran peticiones del usuario que empezaban por `<`.
- `/better-claude:audit` mide también `@imports` de CLAUDE.md, `.claude/rules`, memoria automática y las descripciones de cada plugin activo, y no cuenta los comandos y skills con `disable-model-invocation`.
- `/better-claude:stats` muestra el texto evitado en relecturas y `cat` enormes, y separa las limpiezas sin recorte.
- El autotest pasa de 81 a 122 comprobaciones.

## 2.0.0 - 2026-10-04
- El plugin pasa a llamarse **BetterClaude** (`better-claude`), antes `token-saver`.
- Cambios que rompen compatibilidad: los comandos son ahora `/better-claude:...`, la configuración es `~/.claude/better-claude.json` y `.claude/better-claude.json`, el log es `~/.claude/better-claude.log`, los datos están en `~/.claude/better-claude/` y las variables de entorno empiezan por `BETTER_CLAUDE_` (por ejemplo `BETTER_CLAUDE_OFF=1`).
- El marketplace se llama `betterclaude`: `claude plugin install better-claude@betterclaude`.

## 1.6.1 - 2026-10-04
- `/better-claude:stats` ahora mide el texto que se ha dejado de enviar con los recortes de salida.

## 1.6.0 - 2026-10-04
- Recorte de la salida de comandos ruidosos (instalaciones, builds, tests), guardando la salida completa en un archivo. Requiere Claude Code 2.1.236 o superior.
- Aviso al reanudar una sesión grande con la caché del prompt caducada. Requiere Claude Code 2.1.251 o superior.
- La salida de los hooks se escribe de forma síncrona (evita cortes en Windows).

## 1.5.1 - 2026-10-04
- Válvula anti-bucle: la tercera repetición idéntica de una llamada bloqueada por una regla de límites pasa.
- `audit`, `stats`, `clean` y `doctor` son scripts: misma salida con cualquier modelo y menos tokens.

## 1.5.0 - 2026-10-04
- Regla `cat-big` para `cat` de archivos de más de 300 KB.
- Comando `clean` con el espacio que ocupa `~/.claude`.
- Limpieza automática de handoffs antiguos.
- El aviso de sesión larga distingue entre `/clear` y `/compact`.

## 1.4.1 - 2026-10-04
- Solo cambia el número de versión, para que Claude Code no reutilice la caché de una versión anterior.

## 1.4.0
- Guardas de Bash y Read, anti re-lectura, handoff automático y aviso de sesión larga mediante hooks. Los comandos pasan a ser opcionales.
