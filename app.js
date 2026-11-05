/* Intelinvest — maiores ações da B3, dólar e gráficos. Sem dependências, funciona offline (casca) e instala como app. */
"use strict";

/* ───────── configuração ───────── */
const FREE_TICKERS = ["PETR4", "VALE3", "ITUB4", "MGLU3"];
const UNIVERSE = ["PETR4", "VALE3", "ITUB4", "BBDC4", "BBAS3", "WEGE3", "ABEV3", "B3SA3", "SUZB3", "RENT3", "AXIA3", "GGBR4",
  "ITSA4", "BPAC11", "PRIO3", "RADL3", "EQTL3", "SBSP3", "LREN3", "MGLU3", "CSAN3", "VIVT3", "RAIL3", "CMIG4"];
const REFRESH_MS = 60000;
const STOCK_RANGES = [["Hoje", "1d"], ["1M", "1mo"], ["3M", "3mo"], ["6M", "6mo"], ["1A", "1y"]];
const USD_RANGES = [["1M", 30], ["3M", 90], ["6M", 180], ["1A", 365]];

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento */ } },
};
const getToken = () => (store.get("brapi_token", "") || window.BRAPI_TOKEN || "").trim();
/* Produção: o app fala só com o servidor Intelinvest (API_BASE), que guarda o token e o cache. Vazio = modo desenvolvimento (APIs direto). */
const API = String(window.API_BASE || "").replace(/\/+$/, "");
const hasFull = () => (API ? !!window.API_FULL : !!getToken()); // dados completos (histórico, 30 mini-gráficos, Ibovespa, Análise com 40)
const canHist = (sym) => hasFull() || FREE_TICKERS.includes(sym);

/* ───────── formatação ───────── */
const nBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const n2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n4 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const nInt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtBRL = (v) => (v == null || isNaN(v) ? "—" : nBRL.format(v));
const fmtPct = (v) => (v == null || isNaN(v) ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${n2.format(Math.abs(v))}%`);
const fmtBig = (v) => {
  if (v == null || isNaN(v)) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `R$ ${n2.format(v / 1e12)} tri`;
  if (a >= 1e9) return `R$ ${n2.format(v / 1e9)} bi`;
  if (a >= 1e6) return `R$ ${n2.format(v / 1e6)} mi`;
  return `R$ ${nInt.format(v)}`;
};
const fmtVol = (v) => (v == null ? "—" : v >= 1e6 ? `${n2.format(v / 1e6)} mi` : nInt.format(v));
const fmtDate = (t, long) => long
  ? new Date(t).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "America/Sao_Paulo" }).replace(/\./g, "").replace(" de ", " ")
  : new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", timeZone: "America/Sao_Paulo" }).replace(/\./g, "");
const fmtDay = (t) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Sao_Paulo" });
const fmtTime = (t) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
const dir = (v, eps = 0.005) => (v > eps ? "up" : v < -eps ? "down" : "flat");
const ARROW = {
  up: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1l4.5 7.5h-9z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 9L.5 1.5h9z" fill="currentColor"/></svg>',
  flat: '<svg viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="4" width="8" height="2" rx="1" fill="currentColor"/></svg>',
};
const chip = (pct) => { const d = dir(pct); return `<span class="chip ${d}">${ARROW[d]}${fmtPct(pct)}</span>`; };

/* ───────── rede ───────── */
async function getJSON(url, { timeout = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Busca cotações na brapi. Se o lote falhar (limite do plano), divide ao meio até achar o que o plano libera. */
async function brapiQuotes(tickers, range = "1mo", interval = "1d") {
  if (!tickers.length) return [];
  if (API) { try { return (await getJSON(`${API}/brapi/quote/${tickers.map(encodeURIComponent).join(",")}?range=${range}&interval=${interval}`)).results || []; } catch { return []; } }
  const token = getToken();
  const url = `https://brapi.dev/api/quote/${tickers.map(encodeURIComponent).join(",")}?range=${range}&interval=${interval}${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  try {
    const j = await getJSON(url);
    return j.results || [];
  } catch (e) {
    if (tickers.length === 1) return [];
    const mid = Math.ceil(tickers.length / 2);
    const [a, b] = await Promise.all([brapiQuotes(tickers.slice(0, mid), range, interval), brapiQuotes(tickers.slice(mid), range, interval)]);
    return a.concat(b);
  }
}

async function awesome(path) { return getJSON(API ? `${API}/fx/${path}` : `https://economia.awesomeapi.com.br/json/${path}`); }

/* ───────── estado ───────── */
const S = {
  quotes: {}, series: {}, lists: {}, cat: "stock", q: "", sector: "", shown: 40,
  usd: null, eur: null, usdSeries: null, ibov: null,
  tab: "cap", view: "mercado", updatedAt: null, offline: false, loading: false, sheet: null,
};
const detailCache = new Map();
const CATS = { stock: "Ações", fund: "FIIs/ETFs", bdr: "BDRs" };
const SECTOR_PT = {
  "Finance": "Finanças", "Utilities": "Energia e saneamento", "Producer Manufacturing": "Indústria", "Process Industries": "Indústria de processos",
  "Retail Trade": "Varejo", "Non-Energy Minerals": "Mineração e siderurgia", "Energy Minerals": "Petróleo e gás", "Transportation": "Transporte",
  "Consumer Durables": "Bens duráveis", "Commercial Services": "Serviços comerciais", "Consumer Non-Durables": "Bens de consumo",
  "Industrial Services": "Serviços industriais", "Distribution Services": "Distribuição", "Health Services": "Serviços de saúde",
  "Consumer Services": "Serviços ao consumidor", "Health Technology": "Saúde e biotecnologia", "Electronic Technology": "Tecnologia eletrônica",
  "Technology Services": "Serviços de tecnologia", "Communications": "Comunicações", "Miscellaneous": "Outros",
};
const sectorPT = (s) => SECTOR_PT[s] || s || "Outros";
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const MIN_FIN = 2e6, MIN_CAP = 1e9; // "relevante": negocia ≥ R$ 2 mi/dia e vale ≥ R$ 1 bi
const finOf = (q) => q.fin ?? (q.regularMarketPrice || 0) * (q.regularMarketVolume || 0);
const relevant = (q) => finOf(q) >= MIN_FIN && (S.cat !== "stock" || (q.marketCap || 0) >= MIN_CAP);

