// Roda o Worker localmente em http://localhost:8790 (para testar o app em modo produção sem publicar).
// Uso:  node dev-server.mjs
// Opcional (variáveis de ambiente): BRAPI_TOKEN, BRAPI_PER_CALL, PORT,
//   GOOGLE_CLIENT_ID + SESSION_SECRET (32+ caracteres): liga o login com banco D1 SIMULADO em memória (só para testes locais);
//   SEED_USER='{"id":"1","email":"a@b.c","name":"Ana"}': cria um usuário de teste nesse banco simulado.
import http from "node:http";
import worker from "./worker.js";

const mem = new Map();
globalThis.caches = { default: {
  async match(r) { const v = mem.get(r.url); if (!v || v.exp < Date.now()) return undefined; return new Response(v.body, { headers: v.headers }); },
  async put(r, res) { const ttl = +(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1] || 60); mem.set(r.url, { body: await res.text(), headers: [...res.headers], exp: Date.now() + ttl * 1000 }); },
} };

// D1 simulado: só as instruções usadas pelo login
const users = new Map();
if (process.env.SEED_USER) { const u = JSON.parse(process.env.SEED_USER); users.set(u.id, { picture: "", created_at: Date.now(), last_login: Date.now(), ...u }); }
const DB = { prepare(sql) { return { bind(...a) { return {
  async run() { if (/^INSERT INTO users/.test(sql)) { const [id, email, name, picture, now] = a; const o = users.get(id); users.set(id, { id, email, name, picture, created_at: o ? o.created_at : now, last_login: now }); } else if (/^DELETE FROM users/.test(sql)) users.delete(a[0]); return {}; },
  async first() { const r = users.get(a[0]); return r ? { name: r.name, email: r.email, picture: r.picture } : null; } }; } }; } };

const env = { BRAPI_TOKEN: process.env.BRAPI_TOKEN || "", BRAPI_PER_CALL: process.env.BRAPI_PER_CALL || "", ALLOW_ORIGIN: "*",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "", SESSION_SECRET: process.env.SESSION_SECRET || "", DB: process.env.GOOGLE_CLIENT_ID ? DB : undefined };
const PORT = +process.env.PORT || 8790;

http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length && req.method !== "GET" && req.method !== "HEAD" ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers: req.headers, body }), env, { waitUntil: (p) => p });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
}).listen(PORT, () => console.log(`API Intelinvest local em http://localhost:${PORT}  (token brapi: ${env.BRAPI_TOKEN ? "sim" : "não"} | login: ${env.GOOGLE_CLIENT_ID ? "sim (banco simulado)" : "não"})`));
