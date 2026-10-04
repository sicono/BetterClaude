#!/usr/bin/env node
// /better-claude:audit — deterministic report of what loads into every session (approx tokens = bytes / 4). No model needed.
// Measures: CLAUDE.md (+ @imports), .claude/rules without `paths`, auto-memory MEMORY.md, skills/agents/commands descriptions
// (user, project AND every enabled plugin, skipping disable-model-invocation entries, which cost nothing), MCP servers.
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
const tilde = (p) => p.replace(home, "~");

// --- frontmatter: description (also YAML block scalars) and disable-model-invocation
function frontmatter(t) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t || "");
  if (!m) return { desc: "", off: false };
  const lines = m[1].split(/\r?\n/);
  let desc = "", off = false;
  for (let i = 0; i < lines.length; i++) {
    const d = /^description:\s*(.*)$/.exec(lines[i]);
    if (d) {
      desc = d[1];
      if (/^[>|][+-]?$/.test(desc.trim())) { desc = ""; while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) desc += " " + lines[++i].trim(); }
    }
    if (/^disable-model-invocation:\s*true\b/i.test(lines[i])) off = true;
  }
  return { desc: desc.trim(), off };
}

// Only the description loads at session start. Returns { n, bytes, hidden }.
function scan(dir, isSkill) {
  const r = { n: 0, bytes: 0, hidden: 0 };
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 2) walk(p, depth + 1);
      else if (e.isFile() && /\.md$/i.test(e.name) && (!isSkill || /^SKILL\.md$/i.test(e.name))) {
        const fm = frontmatter((read(p) || "").slice(0, 4000));
        if (fm.off) { r.hidden++; continue; }
        r.n++; r.bytes += Buffer.byteLength(fm.desc) + Buffer.byteLength(e.name);
      }
    }
  };
  walk(dir, 0);
  return r;
}
const scanAll = (root) => {
  const parts = [["skills", scan(path.join(root, "skills"), true)], ["agents", scan(path.join(root, "agents"), false)], ["commands", scan(path.join(root, "commands"), false)]];
  return {
    n: parts.reduce((a, [, x]) => a + x.n, 0),
    bytes: parts.reduce((a, [, x]) => a + x.bytes, 0),
    hidden: parts.reduce((a, [, x]) => a + x.hidden, 0),
    detail: parts.filter(([, x]) => x.n).map(([k, x]) => `${x.n} ${k}`).join(", "),
  };
};

// --- CLAUDE.md + @imports (resolved recursively, depth <= 4, each file once)
const seen = new Set();
function withImports(file, depth) {
  const t = read(file);
  if (t === null || seen.has(file)) return { bytes: 0, imports: 0 };
  seen.add(file);
  let bytes = Buffer.byteLength(t), imports = 0;
  if (depth < 4) {
    const noCode = t.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    for (const m of noCode.matchAll(/(?:^|\s)@(~?[\w./\\-]+\.[\w]+)/g)) {
      const target = m[1].startsWith("~") ? path.join(home, m[1].slice(1)) : path.resolve(path.dirname(file), m[1]);
      const sub = withImports(target, depth + 1);
      if (sub.bytes) { bytes += sub.bytes; imports += 1 + sub.imports; }
    }
  }
  return { bytes, imports };
}
for (const p of [path.join(cwd, "CLAUDE.md"), path.join(cwd, ".claude", "CLAUDE.md"), path.join(home, ".claude", "CLAUDE.md")]) {
  if (read(p) === null) continue;
  const { bytes, imports } = withImports(p, 0);
  const big = tok(bytes) > 2000;
  const nl = read(p).split("\n").length;
  add(tilde(p), bytes, [imports ? `incluye ${imports} @import` : "", nl > 200 ? `${nl} lineas (mejor por debajo de 200)` : "", big ? "grande: prueba /better-claude:slim-claudemd" : ""].filter(Boolean).join("; "));
}

// --- .claude/rules/*.md: those WITHOUT `paths:` frontmatter load every session
for (const [label, dir] of [["rules", path.join(home, ".claude", "rules")], ["rules (proyecto)", path.join(cwd, ".claude", "rules")]]) {
  let n = 0, cond = 0, b = 0;
  const walk = (d, depth) => {
    let ents = []; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (e.isFile() && /\.md$/i.test(e.name)) {
        const t = read(p) || "";
        const fmm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(t);
        if (fmm && /^paths:/m.test(fmm[1])) cond++; else { n++; b += Buffer.byteLength(t); }
      }
    }
  };
  walk(dir, 0);
  if (n) add(`${label}: ${n} siempre cargadas`, b, cond ? `${cond} mas solo cargan al tocar sus rutas` : "");
}

