#!/usr/bin/env node
// Self-test for better-claude. Run: node selftest.js   (or /better-claude:doctor)
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const H = __dirname;
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "ts-self-"));
const home = path.join(sandbox, "home"); fs.mkdirSync(home);
const cwd = path.join(sandbox, "proj"); fs.mkdirSync(cwd);
const env = { ...process.env, HOME: home, USERPROFILE: home, BETTER_CLAUDE_NO_LOG: "1", BETTER_CLAUDE_NO_CONFIG: "1" };
delete env.BETTER_CLAUDE_OFF;

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
  ["Bash", "kubectl logs -f pod", 2], ["Bash", "kubectl logs pod", 2], ["Bash", "kubectl logs --tail=200 pod", 0],
  ["Bash", "ping 8.8.8.8", process.platform === "win32" ? 0 : 2], ["Bash", "ping -c 4 8.8.8.8", 0],
  ["Bash", "adb logcat", 2], ["Bash", "adb logcat -d -t 200", 0],
  ["Bash", "git log", 2], ["Bash", "git log --oneline -n 20", 0], ["Bash", "git log -5", 0], ["Bash", "git log -- src/a.js", 0], ["Bash", "git log main..HEAD", 0],
  ["Bash", "npm ls", 2], ["Bash", "npm ls --depth=0", 0], ["Bash", "npm ls lodash", 0],
  ["Bash", "tail -f x | grep err", 2], ["Bash", "pm2 logs app | head -n 5", 2], ["Bash", "timeout 10 tail -f x", 0],
  ["Bash", "cat release.zip", 2], ["Bash", "cat app.db", 2], ["Bash", "cat release.zip | gunzip", 0], ["Bash", "cat notes.txt", 0],
  ["Bash", "cat build.output; ls -la Builds/app.exe", 0], ["Bash", "cat \"C:/tmp/a b/shot.png\"", 2], ["Bash", "cat -A notes.txt; cat x.dll", 2],
  ["Bash", "ls node_modules", 2], ["Bash", "ls ./node_modules/", 2], ["Bash", "ls node_modules/lodash", 0], ["Bash", "find node_modules -name '*.d.ts'", 0], ["Bash", "ls node_modules | head -n 20", 0],
  ["Bash", "git log | head -n 20", 0], ["Bash", "journalctl -u nginx | tail -n 50", 0],
  ["Bash", "blender scene.blend", 2], ["Bash", "blender -b scene.blend --python x.py", 0], ["Bash", "blender --version", 0], ["Bash", "timeout 60 blender scene.blend", 0],
  ["Bash", "blender scene.blend # ts-allow", 0], ["Bash", "grep blender notes.txt", 0], ["Bash", "cd p && /opt/blender/blender x.blend | head -n 5", 2], ["Bash", "cat model.blend", 2], ["Bash", "cat render.exr", 2],
  // blender named inside quotes is not blender being run (2.4.0 took the | inside the pattern for a pipe)
  ["Bash", 'tasklist //FO CSV //NH | grep -iE "UnrealEditor|RouteMountainUE|blender" | head -3', 0], ["Bash", "echo 'a|blender b'", 0],
  ["Bash", 'pgrep -f "blender "', 0], ["Bash", 'git commit -m "fix; blender x"', 0],
  // the -b must be blender's own, and a quoted path with spaces is still blender
  ["Bash", "ls -b; blender x.blend", 2], ["Bash", "blender x.blend && echo -b", 2],
  ["Bash", '"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b x.blend -P s.py', 0],
  ["Bash", '"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" x.blend', 2],
  ["Bash", '"C:\\Program Files\\Blender\\blender.exe" x.blend', 2], ["Bash", "sudo blender x.blend", 2], ["Bash", "FOO=1 blender -b x.blend", 0],
  ["Read", "/x/scene.blend", 2], ["Read", "/x/model.glb", 2], ["Read", "/x/pack.zip", 2], ["Read", "/x/notes.txt", 0],
  ["Read", "/x/node_modules/a/index.js", 2], ["Read", "/x/dist/app.min.js", 2],
  ["Read", "C:\\proj\\node_modules\\a\\i.js", 2], ["Read", "/x/src/server.js", 0],
];
for (const [tool, v, want] of cases) {
  const st = guard(tool, tool === "Bash" ? { command: v } : { file_path: v });
  check(st === want, `${tool.padEnd(4)} ${v}  (exit ${st}, expected ${want})`);
}
check(guard("Read", { file_path: "/x/package-lock.json", limit: 50 }) === 0, "Read with explicit limit is allowed");
check(guard("Read", { file_path: "/x/scene.blend", limit: 50 }) === 2, "read-binary: an explicit limit does not make a binary readable");

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
try { fs.rmSync(path.join(os.tmpdir(), "better-claude", vs + ".json"), { force: true }); } catch {}

