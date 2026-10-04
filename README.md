# BetterClaude

Plugin para Claude Code que reduce el consumo de tokens sin cambiar lo que Claude puede hacer. Funciona solo, con hooks: una vez instalado no hace falta ejecutar nada.

Es independiente del modelo (los hooks los ejecuta Claude Code, no el modelo) y necesita Node.js 16 o superior.

## Qué hace

| Función | Cuándo actúa | Efecto |
|---|---|---|
| Guardas de Bash y Read | Cada llamada | Bloquea lo que no aporta información: `pm2 logs`, `tail -f`, `journalctl` o `docker logs` sin límite, `top`, `watch`, `find .`, `grep -r .`, `tree`, `ls -R` sobre la raíz, `cat` de lockfiles, `git log -p` sin límite y lecturas completas de `node_modules`, `dist`, lockfiles, `*.min.*` y `*.map`. Claude recibe la alternativa acotada. |
| `cat` de archivos enormes | Cada Bash | Bloquea `cat`, `bat` o `type` sobre archivos de más de 300 KB. No actúa con `\| head`, redirecciones ni archivos que no existen. |
| Anti re-lectura | Cada Read | Bloquea releer el mismo archivo y rango, sin cambios, en las últimas 10 llamadas. Se reinicia tras `/compact`, `/clear` o al reanudar. |
| Recorte de salida ruidosa | Tras cada Bash | Si `npm install/build/test`, `pip install`, `docker build`, `pytest`, `make`, `git clone` y similares imprimen más de 12 KB, Claude ve el principio, el final y las líneas de error y warning del medio. La salida completa se guarda en un archivo cuya ruta se le indica. Requiere Claude Code 2.1.236 o superior. |
| Handoff automático | Al cerrar y abrir sesión | Extrae del transcript (sin modelo) la primera petición, las últimas, los archivos editados y el último mensaje de Claude. Se guarda en `~/.claude/token-saver/handoffs` y se inyecta una sola vez en `startup` y `clear`. Caduca a las 24 h. |
| Aviso de sesión larga | Al enviar un prompt | Mensaje solo para el usuario (no gasta tokens) cuando el transcript supera ~1,5 MB: `/clear` si cambias de tarea, `/compact` si sigues con la misma. |
| Aviso al reanudar | Al reanudar | Si la sesión tiene más de 60k tokens y la caché del prompt caducó, avisa del coste de reenviarla. Requiere Claude Code 2.1.251 o superior. |
| Limpieza propia | Al abrir sesión | Borra handoffs usados (más de 7 días) y caducados (más de 30). |

Los archivos de código se leen siempre enteros.

## Instalación

Terminal:

```
claude plugin marketplace add sicono/BetterClaude
claude plugin install token-saver@token-saver-marketplace
```

App de escritorio: Plugins > Agregar > marketplace > `sicono/BetterClaude`, y después instalar `token-saver`.

Para probarlo en local sin instalar: `claude --plugin-dir ./plugins/token-saver`.

Después de instalar hay que reiniciar Claude Code. Para comprobar que los hooks están activos, escribe `/hooks` o ejecuta `node plugins/token-saver/hooks/selftest.js`.

## Comandos

Son opcionales.

| Comando | Descripción |
|---|---|
| `/token-saver:audit` | Mide lo que se carga en cada sesión: CLAUDE.md, MCP, plugins, skills. |
| `/token-saver:stats` | Bloqueos por regla (`~/.claude/token-saver.log`). |
| `/token-saver:clean` | Espacio que ocupa `~/.claude` (transcripciones, cachés). Solo informa, no borra. |
| `/token-saver:doctor` | Autotest. |
| `/token-saver:handoff` | Handoff manual redactado por Claude. Tiene prioridad sobre el automático. |
| `/token-saver:slim-claudemd` | Propone un `CLAUDE.slim.md`. Nunca modifica el `CLAUDE.md`. |

## Configuración

Archivo `~/.claude/token-saver.json` (global) y/o `.claude/token-saver.json` (proyecto):

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
  "resumeWarnTokens": 60000
}
```

Reglas que se pueden desactivar con `disable`: `interactive`, `pm2-logs`, `journalctl-follow`, `journalctl-unbounded`, `docker-follow`, `docker-unbounded`, `tail-follow`, `grep-root`, `find-root`, `tree`, `ls-recursive`, `cat-noise`, `cat-big`, `git-log-patch`, `read-noise`, `dup-read`, `bash-trim`.

Atajos:

- `TOKEN_SAVER_OFF=1` apaga todos los hooks.
- `# ts-allow` al final de un comando Bash lo deja pasar una vez.
- `# ts-full` al final de un comando Bash evita que se recorte su salida.

## Notas

- Si un modelo repite tres veces la misma llamada bloqueada por una regla de límites (no las que cuelgan la shell), la tercera pasa. Así no se queda atrapado en reintentos.
- El recorte de salida solo actúa sobre comandos de build, instalación y tests, y guarda siempre la salida completa. No toca `cat`, `grep`, `git diff` ni la lectura de código.
- No cambia el modelo, el razonamiento ni el estilo, y no delega en modelos más baratos.

## Estructura

```
.claude-plugin/marketplace.json
plugins/token-saver/
  .claude-plugin/plugin.json
  commands/
  hooks/
```
