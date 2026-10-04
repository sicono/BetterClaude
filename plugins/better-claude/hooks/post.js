#!/usr/bin/env node
// PostToolUse (Bash): when a NOISY build/install/test command prints a lot, replace what Claude SEES with
// head + tail + the error/warning lines of the omitted middle. The FULL output is saved to a file, so nothing is lost.
// Before trimming, a LOSSLESS squeeze removes terminal noise: ANSI colors, progress-bar overwrites (carriage returns), runs of identical lines.
// Allowlist only (npm/pip/docker build/tests/make/...): never touches cat/grep/etc. Fails open.
// Separately, `git diff|show|log -p|stash show` output: the per-file diff of lockfiles, *.min.*, *.map (and extraNoisy paths)
// is replaced by a one-line summary; every other file's diff is kept intact. Rule name: "diff-omit".
// Needs Claude Code >= 2.1.236 (older versions ignore the replacement and show the original output).
// Skip once: "# ts-full" at the end of the command. Disable: "bash-trim" in config. Threshold: trimBashKB (default 12).
const fs = require("fs");
const path = require("path");
const { loadConfig, tmpDir, safeId, readStdin, out, logEvent } = require("./lib.js");

if (process.env.BETTER_CLAUDE_OFF === "1") process.exit(0);

// `blender ...` at the START of a command (also after && ; | ( , behind sudo/xvfb-run, with a quoted path that has spaces).
// Anchored on purpose: `grep blender notes.txt` must never be trimmed.
const BLENDER_CMD = /(^|[;&|(]\s*)(sudo\s+)?(xvfb-run\s+(-\S+\s+)*)?("[^"]*[\/\\]|'[^']*[\/\\]|["']|\S*[\/\\])?blender(\.exe)?["']?\s/;
const NOISY = new RegExp([
  "\\b(npm|pnpm|yarn|bun)\\s+(i|install|ci|add|test|run|build|exec)\\b", "\\bnpx\\b", "\\bpip3?\\s+install\\b",
  "\\bdocker(\\s+compose|-compose)?\\s+(build|pull|push|up)\\b", "\\b(pytest|jest|vitest|mocha|phpunit|playwright|cypress|rspec|ctest)\\b",
  "\\bcomposer\\s+(install|update|require)\\b", "\\bcargo\\s+(build|test|check|clippy)\\b", "\\bgo\\s+(build|test)\\b",
  "\\b(mvn|gradle|gradlew|sbt|bazel|xcodebuild)\\b", "\\bmake\\b", "\\b(cmake|ninja)\\b", "\\bgit\\s+(clone|pull|fetch)\\b",
  "\\bapt(-get)?\\s+(install|update|upgrade)\\b", "\\bdotnet\\s+(build|test|restore|publish|pack)\\b",
  "\\bbundle\\s+(install|update)\\b", "\\bgem\\s+install\\b", "\\bbrew\\s+(install|update|upgrade)\\b",
  "\\buv\\s+(sync|pip|add)\\b", "\\bpoetry\\s+(install|update|add)\\b", "\\bconda\\s+(install|create|update)\\b",
  "\\bflutter\\s+(build|pub|test)\\b", "\\bswift\\s+(build|test)\\b", "\\bng\\s+(build|test)\\b",
  "\\b(next|vite|nuxt|turbo|nx|webpack|rollup)\\s+build\\b", "\\bwebpack\\b", "\\b(terraform|tofu)\\s+(init|plan|apply)\\b",
  "\\bansible(-playbook)?\\b",
  BLENDER_CMD.source,
].join("|"));
const KEEP = /error|fail|exception|traceback|panic|fatal|denied|cannot|not found|warn|✗|×/i;
const cut = (l, n) => (l.length > n ? l.slice(0, n) + "…" : l);

// Lossless cleanup: ANSI escapes, carriage-return progress overwrites, runs (>=3) of identical consecutive lines.
const ANSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
function squeeze(text) {
  const out = [];
  let prev = null, rep = 0;
  const flush = () => { if (prev !== null) { if (rep >= 3) out.push(prev + `  (repeated ${rep}x)`); else for (let k = 0; k < rep; k++) out.push(prev); } };
  for (let l of text.replace(ANSI, "").split("\n")) {
    l = l.replace(/\r+$/, "");
    if (l.includes("\r")) l = l.slice(l.lastIndexOf("\r") + 1);
    if (l === prev && l.trim()) { rep++; continue; }
    flush(); prev = l; rep = 1;
  }
  flush();
  return out.join("\n");
}

// Blender prints one line per progress tick ("Fra:1 Mem:... | Time:... | Sample 12/128"). Keep only the LAST line of
// each run of ticks (it carries the final state) plus every other line (Saved:, Warning:, Error:, tracebacks...).
const BL_TICK = /^(Fra:\d+ Mem:|Sample \d+\/\d+|Rendering \d+ \/ \d+|Updating |Synchronizing |Loading |Building |Computing |Initializing |Compiling )/;
function squeezeBlender(text) {
  const out = [];
  let run = 0, last = "";
  const flush = () => { if (run > 1) out.push(last + `  (${run} progress lines collapsed)`); else if (run === 1) out.push(last); run = 0; };
  for (const l of text.split("\n")) {
    if (BL_TICK.test(l)) { run++; last = l; continue; }
    flush(); out.push(l);
  }
  flush();
  return out.join("\n");
}

function trim(text, budget, file) {
  if (text.length <= budget) return text;
  const lines = text.split("\n");
  const hb = Math.floor(budget * 0.4), tb = Math.floor(budget * 0.4), mb = budget - hb - tb;
  const head = [], tail = [];
  let hc = 0, tc = 0, i = 0, j = lines.length - 1;
  for (; i < lines.length; i++) { const l = cut(lines[i], 400); if (hc + l.length + 1 > hb) break; head.push(l); hc += l.length + 1; }
  for (; j >= i; j--) { const l = cut(lines[j], 400); if (tc + l.length + 1 > tb) break; tail.unshift(l); tc += l.length + 1; }
  const mid = [];
  let mc = 0;
  for (let k = i; k <= j; k++) if (KEEP.test(lines[k])) { const l = cut(lines[k], 300); if (mc + l.length + 1 > mb) break; mid.push(l); mc += l.length + 1; }
  const omitted = Math.max(0, j - i + 1);
  const note = `[better-claude] ${omitted} lines omitted (${Math.round(text.length / 1024)} KB total). Error/warning lines from the omitted part are kept below. Full output: ${file} — use grep -n "<pattern>" "<file>", or head/tail, to see more.`;
  return [...head, note, ...mid, ...tail].join("\n");
}

const DIFFCMD = /\bgit\s+(-C\s+\S+\s+)?(diff|show|log|stash\s+show)\b/;
const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|Gemfile\.lock|go\.sum|uv\.lock|bun\.lockb?|npm-shrinkwrap\.json)$|\.min\.(js|css)$|\.map$/;
const DIFFLINE = /^([ +\-@\\]|index |new file|deleted file|similarity|dissimilarity|rename |copy |old mode|new mode|Binary files|GIT binary patch)/;
const OMIT_MIN = 1500; // only worth summarizing a file's diff above this many chars