// 2) duplicate-read guard
const f = path.join(cwd, "a.js"); fs.writeFileSync(f, "console.log(1)\n".repeat(50));
const sid = "selftest-" + process.pid;
check(guard("Read", { file_path: f }, sid) === 0, "dup-read: first read allowed");
check(guard("Read", { file_path: f }, sid) === 2, "dup-read: identical re-read blocked");
check(guard("Read", { file_path: f, offset: 10, limit: 20 }, sid) === 2, "dup-read: range inside an earlier full read blocked");
// ranges: a 3000-line file read in full covers only lines 1-2000 (Read default)
const f2 = path.join(cwd, "long.js"); fs.writeFileSync(f2, "console.log(1)\n".repeat(3000));
check(guard("Read", { file_path: f2 }, sid) === 0, "dup-read: long file, first read allowed");
check(guard("Read", { file_path: f2, offset: 2500, limit: 100 }, sid) === 0, "dup-read: range beyond the 2000 lines already shown is allowed");
check(guard("Read", { file_path: f2, offset: 100, limit: 50 }, sid) === 2, "dup-read: range within the 2000 shown lines blocked");
// a big file read without limit may have failed ("too large"): never recorded, so a later ranged read is allowed
const f3 = path.join(cwd, "huge.js"); fs.writeFileSync(f3, "console.log(1)\n".repeat(6000));
check(guard("Read", { file_path: f3 }, sid) === 0 && guard("Read", { file_path: f3, offset: 10, limit: 20 }, sid) === 0, "dup-read: big no-limit read is not recorded");
check(guard("Read", { file_path: f3, offset: 10, limit: 20 }, sid) === 2, "dup-read: identical explicit range blocked");
fs.appendFileSync(f, "x\n");
check(guard("Read", { file_path: f }, sid) === 0, "dup-read: modified file allowed");
run("session.js", { session_id: sid, source: "compact", cwd });
check(guard("Read", { file_path: f }, sid) === 0, "dup-read: state reset after compact");
check(guard("Read", { file_path: f }, sid) === 2, "dup-read: blocks again after reset");
try { fs.rmSync(path.join(os.tmpdir(), "better-claude", sid + ".json"), { force: true }); } catch {}

// 2b) images + Blender: dimensions, dup-image, img-fit (opt-in), blender-shot. PNGs are generated in pure Node (zlib + crc32).
const zlib = require("zlib");
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const pngChunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
const makePng = (w, h, seed = 0) => {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3, seed); row[0] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), pngChunk("IEND", Buffer.alloc(0))]);
};
const imgMod = require("./img.js");
const png1 = path.join(cwd, "shot.png"); fs.writeFileSync(png1, makePng(800, 450));
const png2 = path.join(cwd, "otra.png"); fs.writeFileSync(png2, makePng(640, 360, 7));
const pd = imgMod.dims(png1);
check(pd && pd.w === 800 && pd.h === 450, "img: PNG dimensions parsed from the header");
check(imgMod.estTokens(4000, 3000) === imgMod.estTokens(1568, 1176) && imgMod.estTokens(800, 450) === 480, "img: token estimate (w*h/750, long edge capped at 1568)");
check(imgMod.dims(f) === null, "img: non-image has no dimensions");
const sidI = "selftest-img-" + process.pid;
check(guard("Read", { file_path: png1 }, sidI) === 0, "dup-image: first view allowed");
check(guard("Read", { file_path: png1 }, sidI) === 2, "dup-image: same unchanged image blocked");
check(guard("Read", { file_path: png2 }, sidI) === 0, "dup-image: a different image is allowed");
check(guard("Read", { file_path: png1 }, sidI) === 0, "dup-image: valve releases on the 2nd identical retry");
fs.writeFileSync(png2, makePng(640, 361, 9));
check(guard("Read", { file_path: png2 }, sidI) === 0, "dup-image: regenerated image (new size/mtime) allowed");
const sidI2 = sidI + "b";
guard("Read", { file_path: png1 }, sidI2);
run("session.js", { session_id: sidI2, source: "compact", cwd });
check(guard("Read", { file_path: png1 }, sidI2) === 0, "dup-image: state reset after compact");
const dr = run("guard.js", { tool_name: "Read", tool_input: { file_path: png1 }, session_id: sidI2, cwd });
check(dr.status === 2 && /800x450/.test(dr.stderr) && /480 tokens/.test(dr.stderr), "dup-image: message carries size and token estimate");
for (const x of [sidI, sidI2]) try { fs.rmSync(path.join(os.tmpdir(), "better-claude", x + ".json"), { force: true }); } catch {}

