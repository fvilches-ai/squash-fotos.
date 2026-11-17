// Servidor sin dependencias (solo Node 18+). Arranque: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "cambia-esto";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UP_DIR = path.join(DATA_DIR, "uploads");
const DB_FILE = path.join(DATA_DIR, "photos.json");
const MAX_BYTES = 15 * 1024 * 1024;
const PUBLIC = __dirname;

fs.mkdirSync(UP_DIR, { recursive: true });
let photos = [];
try { photos = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch {}
const save = () => fs.writeFileSync(DB_FILE, JSON.stringify(photos));

const MIME = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".js": "text/javascript", ".css": "text/css" };

function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return ".jpg";
  if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (b.slice(0, 4).toString() === "RIFF" && b.slice(8, 12).toString() === "WEBP") return ".webp";
  return null;
}

// Límite sencillo: 40 subidas por IP cada 10 min
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 600000);
  arr.push(now); hits.set(ip, arr);
  return arr.length > 40;
}

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;

  if (req.method === "GET" && url.pathname === "/api/photos") {
    return json(res, 200, photos.slice().reverse().map((p) => ({ id: p.id, url: "/uploads/" + p.file, name: p.name, ts: p.ts })));
  }

  if (req.method === "POST" && url.pathname === "/api/upload") {
    if (limited(ip)) return json(res, 429, { error: "Demasiadas subidas, espera un poco." });
    const chunks = []; let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BYTES) { json(res, 413, { error: "Foto demasiado grande" }); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => {
      if (res.writableEnded) return;
      const buf = Buffer.concat(chunks);
      const ext = sniff(buf);
      if (!ext) return json(res, 400, { error: "Formato no válido (usa JPG, PNG o WebP)" });
      const id = crypto.randomBytes(8).toString("hex");
      const file = id + ext;
      fs.writeFileSync(path.join(UP_DIR, file), buf);
      let name = "";
      try { name = decodeURIComponent(req.headers["x-name"] || "").slice(0, 40); } catch {}
      photos.push({ id, file, name, ts: Date.now() });
      save();
      json(res, 200, { ok: true, id });
    });
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/photos/")) {
    if (req.headers["x-admin-token"] !== ADMIN_TOKEN) return json(res, 401, { error: "No autorizado" });
    const id = url.pathname.split("/").pop();
    const i = photos.findIndex((p) => p.id === id);
    if (i < 0) return json(res, 404, { error: "No existe" });
    try { fs.unlinkSync(path.join(UP_DIR, photos[i].file)); } catch {}
    photos.splice(i, 1); save();
    return json(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
    const f = path.basename(url.pathname);
    const fp = path.join(UP_DIR, f);
    if (!fs.existsSync(fp)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
    return fs.createReadStream(fp).pipe(res);
  }

  if (req.method === "GET") {
    const page = url.pathname === "/qr" ? "qr.html" : "index.html";
    res.writeHead(200, { "Content-Type": MIME[".html"] });
    return fs.createReadStream(path.join(PUBLIC, page)).pipe(res);
  }

  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`Galería en http://localhost:${PORT}  ·  QR en /qr`));
