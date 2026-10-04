#!/usr/bin/env node
// token-saver 1.4 (quality-first). Blocks only calls that waste tokens WITHOUT giving Claude useful info:
//  - programs that hang or never end (interactive, follow/stream) or dump an entire log/journal
//  - root-wide find/grep/tree/ls -R that walk node_modules/.git
//  - cat of a huge file (> catBigKB, default 300 KB) into context
//  - reading vendored/generated files (node_modules, dist, lockfiles, *.min.*, *.map) in full
//  - re-reading the SAME unchanged file/range within the last 10 tool calls (its content is still in context)
// It never limits normal source-file reads. Exit code 2 = block; stderr goes to Claude.
// Disable all: TOKEN_SAVER_OFF=1 | one Bash call: "# ts-allow" | per-rule/project: .claude/token-saver.json
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadConfig, tmpDir, safeId, readStdin } = require("./lib.js");

if (process.env.TOKEN_SAVER_OFF === "1") process.exit(0);

const DUP_WINDOW = 10;
// Soft rules: if a model insists on the exact same call a 3rd time it clearly needs it, so let it through
// (never trap a weaker model in a retry loop that would waste more tokens than the call). Hang rules (follow/interactive/pm2) never relax.
const SOFT = new Set(["journalctl-unbounded", "docker-unbounded", "grep-root", "find-root", "tree", "ls-recursive", "cat-noise", "cat-big", "git-log-patch", "read-noise", "dup-read"]);
const MAX_BLOCKS = 2;
const BOUND = /\|\s*(head|tail|grep|egrep|rg|wc|sed|awk|cut|jq)\b/;
const DIRS = "node_modules|dist|build|\\.next|\\.nuxt|coverage|__pycache__";
const LOCK = "package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|composer\\.lock|Cargo\\.lock|poetry\\.lock";
const NOISY_PATH = new RegExp(`(^|/)(${DIRS}|\\.git)/|\\.min\\.(js|css)$|\\.map$|(^|/)(${LOCK})$`);
const NOISY_CMD = new RegExp(`(^|[/\\s"'])(${DIRS})/|\\.min\\.(js|css)(\\s|$|["'])|\\.map(\\s|$|["'])|(^|[/\\s"'])(${LOCK})(\\s|$|["'])`);

