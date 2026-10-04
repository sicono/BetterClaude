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
  "git-log-patch": "git log -p/--stat sin limite", "read-noise": "Read de node_modules/dist/lockfile/min", "dup-read": "releer el mismo archivo/rango sin cambios",
};
const base = path.join(os.homedir(), ".claude");
const rows = [];
for (const f of ["better-claude.log.old", "better-claude.log"]) {
  try { for (const ln of fs.readFileSync(path.join(base, f), "utf8").split("\n")) { try { const o = JSON.parse(ln); if (o && o.rule) rows.push(o); } catch {} } } catch {}
}
if (!rows.length) { console.log("Sin actividad registrada todavia."); process.exit(0); }

const week = Date.now() - 7 * 86400000;
const inWeek = (r) => Date.parse(r.t) >= week;
const trims = rows.filter((r) => r.rule === "bash-trim");
const blocks = rows.filter((r) => r.rule !== "bash-trim");

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
}
