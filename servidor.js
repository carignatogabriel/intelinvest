// Servidor local simples: serve o app e mostra o endereço para abrir no celular (mesma rede Wi-Fi).
// Opcional: ROOT=<pasta> serve outra pasta (ex.: dist); CSP="<política>" adiciona o cabeçalho de segurança para testar.
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const PORT = +process.env.PORT || 8080;
const ROOT = path.resolve(process.env.ROOT || __dirname);
const CSP = process.env.CSP || "";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  const f = path.join(ROOT, path.normalize(p));
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); return res.end("não encontrado"); }
    const h = { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-cache" };
    if (CSP) h["Content-Security-Policy"] = CSP;
    res.writeHead(200, h);
    res.end(data);
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log("\n  Intelinvest rodando.\n");
  console.log(`  No PC:      http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const i of list) if (i.family === "IPv4" && !i.internal) console.log(`  No celular: http://${i.address}:${PORT}   (mesmo Wi-Fi)`);
  console.log("\n  Feche esta janela para parar.\n");
});
