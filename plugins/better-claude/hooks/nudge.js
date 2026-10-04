#!/usr/bin/env node
// UserPromptSubmit: when the session transcript gets big, show the USER (not the model, zero token cost)
// a one-line hint to /clear between tasks. Approximate: the transcript includes pre-compaction history.
const fs = require("fs");
const path = require("path");
const { loadConfig, tmpDir, safeId, readStdin, out } = require("./lib.js");

if (process.env.BETTER_CLAUDE_OFF === "1") process.exit(0);

readStdin((input) => {
  try {
    const tp = input.transcript_path;
    if (!tp || !input.session_id) process.exit(0);
    const cfg = loadConfig(input.cwd);
    const kb = Math.round(fs.statSync(tp).size / 1024);
    if (kb < cfg.warnTranscriptKB) process.exit(0);
    const f = path.join(tmpDir(), "nudge-" + safeId(input.session_id) + ".json");
    let last = 0;
    try { last = JSON.parse(fs.readFileSync(f, "utf8")).kb || 0; } catch {}
    if (last && kb - last < 1000) process.exit(0);
    fs.mkdirSync(tmpDir(), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ kb }));
    const mb = (kb / 1024).toFixed(1);
    out(JSON.stringify({
      systemMessage: `better-claude: sesion larga (~${mb} MB de transcripcion, aproximado). Tarea nueva: /clear (se guarda un resumen automatico y se restaura solo). Misma tarea: /compact.`
    }));
  } catch {}
  process.exit(0);
});
