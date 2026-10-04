# BetterClaude

![version](https://img.shields.io/badge/version-2.4.0-blue)

Plugin para Claude Code que reduce el consumo de tokens sin cambiar lo que Claude puede hacer. Funciona solo, con hooks: una vez instalado no hace falta ejecutar nada.

El historial de versiones está en [CHANGELOG.md](CHANGELOG.md).

Es independiente del modelo (los hooks los ejecuta Claude Code, no el modelo) y necesita Node.js 16 o superior.

## Qué hace

| Función | Cuándo actúa | Efecto |
|---|---|---|
| Guardas de Bash y Read | Cada llamada | Bloquea lo que no aporta información: `pm2 logs`, `tail -f`, `journalctl`, `docker logs` o `kubectl logs` sin límite, `adb logcat`, `ping` sin `-c`, `top`, `watch`, `find .`, `grep -r .`, `tree`, `ls -R` sobre la raíz, `cat` de lockfiles y de archivos binarios, `ls`/`find` sobre `node_modules` entero, `git log` sin límite, `npm ls` completo y lecturas completas de `node_modules`, `dist`, lockfiles, `*.min.*` y `*.map`. Claude recibe la alternativa acotada. Los comandos que no terminan se bloquean aunque vayan con `\| head` o `\| grep`; se permiten con `timeout N`. |
| `cat` de archivos enormes | Cada Bash | Bloquea `cat`, `bat` o `type` sobre archivos de más de 300 KB. No actúa con `\| head`, redirecciones ni archivos que no existen. |
| Anti re-lectura | Cada Read | Bloquea releer un rango que ya está en el contexto: el mismo, o uno contenido en una lectura anterior (por ejemplo, las líneas 10-30 tras leer el archivo entero), si el archivo no cambió y fue en las últimas 10 llamadas. Una lectura sin `limit` de un archivo de más de 80 KB no se registra, porque pudo fallar por tamaño. Se reinicia tras `/compact`, `/clear` o al reanudar. |
| Anti re-lectura de imágenes | Cada Read de `.png/.jpg/.gif/.webp` | Bloquea (una vez) volver a abrir una imagen que ya está en el contexto y no ha cambiado (misma ruta, fecha y tamaño), dentro de las últimas 25 llamadas (`imgWindow`). Una captura o render regenerado tiene otra fecha y pasa. Si repites la lectura, pasa. Se reinicia tras `/compact`, `/clear` o al reanudar. |
| Blender sin `-b` | Cada Bash | Bloquea `blender archivo.blend` sin `-b`/`--background`: abre la interfaz y cuelga la shell. Pasa con `-b`, `--version`, `--help`, con `timeout N` o con `# ts-allow`. |
| Binarios 3D y de assets | Cada Read y `cat` | Bloquea Read/`cat` de `.blend`, `.glb`, `.fbx`, `.exr`, `.hdr`, `.psd`, zip y similares (solo devuelven bytes ilegibles) y sugiere un script headless que imprima lo necesario. |
| Capturas de Blender repetidas | Cada llamada al MCP de Blender | Bloquea (una vez) `get_viewport_screenshot` con los mismos argumentos si desde la última captura no ha habido ninguna llamada que cambie la escena (`execute_blender_code`, importaciones...). Los `get_*`/`list_*` no cuentan como cambio. Funciona con cualquier servidor MCP cuyo nombre contenga `blender`. |
| Salida de `blender` por terminal | Tras `blender ...` | Colapsa los avisos de progreso del render (`Fra:1 Mem:... Sample 12/128`) a la última línea de cada tanda; mantiene `Warning:`, `Error:`, `Saved:`, cabecera y trazas. Si aun así pasa de 12 KB, recorta como el resto de builds y guarda la salida completa. |
| Reducir imágenes (opcional, apagado) | Cada Read de imagen | Con `imgMaxEdge` > 0, las imágenes con el lado largo mayor se sustituyen por una copia reducida (mantiene proporción y orientación EXIF; el original no se toca; si pides el original, pasa). Usa `magick`, `convert`, `sips` o Python+Pillow, lo que haya; si no hay ninguno, no hace nada. **Esto sí pierde detalle**, por eso viene apagado. |
| Recorte de salida ruidosa | Tras cada Bash | Si `npm install/build/test`, `pip install`, `docker build`, `pytest`, `make`, `git clone`, `terraform`, `poetry`, `next build` y similares imprimen más de 12 KB, Claude ve el principio, el final y las líneas de error y warning del medio. La salida completa se guarda en un archivo cuya ruta se le indica. Requiere Claude Code 2.1.236 o superior. |
| Diffs de lockfiles | Tras `git diff`, `show`, `log -p`, `stash show` | El diff de `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum`, `*.min.*`, `*.map` (y de tus rutas `extraNoisy`) se sustituye por una línea con las líneas añadidas y quitadas. El diff del resto de archivos queda intacto, y la salida completa se guarda en un archivo. Solo actúa si el diff de ese archivo pasa de 1,5 KB. |
| Limpieza sin pérdida | Tras cada Bash ruidoso | Antes de recortar, quita colores ANSI, barras de progreso (`\r`) y colapsa 3 o más líneas idénticas seguidas en una con su contador. Actúa aunque la salida no llegue a 12 KB, si ahorra al menos 1 KB. No elimina contenido. |
| Handoff automático | Al cerrar y abrir sesión | Extrae del transcript (sin modelo) la primera petición, las últimas, el último mensaje de Claude y los archivos editados, con un tope de 2000 caracteres (`handoffMaxChars`). Se guarda en `~/.claude/better-claude/handoffs` y se inyecta una sola vez en `startup` y `clear`. Caduca a las 24 h. |
| Aviso de sesión larga | Al enviar un prompt | Mensaje solo para el usuario (no gasta tokens) cuando el transcript supera ~1,5 MB: `/clear` si cambias de tarea, `/compact` si sigues con la misma. |
| Aviso al reanudar | Al reanudar | Si la sesión tiene más de 60k tokens y la caché del prompt caducó, avisa del coste de reenviarla. Requiere Claude Code 2.1.251 o superior. |
| Comandos sin coste fijo | Siempre | Los seis comandos llevan `disable-model-invocation: true`: solo los lanzas tú, así que su descripción no se carga en el contexto de cada sesión. |
| Limpieza propia | Al abrir sesión | Borra handoffs usados (más de 7 días) y caducados (más de 30). |

Los archivos de código se leen siempre enteros.

## Instalación

Terminal:

```
claude plugin marketplace add sicono/BetterClaude
claude plugin install better-claude@betterclaude
```

App de escritorio: Plugins > Agregar > marketplace > `sicono/BetterClaude`, y después instalar `better-claude`.

Para probarlo en local sin instalar: `claude --plugin-dir ./plugins/better-claude`.

Después de instalar hay que reiniciar Claude Code. Para comprobar que los hooks están activos, escribe `/hooks` o ejecuta `node plugins/better-claude/hooks/selftest.js`.

## Comandos

Son opcionales.

| Comando | Descripción |
|---|---|
| `/better-claude:audit` | Mide lo que se carga en cada sesión: CLAUDE.md con sus `@imports` (y avisa si pasa de 200 líneas), `.claude/rules` sin `paths`, memoria automática, descripciones de skills, agentes y comandos (propios y de cada plugin activo, por separado), y servidores MCP. |
| `/better-claude:stats` | Bloqueos por regla, texto recortado de las salidas y texto evitado en relecturas y `cat` enormes (`~/.claude/better-claude.log`). |
| `/better-claude:clean` | Espacio que ocupa `~/.claude` (transcripciones, cachés). Solo informa, no borra. |
| `/better-claude:doctor` | Autotest. |
| `/better-claude:handoff` | Handoff manual redactado por Claude. Tiene prioridad sobre el automático. |
| `/better-claude:slim-claudemd` | Propone un `CLAUDE.slim.md`. Nunca modifica el `CLAUDE.md`. |

## Configuración

Archivo `~/.claude/better-claude.json` (global) y/o `.claude/better-claude.json` (proyecto):

```json
{
  "disable": ["tree", "dup-read"],
  "allowCommands": ["^pm2 logs blockhost"],
  "extraNoisy": ["/generated/"],
  "autoHandoff": true,
  "warnTranscriptKB": 1500,
  "catBigKB": 300,
  "trimBashKB": 12,
  "trimCommands": ["^terraform "],
  "resumeWarnTokens": 60000,
  "dupWindow": 10,
  "handoffMaxChars": 2000,
  "imgWindow": 25,
  "imgMaxEdge": 0
}
```

Reglas que se pueden desactivar con `disable`: `interactive`, `pm2-logs`, `journalctl-follow`, `journalctl-unbounded`, `docker-follow`, `docker-unbounded`, `kubectl-follow`, `kubectl-unbounded`, `tail-follow`, `ping`, `logcat`, `grep-root`, `find-root`, `tree`, `ls-recursive`, `cat-noise`, `cat-big`, `git-log-patch`, `git-log-unbounded`, `npm-ls`, `cat-binary`, `ls-noise`, `read-noise`, `dup-read`, `dup-image`, `img-fit`, `blender-shot`, `blender-gui`, `read-binary`, `diff-omit`, `bash-trim` (también desactiva la limpieza sin pérdida).

`dupWindow` son las llamadas durante las que una lectura cuenta como "aún en contexto" (máximo 50). Súbelo en sesiones cortas con mucho contexto; bájalo si notas que Claude pierde el hilo de lo leído.

`imgWindow` son las llamadas durante las que una imagen cuenta como "aún en contexto" (máximo 100). `imgMaxEdge` es el lado largo máximo en píxeles (0 = apagado); también se puede probar con `BETTER_CLAUDE_IMG_MAX_EDGE=1000`.

Atajos:

- `BETTER_CLAUDE_OFF=1` apaga todos los hooks.
- `# ts-allow` al final de un comando Bash lo deja pasar una vez.
- `# ts-full` al final de un comando Bash evita que se recorte su salida.

## Notas

- Si un modelo repite tres veces la misma llamada bloqueada por una regla de límites (no las que cuelgan la shell), la tercera pasa. Así no se queda atrapado en reintentos.
- Las descripciones de los comandos solo dejan de cargarse en versiones de Claude Code que respetan `disable-model-invocation` también para el listado de contexto. Compruébalo con `/context`.
- El recorte de salida solo actúa sobre comandos de build, instalación y tests, y guarda siempre la salida completa. No toca `cat`, `grep` ni la lectura de código. De `git diff` solo se omite el diff de archivos generados, nunca el de código.
- **Cómo cuestan las imágenes:** unos `ancho × alto / 750` tokens, y la API reduce el lado largo a 1568 px *antes* de contar. Una imagen de 4000×3000 cuesta lo mismo que una de 1568×1176, así que reescalar por encima de 1568 no ahorra tokens (solo bytes). Lo que ahorra sin perder calidad es no enviar la misma imagen dos veces, no pedir capturas que no han cambiado y, en Blender, preguntar por números con un `execute_blender_code` que los imprima cuando no hace falta ver nada. Bajar de 1568 px (`imgMaxEdge`) sí recorta tokens, pero pierde detalle.
- La copia reducida se guarda en la carpeta temporal de la sesión; si Claude Code pide permiso para leerla, es porque está fuera del proyecto.
- No cambia el modelo, el razonamiento ni el estilo, y no delega en modelos más baratos.

## Estructura

```
.claude-plugin/marketplace.json
plugins/better-claude/
  .claude-plugin/plugin.json
  commands/
  hooks/
```
