// Shared helpers for token-saver hooks.
const fs = require("fs");
const os = require("os");
const path = require("path");

const ARR = ["disable", "allowCommands", "extraNoisy"];

// Config: global ~/.claude/token-saver.json, then project <cwd>/.claude/token-saver.json
// { "disable": ["tree"], "allowCommands": ["^pm2 logs blockhost"], "extraNoisy": ["/generated/"],
//   "autoHandoff": true, "warnTranscriptKB": 1500 }
function loadConfig(cwd) {
  const cfg = { disable: [], allowCommands: [], extraNoisy: [], autoHandoff: true, warnTranscriptKB: 1500, catBigKB: 300 };
  if (process.env.TOKEN_SAVER_WARN_KB) cfg.warnTranscriptKB = Number(process.env.TOKEN_SAVER_WARN_KB) || cfg.warnTranscriptKB;
  if (process.env.TOKEN_SAVER_NO_CONFIG === "1") return cfg;
  const files = [path.join(os.homedir(), ".claude", "token-saver.json"), path.join(cwd || process.cwd(), ".claude", "token-saver.json")];
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const k of ARR) if (Array.isArray(j[k])) cfg[k] = cfg[k].concat(j[k].map(String));
      if (typeof j.autoHandoff === "boolean") cfg.autoHandoff = j.autoHandoff;
      if (Number(j.warnTranscriptKB) > 0) cfg.warnTranscriptKB = Number(j.warnTranscriptKB);
      if (Number(j.catBigKB) > 0) cfg.catBigKB = Number(j.catBigKB);
    } catch {}
  }
  return cfg;
}

const tmpDir = () => path.join(os.tmpdir(), "token-saver");
const dataDir = () => path.join(os.homedir(), ".claude", "token-saver");
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

module.exports = { loadConfig, tmpDir, dataDir, safeId, cwdKey, readStdin };
