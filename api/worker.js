/* Intelinvest API — Cloudflare Worker.
   Faz a ponte entre o app e as fontes de dados: guarda o token da brapi no servidor, agrupa/divide chamadas conforme o limite do plano
   e mantém cache na borda, de modo que UMA consulta atende todos os usuários (essencial para escalar e respeitar limites de cota).
   Variáveis: BRAPI_TOKEN (secret), BRAPI_PER_CALL (tickers por chamada: "1" gratuito, "10" Startup, "20" Pro),
   AWESOME_KEY (secret, opcional: câmbio mais frequente; sem ela usa a PTAX do Banco Central), ALLOW_ORIGIN (opcional). */

import { handleAuth } from "./auth.js";

const BRAPI = "https://brapi.dev/api";
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
const SYMBOL = /^(\^[A-Z]{3,8}|[A-Z0-9]{4}\d{0,2}[A-Z]?)$/;
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"]);
const INTERVALS = new Set(["1m", "2m", "5m", "15m", "30m", "60m", "1h", "1d", "5d", "1wk", "1mo", "3mo"]);
const TYPES = new Set(["stock", "fund", "bdr"]);
const MAX_SYMBOLS = 40;

/** Pregão da B3 (aprox.): dias úteis, 10h–18h de Brasília. Fora disso os dados mudam pouco, então o cache dura mais. */
function marketOpen(now = new Date()) {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "numeric", hour12: false }).formatToParts(now);
  const g = (t) => p.find((x) => x.type === t)?.value;
  return !["Sat", "Sun"].includes(g("weekday")) && +g("hour") % 24 >= 10 && +g("hour") % 24 < 18;
}
const ttlLive = () => (marketOpen() ? 120 : 1800);
const ttlHist = () => (marketOpen() ? 900 : 7200);

const perCall = (env) => Math.max(1, Math.min(20, parseInt(env.BRAPI_PER_CALL || (env.BRAPI_TOKEN ? "10" : "1"), 10) || 1));

function cors(res, env) {
  const h = new Headers(res.headers);
  h.set("Access-Control-Allow-Origin", env.ALLOW_ORIGIN || "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(res.body, { status: res.status, headers: h });
}
const json = (obj, ttl = 0, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": ttl ? `public, max-age=${Math.min(ttl, 60)}` : "no-store" },
});

/** Busca no upstream com cache na borda. Devolve o texto JSON (ou null se falhar). */
async function cached(key, ttl, url, ctx) {
  const cache = globalThis.caches?.default;
  const ck = new Request(`https://cache.intelinvest.internal/${encodeURIComponent(key)}`);
  if (cache) { const hit = await cache.match(ck); if (hit) return hit.text(); }
  let res = null;
  for (let attempt = 0; attempt < 3; attempt++) { // fontes gratuitas oscilam (429/5xx): até 3 tentativas com pausa crescente
    try { res = await fetch(url, { headers: { "User-Agent": "Intelinvest/1.0", Accept: "application/json" }, cf: { cacheTtl: ttl, cacheEverything: true } }); }
    catch { res = null; }
    if (res && res.ok) break;
    if (res && res.status >= 400 && res.status < 500 && res.status !== 429) return null; // erro do pedido: não adianta repetir
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
  }
  if (!res || !res.ok) return null;
  const body = await res.text();
  if (cache) ctx.waitUntil(cache.put(ck, new Response(body, { headers: { "Cache-Control": `public, max-age=${ttl}`, "Content-Type": "application/json" } })));
  return body;
}

const withToken = (u, env) => (env.BRAPI_TOKEN ? `${u}${u.includes("?") ? "&" : "?"}token=${encodeURIComponent(env.BRAPI_TOKEN)}` : u);

