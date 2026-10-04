#!/usr/bin/env node
// /token-saver:clean — read-only report of what Claude Code stores on disk (transcripts, caches, token-saver data).
// Never deletes anything. Works on Windows/macOS/Linux (no `du` needed).
const fs = require("fs");
const os = require("os");
const path = require("path");

const base = path.join(os.homedir(), ".claude");
const DAY = 86400000;
const size = (p) => {
  let t = 0;
  try {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) for (const f of fs.readdirSync(p)) t += size(path.join(p, f));
    else t = st.size;
  } catch {}
  return t;
};
const fmt = (b) => (b >= 1 << 30 ? (b / (1 << 30)).toFixed(1) + " GB" : b >= 1 << 20 ? (b / (1 << 20)).toFixed(1) + " MB" : Math.round(b / 1024) + " KB");

const items = ["projects", "file-history", "todos", "shell-snapshots", "statsig", "plugins", "token-saver", "token-saver.log", "token-saver.log.old"]
  .map((n) => [n, size(path.join(base, n))])
  .filter(([, s]) => s > 0)
  .sort((a, b) => b[1] - a[1]);
const total = items.reduce((a, [, s]) => a + s, 0);

console.log(`Espacio en ${base}: Total ${fmt(total)}`);
for (const [n, s] of items) console.log(`  ${fmt(s).padStart(9)}  ${n}`);

// transcripts (projects/<proj>/*.jsonl)
const tr = [];
try {
  const pr = path.join(base, "projects");
  for (const d of fs.readdirSync(pr)) {
    let files = [];
    try { files = fs.readdirSync(path.join(pr, d)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      try { const st = fs.statSync(path.join(pr, d, f)); tr.push({ d, f, s: st.size, age: Math.floor((Date.now() - st.mtimeMs) / DAY) }); } catch {}
    }
  }
} catch {}
if (tr.length) {
  const old = tr.filter((x) => x.age > 30);
  console.log(`\nTranscripciones: ${tr.length} (${fmt(tr.reduce((a, x) => a + x.s, 0))}); mas de 30 dias: ${old.length} (${fmt(old.reduce((a, x) => a + x.s, 0))})`);
  console.log("Las 5 mas grandes:");
  for (const x of tr.sort((a, b) => b.s - a.s).slice(0, 5)) console.log(`  ${fmt(x.s).padStart(9)}  ${x.age}d  ${x.d}/${x.f.slice(0, 8)}…`);
}
console.log('\nPara que Claude Code borre solo las antiguas: "cleanupPeriodDays": 14 en ~/.claude/settings.json (por defecto 30).');