/** Lista completa da B3 por categoria (brapi, sem token). Remove fracionário, sem negociação e marca 1 classe por empresa. */
async function fetchList(type) {
  const j = await getJSON(API ? `${API}/brapi/quote/list?type=${type}&limit=1000` : `https://brapi.dev/api/quote/list?type=${type}&sortBy=market_cap_basic&sortOrder=desc&limit=1000`, { timeout: 30000 });
  const items = [];
  for (const s of j.stocks || []) {
    if (!(s.close > 0) || !(s.volume > 0)) continue;
    if (/\dB?F$/.test(s.stock)) continue; // mercado fracionário (PETR4F, MRSA5BF)
    if (type === "stock" && !/^[A-Z0-9]{4}(3|4|5|6|7|8|11)$/.test(s.stock)) continue; // só ON/PN/units: fora recibos e direitos (RAIZ55, 9x)
    items.push({ symbol: s.stock, longName: s.name, regularMarketPrice: s.close, regularMarketChangePercent: s.change ?? 0, regularMarketVolume: s.volume,
      marketCap: s.market_cap || null, logourl: s.logo, sector: s.sector, subsector: s.subsector, fin: s.close * s.volume });
  }
  const best = new Map();
  for (const i of items) { if (!i.marketCap) continue; const k = `${i.longName}|${i.marketCap}`; const b = best.get(k); if (!b || i.fin > b.fin) best.set(k, i); }
  for (const i of items) i.main = !i.marketCap || best.get(`${i.longName}|${i.marketCap}`) === i;
  return items;
}
const putItem = (i) => Object.assign((S.quotes[i.symbol] ||= {}), i);

/** Papéis com histórico/sparkline: os 4 livres sem token; as 30 maiores com token. */
function featured() {
  if (!hasFull()) return FREE_TICKERS;
  const L = S.lists.stock?.items;
  return L ? L.filter((i) => i.main && i.marketCap).slice(0, 30).map((i) => i.symbol) : UNIVERSE.slice(0, 30);
}
/** Papéis da aba Análise (precisam de 1 ano de histórico). */
function analysisList() {
  if (!hasFull()) return FREE_TICKERS;
  const L = S.lists.stock?.items;
  return L ? L.filter((i) => i.main && i.marketCap).slice(0, 40).map((i) => i.symbol) : UNIVERSE;
}

function saveCache() {
  const feat = {}; for (const sym in S.series) feat[sym] = S.quotes[sym];
  store.set("snap", { stock: S.lists.stock, feat, series: S.series, usd: S.usd, eur: S.eur, usdSeries: S.usdSeries, ibov: S.ibov, at: S.updatedAt });
}
function loadCache() {
  const c = store.get("snap", null);
  if (!c) return false;
  if (c.stock) { S.lists.stock = c.stock; c.stock.items.forEach(putItem); }
  Object.entries(c.feat || {}).forEach(([k, q]) => q && Object.assign((S.quotes[k] ||= {}), q));
  Object.assign(S, { series: c.series || {}, usd: c.usd, eur: c.eur, usdSeries: c.usdSeries, ibov: c.ibov, updatedAt: c.at });
  return !!c.usd || !!c.stock;
}

/* ───────── carregamento ───────── */
async function refresh(manual) {
  if (S.loading) return;
  S.loading = true;
  $("#btnRefresh").classList.add("spin");
  const token = hasFull();
  const fresh = (c) => S.lists[c] && Date.now() - S.lists[c].at < 100000;
  const cats = [...new Set(["stock", S.cat])].filter((c) => manual || !fresh(c));
  // economiza o servidor gratuito: preço e dólar atualizam sempre; históricos (mudam 1x por dia) só de tempos em tempos
  const age = (t) => Date.now() - (t || 0);
  const needFeat = manual || !Object.keys(S.series).length || age(S.tFeat) > 600000;
  const needDaily = manual || !S.usdSeries || age(S.tDaily) > 1800000;
  const needIbov = token && (manual || !S.ibov || age(S.tIbov) > 600000);
  const [lists, last, daily, ib, feat] = await Promise.allSettled([
    Promise.all(cats.map((c) => fetchList(c).then((items) => [c, items]))),
    awesome("last/USD-BRL,EUR-BRL"),
    needDaily ? awesome("daily/USD-BRL/35") : Promise.resolve(null),
    needIbov ? brapiQuotes(["^BVSP"], "1mo") : Promise.resolve([]),
    needFeat ? brapiQuotes(featured(), "1mo") : Promise.resolve([]),
  ]);
  let got = 0;

  if (lists.status === "fulfilled") {
    for (const [c, items] of lists.value) { if (items.length) { S.lists[c] = { at: Date.now(), items }; items.forEach(putItem); got++; } }
  }
  if (feat.status === "fulfilled" && feat.value.length) {
    S.tFeat = Date.now();
    for (const q of feat.value) {
      Object.assign((S.quotes[q.symbol] ||= {}), q);
      S.series[q.symbol] = (q.historicalDataPrice || []).filter((p) => p.close != null).map((p) => ({ t: p.date * 1000, v: p.close }));
    }
    if (!S.lists.stock) { // plano B: a lista completa falhou, mostra ao menos os papéis com histórico
      const items = feat.value.filter((q) => q.regularMarketPrice != null).map((q) => ({ symbol: q.symbol, longName: q.longName, regularMarketPrice: q.regularMarketPrice,
        regularMarketChangePercent: q.regularMarketChangePercent, regularMarketVolume: q.regularMarketVolume, marketCap: q.marketCap, logourl: q.logourl, sector: null, fin: finOf(q), main: true }));
      S.lists.stock = { at: 0, items };
    }
    got++;
  }
  if (last.status === "fulfilled" && last.value.USDBRL) {
    const u = last.value.USDBRL, e = last.value.EURBRL;
    S.usd = { bid: +u.bid, ask: +u.ask, high: +u.high, low: +u.low, pct: +u.pctChange, chg: +u.varBid, t: +u.timestamp * 1000, src: u.src || "" };
    S.eur = e ? { bid: +e.bid, pct: +e.pctChange } : null;
    got++;
  }
  if (daily.status === "fulfilled" && Array.isArray(daily.value)) {
    S.tDaily = Date.now();
    S.usdSeries = daily.value.map((d) => ({ t: +d.timestamp * 1000, v: +d.bid })).reverse();
  }
  if (ib.status === "fulfilled" && ib.value[0]) {
    S.tIbov = Date.now();
    const q = ib.value[0];
    S.ibov = { price: q.regularMarketPrice, pct: q.regularMarketChangePercent, t: new Date(q.regularMarketTime).getTime(),
      series: (q.historicalDataPrice || []).filter((p) => p.close != null).map((p) => ({ t: p.date * 1000, v: p.close })) };
  }

  S.loading = false;
  $("#btnRefresh").classList.remove("spin");
  if (got) { S.updatedAt = Date.now(); S.offline = false; saveCache(); detailCache.clear(); }
  else { S.offline = true; if (manual) toast("Sem conexão com as fontes de dados — mostrando o último registro."); }
  render();
}

