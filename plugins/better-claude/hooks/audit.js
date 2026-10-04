#!/usr/bin/env node
// /better-claude:audit — deterministic report of what loads into every session (approx tokens = bytes / 4). No model needed.
const fs = require("fs");
const os = require("os");
const path = require("path");

const cwd = process.cwd();
const home = os.homedir();
const tok = (b) => Math.round(b / 4);
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };
const json = (p) => { try { return JSON.parse(read(p)); } catch { return null; } };
const rows = [];
const add = (what, bytes, note) => rows.push([what, tok(bytes), note || ""]);

for (const p of [path.join(cwd, "CLAUDE.md"), path.join(cwd, ".claude", "CLAUDE.md"), path.join(home, ".claude", "CLAUDE.md")]) {
  const t = read(p);
  if (t !== null) add(p.replace(home, "~"), Buffer.byteLength(t), tok(Buffer.byteLength(t)) > 2000 ? "grande: prueba /better-claude:slim-claudemd" : "");
}

// skills / agents / commands: only the frontmatter description loads at session start
for (const [label, dir] of [["skills", path.join(home, ".claude", "skills")], ["skills (proyecto)", path.join(cwd, ".claude", "skills")], ["agents", path.join(home, ".claude", "agents")], ["agents (proyecto)", path.join(cwd, ".claude", "agents")], ["commands", path.join(home, ".claude", "commands")], ["commands (proyecto)", path.join(cwd, ".claude", "commands")]]) {
  let n = 0, b = 0;
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(p, depth + 1);
      else if (e.isFile() && /\.md$/i.test(e.name) && (label.startsWith("skills") ? /^SKILL\.md$/i.test(e.name) : true)) {
        const m = /^description:\s*(.+)$/m.exec((read(p) || "").slice(0, 3000));
        n++; b += m ? Buffer.byteLength(m[1]) + Buffer.byteLength(e.name) : Buffer.byteLength(e.name);
      }
    }
  };
  walk(dir, 0);
  if (n) add(`${label}: ${n}`, b, "solo cuenta la descripcion");
}

// MCP servers (names only: tool schemas are not knowable from config)
const mcp = new Set();
const proj = json(path.join(cwd, ".mcp.json"));
if (proj && proj.mcpServers) Object.keys(proj.mcpServers).forEach((k) => mcp.add(k));
const g = json(path.join(home, ".claude.json"));
if (g) {
  if (g.mcpServers) Object.keys(g.mcpServers).forEach((k) => mcp.add(k));
  const pj = g.projects && g.projects[cwd];
  if (pj && pj.mcpServers) Object.keys(pj.mcpServers).forEach((k) => mcp.add(k));
}
const plugins = [];
for (const f of [path.join(home, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.local.json")]) {
  const s = json(f);
  if (s && s.enabledPlugins) for (const [k, v] of Object.entries(s.enabledPlugins)) if (v && !plugins.includes(k)) plugins.push(k);
}

console.log("Lo que carga en cada sesion (aprox. tokens = bytes / 4):");
for (const [w, t, n] of rows) console.log(`  ~${String(t).padStart(6)}  ${w}${n ? "  — " + n : ""}`);
if (!rows.length) console.log("  (nada medible encontrado)");
console.log(`\nMCP servers (${mcp.size}): ${[...mcp].join(", ") || "ninguno"}`);
console.log(`Plugins activos (${plugins.length}): ${plugins.join(", ") || "ninguno"}`);
console.log("Cada MCP server anade los esquemas de sus herramientas a TODAS las sesiones (a menudo miles de tokens): desactiva los que no uses. Coste real exacto: /context.");
