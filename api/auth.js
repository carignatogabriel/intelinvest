/* Login com Google (Google Identity Services) → sessão própria do Intelinvest.
   O app recebe um "ID token" do Google, o servidor VERIFICA a assinatura (RS256, chaves públicas do Google), confere emissor,
   público (seu Client ID), validade e e-mail verificado, grava o usuário no D1 e devolve um token de sessão assinado (HS256, 30 dias).
   Sem cookies: o app guarda o token e o envia no cabeçalho Authorization.
   Variáveis: GOOGLE_CLIENT_ID (var), SESSION_SECRET (secret, 32+ caracteres), DB (binding D1). */

const te = new TextEncoder(), td = new TextDecoder();
const SESSION_DAYS = 30;

export const b64uToBytes = (s) => { const t = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(t), (c) => c.charCodeAt(0)); };
export const bytesToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function parseJwt(t) {
  const p = String(t).split(".");
  if (p.length !== 3) throw new Error("jwt");
  return { h: JSON.parse(td.decode(b64uToBytes(p[0]))), c: JSON.parse(td.decode(b64uToBytes(p[1]))), sig: b64uToBytes(p[2]), signed: te.encode(`${p[0]}.${p[1]}`) };
}

/** Verifica um ID token do Google. Lança erro se qualquer checagem falhar. jwksProvider(force) devolve {keys:[...]}. */
export async function verifyGoogleIdToken(credential, env, jwksProvider, now = Date.now()) {
  if (typeof credential !== "string" || credential.length > 4096) throw new Error("credencial inválida");
  const { h, c, sig, signed } = parseJwt(credential);
  if (h.alg !== "RS256" || !h.kid) throw new Error("algoritmo");
  let jwk = (await jwksProvider(false))?.keys?.find((k) => k.kid === h.kid);
  if (!jwk) jwk = (await jwksProvider(true))?.keys?.find((k) => k.kid === h.kid); // chave pode ter sido rotacionada
  if (!jwk) throw new Error("chave desconhecida");
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed))) throw new Error("assinatura");
  const t = Math.floor(now / 1000);
  if (c.iss !== "accounts.google.com" && c.iss !== "https://accounts.google.com") throw new Error("emissor");
  if (!env.GOOGLE_CLIENT_ID || c.aud !== env.GOOGLE_CLIENT_ID) throw new Error("público");
  if (!(c.exp + 30 >= t)) throw new Error("expirado");
  if (c.iat > t + 300) throw new Error("emitido no futuro");
  if (!c.sub || !c.email || c.email_verified !== true) throw new Error("e-mail não verificado");
  return {
    sub: String(c.sub), email: String(c.email).slice(0, 200),
    name: String(c.name || String(c.email).split("@")[0]).slice(0, 120),
    picture: typeof c.picture === "string" && c.picture.startsWith("https://") ? c.picture.slice(0, 500) : "",
  };
}

const hmacKey = (secret, usage) => crypto.subtle.importKey("raw", te.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export async function signSession(uid, secret, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const h = bytesToB64u(te.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const p = bytesToB64u(te.encode(JSON.stringify({ sub: uid, iat, exp: iat + SESSION_DAYS * 86400 })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), te.encode(`${h}.${p}`));
  return `${h}.${p}.${bytesToB64u(sig)}`;
}

/** Devolve o id do usuário se o token for válido e não tiver expirado; senão null. */
export async function verifySession(token, secret, now = Date.now()) {
  try {
    const { h, c, sig, signed } = parseJwt(token);
    if (h.alg !== "HS256") return null; // evita troca de algoritmo ("alg: none")
    if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, signed))) return null;
    return c.sub && c.exp > now / 1000 ? String(c.sub) : null;
  } catch { return null; }
}

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** Rotas /auth/*. Devolve null se o caminho não for de autenticação. */
export async function handleAuth(req, url, env, jwksProvider) {
  const p = url.pathname;
  if (!p.startsWith("/auth/")) return null;
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32 || !env.DB) return json({ error: "login indisponível" }, 503);
  const bearer = () => (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

  if (p === "/auth/google" && req.method === "POST") {
    let body;
    try { const t = await req.text(); if (t.length > 8192) throw new Error("grande"); body = JSON.parse(t); } catch { return json({ error: "pedido inválido" }, 400); }
    let g;
    try { g = await verifyGoogleIdToken(body?.credential, env, jwksProvider); } catch { return json({ error: "credencial recusada" }, 401); }
    const now = Date.now();
    await env.DB.prepare("INSERT INTO users (id,email,name,picture,created_at,last_login) VALUES (?1,?2,?3,?4,?5,?5) ON CONFLICT(id) DO UPDATE SET email=?2,name=?3,picture=?4,last_login=?5")
      .bind(g.sub, g.email, g.name, g.picture, now).run();
    return json({ token: await signSession(g.sub, env.SESSION_SECRET, now), user: { name: g.name, email: g.email, picture: g.picture } });
  }
  if (p === "/auth/me" && req.method === "GET") {
    const uid = await verifySession(bearer(), env.SESSION_SECRET);
    if (!uid) return json({ error: "sessão inválida" }, 401);
    const u = await env.DB.prepare("SELECT name,email,picture FROM users WHERE id=?1").bind(uid).first();
    return u ? json({ user: u }) : json({ error: "conta não encontrada" }, 401);
  }
  if (p === "/auth/account" && req.method === "DELETE") { // direito de eliminação (LGPD, art. 18)
    const uid = await verifySession(bearer(), env.SESSION_SECRET);
    if (!uid) return json({ error: "sessão inválida" }, 401);
    await env.DB.prepare("DELETE FROM users WHERE id=?1").bind(uid).run();
    return json({ ok: true });
  }
  return json({ error: "não encontrado" }, 404);
}
