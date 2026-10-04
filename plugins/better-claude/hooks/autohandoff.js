#!/usr/bin/env node
// SessionEnd: build a MECHANICAL handoff from the transcript (no model, nothing invented):
// first/latest user requests, files edited, last assistant message. Saved outside the project
// (~/.claude/better-claude/handoffs) so it can never be committed. session.js restores it once.
const fs = require("fs");
const path = require("path");
const { loadConfig, dataDir, cwdKey, readStdin } = require("./lib.js");

if (process.env.BETTER_CLAUDE_OFF === "1") process.exit(0);

// Harness-generated wrappers, not things the user typed. (A prompt that merely starts with "<", e.g. "<div> is broken", is kept.)
const WRAPPER = /^<(command-|local-command|system-reminder|bash-|task-notification|ide_|user-prompt-submit-hook)/;
const cut = (s, n) => { s = String(s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

readStdin((input) => {
  try {
    const cwd = input.cwd || process.cwd();
    const cfg = loadConfig(cwd);
    const tp = input.transcript_path;
    if (!cfg.autoHandoff || !tp || !fs.existsSync(tp) || fs.statSync(tp).size > 80 * 1024 * 1024) process.exit(0);

    const prompts = [];
    const files = new Set();
    let lastText = "";
    for (const ln of fs.readFileSync(tp, "utf8").split("\n")) {
      if (!ln) continue;
      let o; try { o = JSON.parse(ln); } catch { continue; }
      const m = o && o.message;
      if (!m || o.isSidechain) continue;
      if (o.type === "user" && !o.isMeta) {
        let t = "";
        if (typeof m.content === "string") t = m.content;
        else if (Array.isArray(m.content)) t = m.content.filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
        t = t.trim();
        if (t && !WRAPPER.test(t) && !t.startsWith("[better-claude]") && !t.startsWith("Caveat:") && !t.startsWith("[Request interrupted")) prompts.push(t);
      } else if (o.type === "assistant" && Array.isArray(m.content)) {
        for (const b of m.content) {
          if (!b) continue;
          if (b.type === "tool_use" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(b.name) && b.input) {
            const p = b.input.file_path || b.input.notebook_path;
            if (p) files.add(path.isAbsolute(p) && p.startsWith(cwd) ? path.relative(cwd, p) : p);
          } else if (b.type === "text" && b.text && b.text.trim()) lastText = b.text;
        }
      }
    }
    if (files.size === 0 && prompts.length < 3) process.exit(0); // trivial session: keep any earlier handoff

    const recent = prompts.slice(-3).filter((p) => p !== prompts[0]).slice(-2);
    const fl = [...files];
    // Most useful first: the cap below trims from the end.
    let out = `[better-claude] Auto-extracted summary of the previous session here (${input.reason || "unknown"}, ${new Date().toISOString().slice(0, 16)}Z). May be unrelated: use only if relevant; verify files before editing.\n`;
    out += `First request: ${cut(prompts[0] || "", 250)}\n`;
    if (recent.length) out += "Latest requests:\n" + recent.map((p) => "- " + cut(p, 180)).join("\n") + "\n";
    if (lastText) out += `Last assistant message: ${cut(lastText, 450)}\n`;
    if (fl.length) out += `Files edited (${fl.length}): ${fl.slice(-12).join(", ")}\n`;

    const dir = path.join(dataDir(), "handoffs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, cwdKey(cwd) + ".md"), out.slice(0, cfg.handoffMaxChars));
  } catch {}
  process.exit(0);
});