const BASH_RULES = [
  ["interactive", (c) => {
    if (/^\s*(?:sudo\s+)?top\b/.test(c) && /\s-[a-zA-Z]*b/.test(c)) return null;
    return /^\s*(?:sudo\s+)?(top|htop|btop|watch|nano|vim?|less|more)(\s|$)/.test(c) || /\bpm2\s+monit\b/.test(c)
      ? "Interactive/never-ending program hangs the shell tool. Use a non-interactive form (e.g. top -b -n 1, or Read)." : null;
  }],
  ["pm2-logs", (c) => /\bpm2\s+logs\b/.test(c) && !/--nostream/.test(c)
    ? "`pm2 logs` streams forever. Use: pm2 logs <app> --nostream --lines 200" : null],
  ["journalctl-follow", (c) => /\bjournalctl\b/.test(c) && /(\s-f\b|--follow)/.test(c)
    ? "journalctl -f never ends. Use: journalctl -u <service> -n 200 --no-pager" : null],
  ["journalctl-unbounded", (c) => /\bjournalctl\b/.test(c) && !/(\s-f\b|--follow)/.test(c) && !/(\s-n\s*\d+|\s-n\d+|--lines|--since|--until)/.test(c)
    ? "Unbounded journalctl dumps the whole journal. Use: journalctl -u <service> -n 200 --no-pager" : null],
  ["docker-follow", (c) => /\bdocker(\s+compose|-compose)?\s+logs\b/.test(c) && /(\s-f\b|--follow)/.test(c)
    ? "docker logs -f never ends. Use: docker logs --tail 200 <container>" : null],
  ["docker-unbounded", (c) => /\bdocker(\s+compose|-compose)?\s+logs\b/.test(c) && !/(\s-f\b|--follow)/.test(c) && !/(--tail|\s-n\s*\d+|--since)/.test(c)
    ? "Unbounded docker logs. Use: docker logs --tail 200 <container>" : null],
  ["tail-follow", (c) => /\btail\b[^|;&\n]*\s-(?:-follow|[a-zA-Z]*[fF][a-zA-Z]*)(?=\s|$)/.test(c)
    ? "tail -f never ends. Use: tail -n 200 <file>" : null],
  ["grep-root", (c) => /\bgrep\b[^|;&\n]*\s-[a-zA-Z]*[rR][a-zA-Z]*(\s|$)/.test(c) && /\s(\.\/?|\*)\s*$/.test(c) && !/--exclude-dir|--include/.test(c)
    ? "Recursive grep over the project root also scans node_modules/.git. Use the Grep tool, or add --exclude-dir={node_modules,.git,dist,build}" : null],
  ["find-root", (c) => /^\s*find\s+(\.\/?|\/)(\s|$)/.test(c) && !/-prune|-not\b|\s!\s|-path\b|-maxdepth|node_modules/.test(c)
    ? "find from the root walks node_modules/.git. Use the Glob tool, or add -maxdepth N / -not -path '*/node_modules/*'" : null],
  ["tree", (c) => /^\s*tree(\s|$)/.test(c) && !/\s-[LI]\b/.test(c)
    ? "`tree` dumps everything incl. node_modules. Use: tree -L 2 -I node_modules" : null],
  ["ls-recursive", (c) => /\bls\b[^|;&\n]*\s-[a-zA-Z]*R/.test(c)
    ? "Recursive ls is huge. Use: find . -maxdepth 2 -not -path '*/node_modules/*' -not -path '*/.git/*'" : null],
  ["cat-noise", (c) => /^\s*(cat|bat|type)\s/.test(c) && NOISY_CMD.test(c.replace(/\\/g, "/"))
    ? "That file is vendored/generated/lockfile content. Use grep/jq to pull what you need, or head -n 80 <file>." : null],
  ["cat-big", (c, cfg, cwd) => {
    // `cat`/`bat`/`type` of a file bigger than catBigKB (default 300 KB) straight into context. Redirects/heredocs are ignored; fails open.
    if (!/^\s*(cat|bat|type)\s/.test(c) || /[<>]/.test(c)) return null;
    const args = c.split(/[|;&\n]/)[0].replace(/^\s*(cat|bat|type)\s+/, "").match(/"[^"]+"|'[^']+'|\S+/g) || [];
    for (let a of args) {
      if (a.startsWith("-")) continue;
      a = a.replace(/^["']|["']$/g, "");
      try {
        const st = fs.statSync(path.resolve(cwd || process.cwd(), a));
        if (st.isFile() && st.size > cfg.catBigKB * 1024)
          return `${a} is ${Math.round(st.size / 1024)} KB. Dumping it whole wastes tokens: use grep -n <pattern> ${a}, or Read with offset and limit, or head -n 80 / tail -n 80.`;
      } catch {}
    }
    return null;
  }],
  ["git-log-patch", (c) => /\bgit\s+log\b/.test(c) && /(\s-p\b|--patch|--stat|\s-u\b)/.test(c) && !/(\s-n\s*\d+|\s-\d+\b|--max-count)/.test(c)
    ? "git log with patch/stat and no limit dumps the whole history. Use: git log -p -n 3 -- <path>" : null],
];

readStdin((input) => {
  if (!input.tool_name) process.exit(0);
  const cfg = loadConfig(input.cwd);
  const ti = input.tool_input || {};
  let res = null;
  try {
    const s = loadState(input);
    if (s) s.data.n = (s.data.n || 0) + 1;
    if (input.tool_name === "Bash") res = checkBash(String(ti.command || ""), cfg, input.cwd);
    else if (input.tool_name === "Read") {
      res = checkRead(ti, cfg);
      if (!res && !cfg.disable.includes("dup-read")) res = dupRead(ti, s);
    }
    if (res && s && SOFT.has(res.rule)) {
      const b = s.data.b && Object.keys(s.data.b).length < 50 ? s.data.b : (s.data.b = {});
      const k = res.rule + "|" + [ti.command, ti.file_path, ti.offset, ti.limit].join("|").slice(0, 300);
      b[k] = (b[k] || 0) + 1;
      if (b[k] > MAX_BLOCKS) res = null;
    }
    if (s) saveState(s);
  } catch { process.exit(0); } // never break the session because of the guard
  if (res) {
    log(res.rule, input.tool_name);
    process.stderr.write("[token-saver] " + res.msg + "\n");
    process.exit(2);
  }
  process.exit(0);
});

function loadState(input) {
  const sid = safeId(input.session_id);
  if (!sid) return null;
  const file = path.join(tmpDir(), sid + ".json");
  let data = { n: 0, r: {} };
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  if (!data.r) data.r = {};
  return { file, data };
}
function saveState(s) {
  try { fs.mkdirSync(path.dirname(s.file), { recursive: true }); fs.writeFileSync(s.file, JSON.stringify(s.data)); } catch {}
}

function dupRead(ti, s) {
  if (!s) return null;
  const p = String(ti.file_path || "");
  if (!p) return null;
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  const key = [p, ti.offset || 0, ti.limit || 0, st.mtimeMs, st.size].join("|");
  const n = s.data.n;
  const prev = s.data.r[key];
  if (prev !== undefined && n - prev <= DUP_WINDOW)
    return { rule: "dup-read", msg: `You already read ${p.replace(/\\/g, "/")} (same range, unchanged) ${n - prev} tool calls ago; that content is still in your context above. Use it, or Read a different range.` };
  s.data.r[key] = n;
  for (const k of Object.keys(s.data.r)) if (n - s.data.r[k] > DUP_WINDOW * 3) delete s.data.r[k];
  return null;
}

function log(rule, tool) {
  if (process.env.TOKEN_SAVER_NO_LOG === "1") return;
  try {
    const dir = path.join(os.homedir(), ".claude");
    const f = path.join(dir, "token-saver.log");
    fs.mkdirSync(dir, { recursive: true });
    try { if (fs.statSync(f).size > 500000) fs.renameSync(f, f + ".old"); } catch {}
    fs.appendFileSync(f, JSON.stringify({ t: new Date().toISOString(), rule, tool }) + "\n");
  } catch {}
}

function checkBash(cmd, cfg, cwd) {
  if (/#\s*ts-allow\b/.test(cmd)) return null;
  if (BOUND.test(cmd)) return null; // already piped through a limiter/filter
  for (const re of cfg.allowCommands) { try { if (new RegExp(re).test(cmd)) return null; } catch {} }
  for (const [rule, fn] of BASH_RULES) {
    if (cfg.disable.includes(rule)) continue;
    const msg = fn(cmd, cfg, cwd);
    if (msg) return { rule, msg };
  }
  return null;
}

function checkRead(ti, cfg) {
  if (cfg.disable.includes("read-noise")) return null;
  const p = String(ti.file_path || "");
  if (!p) return null;
  const lim = Number(ti.limit);
  if (Number.isFinite(lim) && lim > 0) return null; // any explicit range is fine
  const norm = p.replace(/\\/g, "/");
  let noisy = NOISY_PATH.test(norm);
  if (!noisy) for (const re of cfg.extraNoisy) { try { if (new RegExp(re).test(norm)) noisy = true; } catch {} }
  return noisy
    ? { rule: "read-noise", msg: `${norm} is vendored/generated/lockfile content. Use Grep for what you need, or Read with offset and limit.` }
    : null;
}
