# token-saver 1.5.1 (autonomo, calidad primero)

Instalalo y ya: todo funciona solo mediante hooks. Los comandos son opcionales.

## Automatico
| Que | Cuando | Efecto |
|---|---|---|
| **Guardas de Bash/Read** | cada llamada | Bloquea lo que no aporta informacion: `pm2 logs`/`tail -f`/`journalctl`/`docker logs` sin limite, `top`/`watch`/`less`, `find .`/`grep -r .`/`tree`/`ls -R` sobre la raiz, `cat` de lockfiles, `git log -p` sin limite, Read completo de `node_modules`/`dist`/lockfiles/`.min.*`/`.map`. Claude recibe la alternativa acotada. |
| **Cat de archivos enormes** | cada Bash | Bloquea `cat`/`bat`/`type` de un archivo de mas de 300 KB (se vuelca entero al contexto). Claude recibe `grep -n`, `Read` con rango o `head`/`tail`. Con `| head`, redirecciones o archivos que no existen no actua. |
| **Anti re-lectura** | cada Read | Bloquea releer el MISMO archivo y rango, sin cambios, en las ultimas 10 llamadas (su contenido sigue en contexto). Se reinicia tras `/compact`, `/clear` o reanudar. |
| **Handoff automatico** | al cerrar sesion → al abrir/`/clear` | Extrae del transcript (sin modelo, sin inventar): primera peticion, ultimas peticiones, archivos editados, ultimo mensaje de Claude. Se guarda fuera del proyecto (`~/.claude/token-saver/handoffs`), se inyecta UNA vez en `startup`/`clear` (caduca a 24 h) y avisa de que puede no ser relevante. |
| **Limpieza propia** | al abrir sesion | Borra handoffs ya usados (>7 dias) y caducados (>30 dias) de `~/.claude/token-saver/handoffs`. |
| **Aviso de sesion larga** | al enviar un prompt | Mensaje solo para ti (coste 0 en tokens) sugiriendo `/clear` (tarea nueva) o `/compact` (misma tarea) cuando el transcript supera ~1.5 MB (aproximado). |

Tu codigo fuente se lee siempre entero, sin limites de tamaño.

## Con cualquier modelo
Los hooks los ejecuta Claude Code, no el modelo: funcionan igual con Opus, Sonnet, Haiku o cualquier otro. Overhead medido: ~8 ms por llamada sobre el arranque de Node. `audit`, `stats`, `clean` y `doctor` son scripts: dan la misma salida con cualquier modelo y gastan menos tokens. Solo `handoff` y `slim-claudemd` los redacta el modelo (no hay otra forma).
**Anti-bucle**: si un modelo repite 3 veces la misma llamada bloqueada por una regla "blanda" (cat-big, dup-read, tree, grep-root...), la 3a pasa: no atrapa a modelos pequenos en reintentos. Las reglas que cuelgan la shell (pm2 logs, tail -f, interactivos...) nunca se relajan.

## Comandos (opcionales)
- `/token-saver:handoff`: handoff manual, mas rico (lo redacta Claude). Tiene prioridad sobre el automatico.
- `/token-saver:audit`: mide lo que se carga en cada sesion (CLAUDE.md, MCP, plugins).
- `/token-saver:slim-claudemd`: propone `CLAUDE.slim.md` (nunca toca tu `CLAUDE.md`). Es manual a proposito: edita reglas tuyas.
- `/token-saver:clean`: informe de espacio en disco de Claude Code (transcripciones, caches). Solo lee, no borra; te indica `cleanupPeriodDays`.
- `/token-saver:stats`: bloqueos por regla (`~/.claude/token-saver.log`).
- `/token-saver:doctor`: autotest.

## Config opcional
`~/.claude/token-saver.json` (global) y/o `.claude/token-saver.json` (proyecto):
```json
{
  "disable": ["tree", "dup-read"],
  "allowCommands": ["^pm2 logs blockhost"],
  "extraNoisy": ["/generated/"],
  "autoHandoff": true,
  "warnTranscriptKB": 1500,
  "catBigKB": 300
}
```
Reglas: `interactive, pm2-logs, journalctl-follow, journalctl-unbounded, docker-follow, docker-unbounded, tail-follow, grep-root, find-root, tree, ls-recursive, cat-noise, cat-big, git-log-patch, read-noise, dup-read`.

## Que NO hace (a proposito)
No puede recortar la salida de un comando que ya se ejecuto (Claude Code no lo permite en herramientas nativas): solo evita las llamadas inutiles. Ni limita lectura de codigo (el Read nunca se corta; `cat-big` solo mira `cat` por Bash), ni cambia modelo/razonamiento/estilo, ni delega a modelos mas baratos, ni reescribe comandos o salidas.

## Instalar
Sube esta carpeta a un repo de GitHub (raiz = este README):
- App de escritorio: Plugins > Agregar > marketplace > `TU_USUARIO/token-saver`, instala `token-saver`.
- Terminal:
  ```
  claude plugin marketplace add TU_USUARIO/token-saver
  claude plugin install token-saver@token-saver-marketplace
  ```
- Prueba local: `claude --plugin-dir ./plugins/token-saver`

Requiere Node.js 16+ en PATH. Comprueba con `node plugins/token-saver/hooks/selftest.js` (y `/hooks` dentro de Claude Code).

## Ajustes rapidos
`TOKEN_SAVER_OFF=1` apaga todos los hooks · `# ts-allow` al final de un comando Bash lo deja pasar una vez.
