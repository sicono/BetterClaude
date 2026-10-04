#!/usr/bin/env node
// SessionStart (startup|resume|clear|compact):
//  1) always: reset the duplicate-read tracker for this session and prune old temp files
//  2) startup|clear: inject, ONCE, the manual handoff (.claude/handoff.md, from /token-saver:handoff)
//     or else the automatic one (made by autohandoff.js). Both expire after 24 h.
const fs = require("fs");
const path = require("path");
const { loadConfig, tmpDir, dataDir, safeId, cwdKey, readStdin } = require("./lib.js");

if (process.env.TOKEN_SAVER_OFF === "1") process.exit(0);

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
  if (src !== "startup" && src !== "clear") process.exit(0);

  try {
    const cwd = input.cwd || process.cwd();
    const cfg = loadConfig(cwd);
    const manual = path.join(cwd, ".claude", "handoff.md");
    const auto = path.join(dataDir(), "handoffs", cwdKey(cwd) + ".md");

    if (fresh(manual)) {
      const txt = fs.readFileSync(manual, "utf8").trim().slice(0, 6000);
      if (txt) {
        process.stdout.write("[token-saver] Handoff from the previous session. Continue from it, but verify the current state of files before editing:\n" + txt + "\n");
        archive(manual);
        if (fs.existsSync(auto)) archive(auto);
        process.exit(0);
      }
    }
    if (cfg.autoHandoff && fresh(auto)) {
      const txt = fs.readFileSync(auto, "utf8").trim();
      if (txt) { process.stdout.write(txt + "\n"); archive(auto); }
    }
  } catch {}
  process.exit(0);
});