/** Muda a categoria (Ações / FIIs / BDRs), carregando a lista se ainda não veio. */
async function setCat(c) {
  S.cat = c; S.sector = ""; S.shown = 40;
  renderFilters(); renderList();
  if (!S.lists[c]) {
    try { const items = await fetchList(c); S.lists[c] = { at: Date.now(), items }; items.forEach(putItem); }
    catch { toast("Não foi possível carregar esta lista agora."); }
    renderFilters(); renderList();
  }
}

/* ───────── estatística / tendência ───────── */
function sma(vals, w) {
  const out = new Array(vals.length).fill(null);
  let sum = 0;
  for (let i = 0; i < vals.length; i++) { sum += vals[i]; if (i >= w) sum -= vals[i - w]; if (i >= w - 1) out[i] = sum / w; }
  return out;
}
/** Regressão linear: variação ajustada ao longo do período (em %) e qualidade do ajuste (R²). */
function regress(vals) {
  const n = vals.length; if (n < 3) return { pct: 0, r2: 0 };
  const mx = (n - 1) / 2, my = vals.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = i - mx, dy = vals[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const slope = sxy / sxx;
  return { pct: (slope * (n - 1)) / my * 100, r2: syy ? (sxy * sxy) / (sxx * syy) : 0 };
}
function verdict(pts, base) {
  const v = pts.map((p) => p.v), n = v.length;
  const { pct, r2 } = regress(v);
  const thr = base * Math.sqrt(Math.max(n, 5) / 21);
  const m20 = n >= 20 ? sma(v, 20)[n - 1] : null;
  let d = "flat", title = "Tendência lateral";
  if (pct > thr) { d = "up"; title = r2 > 0.6 ? "Tendência de alta" : "Alta com oscilação"; }
  else if (pct < -thr) { d = "down"; title = r2 > 0.6 ? "Tendência de queda" : "Queda com oscilação"; }
  const last = v[n - 1];
  let why = `Linha de tendência: ${fmtPct(pct)} no período.`;
  if (m20) why += ` Preço ${fmtPct((last / m20 - 1) * 100).replace("+", "")} ${last >= m20 ? "acima" : "abaixo"} da média de 20 dias.`.replace("−", "");
  return { d, title, why };
}
const VERDICT_ICON = {
  up: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 17l6-6 4 4 8-8M15 7h6v6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 7l6 6 4-4 8 8M15 17h6v-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flat: '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M3 12h18M17 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/* ───────── gráficos (SVG) ───────── */
function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
let gid = 0;

function sparkSVG(pts, { w = 84, h = 30, color } = {}) {
  if (!pts || pts.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}"></svg>`;
  const v = pts.map((p) => p.v), min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const col = color || `var(--${dir(v[v.length - 1] - v[0], 0)})`;
  const id = `g${++gid}`, pad = 2;
  const xy = v.map((y, i) => [(i / (v.length - 1)) * w, pad + (1 - (y - min) / span) * (h - pad * 2)]);
  const d = xy.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".30"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${w},${h}L0,${h}Z" fill="url(#${id})"/>
    <path d="${d}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Gráfico grande e interativo (arraste o dedo para ler cada dia). */
function mountChart(host, pts, { fmt, ma20, ma50, onScrub, xfmt, up: upOverride }) {
  const W = 360, H = 240, L = 6, R = 52, T = 12, B = 24;
  const iw = W - L - R, ih = H - T - B, n = pts.length;
  const v = pts.map((p) => p.v);
  const m20 = ma20 ? sma(v, 20) : null, m50 = ma50 ? sma(v, 50) : null;
  const all = v.concat((m20 || []).filter((x) => x != null), (m50 || []).filter((x) => x != null));
  let min = Math.min(...all), max = Math.max(...all);
  const padv = (max - min) * 0.08 || max * 0.01; min -= padv; max += padv;
  const X = (i) => L + (i / (n - 1)) * iw, Y = (val) => T + (1 - (val - min) / (max - min)) * ih;
  const up = upOverride ?? v[n - 1] >= v[0], col = up ? "var(--up)" : "var(--down)", id = `c${++gid}`;
  const path = (arr) => { let d = "", on = false; arr.forEach((val, i) => { if (val == null) return; d += `${on ? "L" : "M"}${X(i).toFixed(1)},${Y(val).toFixed(1)}`; on = true; }); return d; };
  const line = path(v);
  let grid = "";
  for (let k = 0; k < 4; k++) {
    const val = min + ((max - min) * (k + 0.5)) / 4, y = Y(val);
    grid += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" stroke-width="1" opacity=".7"/><text x="${W - R + 6}" y="${(y + 4).toFixed(1)}" fill="var(--muted)" font-size="11">${esc(fmt(val, true))}</text>`;
  }
  let xt = "";
  [0, 0.34, 0.67, 1].forEach((f, k) => {
    const i = Math.round(f * (n - 1));
    xt += `<text x="${X(i).toFixed(1)}" y="${H - 6}" fill="var(--muted)" font-size="11" text-anchor="${k === 0 ? "start" : k === 3 ? "end" : "middle"}">${xfmt ? xfmt(pts[i].t) : fmtDate(pts[i].t, n > 100)}</text>`;
  });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de preços do período">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".28"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>
    ${grid}${xt}
    <path d="${line}L${X(n - 1)},${T + ih}L${X(0)},${T + ih}Z" fill="url(#${id})"/>
    ${m50 ? `<path d="${path(m50)}" fill="none" stroke="var(--ma2)" stroke-width="1.5" stroke-dasharray="5 4" stroke-linecap="round"/>` : ""}
    ${m20 ? `<path d="${path(m20)}" fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-dasharray="5 4" stroke-linecap="round"/>` : ""}
    <path d="${line}" fill="none" stroke="${col}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    <g id="xh" opacity="0"><line y1="${T}" y2="${T + ih}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 3"/><circle r="5" fill="${col}" stroke="var(--bg)" stroke-width="2.5"/></g>
  </svg>`;
  const svg = host.firstElementChild, xh = svg.querySelector("#xh"), ln = xh.firstElementChild, dot = xh.lastElementChild;
  const at = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((px - L) / iw) * (n - 1))));
    ln.setAttribute("x1", X(i)); ln.setAttribute("x2", X(i));
    dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(v[i]));
    xh.setAttribute("opacity", 1);
    onScrub(i);
  };
  const end = () => { xh.setAttribute("opacity", 0); onScrub(null); };
  host.onpointerdown = (e) => { host.setPointerCapture?.(e.pointerId); at(e); };
  host.onpointermove = (e) => { if (e.pointerType === "mouse" && !(e.buttons & 1) && xh.getAttribute("opacity") === "0") { at(e); return; } if (e.buttons || e.pointerType === "touch") at(e); };
  host.onpointerup = host.onpointercancel = host.onpointerleave = end;
}

/* ───────── render: tela principal ───────── */
function marketOpen() {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "numeric", minute: "numeric", hour12: false }).formatToParts(new Date());
  const g = (t) => parts.find((p) => p.type === t)?.value;
  const mins = (+g("hour") % 24) * 60 + +g("minute");
  const weekday = !["Sat", "Sun"].includes(g("weekday"));
  const newest = Math.max(0, ...Object.values(S.quotes).map((q) => new Date(q.regularMarketTime).getTime() || 0));
  return weekday && mins >= 600 && mins <= 1070 && Date.now() - newest < 30 * 60000;
}

function render() {
  renderStatus(); renderHero(); renderMovers(); renderBreadth(); renderFilters(); renderList();
  if (S.view === "analise" && typeof Analise !== "undefined") Analise.render();
}

function setView(v) {
  S.view = v;
  $("#main").dataset.view = v;
  $("#viewAnalise").hidden = v !== "analise";
  document.querySelectorAll(".v-mercado").forEach((el) => (el.hidden = v !== "mercado"));
  document.querySelectorAll(".bottomnav button").forEach((b) => (b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  window.scrollTo({ top: 0 });
  if (v === "analise") Analise.show();
}

function renderStatus() {
  const open = marketOpen();
  $("#statusDot").className = "dot" + (open && !S.offline ? " open" : "");
  const when = S.updatedAt ? `atualizado às ${fmtTime(S.updatedAt)}` : "sem dados ainda";
  $("#statusText").textContent = `${open ? "Mercado aberto" : "Mercado fechado"} · ${when}${S.offline ? " (offline)" : ""}`;
}

function renderHero() {
  const el = $("#hero");
  el.classList.remove("skeleton-block");
  if (!S.usd) {
    el.className = "card hero skeleton-block v-mercado";
    el.innerHTML = '<div class="skel" style="height:140px"></div>';
    return;
  }
  const u = S.usd;
  el.setAttribute("role", "button"); el.tabIndex = 0;
  el.innerHTML = `
    <div class="hero-head">
      <div><div class="label">${u.src === "ptax" ? "Dólar PTAX · Banco Central" : "Dólar comercial · USD/BRL"}</div><div class="big">${fmtBRL(u.bid)}</div>
        <div class="sub">Máx ${n4.format(u.high)} · Mín ${n4.format(u.low)}${S.eur ? ` · Euro ${fmtBRL(S.eur.bid)}` : ""}</div></div>
      ${chip(u.pct)}
    </div>
    <div class="spark-wrap" style="height:70px">${sparkSVG(S.usdSeries, { w: 320, h: 70 })}</div>
    <div class="sub" style="text-align:right;margin:0 0 6px">${u.src === "ptax" ? `boletim BCB das ${fmtTime(u.t)} · ` : ""}últimos 30 dias · toque para ver detalhes</div>`;
}

/** Panorama do dia = ações líquidas (1 classe por empresa). */
function panorama() { return (S.lists.stock?.items || []).map((i) => S.quotes[i.symbol] || i).filter((q) => q.main !== false && finOf(q) >= 1e6); }

function renderMovers() {
  const el = $("#movers"), arr = panorama().filter((q) => finOf(q) >= MIN_FIN && (q.marketCap || 0) >= MIN_CAP);
  if (arr.length < 2) { el.innerHTML = ""; return; }
  const by = [...arr].sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent);
  const best = by[0], worst = by[by.length - 1];
  const card = (q, label) => `<button class="card mover" data-sym="${esc(q.symbol)}"><div class="label">${label}</div><div class="tick">${esc(q.symbol)}</div>${chip(q.regularMarketChangePercent)}<div class="px">${fmtBRL(q.regularMarketPrice)}</div></button>`;
  el.innerHTML = card(best, best.regularMarketChangePercent > 0 ? "Maior alta do dia" : "Menor queda do dia") +
    card(worst, worst.regularMarketChangePercent < 0 ? "Maior queda do dia" : "Menor alta do dia");
}

function renderBreadth() {
  const el = $("#breadth"), arr = panorama();
  if (!arr.length) { el.innerHTML = ""; return; }
  const u = arr.filter((q) => q.regularMarketChangePercent > 0.005).length;
  const d = arr.filter((q) => q.regularMarketChangePercent < -0.005).length, f = arr.length - u - d;
  const ib = S.ibov ? `<div class="breadth-txt" style="margin:0 0 8px"><span>Ibovespa <b>${nInt.format(S.ibov.price)} pts</b></span>${chip(S.ibov.pct)}</div>` : "";
  el.innerHTML = `${ib}<div class="breadth-bar" role="img" aria-label="${u} em alta, ${d} em queda, ${f} estáveis"><i class="u" style="flex:${u}"></i><i class="f" style="flex:${f}"></i><i class="d" style="flex:${d}"></i></div>
    <div class="breadth-txt"><span><b>${u}</b> em alta</span><span>${arr.length} ações líquidas</span><span><b>${d}</b> em queda</span></div>`;
}

function renderFilters() {
  const L = S.lists[S.cat];
  $("#cats").innerHTML = Object.entries(CATS).map(([k, v]) => {
    const n = S.lists[k]?.items.filter((i) => i.main !== false).length;
    return `<button data-cat="${k}" aria-pressed="${k === S.cat}">${v}${n ? ` <small>${nInt.format(n)}</small>` : ""}</button>`;
  }).join("");
  const sel = $("#sector");
  const cnt = new Map();
  (L?.items || []).filter((i) => i.main !== false).forEach((i) => cnt.set(i.sector || "", (cnt.get(i.sector || "") || 0) + 1));
  sel.innerHTML = '<option value="">Setor: todos</option>' + [...cnt.entries()].filter(([k]) => k).sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<option value="${esc(k)}">${esc(sectorPT(k))} (${n})</option>`).join("");
  sel.value = S.sector;
}

function listItems() {
  const L = S.lists[S.cat]; if (!L) return null;
  let arr = L.items.map((i) => S.quotes[i.symbol] || i);
  const term = norm(S.q);
  if (term) arr = arr.filter((q) => norm(q.symbol).includes(term) || norm(q.longName).includes(term));
  else arr = arr.filter((q) => q.main !== false);
  if (S.sector) arr = arr.filter((q) => q.sector === S.sector);
  const k = S.tab;
  if (k === "up" || k === "down") arr = arr.filter(relevant);
  const key = { cap: (q) => q.marketCap || finOf(q) / 1e3, vol: finOf, up: (q) => q.regularMarketChangePercent, down: (q) => -q.regularMarketChangePercent }[k];
  return [...arr].sort((a, b) => key(b) - key(a));
}

function renderList() {
  const el = $("#list");
  const arr = listItems();
  if (!arr) {
    el.innerHTML = S.offline && !S.updatedAt
      ? '<div class="empty"><b>Sem dados no momento</b>Verifique a conexão e toque em atualizar.</div>'
      : Array.from({ length: 7 }, () => '<div class="skel skel-row"></div>').join("");
    return;
  }
  if (!arr.length) { el.innerHTML = '<div class="empty"><b>Nenhum papel encontrado</b>Tente outro nome, ticker ou setor.</div>'; return; }
  const hasSpark = arr.some((q) => S.series[q.symbol]);
  const note = `<div class="list-note"><span>${nInt.format(arr.length)} papéis${hasSpark ? " · mini-gráfico: 30 dias" : ""}</span><span>Variação: hoje</span></div>`;
  const rows = arr.slice(0, S.shown).map((q) => {
    const p = q.regularMarketChangePercent, sym = q.symbol;
    const mid = S.series[sym] ? sparkSVG(S.series[sym]) : (q.marketCap ? `<div class="capcell"><small>Val. mercado</small><b>${fmtBig(q.marketCap)}</b></div>` : `<div class="capcell"><small>Negociado</small><b>${fmtBig(finOf(q))}</b></div>`);
    return `<button class="row" data-sym="${esc(sym)}" aria-label="${esc(sym)}, ${esc(q.longName || "")}, ${fmtBRL(q.regularMarketPrice)}, ${fmtPct(p)}">
      <div class="logo">${esc(sym.slice(0, 4))}<img src="${esc(q.logourl || `https://icons.brapi.dev/icons/${sym}.svg`)}" alt="" loading="lazy"></div>
      <div class="name"><b>${esc(sym)}</b><span>${esc(q.longName || q.shortName || "")}</span></div>
      <div class="spark-cell">${mid}</div>
      <div class="price"><b>${fmtBRL(q.regularMarketPrice)}</b>${chip(p)}</div>
    </button>`;
  }).join("");
  const rest = arr.length - S.shown;
  const more = rest > 0 ? `<button class="more" id="more">Mostrar mais ${Math.min(40, rest)} <small>(restam ${nInt.format(rest)})</small></button>` : "";
  const tip = S.tab === "up" || S.tab === "down" ? '<p class="hint" style="margin:8px 4px 0">Só papéis com negociação relevante (≥ R$ 2 mi/dia' + (S.cat === "stock" ? " e valor de mercado ≥ R$ 1 bi" : "") + ").</p>" : "";
  const tok = (!API && !hasFull() ? '<div class="empty"><b>Quer histórico de 1M a 1A e a análise das 40 maiores?</b>Toque na engrenagem e cole um token gratuito da brapi.dev. O gráfico do dia de qualquer papel já funciona sem token.</div>' : "");
  el.innerHTML = note + rows + more + tip + tok;
}

/* ───────── detalhe (bottom sheet) ───────── */
const sheet = $("#sheet"), scrim = $("#scrim");
let lastFocus = null;

function openSheet(kind, sym) {
  lastFocus = document.activeElement;
  const hasHist = kind !== "stock" || canHist(sym) || S.series[sym]?.length > 2;
  S.sheet = { kind, sym, range: kind === "stock" && hasHist ? 1 : 0, ma: false };
  if (!hasHist) { S.sheet.noHist = true; S.sheet.bad = new Set([1, 2, 3, 4]); }
  scrim.hidden = sheet.hidden = false;
  document.body.classList.add("locked");
  requestAnimationFrame(() => { scrim.classList.add("show"); sheet.classList.add("show"); });
  history.pushState({ sheet: 1 }, "");
  sheet.scrollTop = 0;
  drawSheet();
}
function closeSheet(fromPop) {
  if (!S.sheet) return;
  S.sheet = null;
  scrim.classList.remove("show"); sheet.classList.remove("show");
  document.body.classList.remove("locked");
  setTimeout(() => { if (!S.sheet) scrim.hidden = sheet.hidden = true; }, 330);
  if (!fromPop && history.state?.sheet) history.back();
  lastFocus?.focus?.();
}

async function loadDetail(kind, sym, ri) {
  const key = `${kind}:${sym}:${ri}`;
  if (detailCache.has(key)) return detailCache.get(key);
  let pts;
  if (kind === "usd") {
    const days = USD_RANGES[ri][1];
    const d = await awesome(`daily/USD-BRL/${days}`);
    pts = d.map((x) => ({ t: +x.timestamp * 1000, v: +x.bid })).reverse();
  } else if (ri === 0) {
    if (API) { // produção: gráfico do dia (5 min) vindo do servidor Intelinvest
      if (!canHist(sym)) throw new Error("token"); // servidor sem token pago: só os 4 papéis livres
      const q = (await brapiQuotes([sym], "1d", "5m"))[0];
      pts = (q?.historicalDataPrice || []).filter((p) => p.close != null).map((p) => ({ t: p.date * 1000, v: p.close }));
    } else { // desenvolvimento: endpoint público da B3 (sem contrato — não usar em produção)
      const j = await getJSON(`https://cotacao.b3.com.br/mds/api/v1/DailyFluctuationHistory/${encodeURIComponent(sym)}`);
      const date = j.TradgFlr?.date;
      pts = (j.TradgFlr?.scty?.lstQtn || []).filter((x) => x.closPric > 0).map((x) => ({ t: Date.parse(`${date}T${x.dtTm}-03:00`), v: x.closPric }));
    }
  } else {
    if (!canHist(sym)) throw new Error("token");
    const q = (await brapiQuotes([sym], STOCK_RANGES[ri][1]))[0];
    pts = (q?.historicalDataPrice || []).filter((p) => p.close != null).map((p) => ({ t: p.date * 1000, v: p.close }));
  }
  if (pts.length < 3) throw new Error("sem dados");
  detailCache.set(key, pts);
  return pts;
}

/** Abertura, máxima e mínima do dia direto da B3 (para papéis que vieram só da lista). */
async function ensureB3Quote(sym) {
  const o = (S.quotes[sym] ||= { symbol: sym });
  if (o.b3At && Date.now() - o.b3At < 60000) return o;
  if (API) { // produção: abertura/máx/mín/52 semanas pelo servidor
    const q = (await brapiQuotes([sym], "1d", "1d"))[0]; if (!q) throw new Error("sem cotação");
    delete q.historicalDataPrice; delete q.validRanges; delete q.validIntervals;
    for (const k of ["regularMarketOpen", "regularMarketDayHigh", "regularMarketDayLow", "regularMarketPreviousClose", "fiftyTwoWeekLow", "fiftyTwoWeekHigh", "earningsPerShare", "priceEarnings"]) if (o[k] == null && q[k] != null) o[k] = q[k];
    o.b3At = Date.now();
    return o;
  }
  const j = await getJSON(`https://cotacao.b3.com.br/mds/api/v1/instrumentQuotation/${encodeURIComponent(sym)}`);
  const d = j.Trad?.[0]?.scty?.SctyQtn; if (!d) throw new Error("b3");
  if (o.regularMarketOpen == null) o.regularMarketOpen = d.opngPric;
  if (o.regularMarketDayHigh == null) o.regularMarketDayHigh = d.maxPric;
  if (o.regularMarketDayLow == null) o.regularMarketDayLow = d.minPric;
  if (o.regularMarketPreviousClose == null && d.curPrc && d.prcFlcn != null) o.regularMarketPreviousClose = d.curPrc / (1 + d.prcFlcn / 100);
  o.b3At = Date.now();
  return o;
}

function statsHTML(st) {
  const tile = ([a, b]) => `<div class="stat"><small>${a}</small><b>${b}</b></div>`;
  if (st.kind === "usd") {
    const u = S.usd; if (!u) return "";
    return [["Compra", `R$ ${n4.format(u.bid)}`], ["Venda", `R$ ${n4.format(u.ask)}`], ["Máxima do dia", n4.format(u.high)], ["Mínima do dia", n4.format(u.low)]].map(tile).join("");
  }
  const q = S.quotes[st.sym]; if (!q) return "";
  const lo = q.fiftyTwoWeekLow, hi = q.fiftyTwoWeekHigh, p = q.regularMarketPrice;
  const pos = hi > lo ? Math.max(0, Math.min(100, ((p - lo) / (hi - lo)) * 100)) : 50;
  return [["Abertura", fmtBRL(q.regularMarketOpen)], ["Fech. anterior", fmtBRL(q.regularMarketPreviousClose)],
    ["Máxima do dia", fmtBRL(q.regularMarketDayHigh)], ["Mínima do dia", fmtBRL(q.regularMarketDayLow)],
    ["Volume", fmtVol(q.regularMarketVolume)], [q.marketCap ? "Valor de mercado" : "Negociado hoje", fmtBig(q.marketCap || finOf(q))]].map(tile).join("") +
    (lo && hi ? `<div class="stat range52"><small>Faixa de 52 semanas</small><div class="bar52"><i style="left:${pos}%"></i></div><div class="bar52-l"><span>${fmtBRL(lo)}</span><span>${fmtBRL(hi)}</span></div></div>` : "") +
    (q.sector ? `<div class="stat range52"><small>Setor</small><b>${esc(sectorPT(q.sector))}${q.subsector ? ` · ${esc(q.subsector)}` : ""}</b></div>` : "");
}

function drawSheet() {
  const st = S.sheet; if (!st) return;
  if (st.kind === "quant") return Analise.drawQuant(st.sym);
  const isUsd = st.kind === "usd", q = isUsd ? null : S.quotes[st.sym];
  const ranges = isUsd ? USD_RANGES : STOCK_RANGES;
  const title = isUsd ? "Dólar" : st.sym, subt = isUsd ? "Dólar americano / Real brasileiro" : (q?.longName || "");
  const body = $("#sheetBody");
  const chips = ranges.map((r, i) => `<button data-r="${i}" aria-pressed="${i === st.range}" ${st.bad?.has(i) ? "disabled" : ""}>${r[0]}</button>`).join("");
  body.innerHTML = `
    <div class="sh-head"><div><h2 id="sheetTitle">${esc(title)}</h2><p>${esc(subt)}</p></div>
      <button class="close" id="sheetClose" aria-label="Fechar"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>
    <div class="readout" id="readout"></div>
    <div class="chart-wrap" id="chart"><div class="chart-msg">Carregando gráfico…</div></div>
    <div class="ranges" id="ranges">${chips}</div>
    ${st.noHist ? `<p class="hint" style="margin:4px 2px 0">${API ? "Histórico de 1M a 1A indisponível para este papel no momento." : "Histórico de 1M a 1A deste papel: cole um token gratuito da brapi.dev na engrenagem."}</p>` : ""}
    <div class="legend" id="legend"></div>
    <div id="verdict"></div>
    <div class="stats" id="stats">${statsHTML(st)}</div>`;
  $("#sheetClose").onclick = () => closeSheet();
  $("#ranges").onclick = (e) => { const b = e.target.closest("button[data-r]"); if (b && !b.disabled) { st.range = +b.dataset.r; drawSheet(); } };
  paintChart();
  if (!isUsd) ensureB3Quote(st.sym).then(() => { if (S.sheet === st && $("#stats")) $("#stats").innerHTML = statsHTML(st); }).catch(() => {});
}

async function paintChart() {
  const st = S.sheet; if (!st) return;
  const isUsd = st.kind === "usd", q = isUsd ? null : S.quotes[st.sym], ri = st.range, intraday = !isUsd && ri === 0;
  const chartEl = $("#chart"), readout = $("#readout");
  const fmt = (x, short) => (short ? n2.format(x) : fmtBRL(x));
  const livePrice = isUsd ? S.usd?.bid : q?.regularMarketPrice, livePct = isUsd ? S.usd?.pct : q?.regularMarketChangePercent;
  readout.innerHTML = `<div class="big">${fmtBRL(livePrice)}</div><div class="sub">${chip(livePct)}<span>hoje</span></div>`;
  let pts;
  try { pts = await loadDetail(st.kind, st.sym, ri); }
  catch (err) {
    if (S.sheet !== st) return;
    (st.bad ||= new Set()).add(ri);
    chartEl.innerHTML = `<div class="chart-msg">${err.message === "token" ? (API ? `O histórico de ${esc(st.sym)} neste período não está disponível agora.` : `O histórico de ${esc(st.sym)} neste período exige um token gratuito da brapi.dev (engrenagem).`)
      : intraday ? "Sem negociações para mostrar hoje (mercado fechado ou papel sem liquidez).<br>Tente outro período." : "Não foi possível carregar este período.<br>O plano gratuito pode limitar o histórico — tente outro."}</div>`;
    $("#ranges").querySelector(`[data-r="${ri}"]`)?.setAttribute("disabled", "");
    return;
  }
  if (S.sheet !== st || st.range !== ri) return;
  const n = pts.length, first = pts[0].v, lastV = pts[n - 1].v, per = (lastV / first - 1) * 100;
  const base = () => `<div class="big">${fmt(livePrice ?? lastV)}</div><div class="sub">${chip(livePct)}<span>hoje</span>${intraday ? "" : ` · <span>${chip(per)}</span><span>no período</span>`}</div>`;
  readout.innerHTML = base();
  mountChart(chartEl, pts, {
    fmt, ma20: n >= 30 && !intraday, ma50: n >= 70, xfmt: intraday ? fmtTime : null, up: intraday ? livePct >= 0 : undefined,
    onScrub: (i) => {
      if (i == null) { readout.innerHTML = base(); return; }
      const p = pts[i], d = (p.v / first - 1) * 100, tf = intraday ? fmtTime : fmtDay;
      readout.innerHTML = `<div class="big">${fmt(p.v)}</div><div class="sub">${chip(d)}<span>desde ${tf(pts[0].t)}</span> · <b>${tf(p.t)}</b></div>`;
    },
  });
  $("#legend").innerHTML = `<span><i style="border-color:var(--${(intraday ? livePct < 0 : dir(per, 0) === "down") ? "down" : "up"})"></i>Preço${intraday ? " ao longo do dia" : ""}</span>${n >= 30 && !intraday ? '<span><i class="d" style="border-color:var(--accent)"></i>Média 20d</span>' : ""}${n >= 70 ? '<span><i class="d" style="border-color:var(--ma2)"></i>Média 50d</span>' : ""}`;
  if (intraday) { $("#verdict").innerHTML = ""; return; }
  const vd = verdict(pts, isUsd ? 1.2 : 2.5);
  $("#verdict").innerHTML = `<div class="verdict ${vd.d}"><div class="vi">${VERDICT_ICON[vd.d]}</div><div><b>${vd.title}</b><span>${esc(vd.why)}</span></div></div>`;
}

/* ───────── eventos ───────── */
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3500);
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest(".bottomnav button");
  if (nav) return setView(nav.dataset.view);
  if (e.target.closest("#hero")) return openSheet("usd", "USD");
  const r = e.target.closest("[data-sym]");
  if (r) return openSheet("stock", r.dataset.sym);
  const t = e.target.closest(".tabs button");
  if (t) {
    S.tab = t.dataset.tab; S.shown = 40;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", b === t));
    renderList();
    return;
  }
  const c = e.target.closest("[data-cat]");
  if (c) return setCat(c.dataset.cat);
  if (e.target.closest("#more")) { S.shown += 40; renderList(); }
});
let qTimer;
$("#q").addEventListener("input", (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value; S.shown = 40; renderList(); }, 140); });
$("#sector").addEventListener("change", (e) => { S.sector = e.target.value; S.shown = 40; renderList(); });
$("#hero").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet("usd", "USD"); } });
scrim.addEventListener("click", () => closeSheet());
window.addEventListener("popstate", () => closeSheet(true));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") { if (!$("#settings").hidden) $("#settings").hidden = true; else closeSheet(); } });
$("#btnRefresh").onclick = () => refresh(true);
// logo que não carrega: some e deixa a sigla (sem handler inline, para valer a política de segurança de conteúdo)
document.addEventListener("error", (e) => { if (e.target.tagName === "IMG" && e.target.closest(".logo")) e.target.remove(); }, true);

