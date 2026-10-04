#!/usr/bin/env node
// better-claude (quality-first). Blocks only calls that waste tokens WITHOUT giving Claude useful info:
//  - programs that hang or never end (interactive, follow/stream) or dump an entire log/journal
//  - root-wide find/grep/tree/ls -R that walk node_modules/.git
//  - cat of a huge file (> catBigKB, default 300 KB) into context
//  - reading vendored/generated files (node_modules, dist, lockfiles, *.min.*, *.map) in full
//  - re-reading a file range that is ALREADY in context (same or contained range, file unchanged, within dupWindow tool calls)
//  - unbounded git log / npm ls / kubectl logs, and ping/logcat that never end
//  - re-reading an IMAGE already in context (dup-image), repeating a Blender viewport screenshot when the scene has not
//    changed since the last one (blender-shot), and (opt-in, imgMaxEdge) downscaling oversized images (img-fit)
// It never limits normal source-file reads. Exit code 2 = block; stderr goes to Claude.
// Disable all: BETTER_CLAUDE_OFF=1 | one Bash call: "# ts-allow" | per-rule/project: .claude/better-claude.json
const fs = require("fs");
const path = require("path");
const { loadConfig, tmpDir, safeId, readStdin, logEvent, blenderRuns } = require("./lib.js");
const { isImage, dims, estTokens, fit } = require("./img.js");

if (process.env.BETTER_CLAUDE_OFF === "1") process.exit(0);

