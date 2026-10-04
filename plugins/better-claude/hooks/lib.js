// Shared helpers for better-claude hooks.
const fs = require("fs");
const os = require("os");
const path = require("path");

const ARR = ["disable", "allowCommands", "extraNoisy", "trimCommands"];

// Config: global ~/.claude/better-claude.json, then project <cwd>/.claude/better-claude.json
// { "disable": ["tree"], "allowCommands": ["^pm2 logs blockhost"], "extraNoisy": ["/generated/"],
//   "autoHandoff": true, "warnTranscriptKB": 1500 }
function loadConfig(cwd) {
  const cfg = { disable: [], allowCommands: [], extraNoisy: [], autoHandoff: true, warnTranscriptKB: 1500, catBigKB: 300, trimBashKB: 12, resumeWarnTokens: 60000, trimCommands: [], dupWindow: 10, handoffMaxChars: 2000, imgWindow: 25, imgMaxEdge: 0 };
  if (process.env.BETTER_CLAUDE_WARN_KB) cfg.warnTranscriptKB = Number(process.env.BETTER_CLAUDE_WARN_KB) || cfg.warnTranscriptKB;
  if (process.env.BETTER_CLAUDE_IMG_MAX_EDGE) cfg.imgMaxEdge = Number(process.env.BETTER_CLAUDE_IMG_MAX_EDGE) || 0;
  if (process.env.BETTER_CLAUDE_NO_CONFIG === "1") return cfg;
  const files = [path.join(os.homedir(), ".claude", "better-claude.json"), path.join(cwd || process.cwd(), ".claude", "better-claude.json")];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const k of ARR) if (Array.isArray(j[k])) cfg[k] = cfg[k].concat(j[k].map(String));
      if (typeof j.autoHandoff === "boolean") cfg.autoHandoff = j.autoHandoff;
      if (Number(j.warnTranscriptKB) > 0) cfg.warnTranscriptKB = Number(j.warnTranscriptKB);
      if (Number(j.catBigKB) > 0) cfg.catBigKB = Number(j.catBigKB);
      if (Number(j.trimBashKB) > 0) cfg.trimBashKB = Number(j.trimBashKB);
      if (Number(j.resumeWarnTokens) > 0) cfg.resumeWarnTokens = Number(j.resumeWarnTokens);
      if (Number(j.dupWindow) > 0) cfg.dupWindow = Math.min(50, Number(j.dupWindow));
      if (Number(j.handoffMaxChars) > 0) cfg.handoffMaxChars = Number(j.handoffMaxChars);
      if (Number(j.imgWindow) > 0) cfg.imgWindow = Math.min(100, Number(j.imgWindow));
      if (Number(j.imgMaxEdge) >= 0 && j.imgMaxEdge !== undefined) cfg.imgMaxEdge = Number(j.imgMaxEdge) || 0;
    } catch {}
  }
  return cfg;
}

const tmpDir = () => path.join(os.tmpdir(), "better-claude");
const dataDir = () => path.join(os.homedir(), ".claude", "better-claude");
const safeId = (s) => String(s || "").replace(/[^\w-]/g, "").slice(0, 80);
const cwdKey = (cwd) => require("crypto").createHash("sha1").update(path.resolve(cwd || process.cwd())).digest("hex").slice(0, 12);

function readStdin(cb) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let i = {};
    try { i = JSON.parse(raw); } catch {}
    cb(i || {});
  });
}

// Synchronous write to stdout: process.exit() right after process.stdout.write() can truncate piped output (notably on Windows).
function out(s) {
  const b = Buffer.from(String(s));
  let off = 0;
  try { while (off < b.length) off += fs.writeSync(1, b, off); }
  catch { try { process.stdout.write(b.subarray(off)); } catch {} }
}

// Append one JSON line to ~/.claude/better-claude.log (rotated at 500 KB). Opt out with BETTER_CLAUDE_NO_LOG=1.
function logEvent(o) {
  if (process.env.BETTER_CLAUDE_NO_LOG === "1") return;
  try {
    const dir = path.join(os.homedir(), ".claude");
    const f = path.join(dir, "better-claude.log");
    fs.mkdirSync(dir, { recursive: true });
    try { if (fs.statSync(f).size > 500000) fs.renameSync(f, f + ".old"); } catch {}
    fs.appendFileSync(f, JSON.stringify({ t: new Date().toISOString(), ...o }) + "\n");
  } catch {}
}

module.exports = { loadConfig, tmpDir, dataDir, safeId, cwdKey, readStdin, out, logEvent };