// Replace the diff body of generated files; keep what follows it (e.g. the next `commit` header in `git log -p`).
function omitGenerated(text, cfg, file) {
  const parts = text.split(/(?=^diff --git )/m);
  if (parts.length < 2 && !text.startsWith("diff --git")) return null;
  let n = 0;
  const res = parts.map((sec) => {
    if (!sec.startsWith("diff --git ") || sec.length < OMIT_MIN) return sec;
    const lines = sec.split("\n");
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[0]);
    if (!m) return sec;
    const f = m[2];
    let hit = GENERATED.test(f);
    if (!hit) for (const re of cfg.extraNoisy) { try { if (new RegExp(re).test(f)) hit = true; } catch {} }
    if (!hit) return sec;
    let end = 1, add = 0, del = 0;
    while (end < lines.length && lines[end] !== "" && DIFFLINE.test(lines[end])) {
      if (lines[end][0] === "+" && !lines[end].startsWith("+++")) add++;
      else if (lines[end][0] === "-" && !lines[end].startsWith("---")) del++;
      end++;
    }
    n++;
    const note = `[better-claude] diff of generated/lockfile content omitted (+${add} -${del} lines, ${Math.round(lines.slice(0, end).join("\n").length / 1024)} KB). Full output: ${file} — or rerun with  # ts-full`;
    return [lines[0], note, ...lines.slice(end)].join("\n");
  });
  return n ? res.join("") : null;
}

