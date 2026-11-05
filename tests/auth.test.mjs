// Teste do login com Google: criptografia real (RSA/HMAC do Node), Google e D1 simulados.
import worker from "../api/worker.js";
import { signSession, bytesToB64u } from "../api/auth.js";
const te = new TextEncoder();
const CID = "123456789-abc.apps.googleusercontent.com", SECRET = "s".repeat(40);

// chaves "do Google" geradas aqui
const mk = async () => { const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]); return { kp, jwk: await crypto.subtle.exportKey("jwk", kp.publicKey) }; };
const good = await mk(), other = await mk();
let jwks = { keys: [{ ...good.jwk, kid: "k1", use: "sig", alg: "RS256" }] }; let jwksFetches = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, o) => { if (String(u).includes("googleapis.com/oauth2/v3/certs")) { jwksFetches++; return new Response(JSON.stringify(jwks), { headers: { "Content-Type": "application/json" } }); } return realFetch(u, o); };
globalThis.caches = { default: { async match() {}, async put() {} } };

const b64 = (o) => bytesToB64u(te.encode(JSON.stringify(o)));
const idToken = async (claims = {}, { key = good.kp.privateKey, kid = "k1", alg = "RS256" } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  const c = { iss: "https://accounts.google.com", aud: CID, sub: "1100", email: "ana@gmail.com", email_verified: true, name: "Ana Souza", picture: "https://lh3.googleusercontent.com/a/x", iat: now, exp: now + 3600, ...claims };
  const h = b64({ alg, kid, typ: "JWT" }), p = b64(c), signed = te.encode(`${h}.${p}`);
  const sig = alg === "none" ? new Uint8Array() : new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, signed));
  return `${h}.${p}.${bytesToB64u(sig)}`;
};

// D1 simulado (só as 3 instruções usadas)
const rows = new Map();
const DB = { prepare(sql) { return { bind(...a) { return {
  async run() { if (/^INSERT INTO users/.test(sql)) { const [id, email, name, picture, now] = a; const old = rows.get(id); rows.set(id, { id, email, name, picture, created_at: old ? old.created_at : now, last_login: now }); } else if (/^DELETE FROM users/.test(sql)) rows.delete(a[0]); return {}; },
  async first() { const r = rows.get(a[0]); return r ? { name: r.name, email: r.email, picture: r.picture } : null; } }; } }; } };
const env = { GOOGLE_CLIENT_ID: CID, SESSION_SECRET: SECRET, DB };
const ctx = { waitUntil: (p) => p };
const call = async (path, { method = "GET", body, headers = {}, e = env } = {}) => { const r = await worker.fetch(new Request("https://api.test" + path, { method, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), headers }), e, ctx); let j = null; try { j = await r.json(); } catch {} return { status: r.status, j, h: r.headers }; };
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? "OK   " : "FALHA", m); };
const login = (cred) => call("/auth/google", { method: "POST", body: { credential: cred }, headers: { "Content-Type": "application/json" } });

// 1) caminho feliz
let r = await login(await idToken());
ok(r.status === 200 && r.j.token && r.j.user.email === "ana@gmail.com" && r.j.user.name === "Ana Souza", "login válido devolve sessão e perfil");
const session = r.j.token;
ok(rows.get("1100")?.email === "ana@gmail.com", "usuário gravado no banco");
const created = rows.get("1100").created_at; await new Promise((x) => setTimeout(x, 15));
await login(await idToken({ name: "Ana S." }));
ok(rows.get("1100").created_at === created && rows.get("1100").name === "Ana S." && rows.get("1100").last_login > created, "2º login atualiza perfil e last_login, mantém created_at");
ok(rows.size === 1, "sem duplicar usuário");
r = await call("/auth/me", { headers: { Authorization: `Bearer ${session}` } });
ok(r.status === 200 && r.j.user.email === "ana@gmail.com", "/auth/me com sessão válida");
ok(r.h.get("cache-control") === "no-store", "respostas de auth não são cacheadas");