// Soft rules: if a model insists on the exact same call a 3rd time it clearly needs it, so let it through
// (never trap a weaker model in a retry loop that would waste more tokens than the call). Hang rules (follow/interactive/pm2) never relax.
const SOFT = new Set(["journalctl-unbounded", "docker-unbounded", "kubectl-unbounded", "grep-root", "find-root", "tree", "ls-recursive", "cat-noise", "cat-big", "git-log-patch", "git-log-unbounded", "npm-ls", "cat-binary", "ls-noise", "read-noise", "read-binary", "dup-read", "dup-image", "img-fit", "blender-shot"]);
// Hang rules: the call never ends, so a pipe to head/grep does NOT make it safe. Only `timeout N` or `# ts-allow` lets them through.
const HANG = new Set(["blender-gui", "interactive", "pm2-logs", "journalctl-follow", "docker-follow", "kubectl-follow", "tail-follow", "ping", "logcat"]);
const TIMED = /(^|[\s;&|(])timeout\s+(-\S+\s+)*\d/;
const MAX_BLOCKS = 2;
// Image rules block ONCE: if the model repeats the call it really needs the pixels again (viewport moved by hand, file regenerated in place...).
const LIMIT = { "dup-image": 1, "img-fit": 1, "blender-shot": 1 };
const BLENDER = /^mcp__(.*blender.*?)__(.+)$/i;
const BOUND = /\|\s*(head|tail|grep|egrep|rg|wc|sed|awk|cut|jq|uniq|sort)\b/;
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
  ["blender-gui", (c) => blenderRuns(c).some((args) => !args.some((w) => /^(-b|--background|-h|--help|-v|--version)$/.test(w)))
    ? "`blender` without -b opens the GUI and never returns, which hangs the shell. Run it headless: blender -b file.blend --python script.py (add -noaudio). To inspect a scene, print data from a --python script instead of opening it." : null],
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
  ["kubectl-follow", (c) => /\bkubectl\s+logs\b/.test(c) && /(\s-f\b|--follow)/.test(c)
    ? "kubectl logs -f never ends. Use: kubectl logs --tail=200 <pod>" : null],
  ["kubectl-unbounded", (c) => /\bkubectl\s+logs\b/.test(c) && !/(\s-f\b|--follow)/.test(c) && !/(--tail|--since|--limit-bytes)/.test(c)
    ? "Unbounded kubectl logs. Use: kubectl logs --tail=200 <pod>" : null],
  ["ping", (c) => process.platform !== "win32" && /^\s*ping\s/.test(c) && !/\s-[a-zA-Z]*[cwW]\s*\d/.test(c)
    ? "ping runs forever on Linux/macOS. Use: ping -c 4 <host>" : null],
  ["logcat", (c) => /\badb\b[^|;&\n]*\blogcat\b/.test(c) && !/\s-[a-zA-Z]*[dt]\b|--max-count|\s-m\s*\d/.test(c)
    ? "adb logcat streams forever. Use: adb logcat -d -t 200" : null],
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
  ["git-log-unbounded", (c) => /\bgit\s+log\b/.test(c) && !/(\s-n\s*\d+|\s-n\d+|\s-\d+\b|--max-count|--since|--after|--until|--before|--grep|--author|\s-[SGL]|\s--\s|\.\.)/.test(c)
    ? "git log without a limit prints the whole history. Use: git log --oneline -n 20" : null],
  ["npm-ls", (c) => {
    const m = /\b(npm|pnpm|yarn)\s+(ls|list)\b([^|;&\n]*)/.exec(c);
    if (!m || /--?depth|--long|--json/.test(m[3])) return null;
    return m[3].split(/\s+/).some((t) => t && !t.startsWith("-")) ? null // a package name narrows it
      : "Full dependency tree is huge. Use: " + m[1] + " ls --depth=0, or " + m[1] + " ls <package>";
  }],
  ["cat-binary", (c) => /^\s*(cat|bat|type)\s/.test(c) && !/[|<>]/.test(c)
    && /\.(zip|tar|gz|tgz|bz2|xz|7z|rar|exe|dll|so|dylib|bin|o|a|class|jar|pyc|sqlite3?|db|woff2?|ttf|otf|ico|png|jpe?g|gif|webp|pdf|mp[34]|mov|wasm|parquet|blend1?|glb|fbx|exr|hdr|psd|usdc|abc|bmp|tiff?)(\s|$|[\"'])/i.test(c)
    ? "That is a binary file: cat prints unreadable bytes. Use `file <path>`, `unzip -l`/`tar -tf` for archives, or Read for images and PDFs." : null],
  ["ls-noise", (c) => {
    // Listing node_modules itself (thousands of entries). `ls node_modules/pkg` or a find with -name/-maxdepth is fine.
    if (!/^\s*(ls|find)\s/.test(c) || /-name|-iname|-maxdepth|-path|-regex/.test(c)) return null;
    return /(^|\s)(\.\/)?node_modules\/?(\s|$)/.test(c) ? "node_modules has thousands of entries. Use: ls node_modules | head -n 50, or ls node_modules/<package>" : null;
  }],
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
      if (!res && isImage(ti.file_path)) res = checkImage(ti, s, cfg, input);
      else if (!res && !cfg.disable.includes("dup-read")) res = dupRead(ti, s, cfg);
    } else if (BLENDER.test(String(input.tool_name))) res = blenderShot(input, s, cfg);
    if (res && s && SOFT.has(res.rule)) {
      const b = s.data.b && Object.keys(s.data.b).length < 50 ? s.data.b : (s.data.b = {});
      const k = res.rule + "|" + [ti.command, ti.file_path, ti.offset, ti.limit].join("|").slice(0, 300) + (BLENDER.test(String(input.tool_name)) ? JSON.stringify(ti).slice(0, 200) : "");
      b[k] = (b[k] || 0) + 1;
      if (b[k] > (LIMIT[res.rule] || MAX_BLOCKS)) res = null;
    }
    if (s) saveState(s);
  } catch { process.exit(0); } // never break the session because of the guard
  if (res) {
    logEvent({ rule: res.rule, tool: input.tool_name, ...(res.bytes ? { bytes: res.bytes } : {}), ...(res.tokens ? { tokens: res.tokens } : {}) });
    process.stderr.write("[better-claude] " + res.msg + "\n");
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

// Lines already in context, per file version (path + mtime + size). A read is a duplicate when its line range is
// fully inside a range read earlier (and still within dupWindow tool calls): the content is above in the context.
// Reads of files > 80 KB without an explicit limit are not recorded: they may have failed with "file too large".
const NOLIMIT_MAX = 80 * 1024;
function lineCount(p) {
  const b = fs.readFileSync(p);
  let n = 0;
  for (let i = 0; i < b.length; i++) if (b[i] === 10) n++;
  return b.length && b[b.length - 1] !== 10 ? n + 1 : n;
}
function dupRead(ti, s, cfg) {
  if (!s) return null;
  const p = String(ti.file_path || "");
  if (!p) return null;
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  if (!st.isFile()) return null;
  const W = cfg.dupWindow;
  const n = s.data.n;
  const explicit = Number(ti.limit) > 0;
  let a = Math.max(1, Number(ti.offset) || 1);
  let b = a + (explicit ? Number(ti.limit) : 2000) - 1; // Read shows up to 2000 lines by default
  if (!explicit && st.size <= NOLIMIT_MAX) {
    try { const total = lineCount(p); if (a > total) return null; b = Math.min(b, total); } catch { return null; }
  }
  const rd = s.data.rd || (s.data.rd = {});
  const fk = p + "|" + st.mtimeMs + "|" + st.size;
  const ivs = rd[fk] || (rd[fk] = []);
  const hit = ivs.find((v) => v.a <= a && v.b >= b && n - v.n <= W);
  if (hit)
    return { rule: "dup-read", bytes: st.size, msg: `You already read lines ${a}-${b} of ${p.replace(/\\/g, "/")} (file unchanged) ${n - hit.n} tool calls ago; that content is still in your context above. Use it, or Read a different range.` };
  if (explicit || st.size <= NOLIMIT_MAX) {
    ivs.push({ a, b, n });
    if (ivs.length > 20) ivs.splice(0, ivs.length - 20);
  }
  for (const k of Object.keys(rd)) {
    rd[k] = rd[k].filter((v) => n - v.n <= W * 3);
    if (!rd[k].length) delete rd[k];
  }
  return null;
}

// Images: the pixels of one image stay in context after it is read, so reading the same unchanged file again only
// pays its tokens twice (path + mtime + size identify the version; a regenerated render has a new mtime and is allowed).
// img-fit (opt-in) swaps an oversized image for a downscaled copy BEFORE it reaches the model.
function checkImage(ti, s, cfg, input) {
  const p = String(ti.file_path || "");
  let st;
  try { st = fs.statSync(p); } catch { return null; }
  if (!st.isFile()) return null;
  const d = dims(p);
  const tok = d ? estTokens(d.w, d.h) : 0;
  const n = s ? s.data.n : 0;
  const im = s ? (s.data.im || (s.data.im = {})) : null;
  const key = p + "|" + st.mtimeMs + "|" + st.size;
  const name = path.basename(p);
  if (im && !cfg.disable.includes("dup-image") && im[key] !== undefined && n - im[key] <= cfg.imgWindow)
    return { rule: "dup-image", tokens: tok, msg: `You already viewed ${name}${d ? ` (${d.w}x${d.h}, ~${tok} tokens)` : ""} ${n - im[key]} tool calls ago and the file has not changed: the image is still in your context above. Use it. If you really need to see it again, repeat the Read.` };
  if (cfg.imgMaxEdge > 0 && d && Math.max(d.w, d.h) > cfg.imgMaxEdge && !cfg.disable.includes("img-fit")) {
    let dir = path.join(tmpDir(), "img");
    try { if (input.scratchpad_dir && fs.statSync(input.scratchpad_dir).isDirectory()) dir = input.scratchpad_dir; } catch {}
    const copy = fit(p, cfg.imgMaxEdge, dir);
    const d2 = copy && dims(copy);
    if (d2 && Math.max(d2.w, d2.h) < Math.max(d.w, d.h))
      return { rule: "img-fit", tokens: Math.max(0, tok - estTokens(d2.w, d2.h)), msg: `${name} is ${d.w}x${d.h} (~${tok} tokens). Read this ${d2.w}x${d2.h} copy instead (same image, long edge limited by imgMaxEdge=${cfg.imgMaxEdge}): ${copy.replace(/\\/g, "/")}  If you need full resolution (fine text, small details), repeat the Read on the original.` };
  }
  if (im) {
    im[key] = n;
    for (const k of Object.keys(im)) if (n - im[k] > cfg.imgWindow * 3) delete im[k];
  }
  return null;
}

// Blender MCP: an identical viewport screenshot with no scene-changing call in between returns the same pixels.
// Read-only getters (get_/list_/search_...) do not change the scene; anything else (execute_blender_code, imports, downloads) does.
function blenderShot(input, s, cfg) {
  if (!s || cfg.disable.includes("blender-shot")) return null;
  const name = String((BLENDER.exec(String(input.tool_name)) || [])[2] || "");
  const n = s.data.n;
  const bl = s.data.bl || (s.data.bl = { mut: 0 });
  if (!/screenshot|snapshot|capture/i.test(name)) {
    if (!/^(get|list|search|check|query|find|describe|inspect|read)_/i.test(name)) bl.mut = n;
    return null;
  }
  const key = input.tool_name + "|" + JSON.stringify(input.tool_input || {});
  const prev = bl.shot;
  if (prev && prev.key === key && bl.mut < prev.n && n - prev.n <= cfg.imgWindow) {
    const m = Number((input.tool_input || {}).max_size) || 800; // blender-mcp default; 16:9 assumed, so this is an approximation
    return { rule: "blender-shot", tokens: estTokens(m, Math.round(m * 0.5625)), msg: `Same Blender viewport screenshot as ${n - prev.n} calls ago and nothing in the scene has changed since (no execute/modify call): that image is still in your context above. Use it, or change the scene/args first. If the user moved the viewport by hand, repeat the call. To check numbers (positions, counts, materials) a short execute_blender_code that prints them is cheaper than an image.` };
  }
  bl.shot = { key, n };
  return null;
}

function checkBash(cmd, cfg, cwd) {
  if (/#\s*ts-allow\b/.test(cmd)) return null;
  for (const re of cfg.allowCommands) { try { if (new RegExp(re).test(cmd)) return null; } catch {} }
  const bounded = BOUND.test(cmd); // piped through a limiter/filter: fine for soft rules, but a never-ending stream still hangs
  const timed = TIMED.test(cmd);
  for (const [rule, fn] of BASH_RULES) {
    if (cfg.disable.includes(rule)) continue;
    if (HANG.has(rule) ? timed : bounded) continue;
    const msg = fn(cmd, cfg, cwd);
    if (msg) return { rule, msg, bytes: rule === "cat-big" ? bytesOf(msg) : 0 };
  }
  return null;
}
// cat-big embeds the size in its message ("<file> is N KB.")
function bytesOf(msg) { const m = / is (\d+) KB\./.exec(msg); return m ? Number(m[1]) * 1024 : 0; }

const BINARY_READ = /\.(blend1?|glb|fbx|exr|hdr|psd|usdc|abc|zip|tar|gz|tgz|bz2|xz|7z|rar|exe|dll|so|dylib|bin|o|a|class|jar|pyc|sqlite3?|db|woff2?|ttf|otf|wasm|parquet)$/i;
function checkRead(ti, cfg) {
  const p = String(ti.file_path || "");
  if (!p) return null;
  if (!cfg.disable.includes("read-binary") && BINARY_READ.test(p))
    return { rule: "read-binary", msg: `${p.replace(/\\/g, "/")} is a binary file: Read would return unreadable bytes. For .blend/.glb/.fbx use a headless script (blender -b file --python-expr "..." printing what you need); for archives use unzip -l / tar -tf; otherwise \`file <path>\`.` };
  if (cfg.disable.includes("read-noise")) return null;
  const lim = Number(ti.limit);
  if (Number.isFinite(lim) && lim > 0) return null; // any explicit range is fine
  const norm = p.replace(/\\/g, "/");
  let noisy = NOISY_PATH.test(norm);
  if (!noisy) for (const re of cfg.extraNoisy) { try { if (new RegExp(re).test(norm)) noisy = true; } catch {} }
  return noisy
    ? { rule: "read-noise", msg: `${norm} is vendored/generated/lockfile content. Use Grep for what you need, or Read with offset and limit.` }
    : null;
}