// --- auto memory index (first 200 lines / 25 KB of MEMORY.md load every session)
{
  const mem = read(path.join(home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "memory", "MEMORY.md"));
  if (mem !== null) add("memoria automatica (MEMORY.md)", Math.min(Buffer.byteLength(mem.split("\n").slice(0, 200).join("\n")), 25000), "se carga el indice, no los temas");
}

// --- skills / agents / commands (user + project): description only; hidden ones cost nothing
for (const [label, root] of [["usuario", path.join(home, ".claude")], ["proyecto", path.join(cwd, ".claude")]]) {
  const r = scanAll(root);
  if (r.n) add(`descripciones (${label}): ${r.detail}`, r.bytes, r.hidden ? `${r.hidden} con disable-model-invocation no cuentan` : "");
}

// --- MCP servers (names only: tool schemas are not knowable from config)
const mcp = new Set();
const proj = json(path.join(cwd, ".mcp.json"));
if (proj && proj.mcpServers) Object.keys(proj.mcpServers).forEach((k) => mcp.add(k));
const g = json(path.join(home, ".claude.json"));
if (g) {
  if (g.mcpServers) Object.keys(g.mcpServers).forEach((k) => mcp.add(k));
  const pj = g.projects && g.projects[cwd];
  if (pj && pj.mcpServers) Object.keys(pj.mcpServers).forEach((k) => mcp.add(k));
}

// --- enabled plugins: what each one adds to every session
const plugins = [];
for (const f of [path.join(home, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.json"), path.join(cwd, ".claude", "settings.local.json")]) {
  const s = json(f);
  if (s && s.enabledPlugins) for (const [k, v] of Object.entries(s.enabledPlugins)) if (v && !plugins.includes(k)) plugins.push(k);
}
const installed = json(path.join(home, ".claude", "plugins", "installed_plugins.json"));
function pluginDir(key) {
  try {
    const e = installed && installed.plugins && installed.plugins[key];
    if (Array.isArray(e) && e[0] && e[0].installPath && fs.existsSync(e[0].installPath)) return e[0].installPath;
    const [name, mkt] = key.split("@");
    const base = path.join(home, ".claude", "plugins", "cache", mkt || "", name);
    const vers = fs.readdirSync(base).map((v) => [v, fs.statSync(path.join(base, v)).mtimeMs]).sort((a, b) => b[1] - a[1]);
    return vers.length ? path.join(base, vers[0][0]) : null;
  } catch { return null; }
}
const prow = [];
for (const key of plugins) {
  const dir = pluginDir(key);
  if (!dir) { prow.push([key, null, "no encontrado en disco"]); continue; }
  const r = scanAll(dir);
  const pm = json(path.join(dir, ".mcp.json"));
  const names = pm ? Object.keys(pm.mcpServers || pm) : [];
  names.forEach((k) => mcp.add(`${k} (plugin ${key.split("@")[0]})`));
  prow.push([key, tok(r.bytes), [r.detail, r.hidden ? `${r.hidden} ocultos` : "", names.length ? `${names.length} MCP` : ""].filter(Boolean).join("; ")]);
}
prow.sort((a, b) => (b[1] || 0) - (a[1] || 0));

console.log("Lo que carga en cada sesion (aprox. tokens = bytes / 4):");
for (const [w, t, n] of rows) console.log(`  ~${String(t).padStart(6)}  ${w}${n ? "  — " + n : ""}`);
if (!rows.length) console.log("  (nada medible encontrado)");
console.log(`\nPlugins activos (${plugins.length}) — descripciones que anaden a cada sesion:`);
for (const [k, t, n] of prow) console.log(`  ${t === null ? "     ?" : "~" + String(t).padStart(5)}  ${k}${n ? "  — " + n : ""}`);
if (!plugins.length) console.log("  ninguno");
console.log(`\nMCP servers (${mcp.size}): ${[...mcp].join(", ") || "ninguno"}`);
console.log("Cada MCP server anade los esquemas de sus herramientas a TODAS las sesiones (a menudo miles de tokens): desactiva los que no uses. Coste real exacto: /context.");