// 2) ID tokens inválidos
const bad = [
  ["audiência (client id) errada", await idToken({ aud: "outro.apps.googleusercontent.com" })],
  ["emissor errado", await idToken({ iss: "https://evil.example" })],
  ["expirado", await idToken({ exp: Math.floor(Date.now() / 1000) - 3600 })],
  ["e-mail não verificado", await idToken({ email_verified: false })],
  ["sem e-mail", await idToken({ email: undefined })],
  ["assinado por outra chave", await idToken({}, { key: other.kp.privateKey })],
  ["kid desconhecido", await idToken({}, { kid: "zzz" })],
  ["alg none", await idToken({}, { alg: "none" })],
  ["emitido no futuro", await idToken({ iat: Math.floor(Date.now() / 1000) + 7200 })],
];
for (const [nome, t] of bad) { const x = await login(t); ok(x.status === 401 && !x.j.token, `recusa ID token: ${nome}`); }
const t0 = await idToken(); const [h, p, s] = t0.split(".");
const forged = `${h}.${b64({ ...JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))), sub: "9999", email: "hacker@x.com" })}.${s}`;
r = await login(forged); ok(r.status === 401 && !rows.has("9999"), "recusa payload adulterado e não cria usuário");
ok((await login("lixo")).status === 401 && (await login("")).status === 401 && (await login("a".repeat(5000))).status === 401, "recusa lixo, vazio e token gigante");

// 3) rotação de chaves: kid novo aparece no JWKS → servidor rebusca e aceita
const rot = await mk(); jwks = { keys: [{ ...good.jwk, kid: "k1" }, { ...rot.jwk, kid: "k2" }] }; const before = jwksFetches;
r = await login(await idToken({ sub: "2200", email: "bia@gmail.com" }, { key: rot.kp.privateKey, kid: "k2" }));
ok(r.status === 200 && jwksFetches > before, "chave nova do Google (rotação) é aceita após rebuscar o JWKS");

// 4) sessões inválidas
const bearer = (t) => ({ Authorization: `Bearer ${t}` });
ok((await call("/auth/me")).status === 401, "/auth/me sem token → 401");
ok((await call("/auth/me", { headers: bearer("abc.def.ghi") })).status === 401, "/auth/me com lixo → 401");
const expired = await signSession("1100", SECRET, Date.now() - 31 * 86400e3);
ok((await call("/auth/me", { headers: bearer(expired) })).status === 401, "/auth/me com sessão expirada → 401");
const wrongSecret = await signSession("1100", "x".repeat(40));
ok((await call("/auth/me", { headers: bearer(wrongSecret) })).status === 401, "/auth/me com sessão assinada por outro segredo → 401");
const hdr = bytesToB64u(te.encode(JSON.stringify({ alg: "none", typ: "JWT" }))), pay = bytesToB64u(te.encode(JSON.stringify({ sub: "1100", exp: 9999999999 })));
ok((await call("/auth/me", { headers: bearer(`${hdr}.${pay}.`) })).status === 401, "/auth/me com 'alg none' → 401");
const swap = session.split("."); const pl = JSON.parse(atob(swap[1].replace(/-/g, "+").replace(/_/g, "/"))); pl.sub = "2200";
ok((await call("/auth/me", { headers: bearer(`${swap[0]}.${b64(pl)}.${swap[2]}`) })).status === 401, "/auth/me com sessão adulterada (troca de usuário) → 401");
ok((await call("/auth/account", { method: "DELETE" })).status === 401 && rows.has("1100"), "excluir conta sem sessão → 401 e nada é apagado");

// 5) exclusão da conta (LGPD)
r = await call("/auth/account", { method: "DELETE", headers: bearer(session) });
ok(r.status === 200 && !rows.has("1100") && rows.has("2200"), "excluir conta apaga só o próprio usuário");
r = await call("/auth/me", { headers: bearer(session) }); ok(r.status === 401, "sessão antiga não funciona depois de excluir a conta");

// 6) configuração e métodos
ok((await call("/auth/me", { e: { ...env, DB: undefined } })).status === 503, "sem banco configurado → 503");
ok((await call("/auth/me", { e: { ...env, SESSION_SECRET: "curto" } })).status === 503, "segredo curto → 503");
ok((await call("/auth/me", { e: { ...env, GOOGLE_CLIENT_ID: "" } })).status === 503, "sem Client ID → 503");
ok((await call("/auth/google")).status === 404, "GET em /auth/google → 404");
ok((await call("/auth/google", { method: "POST", body: "{ não é json" })).status === 400, "JSON inválido → 400");
ok((await call("/auth/google", { method: "POST", body: "x".repeat(9000) })).status === 400, "corpo gigante → 400");
ok((await call("/macro", { method: "POST" })).status === 405, "POST fora de /auth → 405");
const pre = await worker.fetch(new Request("https://api.test/auth/google", { method: "OPTIONS" }), env, ctx);
ok(pre.status === 204 && /Authorization/.test(pre.headers.get("access-control-allow-headers")) && /POST/.test(pre.headers.get("access-control-allow-methods")), "preflight CORS permite POST e Authorization");
console.log(fails ? `\n${fails} FALHA(S)` : "\nTodos os testes de login passaram");
process.exit(fails ? 1 : 0);
