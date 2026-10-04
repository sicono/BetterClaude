#!/usr/bin/env node
// /better-claude:stats — deterministic report of blocked calls and trimmed outputs (reads ~/.claude/better-claude.log[.old]). No model needed.
const fs = require("fs");
const os = require("os");
const path = require("path");

const MEAN = {
  "pm2-logs": "pm2 logs sin --nostream: stream infinito", "journalctl-follow": "journalctl -f: stream infinito",
  "journalctl-unbounded": "journalctl sin limite: volcado del journal entero", "docker-follow": "docker logs -f: stream infinito",
  "docker-unbounded": "docker logs sin --tail", "tail-follow": "tail -f: stream infinito", interactive: "programa interactivo que cuelga la shell",
  "grep-root": "grep -r sobre la raiz (recorre node_modules/.git)", "find-root": "find desde la raiz (recorre node_modules/.git)",
  tree: "tree sin limite", "ls-recursive": "ls -R", "cat-noise": "cat de lockfile/generado/vendored", "cat-big": "cat de un archivo enorme",
  "git-log-patch": "git log -p/--stat sin limite", "git-log-unbounded": "git log sin limite (historial entero)", "npm-ls": "arbol de dependencias completo", "cat-binary": "cat de un archivo binario", "ls-noise": "ls/find sobre node_modules entero", "kubectl-follow": "kubectl logs -f: stream infinito", "kubectl-unbounded": "kubectl logs sin --tail", ping: "ping sin -c (no termina)", logcat: "adb logcat sin limite", "read-noise": "Read de node_modules/dist/lockfile/min", "dup-read": "releer el mismo archivo/rango sin cambios",
  "dup-image": "releer una imagen que ya esta en contexto y no cambio", "img-fit": "imagen reducida a imgMaxEdge antes de enviarla", "blender-shot": "captura de Blender repetida sin cambios en la escena",
};
const base = path.join(os.homedir(), ".claude");
const rows = [];
for (const f of ["better-claude.log.old", "better-claude.log"]) {
  try { for (const ln of fs.readFileSync(path.join(base, f), "utf8").split("\n")) { try { const o = JSON.parse(ln); if (o && o.rule) rows.push(o); } catch {} } } catch {}
}
if (!rows.length) { console.log("Sin actividad registrada todavia."); process.exit(0); }

const week = Date.now() - 7 * 86400000;
const inWeek = (r) => Date.parse(r.t) >= week;
const isTrim = (r) => r.rule === "bash-trim" || r.rule === "bash-squeeze" || r.rule === "diff-omit";
const trims = rows.filter(isTrim);
const blocks = rows.filter((r) => !isTrim(r));

console.log(`Bloqueos: ${blocks.length} en total, ${blocks.filter(inWeek).length} en los ultimos 7 dias.`);
const by = {};
for (const r of blocks) by[r.rule] = (by[r.rule] || 0) + 1;
for (const [r, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${r}${MEAN[r] ? "  — " + MEAN[r] : ""}`);

if (trims.length) {
  const saved = (list) => list.reduce((a, r) => a + Math.max(0, (Number(r.before) || 0) - (Number(r.after) || 0)), 0);
  const fmt = (c) => `${Math.round(c / 1024)} KB de texto (~${Math.round(c / 4000)}k tokens, aprox.)`;
  const wk = trims.filter(inWeek);
  console.log(`\nRecortes de salida: ${trims.length} en total (${wk.length} en 7 dias).`);
  console.log(`  Enviado de menos a Claude: ${fmt(saved(trims))}; ultimos 7 dias: ${fmt(saved(wk))}.`);
  const df = trims.filter((r) => r.rule === "diff-omit").length;
  if (df) console.log(`  ${df} eran diffs de lockfiles/minificados/.map dentro de git diff/show/log -p (el resto del diff se mantuvo).`);
  const sq = trims.filter((r) => r.rule === "bash-squeeze").length;
  if (sq) console.log(`  De ellos, ${sq} solo limpiaron colores ANSI, barras de progreso y lineas repetidas (sin recortar contenido).`);
}

// Texto que se habria reenviado: dup-read es casi exacto; cat-big es una cota superior (Claude suele hacer luego un grep acotado).
const avoided = (rule) => blocks.filter((r) => r.rule === rule).reduce((a, r) => a + (Number(r.bytes) || 0), 0);
const dup = avoided("dup-read"), cb = avoided("cat-big");
// Imagenes: tokens estimados con la formula de la doc (ancho*alto/750, tope 1568 px en el lado largo). Aproximado.
const imgTok = (rule) => blocks.filter((r) => r.rule === rule).reduce((a, r) => a + (Number(r.tokens) || 0), 0);
const iDup = imgTok("dup-image"), iFit = imgTok("img-fit"), iBl = imgTok("blender-shot");
if (dup || cb || iDup || iFit || iBl) {
  console.log("\nTexto evitado por bloqueos (aprox., bytes / 4):");
  if (dup) console.log(`  ~${Math.round(dup / 4000)}k tokens en relecturas de archivos ya en contexto.`);
  if (cb) console.log(`  hasta ~${Math.round(cb / 4000)}k tokens en cat de archivos enormes (cota superior).`);
  if (iDup) console.log(`  ~${iDup} tokens en imagenes releidas sin cambios.`);
  if (iBl) console.log(`  ~${iBl} tokens en capturas de Blender repetidas sin cambios en la escena (aprox., asume 16:9).`);
  if (iFit) console.log(`  ~${iFit} tokens por reducir imagenes a imgMaxEdge (esto SI pierde detalle: es opcional).`);
}
