#!/usr/bin/env node
// /token-saver:stats — deterministic report of blocked calls (reads ~/.claude/token-saver.log[.old]). No model needed.
const fs = require("fs");
const os = require("os");
const path = require("path");

const MEAN = {
  "pm2-logs": "pm2 logs sin --nostream: stream infinito", "journalctl-follow": "journalctl -f: stream infinito",
  "journalctl-unbounded": "journalctl sin limite: volcado del journal entero", "docker-follow": "docker logs -f: stream infinito",
  "docker-unbounded": "docker logs sin --tail", "tail-follow": "tail -f: stream infinito", interactive: "programa interactivo que cuelga la shell",
  "grep-root": "grep -r sobre la raiz (recorre node_modules/.git)", "find-root": "find desde la raiz (recorre node_modules/.git)",
  tree: "tree sin limite", "ls-recursive": "ls -R", "cat-noise": "cat de lockfile/generado/vendored", "cat-big": "cat de un archivo enorme",
  "git-log-patch": "git log -p/--stat sin limite", "read-noise": "Read de node_modules/dist/lockfile/min", "dup-read": "releer el mismo archivo/rango sin cambios",
};
const base = path.join(os.homedir(), ".claude");
const rows = [];
for (const f of ["token-saver.log.old", "token-saver.log"]) {
  try { for (const ln of fs.readFileSync(path.join(base, f), "utf8").split("\n")) { try { const o = JSON.parse(ln); if (o && o.rule) rows.push(o); } catch {} } } catch {}
}
if (!rows.length) { console.log("Sin bloqueos registrados todavia."); process.exit(0); }
const week = Date.now() - 7 * 86400000;
const by = {};
let wk = 0;
for (const r of rows) { by[r.rule] = (by[r.rule] || 0) + 1; if (Date.parse(r.t) >= week) wk++; }
const top = Object.entries(by).sort((a, b) => b[1] - a[1]);
console.log(`Bloqueos: ${rows.length} en total, ${wk} en los ultimos 7 dias.`);
for (const [r, n] of top) console.log(`  ${String(n).padStart(5)}  ${r}${MEAN[r] ? "  — " + MEAN[r] : ""}`);
