#!/usr/bin/env node
// PostToolUse (Bash): when a NOISY build/install/test command prints a lot, replace what Claude SEES with
// head + tail + the error/warning lines of the omitted middle. The FULL output is saved to a file, so nothing is lost.
// Allowlist only (npm/pip/docker build/tests/make/...): never touches cat/grep/git diff/etc. Fails open.
// Needs Claude Code >= 2.1.236 (older versions ignore the replacement and show the original output).
// Skip once: "# ts-full" at the end of the command. Disable: "bash-trim" in config. Threshold: trimBashKB (default 12).
const fs = require("fs");
const path = require("path");
const { loadConfig, tmpDir, safeId, readStdin, out } = require("./lib.js");

if (process.env.TOKEN_SAVER_OFF === "1") process.exit(0);

const NOISY = /\b(npm|pnpm|yarn|bun)\s+(i|install|ci|add|test|run|build|exec)\b|\bnpx\b|\bpip3?\s+install\b|\bdocker(\s+compose|-compose)?\s+(build|pull|up)\b|\b(pytest|jest|vitest|mocha|phpunit|playwright)\b|\bcomposer\s+(install|update|require)\b|\bcargo\s+(build|test|check|clippy)\b|\bgo\s+(build|test)\b|\b(mvn|gradle|gradlew)\b|\bmake\b|\bgit\s+(clone|pull|fetch)\b|\bapt(-get)?\s+(install|update|upgrade)\b|\bdotnet\s+(build|test|restore)\b/;
const KEEP = /error|fail|exception|traceback|panic|fatal|denied|cannot|not found|warn|✗|×/i;
const cut = (l, n) => (l.length > n ? l.slice(0, n) + "…" : l);

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
  const note = `[token-saver] ${omitted} lines omitted (${Math.round(text.length / 1024)} KB total). Error/warning lines from the omitted part are kept below. Full output: ${file} — use grep -n "<pattern>" "<file>", or head/tail, to see more.`;
  return [...head, note, ...mid, ...tail].join("\n");
}

readStdin((input) => {
  try {
    if (input.tool_name !== "Bash") process.exit(0);
    const cfg = loadConfig(input.cwd);
    if (cfg.disable.includes("bash-trim")) process.exit(0);
    const cmd = String((input.tool_input || {}).command || "");
    if (/#\s*ts-full\b/.test(cmd)) process.exit(0);
    const r = input.tool_response;
    if (!r || typeof r !== "object" || r.interrupted || r.isImage) process.exit(0);
    const so = typeof r.stdout === "string" ? r.stdout : "";
    const se = typeof r.stderr === "string" ? r.stderr : "";
    if (so.length + se.length <= cfg.trimBashKB * 1024) process.exit(0);
    let noisy = NOISY.test(cmd);
    if (!noisy) for (const re of cfg.trimCommands) { try { if (new RegExp(re).test(cmd)) noisy = true; } catch {} }
    if (!noisy) process.exit(0);

    let dir = tmpDir();
    try { if (input.scratchpad_dir && fs.statSync(input.scratchpad_dir).isDirectory()) dir = input.scratchpad_dir; } catch {}
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "out-" + (safeId(input.tool_use_id) || Date.now()) + ".txt");
    fs.writeFileSync(file, `$ ${cmd}\n--- stdout ---\n${so}\n--- stderr ---\n${se}\n`);

    const updated = { ...r, stdout: trim(so, se.length > 3000 ? 7000 : 10000, file), stderr: trim(se, 5000, file) };
    out(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", updatedToolOutput: updated } }));
  } catch {}
  process.exit(0);
});