// img-fit is OFF by default and, when on, only acts on images larger than imgMaxEdge
const bigPng = path.join(cwd, "bigPng.png"); fs.writeFileSync(bigPng, makePng(2400, 1200));
check(guard("Read", { file_path: bigPng }, "selftest-fit0-" + process.pid) === 0, "img-fit: off by default (no quality change unless asked)");
const fr = run("guard.js", { tool_name: "Read", tool_input: { file_path: bigPng }, session_id: "selftest-fit-" + process.pid, cwd }, { BETTER_CLAUDE_IMG_MAX_EDGE: "1000" });
if (fr.status === 2) {
  const cp = (/: (\S+\.png)/.exec(fr.stderr) || [])[1];
  const cd = cp && imgMod.dims(cp);
  check(cd && Math.max(cd.w, cd.h) <= 1000 && cd.w / cd.h > 1.9 && cd.w / cd.h < 2.1, "img-fit: copy made, long edge <= imgMaxEdge, aspect ratio kept");
  check(fs.statSync(bigPng).size > 0 && imgMod.dims(bigPng).w === 2400, "img-fit: original untouched");
  check(cp && run("guard.js", { tool_name: "Read", tool_input: { file_path: cp }, session_id: "selftest-fit-" + process.pid, cwd }, { BETTER_CLAUDE_IMG_MAX_EDGE: "1000" }).status === 0, "img-fit: the reduced copy itself is allowed");
  check(run("guard.js", { tool_name: "Read", tool_input: { file_path: bigPng }, session_id: "selftest-fit-" + process.pid, cwd }, { BETTER_CLAUDE_IMG_MAX_EDGE: "1000" }).status === 0, "img-fit: repeating the Read on the original passes (full resolution on demand)");
} else check(fr.status === 0, "img-fit: no resizer on this machine -> fails open (image read as is)");
check(guard("Read", { file_path: png1 }, "selftest-fit1-" + process.pid) === 0, "img-fit: images under the limit are never touched");

// blender-shot (Blender MCP): repeated identical viewport screenshot with no scene change in between
const SH = "mcp__blender__get_viewport_screenshot";
const sb = (tag) => "selftest-bl-" + tag + "-" + process.pid;
check([1, 2, 3].map(() => guard(SH, { max_size: 800 }, sb("a"))).join() === "0,2,0", "blender-shot: identical screenshot blocked once, then released");
check([guard(SH, { max_size: 800 }, sb("b")), guard("mcp__blender__execute_blender_code", { code: "pass" }, sb("b")), guard(SH, { max_size: 800 }, sb("b"))].join() === "0,0,0", "blender-shot: allowed after the scene changed (execute_blender_code)");
check([guard(SH, { max_size: 800 }, sb("c")), guard("mcp__blender__get_scene_info", {}, sb("c")), guard(SH, { max_size: 800 }, sb("c"))].join() === "0,0,2", "blender-shot: read-only getters do not count as scene changes");
check([guard(SH, { max_size: 800 }, sb("d")), guard(SH, { max_size: 1200 }, sb("d"))].join() === "0,0", "blender-shot: different arguments are a different image");
check([guard("mcp__blender-mcp__get_viewport_screenshot", {}, sb("e")), guard("mcp__blender-mcp__get_viewport_screenshot", {}, sb("e"))].join() === "0,2", "blender-shot: any server name containing 'blender'");
check([guard("mcp__other__get_viewport_screenshot", {}, sb("f")), guard("mcp__other__get_viewport_screenshot", {}, sb("f"))].join() === "0,0", "blender-shot: other MCP servers untouched");
check(JSON.parse(fs.readFileSync(path.join(H, "hooks.json"), "utf8")).hooks.PreToolUse[0].matcher.includes("lender"), "hooks.json: PreToolUse matcher covers the Blender MCP");
for (const x of "abcdef") try { fs.rmSync(path.join(os.tmpdir(), "better-claude", sb(x) + ".json"), { force: true }); } catch {}

