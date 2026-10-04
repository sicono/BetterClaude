#!/usr/bin/env node
// SessionStart (startup|resume|clear|compact):
//  1) always: reset the duplicate-read tracker for this session and prune old temp files
//  2) startup|clear: inject, ONCE, the manual handoff (.claude/handoff.md, from /better-claude:handoff)
//     or else the automatic one (made by autohandoff.js). Both expire after 24 h.
const fs = require("fs");
const path = require("path");
const { loadConfig, tmpDir, dataDir, safeId, cwdKey, readStdin, out } = require("./lib.js");

if (process.env.BETTER_CLAUDE_OFF === "1") process.exit(0);

const DAY = 24 * 3600 * 1000;
const fresh = (f) => { try { return Date.now() - fs.statSync(f).mtimeMs <= DAY; } catch { return false; } };
const archive = (f) => { try { fs.renameSync(f, f.replace(/\.md$/, ".used.md")); } catch {} };

readStdin((input) => {
  try {
    const d = tmpDir();
    if (input.session_id) fs.rmSync(path.join(d, safeId(input.session_id) + ".json"), { force: true });
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (Date.now() - fs.statSync(p).mtimeMs > 3 * DAY) fs.rmSync(p, { force: true });
    }
  } catch {}

  try { // keep our own data small: used handoffs after 7 days, any stale handoff after 30 days
    const hd = path.join(dataDir(), "handoffs");
    for (const f of fs.readdirSync(hd)) {
      const p = path.join(hd, f);
      const age = Date.now() - fs.statSync(p).mtimeMs;
      if (age > (f.endsWith(".used.md") ? 7 : 30) * DAY) fs.rmSync(p, { force: true });
    }
  } catch {}

  const src = input.source || "startup";
  if (src === "resume" || src === "fork") {
    // Claude Code >= 2.1.251 reports the size of the resumed context and whether the prompt cache expired.
    try {
      const cfg0 = loadConfig(input.cwd || process.cwd());
      const ct = Number(input.context_tokens);
      if (input.prompt_cache_likely_expired && ct >= cfg0.resumeWarnTokens) {
        const usd = Number(input.estimated_cache_write_usd);
        out(JSON.stringify({ systemMessage: `better-claude: reanudas una sesion de ~${Math.round(ct / 1000)}k tokens y la cache del prompt ya caduco: la primera peticion los reenvia enteros${usd > 0 ? ` (~$${usd.toFixed(2)})` : ""}. Si vas a cambiar de tarea, mejor /clear (el resumen automatico se restaura solo); si sigues con lo mismo, /compact.` }));
      }
    } catch {}
    process.exit(0);
  }
  if (src !== "startup" && src !== "clear") process.exit(0);

  try {
    const cwd = input.cwd || process.cwd();
    const cfg = loadConfig(cwd);
    const manual = path.join(cwd, ".claude", "handoff.md");
    const auto = path.join(dataDir(), "handoffs", cwdKey(cwd) + ".md");

    if (fresh(manual)) {
      const txt = fs.readFileSync(manual, "utf8").trim().slice(0, 6000);
      if (txt) {
        out("[better-claude] Handoff from the previous session. Continue from it, but verify the current state of files before editing:\n" + txt + "\n");
        archive(manual);
        if (fs.existsSync(auto)) archive(auto);
        process.exit(0);
      }
    }
    if (cfg.autoHandoff && fresh(auto)) {
      const txt = fs.readFileSync(auto, "utf8").trim();
      if (txt) { out(txt + "\n"); archive(auto); }
    }
  } catch {}
  process.exit(0);
});
