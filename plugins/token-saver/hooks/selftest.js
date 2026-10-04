#!/usr/bin/env node
// Self-test for token-saver. Run: node selftest.js   (or /token-saver:doctor)
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const H = __dirname;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ts-self-"));
const home = path.join(sandbox, "home"); fs.mkdirSync(home);
const cwd = path.join(sandbox, "proj"); fs.mkdirSync(cwd);
const env = { ...process.env, HOME: home, USERPROFILE: home, TOKEN_SAVER_NO_LOG: "1", TOKEN_SAVER_NO_CONFIG: "1" };
delete env.TOKEN_SAVER_OFF;

let fail = 0;
const check = (ok, label) => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${label}`); };
const run = (script, input, extra = {}) =>
  spawnSync(process.execPath, [path.join(H, script)], { input: JSON.stringify(input), env: { ...env, ...extra }, encoding: "utf8" });
const guard = (tool, ti, sid) => run("guard.js", { tool_name: tool, tool_input: ti, session_id: sid, cwd }).status;

// 1) static rules  [tool, command-or-path, expected exit]
const cases = [
  ["Bash", "pm2 logs app", 2], ["Bash", "pm2 logs app --nostream --lines 200", 0],
  ["Bash", "pm2 monit", 2], ["Bash", "top", 2], ["Bash", "top -b -n 1", 0],
  ["Bash", "journalctl -u nginx", 2], ["Bash", "journalctl -u nginx -n 200 --no-pager", 0],
  ["Bash", "docker logs web", 2], ["Bash", "docker logs --tail 200 web", 0],
  ["Bash", "tail -f /var/log/x", 2], ["Bash", "tail -n 100 /var/log/x", 0],
  ["Bash", "grep -rn foo .", 2], ["Bash", "grep -rn foo src/", 0],
  ["Bash", "find . -name '*.js'", 2], ["Bash", "find . -maxdepth 2 -name '*.js'", 0],
  ["Bash", "tree", 2], ["Bash", "tree -L 2 -I node_modules", 0],
  ["Bash", "ls -R", 2], ["Bash", "ls -la", 0],
  ["Bash", "cat package-lock.json", 2], ["Bash", "cat src/index.js", 0],
  ["Bash", "git log -p", 2], ["Bash", "git log -p -n 3", 0], ["Bash", "git status", 0],
  ["Bash", "pm2 logs app # ts-allow", 0],
  ["Read", "/x/node_modules/a/index.js", 2], ["Read", "/x/dist/app.min.js", 2],
  ["Read", "C:\\proj\\node_modules\\a\\i.js", 2], ["Read", "/x/src/server.js", 0],
];
for (const [tool, v, want] of cases) {
  const st = guard(tool, tool === "Bash" ? { command: v } : { file_path: v });
  check(st === want, `${tool.padEnd(4)} ${v}  (exit ${st}, expected ${want})`);
}
check(guard("Read", { file_path: "/x/package-lock.json", limit: 50 }) === 0, "Read with explicit limit is allowed");

// 1b) cat-big (real files in the sandbox project)
fs.writeFileSync(path.join(cwd, "huge.log"), "linea de log\n".repeat(30000));
fs.writeFileSync(path.join(cwd, "small.txt"), "hola\n");
for (const [cmd, want] of [["cat huge.log", 2], ["cat -n huge.log", 2], ["cat huge.log | head -n 5", 0], ["cat small.txt", 0], ["cat > nuevo.txt", 0], ["cat huge.log > /dev/null", 0], ["cat no-existe.log", 0]]) {
  const st = guard("Bash", { command: cmd });
  check(st === want, `Bash ${cmd}  (exit ${st}, expected ${want})`);
}

// 1c) loop valve: soft rule blocks twice, lets the 3rd identical attempt through; hang rules never relax
const vs = "valve-" + process.pid;
check([1, 2, 3].map(() => guard("Bash", { command: "cat huge.log" }, vs)).join() === "2,2,0", "valve: soft rule releases on 3rd identical attempt");
check([1, 2, 3, 4].map(() => guard("Bash", { command: "pm2 logs app" }, vs)).join() === "2,2,2,2", "valve: hang rules never relax");
try { fs.rmSync(path.join(os.tmpdir(), "token-saver", vs + ".json"), { force: true }); } catch {}

// 2) duplicate-read guard
const f = path.join(cwd, "a.js"); fs.writeFileSync(f, "console.log(1)\n".repeat(50));
const sid = "selftest-" + process.pid;
check(guard("Read", { file_path: f }, sid) === 0, "dup-read: first read allowed");
check(guard("Read", { file_path: f }, sid) === 2, "dup-read: identical re-read blocked");
check(guard("Read", { file_path: f, offset: 10, limit: 20 }, sid) === 0, "dup-read: different range allowed");
fs.appendFileSync(f, "x\n");
check(guard("Read", { file_path: f }, sid) === 0, "dup-read: modified file allowed");
run("session.js", { session_id: sid, source: "compact", cwd });
check(guard("Read", { file_path: f }, sid) === 0, "dup-read: state reset after compact");
check(guard("Read", { file_path: f }, sid) === 2, "dup-read: blocks again after reset");
try { fs.rmSync(path.join(os.tmpdir(), "token-saver", sid + ".json"), { force: true }); } catch {}

// 3) auto-handoff round trip (SessionEnd -> SessionStart)
const tl = [
  { type: "user", message: { role: "user", content: "Arregla el login del panel" } },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reviso server.js" }, { type: "tool_use", name: "Edit", input: { file_path: path.join(cwd, "server.js") } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Listo, falta probar el logout." }] } },
  { type: "user", message: { role: "user", content: "ahora prueba el logout" } },
];
const tp = path.join(sandbox, "t.jsonl"); fs.writeFileSync(tp, tl.map((x) => JSON.stringify(x)).join("\n"));
run("autohandoff.js", { transcript_path: tp, cwd, reason: "clear", session_id: "s1" });
const r1 = run("session.js", { source: "clear", cwd, session_id: "s2" });
check(/login del panel/.test(r1.stdout) && /server\.js/.test(r1.stdout) && /falta probar/.test(r1.stdout), "auto-handoff: restored after /clear");
const r2 = run("session.js", { source: "clear", cwd, session_id: "s3" });
check(r2.stdout.trim() === "", "auto-handoff: injected only once");
const triv = path.join(sandbox, "triv.jsonl"); fs.writeFileSync(triv, JSON.stringify(tl[0]));
run("autohandoff.js", { transcript_path: triv, cwd, reason: "other", session_id: "s4" });
check(run("session.js", { source: "startup", cwd, session_id: "s5" }).stdout.trim() === "", "auto-handoff: trivial session writes nothing");
run("autohandoff.js", { transcript_path: tp, cwd, reason: "clear", session_id: "s6" });
check(run("session.js", { source: "resume", cwd, session_id: "s7" }).stdout.trim() === "", "auto-handoff: not injected on resume/compact");
run("autohandoff.js", { transcript_path: tp, cwd, reason: "clear", session_id: "s8" }, { TOKEN_SAVER_OFF: "1" });

// 3b) prune of old handoffs
const hdir = path.join(home, ".claude", "token-saver", "handoffs"); fs.mkdirSync(hdir, { recursive: true });
const oldUsed = path.join(hdir, "viejo.used.md"), oldStale = path.join(hdir, "caducado.md"), newUsed = path.join(hdir, "reciente.used.md");
for (const p of [oldUsed, oldStale, newUsed]) fs.writeFileSync(p, "x");
const ago = (d) => new Date(Date.now() - d * 86400000);
fs.utimesSync(oldUsed, ago(8), ago(8)); fs.utimesSync(oldStale, ago(31), ago(31)); fs.utimesSync(newUsed, ago(1), ago(1));
run("session.js", { source: "compact", cwd, session_id: "s-prune" });
check(!fs.existsSync(oldUsed) && !fs.existsSync(oldStale) && fs.existsSync(newUsed), "prune: old handoffs removed, recent kept");

// 3c) space report runs and never deletes
const sp = run("space.js", {});
check(sp.status === 0 && /token-saver|transcripciones|Total/i.test(sp.stdout), "space.js runs");
check(fs.existsSync(newUsed), "space.js does not delete anything");

// 4) manual handoff has priority
fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
fs.writeFileSync(path.join(cwd, ".claude", "handoff.md"), "Goal: MANUAL\n");
const r3 = run("session.js", { source: "clear", cwd, session_id: "s9" });
check(/MANUAL/.test(r3.stdout) && !/Auto-extracted/.test(r3.stdout), "manual handoff takes priority");

// 5) nudge
const big = path.join(sandbox, "big.jsonl"); fs.writeFileSync(big, "x".repeat(3000));
const n1 = run("nudge.js", { transcript_path: big, session_id: "n1", cwd }, { TOKEN_SAVER_WARN_KB: "1" });
let msg = ""; try { msg = JSON.parse(n1.stdout).systemMessage || ""; } catch {}
check(/sesion larga/.test(msg), "nudge: warns on big session");
check(run("nudge.js", { transcript_path: big, session_id: "n1", cwd }, { TOKEN_SAVER_WARN_KB: "1" }).stdout === "", "nudge: does not repeat");
check(run("nudge.js", { transcript_path: big, session_id: "n2", cwd }).stdout === "", "nudge: silent below threshold");
try { for (const s of ["n1", "n2"]) fs.rmSync(path.join(os.tmpdir(), "token-saver", "nudge-" + s + ".json"), { force: true }); } catch {}

// 5b) deterministic report scripts (no model involved)
fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
fs.writeFileSync(path.join(home, ".claude", "token-saver.log"), JSON.stringify({ t: new Date().toISOString(), rule: "tree", tool: "Bash" }) + "\n");
const st = run("stats.js", {});
check(st.status === 0 && /Bloqueos: 1 en total/.test(st.stdout) && /tree/.test(st.stdout), "stats.js reports blocks");
const au = spawnSync(process.execPath, [path.join(H, "audit.js")], { cwd, env, encoding: "utf8" });
check(au.status === 0 && /MCP servers/.test(au.stdout), "audit.js runs");

// 5c) bash-trim (PostToolUse): noisy + big -> trimmed, full output saved, shape kept; everything else untouched
const lines = []; for (let i = 0; i < 3000; i++) lines.push(i === 1500 ? "ERROR: fallo critico en modulo X" : `linea ${i} de salida normal del build`);
const bigOut = lines.join("\n");
const sp2 = path.join(sandbox, "scratch"); fs.mkdirSync(sp2);
const post = (cmd, resp, extra = {}, envx = {}) => run("post.js", { tool_name: "Bash", tool_input: { command: cmd }, tool_response: resp, tool_use_id: "toolu_t1", cwd, scratchpad_dir: sp2, ...extra }, envx);
const base = { stdout: bigOut, stderr: "", interrupted: false, isImage: false };
const pr = post("npm run build", base);
let upd = null; try { upd = JSON.parse(pr.stdout).hookSpecificOutput.updatedToolOutput; } catch {}
check(upd && upd.stdout.length < bigOut.length / 3 && /ERROR: fallo critico/.test(upd.stdout) && /linea 0 /.test(upd.stdout) && /linea 2999 /.test(upd.stdout), "bash-trim: trims big noisy output, keeps head/tail/errors");
check(upd && upd.interrupted === false && upd.isImage === false && upd.stderr === "", "bash-trim: output shape preserved");
check(fs.existsSync(path.join(sp2, "out-toolu_t1.txt")) && fs.readFileSync(path.join(sp2, "out-toolu_t1.txt"), "utf8").includes("linea 1499 "), "bash-trim: full output saved to file");
check(post("cat src/index.js", base).stdout === "", "bash-trim: ignores non-noisy commands (cat/grep/diff)");
check(post("npm run build", { ...base, stdout: "ok\n" }).stdout === "", "bash-trim: small output untouched");
check(post("npm run build # ts-full", base).stdout === "", "bash-trim: # ts-full skips");
check(post("npm run build", { ...base, interrupted: true }).stdout === "", "bash-trim: interrupted output untouched");
check(post("npm run build", base, {}, { TOKEN_SAVER_OFF: "1" }).stdout === "", "bash-trim: TOKEN_SAVER_OFF respected");

// 5d) stale resume warning (user-only message)
const rw = run("session.js", { source: "resume", cwd, session_id: "rw1", context_tokens: 182000, prompt_cache_likely_expired: true, estimated_cache_write_usd: 1.14 });
let rwm = ""; try { rwm = JSON.parse(rw.stdout).systemMessage || ""; } catch {}
check(/182k/.test(rwm) && /\$1\.14/.test(rwm), "resume: warns on big stale session");
check(run("session.js", { source: "resume", cwd, session_id: "rw2", context_tokens: 182000, prompt_cache_likely_expired: false }).stdout === "", "resume: silent when cache is still warm");
check(run("session.js", { source: "resume", cwd, session_id: "rw3", context_tokens: 5000, prompt_cache_likely_expired: true }).stdout === "", "resume: silent for small sessions");

// 6) environment
console.log(`\nnode ${process.version} on ${process.platform}`);
for (const x of ["hooks.json", "guard.js", "session.js", "autohandoff.js", "nudge.js", "lib.js", "space.js", "stats.js", "audit.js", "post.js"]) check(fs.existsSync(path.join(H, x)), `file ${x}`);
try { JSON.parse(fs.readFileSync(path.join(H, "hooks.json"), "utf8")); check(true, "hooks.json is valid JSON"); } catch { check(false, "hooks.json is valid JSON"); }
for (const x of [path.join(os.homedir(), ".claude", "token-saver.json"), path.join(process.cwd(), ".claude", "token-saver.json")])
  if (fs.existsSync(x)) console.log("info config found: " + x);

try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
console.log(fail ? `\n${fail} FAILED` : "\nALL OK");
process.exit(fail ? 1 : 0);