async function list(url, env, ctx) {
  const type = url.searchParams.get("type") || "stock";
  if (!TYPES.has(type)) return json({ error: "type inválido" }, 0, 400);
  const limit = Math.min(1000, Math.max(1, parseInt(url.searchParams.get("limit") || "1000", 10) || 1000));
  const u = `${BRAPI}/quote/list?type=${type}&sortBy=market_cap_basic&sortOrder=desc&limit=${limit}`;
  const body = await cached(`list:${type}:${limit}`, ttlLive(), withToken(u, env), ctx);
  return body ? new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30" } }) : json({ error: "fonte indisponível" }, 0, 502);
}

async function quotes(csv, url, env, ctx) {
  const symbols = [...new Set(decodeURIComponent(csv).toUpperCase().split(",").map((s) => s.trim()).filter(Boolean))];
  if (!symbols.length || symbols.length > MAX_SYMBOLS || !symbols.every((s) => SYMBOL.test(s))) return json({ error: "tickers inválidos" }, 0, 400);
  const range = url.searchParams.get("range") || "1d", interval = url.searchParams.get("interval") || "1d";
  if (!RANGES.has(range) || !INTERVALS.has(interval)) return json({ error: "período inválido" }, 0, 400);
  const n = perCall(env), chunks = [];
  for (let i = 0; i < symbols.length; i += n) chunks.push(symbols.slice(i, i + n));
  const ttl = range === "1d" ? ttlLive() : ttlHist();
  const parts = await Promise.all(chunks.map(async (c) => {
    const u = `${BRAPI}/quote/${c.map(encodeURIComponent).join(",")}?range=${range}&interval=${interval}`;
    const body = await cached(`q:${c.join(",")}:${range}:${interval}`, ttl, withToken(u, env), ctx);
    try { return body ? JSON.parse(body).results || [] : []; } catch { return []; }
  }));
  return json({ results: parts.flat() }, ttl);
}

async function macro(env, ctx) {
  const g = async (id) => {
    const body = await cached(`bcb:${id}`, 21600, `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${id}/dados/ultimos/1?formato=json`, ctx);
    try { const v = parseFloat(JSON.parse(body)[0].valor); return isFinite(v) ? v : null; } catch { return null; }
  };
  const [selic, ipca] = await Promise.all([g(432), g(13522)]);
  return json({ selic, ipca }, 3600);
}

/* ───── Câmbio ─────
   1) AwesomeAPI (cotação "comercial" mais frequente) — só se AWESOME_KEY estiver configurada (o plano sem chave bloqueia a Cloudflare).
   2) PTAX do Banco Central (fonte oficial e aberta): boletins de abertura, intermediários e fechamento, até ~13h de Brasília. */
const brtDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d); // AAAA-MM-DD
const odataDay = (d) => { const [y, m, dd] = brtDay(d).split("-"); return `${m}-${dd}-${y}`; };
const tsOf = (s) => Math.floor(Date.parse(`${s.replace(" ", "T").slice(0, 23)}-03:00`) / 1000);
const pair = (a) => /^[A-Z]{3}$/.test(a);