// 3) auto-handoff round trip (SessionEnd -> SessionStart)
const tl = [
  { type: "user", message: { role: "user", content: "Arregla el login del panel" } },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Reviso server.js" }, { type: "tool_use", name: "Edit", input: { file_path: path.join(cwd, "server.js") } }] } },
  { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } },
  { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Listo, falta probar el logout." }] } },
  { type: "user", message: { role: "user", content: "<button> ahora prueba el logout" } },
  { type: "user", message: { role: "user", content: "<command-name>/clear</command-name>" } },
];
const tp = path.join(sandbox, "t.jsonl"); fs.writeFileSync(tp, tl.map((x) => JSON.stringify(x)).join("\n"));
run("autohandoff.js", { transcript_path: tp, cwd, reason: "clear", session_id: "s1" });
const r1 = run("session.js", { source: "clear", cwd, session_id: "s2" });
check(/login del panel/.test(r1.stdout) && /server\.js/.test(r1.stdout) && /falta probar/.test(r1.stdout), "auto-handoff: restored after /clear");
check(/<button> ahora prueba/.test(r1.stdout) && !/command-name/.test(r1.stdout), "auto-handoff: keeps user prompts that start with <, drops harness wrappers");
const r2 = run("session.js", { source: "clear", cwd, session_id: "s3" });
check(r2.stdout.trim() === "", "auto-handoff: injected only once");
const triv = path.join(sandbox, "triv.jsonl"); fs.writeFileSync(triv, JSON.stringify(tl[0]));
run("autohandoff.js", { transcript_path: triv, cwd, reason: "other", session_id: "s4" });
check(run("session.js", { source: "startup", cwd, session_id: "s5" }).stdout.trim() === "", "auto-handoff: trivial session writes nothing");
run("autohandoff.js", { transcript_path: tp, cwd, reason: "clear", session_id: "s6" });
check(run("session.js", { source: "resume", cwd, session_id: "s7" }).stdout.trim() === "", "auto-handoff: not injected on resume/compact");
run("autohandoff.js", { transcript_path: tp, cwd, reason: "clear", session_id: "s8" }, { BETTER_CLAUDE_OFF: "1" });

// 3b) prune of old handoffs
const hdir = path.join(home, ".claude", "better-claude", "handoffs"); fs.mkdirSync(hdir, { recursive: true });
const oldUsed = path.join(hdir, "viejo.used.md"), oldStale = path.join(hdir, "caducado.md"), newUsed = path.join(hdir, "reciente.used.md");
for (const p of [oldUsed, oldStale, newUsed]) fs.writeFileSync(p, "x");
const ago = (d) => new Date(Date.now() - d * 86400000);
fs.utimesSync(oldUsed, ago(8), ago(8)); fs.utimesSync(oldStale, ago(31), ago(31)); fs.utimesSync(newUsed, ago(1), ago(1));
run("session.js", { source: "compact", cwd, session_id: "s-prune" });
check(!fs.existsSync(oldUsed) && !fs.existsSync(oldStale) && fs.existsSync(newUsed), "prune: old handoffs removed, recent kept");

