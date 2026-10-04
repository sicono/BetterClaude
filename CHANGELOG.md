# Changelog

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