// Save the untouched output so nothing is lost; returns its path.
function saveFull(input, cmd, so, se) {
  let dir = tmpDir();
  try { if (input.scratchpad_dir && fs.statSync(input.scratchpad_dir).isDirectory()) dir = input.scratchpad_dir; } catch {}
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "out-" + (safeId(input.tool_use_id) || Date.now()) + ".txt");
  fs.writeFileSync(file, `$ ${cmd}\n--- stdout ---\n${so}\n--- stderr ---\n${se}\n`);
  return file;
}
const emit = (r, patch, rule, before) => {
  const updated = { ...r, ...patch };
  logEvent({ rule, tool: "Bash", before, after: updated.stdout.length + updated.stderr.length });
  out(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated } }));
};

readStdin((input) => {
  try {
    if (input.tool_name !== "Bash") process.exit(0);
    const cfg = loadConfig(input.cwd);
    const cmd = String((input.tool_input || {}).command || "");
    if (/#\s*ts-full\b/.test(cmd)) process.exit(0);
    const r = input.tool_response;
    if (!r || typeof r !== "object" || r.interrupted || r.isImage) process.exit(0);
    const so = typeof r.stdout === "string" ? r.stdout : "";
    const se = typeof r.stderr === "string" ? r.stderr : "";
    const before = so.length + se.length;
    if (before < 2048) process.exit(0);

    // 1) generated/lockfile diffs inside git diff/show/log -p output
    if (!cfg.disable.includes("diff-omit") && DIFFCMD.test(cmd) && so.length >= OMIT_MIN) {
      const file = saveFull(input, cmd, so, se);
      const o = omitGenerated(so, cfg, file);
      if (o !== null) { emit(r, { stdout: o, stderr: se }, "diff-omit", before); process.exit(0); }
      try { fs.rmSync(file, { force: true }); } catch {}
    }

    // 2) noisy build/install/test commands
    if (cfg.disable.includes("bash-trim")) process.exit(0);
    let noisy = NOISY.test(cmd);
    if (!noisy) for (const re of cfg.trimCommands) { try { if (new RegExp(re).test(cmd)) noisy = true; } catch {} }
    if (!noisy) process.exit(0);

    const isBl = BLENDER_CMD.test(cmd);
    const so2 = isBl ? squeezeBlender(squeeze(so)) : squeeze(so), se2 = isBl ? squeezeBlender(squeeze(se)) : squeeze(se);
    const big = so2.length + se2.length > cfg.trimBashKB * 1024;
    if (!big && before - (so2.length + se2.length) < 1024) process.exit(0); // nothing worth rewriting

    let stdout = so2, stderr = se2;
    if (big) {
      const file = saveFull(input, cmd, so, se);
      stdout = trim(so2, se2.length > 3000 ? 7000 : 10000, file);
      stderr = trim(se2, 5000, file);
    }
    emit(r, { stdout, stderr }, big ? "bash-trim" : "bash-squeeze", before);
  } catch {}
  process.exit(0);
});