// 3c) space report runs and never deletes
const sp = run("space.js", {});
check(sp.status === 0 && /better-claude|transcripciones|Total/i.test(sp.stdout), "space.js runs");
check(fs.existsSync(newUsed), "space.js does not delete anything");

// 4) manual handoff has priority
fs.mkdirSync(path.join(cwd, ".claude"), { recursive: true });
fs.writeFileSync(path.join(cwd, ".claude", "handoff.md"), "Goal: MANUAL\n");
const r3 = run("session.js", { source: "clear", cwd, session_id: "s9" });
check(/MANUAL/.test(r3.stdout) && !/Auto-extracted/.test(r3.stdout), "manual handoff takes priority");

// 5) nudge
const big = path.join(sandbox, "big.jsonl"); fs.writeFileSync(big, "x".repeat(3000));
const n1 = run("nudge.js", { transcript_path: big, session_id: "n1", cwd }, { BETTER_CLAUDE_WARN_KB: "1" });
let msg = ""; try { msg = JSON.parse(n1.stdout).systemMessage || ""; } catch {}
check(/sesion larga/.test(msg), "nudge: warns on big session");
check(run("nudge.js", { transcript_path: big, session_id: "n1", cwd }, { BETTER_CLAUDE_WARN_KB: "1" }).stdout === "", "nudge: does not repeat");
check(run("nudge.js", { transcript_path: big, session_id: "n2", cwd }).stdout === "", "nudge: silent below threshold");
try { for (const s of ["n1", "n2"]) fs.rmSync(path.join(os.tmpdir(), "better-claude", "nudge-" + s + ".json"), { force: true }); } catch {}

// 5b) deterministic report scripts (no model involved)
fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
fs.writeFileSync(path.join(home, ".claude", "better-claude.log"), JSON.stringify({ t: new Date().toISOString(), rule: "tree", tool: "Bash" }) + "\n");
const st = run("stats.js", {});
check(st.status === 0 && /Bloqueos: 1 en total/.test(st.stdout) && /tree/.test(st.stdout), "stats.js reports blocks");
fs.writeFileSync(path.join(cwd, "CLAUDE.md"), "# Proyecto\n@extra.md\n"); fs.writeFileSync(path.join(cwd, "extra.md"), "x".repeat(400));
const pdir = path.join(home, ".claude", "plugins", "cache", "mk", "foo", "1.0.0", "commands"); fs.mkdirSync(pdir, { recursive: true });
fs.writeFileSync(path.join(pdir, "a.md"), "---\ndescription: Hace una cosa util\n---\nbody\n");
fs.writeFileSync(path.join(pdir, "b.md"), "---\ndescription: oculto\ndisable-model-invocation: true\n---\nbody\n");
fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({ enabledPlugins: { "foo@mk": true } }));
const au = spawnSync(process.execPath, [path.join(H, "audit.js")], { cwd, env, encoding: "utf8" });
check(au.status === 0 && /MCP servers/.test(au.stdout), "audit.js runs");
check(/incluye 1 @import/.test(au.stdout), "audit: counts CLAUDE.md @imports");
check(/foo@mk\s+— 1 commands; 1 ocultos/.test(au.stdout), "audit: measures plugin descriptions, hidden commands cost nothing");

fs.appendFileSync(path.join(home, ".claude", "better-claude.log"), JSON.stringify({ t: new Date().toISOString(), rule: "dup-read", tool: "Read", bytes: 400000 }) + "\n");
check(/relecturas/.test(run("stats.js", {}).stdout), "stats: reports text avoided by dup-read");

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
post("npm run build", base, {}, { BETTER_CLAUDE_NO_LOG: "0" });
const st2 = run("stats.js", {});
check(/Bloqueos: 2 en total/.test(st2.stdout) && /Recortes de salida: 1 en total/.test(st2.stdout) && /KB de texto/.test(st2.stdout), "stats: reports trims separately from blocks");
check(post("npm run build # ts-full", base).stdout === "", "bash-trim: # ts-full skips");
check(post("npm run build", { ...base, interrupted: true }).stdout === "", "bash-trim: interrupted output untouched");
check(post("npm run build", base, {}, { BETTER_CLAUDE_OFF: "1" }).stdout === "", "bash-trim: BETTER_CLAUDE_OFF respected");