/* ───────── aceite dos termos (primeiro uso) ───────── */
const welcome = $("#welcome");
if (!store.get("accepted_v1", false)) welcome.hidden = false;
$("#welcomeOk").onclick = () => { store.set("accepted_v1", Date.now()); welcome.hidden = true; };

/* ───────── instalar como app ───────── */
let installEvt = null;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
function updateInstallUI() {
  const can = !standalone && (installEvt || isIOS);
  $("#installBox").hidden = !can;
  $("#btnInstall").hidden = !installEvt;
  $("#iosHint").hidden = !(isIOS && !installEvt);
  const bar = $("#installBar");
  bar.hidden = !can || !!store.get("install_dismissed", false);
  $("#installText").textContent = installEvt ? "Instale o Intelinvest na tela inicial do celular." : "No iPhone: Compartilhar → Adicionar à Tela de Início.";
  $("#installGo").hidden = !installEvt;
}
async function doInstall() { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch { /* sem escolha */ } installEvt = null; updateInstallUI(); }
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; updateInstallUI(); });
window.addEventListener("appinstalled", () => { installEvt = null; updateInstallUI(); toast("Intelinvest instalado."); });
$("#installGo").onclick = doInstall; $("#btnInstall").onclick = doInstall;
$("#installX").onclick = () => { store.set("install_dismissed", true); updateInstallUI(); };
updateInstallUI();