async function ptaxRows(code, days, ctx) {
  const now = new Date(), start = new Date(now.getTime() - days * 864e5);
  const u = `https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoMoedaPeriodo(moeda=@m,dataInicial=@di,dataFinalCotacao=@df)?@m='${code}'&@di='${odataDay(start)}'&@df='${odataDay(now)}'&$top=10000&$format=json`;
  const body = await cached(`ptax:${code}:${days}`, days > 30 ? 3600 : 300, u, ctx);
  try { return (JSON.parse(body).value || []).filter((r) => r.cotacaoCompra > 0).sort((a, b) => (a.dataHoraCotacao < b.dataHoraCotacao ? -1 : 1)); } catch { return []; }
}
async function fxLastPtax(codes, ctx) {
  const out = {};
  await Promise.all(codes.map(async (c) => {
    const rows = await ptaxRows(c, 8, ctx); if (!rows.length) return;
    const latest = rows[rows.length - 1], day = latest.dataHoraCotacao.slice(0, 10);
    const today = rows.filter((r) => r.dataHoraCotacao.startsWith(day)), before = rows.filter((r) => !r.dataHoraCotacao.startsWith(day));
    const prev = before.length ? before[before.length - 1].cotacaoCompra : latest.cotacaoCompra, bid = latest.cotacaoCompra;
    out[`${c}BRL`] = { code: c, codein: "BRL", name: `${c}/BRL (PTAX)`, src: "ptax", bid: String(bid), ask: String(latest.cotacaoVenda),
      high: String(Math.max(...today.map((r) => r.cotacaoCompra))), low: String(Math.min(...today.map((r) => r.cotacaoCompra))),
      varBid: String(+(bid - prev).toFixed(5)), pctChange: String(+(((bid / prev) - 1) * 100).toFixed(4)), timestamp: String(tsOf(latest.dataHoraCotacao)) };
  }));
  return out;
}
async function fxDailyPtax(code, n, ctx) {
  const rows = await ptaxRows(code, Math.ceil(n * 1.5) + 8, ctx), byDay = new Map();
  for (const r of rows) byDay.set(r.dataHoraCotacao.slice(0, 10), r); // último boletim de cada dia
  return [...byDay.values()].slice(-n).reverse().map((r) => ({ code, codein: "BRL", src: "ptax", bid: String(r.cotacaoCompra), ask: String(r.cotacaoVenda), high: String(r.cotacaoCompra), low: String(r.cotacaoCompra), timestamp: String(tsOf(r.dataHoraCotacao)) }));
}

async function fx(path, env, ctx) {
  const last = /^last\/[A-Z]{3}-BRL(,[A-Z]{3}-BRL){0,4}$/.test(path), daily = /^daily\/[A-Z]{3}-BRL\/\d{1,3}$/.test(path);
  if (!last && !daily) return json({ error: "rota inválida" }, 0, 400);
  const ok = (obj, ttl) => json(obj, ttl);
  if (env.AWESOME_KEY) { // fonte preferida, quando há chave
    const u = `https://economia.awesomeapi.com.br/json/${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(env.AWESOME_KEY)}`;
    const body = await cached(`fx:${path}`, last ? 60 : 900, u, ctx);
    if (body) return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=30" } });
  }
  if (last) { const codes = path.slice(5).split(",").map((s) => s.split("-")[0]).filter(pair); const o = await fxLastPtax(codes, ctx); return Object.keys(o).length ? ok(o, 120) : json({ error: "fonte indisponível" }, 0, 502); }
  const [, p, n] = path.split("/"); const arr = await fxDailyPtax(p.split("-")[0], Math.min(400, parseInt(n, 10)), ctx);
  return arr.length ? ok(arr, 900) : json({ error: "fonte indisponível" }, 0, 502);
}

export default {
  async fetch(req, env, ctx) {
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }), env);
    const url = new URL(req.url), p = url.pathname.replace(/\/+$/, "") || "/";
    const authRoute = p.startsWith("/auth/");
    if (req.method !== "GET" && !(authRoute && (req.method === "POST" || req.method === "DELETE"))) return cors(json({ error: "método não permitido" }, 0, 405), env);
    let res;
    try {
      if (authRoute) {
        const jwks = async (force) => { const body = force ? await (await fetch(GOOGLE_JWKS)).text() : await cached("google-jwks", 3600, GOOGLE_JWKS, ctx); return JSON.parse(body || "{}"); };
        return cors((await handleAuth(req, url, env, jwks)) || json({ error: "não encontrado" }, 0, 404), env);
      }
      if (p === "/" || p === "/status") res = json({ ok: true, name: "intelinvest-api", full: !!env.BRAPI_TOKEN, perCall: perCall(env), marketOpen: marketOpen() }, 60);
      else if (p === "/brapi/quote/list") res = await list(url, env, ctx);
      else if (p.startsWith("/brapi/quote/")) res = await quotes(p.slice("/brapi/quote/".length), url, env, ctx);
      else if (p === "/macro") res = await macro(env, ctx);
      else if (p.startsWith("/fx/")) res = await fx(p.slice(4), env, ctx);
      else res = json({ error: "não encontrado" }, 0, 404);
    } catch { res = json({ error: "erro interno" }, 0, 500); }
    return cors(res, env);
  },
};