const ansi = "\x1b[32mok linea repetida\x1b[0m\n".repeat(500) + "progreso 10%\rprogreso 60%\rprogreso 100%\nfin\n";
let sqz = null; try { sqz = JSON.parse(post("npm install", { ...base, stdout: ansi }).stdout).hookSpecificOutput.updatedToolOutput; } catch {}
check(sqz && /repeated 500x/.test(sqz.stdout) && !/\x1b/.test(sqz.stdout) && /progreso 100%/.test(sqz.stdout) && !/progreso 10%/.test(sqz.stdout) && /fin/.test(sqz.stdout), "bash-squeeze: lossless cleanup (ANSI, progress bars, repeated lines) below the trim threshold");
check(post("npm install", { ...base, stdout: "ok\n".repeat(300) }).stdout === "", "bash-squeeze: not worth rewriting -> untouched");
for (const c of ["terraform plan", "poetry install", "next build", "cmake --build ."])
  check(/updatedToolOutput/.test(post(c, base).stdout), `bash-trim: recognizes ${c}`);

// 5c2) diff-omit: lockfile diffs replaced by a summary, real code diffs and following commit headers untouched
const hunk = (n, sign) => Array.from({ length: n }, (_, i) => `${sign}  "dep-${i}": "1.0.${i}",`).join("\n");
const diffOut = [
  "diff --git a/package-lock.json b/package-lock.json", "index 111..222 100644", "--- a/package-lock.json", "+++ b/package-lock.json", "@@ -1,50 +1,50 @@",
  hunk(120, "-"), hunk(120, "+"),
  "diff --git a/src/app.js b/src/app.js", "index 333..444 100644", "--- a/src/app.js", "+++ b/src/app.js", "@@ -1,3 +1,3 @@", " const a = 1;", "-const b = 2;", "+const b = 3;", " const c = 4;",
  "commit abc123", "Author: A <a@b.c>", "", "    mensaje del siguiente commit", "",
  "diff --git a/dist/app.min.js b/dist/app.min.js", "index 555..666 100644", "--- a/dist/app.min.js", "+++ b/dist/app.min.js", "@@ -1 +1 @@", "-" + "x".repeat(2000), "+" + "y".repeat(2000), "",
].join("\n");
const dp = post("git diff", { ...base, stdout: diffOut });
let du = null; try { du = JSON.parse(dp.stdout).hookSpecificOutput.updatedToolOutput; } catch {}
check(du && /diff of generated\/lockfile content omitted \(\+120 -120 lines/.test(du.stdout) && !/dep-50/.test(du.stdout), "diff-omit: lockfile diff summarized");
check(du && /\+const b = 3;/.test(du.stdout) && /-const b = 2;/.test(du.stdout), "diff-omit: normal code diff kept intact");
check(du && /commit abc123/.test(du.stdout) && /mensaje del siguiente commit/.test(du.stdout), "diff-omit: text after the omitted diff (next commit header) preserved");
check(du && /app\.min\.js[^\n]*\n\[better-claude\]/.test(du.stdout) && du.stdout.length < diffOut.length / 4, "diff-omit: minified file diff summarized");
check(fs.existsSync(path.join(sp2, "out-toolu_t1.txt")) && fs.readFileSync(path.join(sp2, "out-toolu_t1.txt"), "utf8").includes("dep-50"), "diff-omit: full output saved to file");
const onlyCode = ["diff --git a/src/app.js b/src/app.js", "--- a/src/app.js", "+++ b/src/app.js", "@@ -1 +1 @@", ...Array.from({ length: 200 }, (_, i) => "+linea de codigo " + i), ""].join("\n");
check(post("git diff", { ...base, stdout: onlyCode }).stdout === "", "diff-omit: diff without generated files untouched");
check(post("git diff # ts-full", { ...base, stdout: diffOut }).stdout === "", "diff-omit: # ts-full skips");
check(post("git diff", { ...base, stdout: diffOut }, {}, { BETTER_CLAUDE_OFF: "1" }).stdout === "", "diff-omit: BETTER_CLAUDE_OFF respected");

// 5c3) Blender CLI: render progress ticks collapsed, every real line (warnings, Saved:, errors) kept
const tick = (i) => `Fra:1 Mem:25.00M (Peak 25.37M) | Time:00:${String(i % 60).padStart(2, "0")}.10 | Mem:0.00M, Peak:0.00M | Scene, ViewLayer | Sample ${i}/400`;
const blOut = ["Blender 4.2.0 (hash abc123)", "Read blend: /p/scene.blend", ...Array.from({ length: 400 }, (_, i) => tick(i + 1)), "Warning: texture missing foo.png", "Saved: '/tmp/0001.png'", " Time: 00:12.30 (Saving: 00:00.10)", ""].join("\n");
let bu = null; try { bu = JSON.parse(post("blender -b scene.blend -o //out_#### -f 1", { ...base, stdout: blOut }).stdout).hookSpecificOutput.updatedToolOutput; } catch {}
check(bu && /Sample 400\/400/.test(bu.stdout) && /400 progress lines collapsed/.test(bu.stdout) && !/Sample 200\/400/.test(bu.stdout) && bu.stdout.length < blOut.length / 10, "blender: progress ticks collapsed to the last one");
check(bu && /Warning: texture missing foo\.png/.test(bu.stdout) && /Saved: '\/tmp\/0001\.png'/.test(bu.stdout) && /Blender 4\.2\.0/.test(bu.stdout) && /Time: 00:12\.30/.test(bu.stdout), "blender: warnings, Saved: and header lines kept");
for (const c of ["cd proj && /usr/bin/blender -b x.blend -a", "xvfb-run -a blender -b x.blend -f 1", "\"C:\\Program Files\\Blender\\blender.exe\" -b x.blend -f 1"])
  check(/updatedToolOutput/.test(post(c, { ...base, stdout: blOut }).stdout), `blender: recognizes ${c}`);
check(post("grep blender notes.txt", { ...base, stdout: blOut }).stdout === "", "blender: grep/cat that merely mention blender are untouched");
check(post("blender -b scene.blend -f 1 # ts-full", { ...base, stdout: blOut }).stdout === "", "blender: # ts-full skips");

// 5d) stale resume warning (user-only message)
const rw = run("session.js", { source: "resume", cwd, session_id: "rw1", context_tokens: 182000, prompt_cache_likely_expired: true, estimated_cache_write_usd: 1.14 });
let rwm = ""; try { rwm = JSON.parse(rw.stdout).systemMessage || ""; } catch {}
check(/182k/.test(rwm) && /\$1\.14/.test(rwm), "resume: warns on big stale session");
check(run("session.js", { source: "resume", cwd, session_id: "rw2", context_tokens: 182000, prompt_cache_likely_expired: false }).stdout === "", "resume: silent when cache is still warm");
check(run("session.js", { source: "resume", cwd, session_id: "rw3", context_tokens: 5000, prompt_cache_likely_expired: true }).stdout === "", "resume: silent for small sessions");

// 5e) commands are user-only: no description loaded into every session
const cdir = path.join(H, "..", "commands");
for (const c of fs.readdirSync(cdir)) check(/^disable-model-invocation:\s*true$/m.test(fs.readFileSync(path.join(cdir, c), "utf8")), `command ${c}: disable-model-invocation`);

// 6) environment
console.log(`\nnode ${process.version} on ${process.platform}`);
for (const x of ["hooks.json", "guard.js", "session.js", "autohandoff.js", "nudge.js", "lib.js", "space.js", "stats.js", "audit.js", "post.js", "img.js"]) check(fs.existsSync(path.join(H, x)), `file ${x}`);
try { JSON.parse(fs.readFileSync(path.join(H, "hooks.json"), "utf8")); check(true, "hooks.json is valid JSON"); } catch { check(false, "hooks.json is valid JSON"); }
for (const x of [path.join(os.homedir(), ".claude", "better-claude.json"), path.join(process.cwd(), ".claude", "better-claude.json")])
  if (fs.existsSync(x)) console.log("info config found: " + x);

try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
console.log(fail ? `\n${fail} FAILED` : "\nALL OK");
process.exit(fail ? 1 : 0);