$("#btnSettings").onclick = () => {
  $("#tokenBox").hidden = !!API; $("#setSave").hidden = !!API;
  $("#token").value = store.get("brapi_token", ""); $("#settings").hidden = false; updateInstallUI();
  if (typeof Auth !== "undefined") Auth.render();
  if (!API) $("#token").focus();
};
$("#setCancel").onclick = () => ($("#settings").hidden = true);
$("#setSave").onclick = () => { store.set("brapi_token", $("#token").value.trim()); $("#settings").hidden = true; toast("Salvo. Atualizando…"); refresh(true); };
$("#settings").addEventListener("click", (e) => { if (e.target.id === "settings") e.target.hidden = true; });

let timer;
// com o mercado aberto atualiza a cada 1 min; fechado, a cada 5 min (os dados quase não mudam)
const gapMs = () => (marketOpen() ? REFRESH_MS : 5 * REFRESH_MS);
function schedule() { clearInterval(timer); timer = setInterval(() => { if (!document.hidden && Date.now() - (S.updatedAt || 0) >= gapMs() - 2000) refresh(); }, REFRESH_MS); }
document.addEventListener("visibilitychange", () => { if (!document.hidden && (!S.updatedAt || Date.now() - S.updatedAt > gapMs())) refresh(); renderStatus(); });
window.addEventListener("online", () => refresh());

/* ───────── início ───────── */
if (loadCache()) { S.offline = true; render(); } else render();
refresh();
schedule();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
