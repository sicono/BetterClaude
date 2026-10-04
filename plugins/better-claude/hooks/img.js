// Image helpers for better-claude. No dependencies: dimensions are parsed from the file header.
// Token model (Anthropic docs): tokens ~ width*height/750, and the API scales the long edge down to 1568 px
// BEFORE counting, so anything above 1568 px costs the same as 1568 px. Only images under that cap get cheaper
// by being smaller, and that costs detail: it is therefore opt-in (imgMaxEdge), never on by default.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const IMG = /\.(png|jpe?g|gif|webp)$/i;
const isImage = (p) => IMG.test(String(p || ""));
const API_EDGE = 1568;

function dims(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const b = Buffer.alloc(512 * 1024);
    const n = fs.readSync(fd, b, 0, b.length, 0);
    const u16 = (o) => b.readUInt16BE(o);
    if (n > 24 && b.toString("latin1", 1, 4) === "PNG") return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (n > 10 && b.toString("latin1", 0, 3) === "GIF") return { w: b.readUInt16LE(6), h: b.readUInt16LE(8) };
    if (n > 30 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") {
      const k = b.toString("latin1", 12, 16);
      if (k === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
      if (k === "VP8L") { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }; }
      if (k === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      return null;
    }
    if (n > 4 && b[0] === 0xff && b[1] === 0xd8) { // JPEG: walk the segments until a SOF marker
      let i = 2;
      while (i + 9 < n) {
        if (b[i] !== 0xff) { i++; continue; }
        const t = b[i + 1];
        if (t === 0xff) { i++; continue; }
        if (t === 0xd8 || t === 0x01 || (t >= 0xd0 && t <= 0xd7)) { i += 2; continue; }
        if (t >= 0xc0 && t <= 0xcf && t !== 0xc4 && t !== 0xc8 && t !== 0xcc) return { h: u16(i + 5), w: u16(i + 7) };
        i += 2 + u16(i + 2);
      }
    }
  } catch {} finally { if (fd !== undefined) try { fs.closeSync(fd); } catch {} }
  return null;
}

// Approximate tokens the model is charged for one image of this size.
function estTokens(w, h) {
  if (!(w > 0 && h > 0)) return 0;
  const s = Math.min(1, API_EDGE / Math.max(w, h));
  return Math.round((w * s * h * s) / 750);
}

const PY = `import sys
from PIL import Image, ImageOps
im = ImageOps.exif_transpose(Image.open(sys.argv[1]))
m = int(sys.argv[3])
im.thumbnail((m, m), Image.LANCZOS)
if sys.argv[2].lower().endswith((".jpg", ".jpeg")):
    im.convert("RGB").save(sys.argv[2], quality=95, subsampling=0)
else:
    im.save(sys.argv[2])`;

// Candidate resizers, tried in order; args are passed as an array (no shell), so file names cannot inject commands.
// Windows has no `convert` we can trust (it is a disk utility there), so only `magick`/python are tried.
function resizers(src, dst, m) {
  const list = [["magick", [src, "-auto-orient", "-resize", `${m}x${m}>`, "-quality", "95", dst]]];
  if (process.platform !== "win32") list.push(["convert", [src, "-auto-orient", "-resize", `${m}x${m}>`, "-quality", "95", dst]]);
  if (process.platform === "darwin") list.push(["sips", ["-Z", String(m), "-s", "formatOptions", "95", src, "--out", dst]]);
  for (const py of process.platform === "win32" ? ["python", "py"] : ["python3", "python"]) list.push([py, ["-c", PY, src, dst, String(m)]]);
  return list;
}

// Make (or reuse) a copy of `src` whose long edge is at most `m`. Returns the new path or null (fails open).
function fit(src, m, dir) {
  try {
    const st = fs.statSync(src);
    const ext = path.extname(src).toLowerCase() || ".png";
    if (ext === ".gif") return null; // animated: a single resized frame would change what the file is
    fs.mkdirSync(dir, { recursive: true });
    const key = crypto.createHash("sha1").update([path.resolve(src), st.mtimeMs, st.size, m].join("|")).digest("hex").slice(0, 16);
    const dst = path.join(dir, `img-${key}${ext}`);
    if (fs.existsSync(dst) && fs.statSync(dst).size > 0) return dst;
    for (const [bin, args] of resizers(src, dst, m)) {
      const r = spawnSync(bin, args, { timeout: 20000, stdio: "ignore", windowsHide: true });
      if (r.status === 0 && fs.existsSync(dst) && fs.statSync(dst).size > 0) return dst;
      try { fs.rmSync(dst, { force: true }); } catch {}
    }
  } catch {}
  return null;
}

module.exports = { isImage, dims, estTokens, fit, API_EDGE };
