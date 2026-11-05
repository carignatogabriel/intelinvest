// Teste do Worker em Node: simula a API de cache do Cloudflare e conta chamadas ao upstream.
import worker from "../api/worker.js";
const store = new Map();
globalThis.caches = { default: { async match(r) { const v = store.get(r.url); return v ? new Response(v.body, v.init) : undefined; }, async put(r, res) { store.set(r.url, { body: await res.text(), init: { headers: [...res.headers] } }); } } };
const realFetch = globalThis.fetch; let upstream = 0; const urls = [];
globalThis.fetch = (u, o) => { upstream++; urls.push(String(u).replace(/token=[^&]+/, "token=***")); return realFetch(u, o); };
const ctx = { waitUntil: (p) => p };
const call = async (path, env = {}) => { const r = await worker.fetch(new Request("https://api.test" + path), env, ctx); const t = await r.text(); let j; try { j = JSON.parse(t); } catch {} return { status: r.status, cors: r.headers.get("access-control-allow-origin"), j, len: t.length }; };
const ok = (c, m) => console.log((c ? "OK   " : "FALHA"), m);

let r = await call("/status", { BRAPI_PER_CALL: "2" });
ok(r.status === 200 && r.j.ok && r.j.perCall === 2 && r.j.full === false && r.cors === "*", `status: ${JSON.stringify(r.j)}`);

upstream = 0; r = await call("/brapi/quote/PETR4,VALE3,ITUB4,MGLU3?range=1mo&interval=1d", { BRAPI_PER_CALL: "2" });
ok(r.status === 200 && r.j.results.length === 4 && upstream >= 2 && upstream <= 4, `quotes em lotes de 2: ${r.j?.results?.length} resultados, ${upstream} chamadas ao upstream (2 + repetições por limite)`);
ok(r.j.results.every((x) => x.historicalDataPrice?.length > 10), "histórico presente em todos");
upstream = 0; r = await call("/brapi/quote/PETR4,VALE3,ITUB4,MGLU3?range=1mo&interval=1d", { BRAPI_PER_CALL: "2" });
ok(r.status === 200 && r.j.results.length === 4 && upstream === 0, `2ª chamada igual vem do cache (upstream=${upstream})`);

upstream = 0; r = await call("/brapi/quote/PETR4?range=1d&interval=5m");
ok(r.status === 200 && r.j.results[0].historicalDataPrice.length > 5, `intraday 5m: ${r.j?.results?.[0]?.historicalDataPrice?.length} pontos`);

r = await call("/brapi/quote/list?type=stock&limit=1000");
ok(r.status === 200 && r.j.stocks.length > 300, `lista de ações: ${r.j?.stocks?.length} papéis (${(r.len / 1024).toFixed(0)} KB)`);
r = await call("/brapi/quote/list?type=hacker");
ok(r.status === 400, "type inválido recusado (400)");

r = await call("/macro");
ok(r.status === 200 && r.j.selic > 0 && r.j.ipca > 0, `macro: ${JSON.stringify(r.j)}`);
r = await call("/fx/last/USD-BRL,EUR-BRL");
ok(r.status === 200 && r.j.USDBRL && r.j.EURBRL && r.j.USDBRL.src === "ptax" && +r.j.USDBRL.bid > 3 && +r.j.USDBRL.high >= +r.j.USDBRL.low && isFinite(+r.j.USDBRL.pctChange) && +r.j.USDBRL.timestamp > 1.7e9,
  `câmbio PTAX: USD ${r.j?.USDBRL?.bid} (máx ${r.j?.USDBRL?.high} mín ${r.j?.USDBRL?.low} var ${r.j?.USDBRL?.pctChange}%) EUR ${r.j?.EURBRL?.bid}`);
r = await call("/fx/daily/USD-BRL/35");
ok(r.status === 200 && Array.isArray(r.j) && r.j.length >= 20 && +r.j[0].timestamp > +r.j[1].timestamp, `câmbio diário PTAX: ${r.j?.length} dias, do mais novo ao mais antigo`);
r = await call("/fx/daily/USD-BRL/365");
ok(r.status === 200 && r.j.length > 200, `câmbio diário 365: ${r.j?.length} dias`);

for (const bad of ["/fx/../../etc/passwd", "/fx/last/USD-BRL;rm", "/brapi/quote/AAA%2F..%2Fx", "/brapi/quote/PETR4?range=forever", "/admin", "/brapi/quote/" + Array.from({ length: 41 }, (_, i) => "X" + String(i).padStart(3, "0") + "3").join(",")]) {
  r = await call(bad); ok(r.status >= 400 && r.status < 500, `rota/entrada inválida recusada: ${bad.slice(0, 50)} -> ${r.status}`);
}
upstream = 0; urls.length = 0; await call("/brapi/quote/WEGE3?range=1mo", { BRAPI_TOKEN: "SEGREDO123", BRAPI_PER_CALL: "10" });
ok(urls.length === 1 && urls[0].includes("token=***") && !JSON.stringify(urls).includes("SEGREDO123"), "token do servidor é enviado ao upstream (e só lá)");
const opt = await worker.fetch(new Request("https://api.test/status", { method: "OPTIONS" }), {}, ctx);
ok(opt.status === 204 && opt.headers.get("access-control-allow-origin") === "*", "preflight CORS (OPTIONS) ok");
const post = await worker.fetch(new Request("https://api.test/status", { method: "POST" }), {}, ctx);
ok(post.status === 405, "POST recusado (405)");
