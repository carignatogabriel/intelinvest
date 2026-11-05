/* Aba "Análise": matemática clássica de avaliação de investimentos aplicada aos dados de hoje.
   Usa as funções/estado de app.js (S, brapiQuotes, getJSON, loadDetail, formatadores). */
"use strict";

const Analise = (() => {
  const A = { macro: null, hist: {}, usd: null, loading: false, tried: false, sort: "sharpe", mode: "rn" };
  const f1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const f2 = n2;
  const P1 = (v) => `${f1.format(v)}%`;
  const P2 = (v) => `${f2.format(v)}%`;

  /* ───────── matemática ───────── */
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const std = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function mulberry32(seed) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const corr = (a, b) => { const ma = mean(a), mb = mean(b); let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; } return sab / Math.sqrt(saa * sbb || 1); };

  /** Estatísticas de uma série de preços (fechamentos diários). */
  function stats(pts, rf, q) {
    const c = pts.map((p) => p.v), n = c.length;
    const r = []; for (let i = 1; i < n; i++) r.push(Math.log(c[i] / c[i - 1]));
    const mu = mean(r), sd = std(r), vol = sd * Math.sqrt(252);
    const yrs = Math.max((pts[n - 1].t - pts[0].t) / (365.25 * 864e5), 0.05);
    const ret = c[n - 1] / c[0] - 1;
    const cagr = Math.pow(Math.max(1 + ret, 1e-6), 1 / yrs) - 1;
    let peak = c[0], maxDD = 0;
    for (const x of c) { peak = Math.max(peak, x); maxDD = Math.min(maxDD, x / peak - 1); }
    const curDD = c[n - 1] / peak - 1;
    const mom = n >= 200 ? c[n - 22] / c[0] - 1 : null;
    let z200 = null;
    if (n >= 200) { const w = c.slice(-200), s = std(w); z200 = s ? (c[n - 1] - mean(w)) / s : 0; }
    const sorted = [...r].sort((a, b) => a - b);
    const var95 = Math.exp(sorted[Math.floor(0.05 * sorted.length)]) - 1;
    const m2 = mean(r.map((x) => (x - mu) ** 2)), m4 = mean(r.map((x) => (x - mu) ** 4));
    const kurt = m2 ? m4 / (m2 * m2) - 3 : 0;
    const extreme = r.filter((x) => Math.abs(x - mu) > 3 * sd).length;
    const eps = q?.earningsPerShare, ey = eps != null && isFinite(eps) ? eps / c[n - 1] : null;
    let jump = null; r.forEach((x, i) => { if (Math.abs(x) > 0.4 && (!jump || Math.abs(x) > Math.abs(jump.x))) jump = { x, t: pts[i + 1].t }; });
    const sharpe = vol ? (cagr - rf) / vol : 0;
    const kellyRaw = vol ? (cagr - rf) / (vol * vol) : 0;
    return { n, yrs, ret, cagr, vol, sharpe, maxDD, curDD, mom, z200, var95, kurt, extreme, obs: r.length, ey, pl: q?.priceEarnings, kellyRaw, kelly: clamp(kellyRaw, 0, 1), jump, mu, sd, r, last: c[n - 1] };
  }

  /** Alinha as séries por data (preenche feriados específicos) e mede diversificação. */
  function portfolio(hist) {
    const syms = Object.keys(hist);
    if (syms.length < 2) return null;
    const ref = syms.reduce((a, b) => (hist[b].length > hist[a].length ? b : a));
    const days = hist[ref].map((p) => Math.floor(p.t / 864e5));
    const cols = syms.map((s) => { const m = new Map(hist[s].map((p) => [Math.floor(p.t / 864e5), p.v])); let last = null; return days.map((d) => { if (m.has(d)) last = m.get(d); return last; }); });
    let start = 0; while (start < days.length && cols.some((c) => c[start] == null)) start++;
    if (days.length - start < 40) return null;
    const rets = cols.map((c) => { const o = []; for (let i = start + 1; i < days.length; i++) o.push(Math.log(c[i] / c[i - 1])); return o; });
    let sum = 0, cnt = 0;
    for (let i = 0; i < rets.length; i++) for (let j = i + 1; j < rets.length; j++) { sum += corr(rets[i], rets[j]); cnt++; }
    const port = rets[0].map((_, k) => mean(rets.map((r) => r[k])));
    const volP = std(port) * Math.sqrt(252), volBar = mean(rets.map((r) => std(r) * Math.sqrt(252)));
    return { rho: sum / cnt, volP, volBar, red: 1 - volP / volBar, n: syms.length };
  }

  /** Monte Carlo (movimento browniano geométrico). logDrift = deriva anual do log-preço. */
  function simulate(logDrift, sigma, { days = 252, N = 2000, seed = 7 } = {}) {
    const rnd = mulberry32(seed), dt = 1 / 252, dr = logDrift * dt, vs = sigma * Math.sqrt(dt);
    const x = new Float64Array(N), mn = new Float64Array(N);
    const idx = [0], P = { p10: [0], p25: [0], p50: [0], p75: [0], p90: [0] };
    const snap = () => { const s = Float64Array.from(x).sort(); const at = (p) => s[Math.floor(p * (N - 1))]; P.p10.push(at(0.1)); P.p25.push(at(0.25)); P.p50.push(at(0.5)); P.p75.push(at(0.75)); P.p90.push(at(0.9)); };
    for (let d = 1; d <= days; d++) {
      for (let i = 0; i < N; i++) {
        const z = Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
        x[i] += dr + vs * z; if (x[i] < mn[i]) mn[i] = x[i];
      }
      if (d % 4 === 0 || d === days) { idx.push(d); snap(); }
    }
    const L20 = Math.log(0.8);
    let up = 0, endLoss = 0, touch = 0; for (let i = 0; i < N; i++) { if (x[i] > 0) up++; if (x[i] < L20) endLoss++; if (mn[i] < L20) touch++; }
    return { idx, P, probUp: up / N, probEnd20: endLoss / N, probTouch20: touch / N };
  }

  /* ───────── dados ───────── */
  async function fetchMacro() {
    if (API) { const m = await getJSON(`${API}/macro`); return { selic: m.selic, ipca: m.ipca }; }
    const g = (id) => getJSON(`https://api.bcb.gov.br/dados/serie/bcdata.sgs.${id}/dados/ultimos/1?formato=json`);
    const [s, i] = await Promise.allSettled([g(432), g(13522)]);
    return { selic: s.status === "fulfilled" ? +s.value[0].valor : null, ipca: i.status === "fulfilled" ? +i.value[0].valor : null };
  }
  async function fetchHist(list) {
    const c = store.get("hist1y", null);
    if (c && Date.now() - c.at < 6 * 3600e3 && list.every((s) => c.d[s])) return Object.fromEntries(Object.entries(c.d).map(([k, v]) => [k, v.map(([t, x]) => ({ t: t * 1000, v: x }))]));
    for (const rg of ["1y", "6mo", "3mo"]) {
      const qs = await brapiQuotes(list, rg), d = {};
      for (const q of qs) { const p = (q.historicalDataPrice || []).filter((x) => x.close != null).map((x) => ({ t: x.date * 1000, v: x.close })); if (p.length >= 40) d[q.symbol] = p; }
      if (Object.keys(d).length >= Math.min(2, list.length)) { store.set("hist1y", { at: Date.now(), d: Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.map((p) => [Math.round(p.t / 1000), p.v])])) }); return d; }
    }
    return {};
  }
  async function load() {
    if (A.loading) return;
    A.loading = true; render();
    const list = analysisList();
    const [m, h, u] = await Promise.allSettled([fetchMacro(), fetchHist(list), loadDetail("usd", "USD", 3)]);
    if (m.status === "fulfilled") A.macro = m.value;
    if (h.status === "fulfilled") A.hist = h.value;
    if (u.status === "fulfilled") A.usd = u.value;
    A.loading = false; A.tried = true; render();
  }

  /* ───────── modelo de dados da tela ───────── */
  function model() {
    const mc = A.macro || {};
    const rf = mc.selic != null ? mc.selic / 100 : 0;
    const real = mc.selic != null && mc.ipca != null ? (1 + mc.selic / 100) / (1 + mc.ipca / 100) - 1 : null;
    const rows = Object.keys(A.hist).map((sym) => ({ sym, q: S.quotes[sym], s: stats(A.hist[sym], rf, S.quotes[sym]) }));
    return { mc, rf, real, rows, port: portfolio(A.hist) };
  }

  const nameOf = (r) => esc(r.sym);
  const list3 = (arr) => arr.map((r) => `<b>${nameOf(r)}</b>`).join(", ");

  /** Cartões de princípios: cada um traz a leitura de hoje + a matemática por trás. */
  function cards(M) {
    const { mc, rf, real, rows, port } = M, out = [], N = rows.length;
    const add = (tag, title, tone, body, math) => out.push({ tag, title, tone, body, math });

    if (real != null) {
      const tone = real >= 0.06 ? "down" : real >= 0.03 ? "flat" : "up";
      add("Irving Fisher · 1930", "Juro real: o piso que toda ação precisa vencer", tone,
        `Selic <b>${P2(mc.selic)}</b> e inflação (IPCA 12m) <b>${P1(mc.ipca)}</b> dão um juro real de <b>${P1(real * 100)}</b> ao ano. ` +
        (real >= 0.06 ? "É alto: a renda fixa paga muito acima da inflação, então uma ação precisa render bem mais que isso para compensar o risco." : real >= 0.03 ? "É moderado: a renda fixa ainda compete bem com a bolsa." : "É baixo: a renda fixa rende pouco acima da inflação e a bolsa fica relativamente mais atraente."),
        "<b>(1 + juro nominal) = (1 + juro real) × (1 + inflação)</b>, logo juro real = (1+Selic) ÷ (1+IPCA) − 1. Quem aceita risco quer o juro real <i>mais</i> um prêmio de risco; se uma ação não promete isso, a renda fixa vence sem a dor de cabeça.");
      const yN = Math.log(2) / Math.log(1 + rf), yR = Math.log(2) / Math.log(1 + real);
      add("Pacioli · 1494 / Euler", "Juros compostos e a regra dos 72", "flat",
        `Na Selic atual o dinheiro dobra em <b>${f1.format(yN)} anos</b> no papel — e em <b>${yR > 60 ? "mais de 60" : f1.format(yR)} anos</b> em poder de compra. R$ 1.000 viram <b>${fmtBRL(1000 * (1 + rf) ** 10)}</b> em 10 anos (hoje), ou <b>${fmtBRL(1000 * (1 + real) ** 10)}</b> em valor real.`,
        "<b>Anos para dobrar ≈ 72 ÷ taxa(%)</b>. Exato: ln 2 ÷ ln(1+taxa). O crescimento é exponencial: tempo e constância pesam mais que acertar o momento. Einstein nunca disse que juros compostos são a 8ª maravilha — mas a conta é essa.");
    }

    const ey = rows.filter((r) => r.s.ey != null && r.s.ey > 0 && r.s.pl > 0);
    if (ey.length && mc.selic != null) {
      const cheap = ey.filter((r) => r.s.ey * 100 > mc.selic).sort((a, b) => b.s.ey - a.s.ey);
      add("Benjamin Graham · 1949", "Lucro por real investido vs. juros", cheap.length ? "up" : "flat",
        `A Selic paga <b>${P2(mc.selic)}</b>. ${cheap.length ? `${cheap.length} de ${ey.length} ações têm lucro/preço acima disso: ${list3(cheap.slice(0, 4))} (lucro/preço de ${P1(cheap[0].s.ey * 100)} no melhor caso).` : `Nenhuma das ${ey.length} ações com lucro positivo gera lucro/preço acima da Selic (a melhor, <b>${nameOf(ey.sort((a, b) => b.s.ey - a.s.ey)[0])}</b>, tem ${P1(ey[0].s.ey * 100)}). Quem compra hoje aposta em crescimento futuro do lucro.`}`,
        "<b>Lucro/Preço = LPA ÷ Preço = 1 ÷ (P/L)</b>. Graham, mentor de Warren Buffett, exigia <i>margem de segurança</i>: pagar bem menos que o valor. O 'modelo do Fed' compara esse rendimento com o juro sem risco. Cuidados: o lucro de um ano pode ser atípico, bancos e cíclicas têm múltiplos diferentes, e crescimento justifica pagar mais.");
    }

    if (N >= 2) {
      const by = [...rows].sort((a, b) => b.s.sharpe - a.s.sharpe), pos = rows.filter((r) => r.s.sharpe > 0).length;
      add("William Sharpe · 1966 (Nobel)", "Retorno ajustado ao risco", pos > N / 2 ? "up" : pos ? "flat" : "down",
        `Nos últimos ${f1.format(by[0].s.yrs * 12)} meses, <b>${pos} de ${N}</b> ações entregaram retorno acima da Selic descontando o risco. Melhor: <b>${nameOf(by[0])}</b> (Sharpe ${f2.format(by[0].s.sharpe)}). Pior: <b>${nameOf(by[N - 1])}</b> (${f2.format(by[N - 1].s.sharpe)}).`,
        "<b>Sharpe = (retorno anualizado − juro livre de risco) ÷ volatilidade anualizada</b>. Mede quanto retorno extra você recebeu por unidade de oscilação. Acima de 1 é excelente; abaixo de 0, a ação rendeu menos que a renda fixa <i>e</i> ainda deu susto. Armadilha: olha o passado — não garante o futuro.");
    }

    if (port) {
      add("Harry Markowitz · 1952 (Nobel)", "Diversificar: o único almoço grátis", port.rho > 0.6 ? "flat" : "up",
        `A correlação média entre as ${port.n} ações é <b>${f2.format(port.rho)}</b>. Uma carteira com pesos iguais oscilou <b>${P1(port.volP * 100)}</b> ao ano contra <b>${P1(port.volBar * 100)}</b> da ação média: <b>${P1(port.red * 100)} menos risco</b> sem abrir mão do retorno médio. ${port.rho > 0.6 ? "Correlação alta: as ações andam juntas, então diversificar só entre elas protege menos." : "Correlação moderada: há ganho real em dividir o dinheiro."}`,
        "<b>σ²<sub>carteira</sub> = Σᵢ Σⱼ wᵢ wⱼ σᵢ σⱼ ρᵢⱼ</b>. Com ρ = 1 não há ganho; com ρ = 0 o risco cai ≈ 1/√N. Markowitz mostrou que o risco de um ativo importa pela forma como ele se move <i>junto</i> com o resto da carteira — não isoladamente. Para diversificar de verdade, misture classes (ações, renda fixa, dólar), não só tickers.");
    }

    const mo = rows.filter((r) => r.s.mom != null).sort((a, b) => b.s.mom - a.s.mom);
    if (mo.length >= 3) {
      add("Jegadeesh & Titman · 1993", "Momentum: quem subiu tende a continuar (um pouco)", "flat",
        `Maiores momentos de ~11 meses: ${mo.slice(0, 3).map((r) => `<b>${nameOf(r)}</b> (${fmtPct(r.s.mom * 100)})`).join(", ")}.` +
        (mo.length > 3 ? ` Piores: ${mo.slice(3).slice(-2).map((r) => `<b>${nameOf(r)}</b> (${fmtPct(r.s.mom * 100)})`).join(", ")}.` : ""),
        "<b>Momentum 12−1 = preço de 1 mês atrás ÷ preço de 12 meses atrás − 1</b> (ignora o último mês para evitar a reversão de curtíssimo prazo). É um dos fatores mais estudados da finança, visto em dezenas de países — mas sofre quedas bruscas nas viradas de mercado. É uma tendência estatística, não garantia.");
    }

    if (N) {
      const dd = rows.filter((r) => r.s.curDD <= -0.2).sort((a, b) => a.s.curDD - b.s.curDD), w = [...rows].sort((a, b) => a.s.curDD - b.s.curDD)[0];
      add("Kahneman & Tversky · 1979 (Nobel)", "Perder dói mais que ganhar alegra", dd.length ? "down" : "flat",
        `${dd.length ? `<b>${dd.length}</b> de ${N} ações estão mais de 20% abaixo do topo do período.` : `Nenhuma ação está mais de 20% abaixo do topo.`} A mais distante: <b>${nameOf(w)}</b> a <b>${fmtPct(w.s.curDD * 100)}</b> do topo — precisaria subir <b>${fmtPct((1 / (1 + w.s.curDD) - 1) * 100)}</b> só para voltar a ele.`,
        "<b>Ganho necessário = 1 ÷ (1 − queda) − 1</b>: −20% exige +25%; −50% exige +100%. A dor de uma perda pesa ≈ 2× o prazer de um ganho igual (aversão à perda), o que leva a vender no fundo e segurar perdedoras. Defina antes quanto aceita perder; decida com regra, não com emoção.");
    }

    if (A.usd && A.usd.length > 60) {
      const v = A.usd.map((p) => p.v), m = mean(v), s = std(v), last = v[v.length - 1], z = s ? (last - m) / s : 0, rank = v.filter((x) => x < last).length / v.length;
      add("Gustav Cassel · 1918", "Dólar: quão longe da média?", Math.abs(z) > 2 ? "down" : "flat",
        `O dólar a <b>R$ ${n2.format(last)}</b> está <b>${z >= 0 ? "acima" : "abaixo"}</b> da média de 12 meses (R$ ${n2.format(m)}): z-score <b>${f2.format(z)}</b>, mais caro que <b>${nInt.format(rank * 100)}%</b> dos dias do ano.`,
        "<b>z = (preço atual − média) ÷ desvio-padrão</b>. Numa distribuição normal, |z| > 2 é raro (≈5% dos dias). A paridade do poder de compra sugere que o câmbio volta ao valor 'justo' no longo prazo — mas o prazo é imprevisível e o real já ficou longe da média por anos. Serve para medir extremos, não para cravar o momento.");
    }

    if (N) {
      const obs = rows.reduce((a, r) => a + r.s.extreme, 0), tot = rows.reduce((a, r) => a + r.s.obs, 0), exp = tot * 0.0027;
      add("Mandelbrot · 1963 / Taleb", "Caudas grossas: o dia ruim é mais comum que o modelo diz", obs > exp * 1.2 ? "down" : "flat",
        `Em ${N} ações × ${nInt.format(tot / N)} pregões, movimentos diários maiores que 3 desvios-padrão aconteceram <b>${obs}</b> vezes; a curva normal previa <b>${f1.format(exp)}</b>. Curtose média: <b>${f1.format(mean(rows.map((r) => r.s.kurt)))}</b> (0 = normal).`,
        "Na distribuição normal só <b>0,27%</b> dos dias passam de 3σ. Nos mercados reais acontece bem mais (<i>curtose</i> alta). Consequência: modelos que supõem normalidade subestimam crises. Dimensione posições pensando no <b>pior dia</b>, não no dia típico — e evite alavancagem.");
    }

    if (N) {
      add("John Kelly · 1956 / Edward Thorp", "Quanto apostar: a fração de Kelly", "flat",
        "Exemplo <b>hipotético</b>: um ativo que rende 10% acima da renda fixa, com volatilidade de 25%, daria f* = 0,10 ÷ 0,25² = <b>160%</b> do patrimônio — um número impossível de seguir. Esse é o alerta da fórmula: com retornos estimados e ruidosos, ela superestima a aposta. Por isso gestores usam ¼ a ½ Kelly e nunca concentram tudo numa ação. O app não calcula isso para papéis reais.",
        "<b>f* ≈ (retorno esperado − juro) ÷ variância</b>. Maximiza o crescimento no longo prazo, mas é agressiva e extremamente sensível a erro na estimativa do retorno. Se f* ≤ 0, o histórico não pagou o risco. Thorp usou a ideia para vencer o blackjack e operar em fundos de investimento.");
    }

    add("Black, Scholes & Merton · 1973 (Nobel)", "Incerteza: pense em faixas, não em previsões", "flat",
      "Ninguém sabe o preço de amanhã; dá para estimar a <b>faixa provável</b>. Toque em qualquer ação do placar abaixo para ver o <b>cone de probabilidade</b> (simulação de Monte Carlo com 2.000 futuros possíveis).",
      "O preço segue um movimento browniano geométrico: <b>dS = μS dt + σS dW</b>. Simulamos milhares de trajetórias e lemos os percentis P10/P50/P90. A largura do cone cresce com <b>σ√t</b>. É um modelo — real tem saltos e crises que ele não captura.");
    return out;
  }

  /* ───────── render da aba ───────── */
  const SORTS = { sharpe: ["Sharpe", (r) => r.s.sharpe, -1], ret: ["Retorno", (r) => r.s.cagr, -1], risk: ["Menor risco", (r) => r.s.vol, 1], dd: ["Menor queda", (r) => -r.s.curDD, 1] };

  function render() {
    const el = $("#viewAnalise"); if (!el) return;
    if (!A.tried) { el.innerHTML = '<div class="skel" style="height:110px;margin-bottom:12px"></div>' + Array.from({ length: 4 }, () => '<div class="skel" style="height:120px;margin-bottom:10px"></div>').join(""); return; }
    if (!Object.keys(A.hist).length) { el.innerHTML = '<div class="empty"><b>Sem histórico no momento</b>Não foi possível carregar os preços do último ano. Verifique a conexão e volte a esta aba.</div>'; return; }
    const M = model(), { mc, real, rows } = M;
    const macro = `<div class="macro">
      <div class="stat"><small>Selic (meta)</small><b>${mc.selic != null ? P2(mc.selic) : "—"}</b></div>
      <div class="stat"><small>Inflação IPCA 12m</small><b>${mc.ipca != null ? P1(mc.ipca) : "—"}</b></div>
      <div class="stat"><small>Juro real ao ano</small><b class="${real == null ? "" : real >= 0 ? "t-up" : "t-down"}">${real != null ? P1(real * 100) : "—"}</b></div>
      <div class="stat"><small>Ações analisadas</small><b>${rows.length}</b></div></div>`;
    const cs = cards(M).map((c, i) => `<article class="pcard ${c.tone}">
      <div class="ptag">${esc(c.tag)}</div><h3>${c.title}</h3><p>${c.body}</p>
      <details><summary>Entenda a matemática</summary><p>${c.math}</p></details></article>`).join("");
    const [, key, ord] = SORTS[A.sort];
    const sorted = [...rows].sort((a, b) => (key(a) - key(b)) * (ord === 1 ? 1 : -1));
    const chips = Object.entries(SORTS).map(([k, v]) => `<button data-sort="${k}" aria-pressed="${k === A.sort}">${v[0]}</button>`).join("");
    const tbl = sorted.map((r) => {
      const s = r.s, tone = s.sharpe > 0.5 ? "up" : s.sharpe > 0 ? "flat" : "down";
      return `<button class="qrow" data-quant="${esc(r.sym)}" aria-label="${esc(r.sym)}: Sharpe ${f2.format(s.sharpe)}, retorno ${fmtPct(s.cagr * 100)}, risco ${P1(s.vol * 100)}">
        <div class="qn"><b>${esc(r.sym)}${s.jump ? ' <span class="warn" title="salto extremo nos dados">⚠</span>' : ""}</b><span>${fmtPct(s.curDD * 100)} do topo</span></div>
        <div class="qc"><small>Retorno/ano</small><b class="t-${dir(s.cagr)}">${fmtPct(s.cagr * 100)}</b></div>
        <div class="qc"><small>Risco/ano</small><b>${P1(s.vol * 100)}</b></div>
        <div class="qc"><small>Sharpe</small><b><span class="chip ${tone}">${f2.format(s.sharpe)}</span></b></div></button>`;
    }).join("");
    const note = !API && !hasFull() ?'<p class="hint" style="margin:10px 4px 0">Sem token a brapi libera só 4 ações; com o token gratuito o placar analisa as 40 maiores ações (engrenagem no topo).</p>' : "";
    el.innerHTML = `<div class="notice"><b>Conteúdo educativo.</b> Esta aba explica métodos clássicos de avaliação aplicados a dados públicos. Não é recomendação de compra, venda ou manutenção de ativos, não considera seu perfil e não substitui um profissional habilitado.</div>
      <h2 class="sec">Cenário de hoje</h2>${macro}
      <h2 class="sec">Princípios aplicados ao mercado de hoje</h2><div class="pcards">${cs}</div>
      <h2 class="sec">Indicadores históricos <small>12 meses · toque no papel para ver a simulação</small></h2>
      <div class="sortchips" role="group" aria-label="Ordenar placar">${chips}</div><div class="qtable">${tbl}</div>${note}
      <p class="hint" style="margin:14px 4px 0">Tudo aqui é calculado no seu aparelho com dados públicos e serve para <b>aprender a avaliar</b> — não é recomendação de compra ou venda. Rentabilidade passada não garante resultado futuro.</p>`;
  }

  /* ───────── detalhe quantitativo de uma ação ───────── */
  function cone(hist, sim, S0) {
    const W = 360, H = 250, L = 6, R = 54, T = 12, B = 24, iw = W - L - R, ih = H - T - B;
    const hh = hist.slice(-90).map((p) => p.v), hn = hh.length, total = hn - 1 + 252;
    const X = (d) => L + (d / total) * iw, f = (k) => S0 * Math.exp(k);
    const P = sim.P, last = P.p50.length - 1;
    const all = hh.concat(P.p10.map(f), P.p90.map(f));
    let mn = Math.min(...all), mx = Math.max(...all); const pad = (mx - mn) * 0.06; mn -= pad; mx += pad;
    const Y = (v) => T + (1 - (v - mn) / (mx - mn)) * ih, id = `k${++gid}`;
    const fx = sim.idx.map((d) => hn - 1 + d);
    const band = (lo, hi) => fx.map((x, i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(f(hi[i])).toFixed(1)}`).join("") + [...fx].reverse().map((x, i) => `L${X(x).toFixed(1)},${Y(f(lo[fx.length - 1 - i])).toFixed(1)}`).join("") + "Z";
    const line = (arr) => fx.map((x, i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(f(arr[i])).toFixed(1)}`).join("");
    const hl = hh.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join("");
    let grid = ""; for (let k = 0; k < 4; k++) { const y = Y(mn + ((mx - mn) * (k + 0.5)) / 4); grid += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--line)" opacity=".7"/>`; }
    grid += `<text x="${W - R + 5}" y="${(Y(S0) + 4).toFixed(1)}" fill="var(--muted)" font-size="11">hoje</text>`;
    const tick = (d, t, a) => `<text x="${X(d).toFixed(1)}" y="${H - 6}" fill="var(--muted)" font-size="11" text-anchor="${a}">${t}</text>`;
    const end = (arr, c, dy) => `<text x="${X(total) + 5}" y="${(Y(f(arr[last])) + dy).toFixed(1)}" fill="${c}" font-size="11" font-weight="700">${n2.format(f(arr[last]))}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cone de probabilidade para os próximos 12 meses">
      ${grid}${tick(0, "−3m", "start")}${tick(hn - 1, "hoje", "middle")}${tick(hn - 1 + 126, "+6m", "middle")}${tick(total, "+12m", "end")}
      <path d="${band(P.p10, P.p90)}" fill="var(--accent)" opacity=".16"/><path d="${band(P.p25, P.p75)}" fill="var(--accent)" opacity=".30"/>
      <line x1="${X(hn - 1)}" x2="${X(total)}" y1="${Y(S0)}" y2="${Y(S0)}" stroke="var(--muted)" stroke-dasharray="3 4" opacity=".8"/>
      <path d="${hl}" fill="none" stroke="var(--text)" stroke-width="2" stroke-linejoin="round" opacity=".9"/>
      <path d="${line(P.p50)}" fill="none" stroke="var(--accent)" stroke-width="2.2" stroke-linecap="round"/>
      ${end(P.p90, "var(--up)", 3)}${end(P.p50, "var(--accent)", 4)}${end(P.p10, "var(--down)", 4)}</svg>`;
  }

  function drawQuant(sym) {
    const body = $("#sheetBody"), M = model(), r = M.rows.find((x) => x.sym === sym);
    if (!r) { body.innerHTML = '<div class="empty">Sem dados para esta ação.</div>'; return; }
    const s = r.s, q = r.q || {}, rf = M.rf, hist = A.hist[sym];
    const logDrift = A.mode === "rn" ? Math.log(1 + rf) - (s.vol * s.vol) / 2 : s.mu * 252;
    const sim = simulate(logDrift, s.vol), S0 = s.last, f = (k) => S0 * Math.exp(k), last = sim.P.p50.length - 1;
    const t = (v, good, bad) => (v >= good ? "up" : v <= bad ? "down" : "flat");
    const tile = (label, val, tone, note) => `<div class="stat"><small>${label}</small><b class="t-${tone}">${val}</b><em>${note}</em></div>`;
    const evol = s.vol < 0.25 ? "up" : s.vol > 0.4 ? "down" : "flat";
    const eyTone = s.ey == null ? "flat" : s.ey * 100 > (M.mc.selic ?? 99) ? "up" : "flat";
    const tiles = [
      tile("Retorno anualizado", fmtPct(s.cagr * 100), dir(s.cagr), `${fmtPct(s.ret * 100)} no período (${nInt.format(s.n)} pregões)`),
      tile("Volatilidade anual", P1(s.vol * 100), evol, `Oscila ±${P1(s.vol * 100)} num ano típico (1σ)`),
      tile("Índice de Sharpe", f2.format(s.sharpe), t(s.sharpe, 0.5, 0), s.sharpe > 1 ? "Excelente vs. a Selic" : s.sharpe > 0.5 ? "Bom: paga o risco" : s.sharpe > 0 ? "Fraco: paga pouco o risco" : "Rendeu menos que a renda fixa"),
      tile("Queda máxima", fmtPct(s.maxDD * 100), s.maxDD < -0.3 ? "down" : "flat", "Pior queda topo→fundo no período"),
      tile("Distância do topo", fmtPct(s.curDD * 100), s.curDD > -0.05 ? "up" : s.curDD < -0.2 ? "down" : "flat", `Precisa de ${fmtPct((1 / (1 + s.curDD) - 1) * 100)} p/ voltar ao topo`),
      tile("Momentum 12−1", s.mom == null ? "—" : fmtPct(s.mom * 100), s.mom == null ? "flat" : dir(s.mom), "Retorno ignorando o último mês"),
      tile("Desvio da média de 200d", s.z200 == null ? "—" : `${f2.format(s.z200)} σ`, s.z200 == null ? "flat" : Math.abs(s.z200) > 2 ? "down" : "flat", s.z200 == null ? "Poucos dados" : s.z200 > 2 ? "Esticada acima da média" : s.z200 < -2 ? "Bem abaixo da média" : "Perto da média"),
      tile("Perda diária (VaR 95%)", fmtPct(s.var95 * 100), "flat", "Em 95% dos dias a perda foi menor"),
      tile("Lucro/Preço", s.ey == null ? "—" : P1(s.ey * 100), eyTone, s.ey == null ? "Sem lucro divulgado" : `P/L ${s.pl ? f1.format(s.pl) : "—"} · Selic ${M.mc.selic != null ? P2(M.mc.selic) : "—"}`),
    ].join("");
    const bullets = [];
    bullets.push(s.sharpe > 0.5 ? `No período, o retorno ajustado ao risco foi alto (Sharpe ${f2.format(s.sharpe)}).` : s.sharpe > 0 ? `No período, o retorno ajustado ao risco foi baixo (Sharpe ${f2.format(s.sharpe)}).` : `No período, o retorno ficou abaixo da Selic mesmo com risco (Sharpe ${f2.format(s.sharpe)}).`);
    bullets.push(`A maior queda do topo ao fundo no período foi de ${P1(Math.abs(s.maxDD) * 100)}.`);
    if (s.ey != null && M.mc.selic != null) bullets.push(s.ey * 100 > M.mc.selic ? `O lucro/preço (${P1(s.ey * 100)}) está acima da Selic, critério que Graham usava para medir margem de segurança.` : `O lucro/preço (${P1(s.ey * 100)}) está abaixo da Selic: o preço embute expectativa de crescimento do lucro.`);
    if (s.z200 != null && Math.abs(s.z200) > 2) bullets.push(s.z200 > 0 ? "O preço está bem acima da média de 200 dias." : "O preço está bem abaixo da média de 200 dias.");
    bullets.push("Estes números descrevem o passado de dados públicos; não consideram seu perfil e não indicam o que vai acontecer.");
    body.innerHTML = `
      <div class="sh-head"><div><h2 id="sheetTitle">${esc(sym)} · análise</h2><p>${esc(q.longName || "")}</p></div>
        <button class="close" id="sheetClose" aria-label="Fechar"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button></div>
      ${s.jump ? `<div class="verdict down" style="margin-top:8px"><div class="vi">⚠</div><div><b>Salto extremo em ${fmtDay(s.jump.t)}: ${fmtPct((Math.exp(s.jump.x) - 1) * 100)} num dia</b><span>Pode ser um fato real ou um desdobramento/grupamento sem ajuste nos dados. Risco, queda máxima e Sharpe desta ação podem estar distorcidos — confira o histórico da empresa.</span></div></div>` : ""}
      <h3 class="sec" style="margin-top:8px">Radar quantitativo</h3><div class="stats metrics">${tiles}</div>
      <h3 class="sec">Simulação ilustrativa · 12 meses</h3>
      <div class="ranges" id="modes"><button data-mode="rn" aria-pressed="${A.mode === "rn"}">Premissa: juro (neutro)</button><button data-mode="hist" aria-pressed="${A.mode === "hist"}">Premissa: histórico</button></div>
      <div class="chart-wrap">${cone(hist, sim, S0)}</div>
      <div class="legend"><span><i style="border-color:var(--up)"></i>P90 ${n2.format(f(sim.P.p90[last]))}</span><span><i style="border-color:var(--accent)"></i>Mediana ${n2.format(f(sim.P.p50[last]))}</span><span><i style="border-color:var(--down)"></i>P10 ${n2.format(f(sim.P.p10[last]))}</span></div>
      <div class="stats" style="grid-template-columns:repeat(3,1fr)">
        <div class="stat"><small>Terminar acima de hoje</small><b>${nInt.format(sim.probUp * 100)}%</b></div>
        <div class="stat"><small>Terminar −20% ou pior</small><b>${nInt.format(sim.probEnd20 * 100)}%</b></div>
        <div class="stat"><small>Tocar −20% no caminho</small><b>${nInt.format(sim.probTouch20 * 100)}%</b></div></div>
      <p class="hint" style="margin:10px 2px 0">${A.mode === "rn" ? "Neutro: assume que a ação rende a Selic (como no modelo de Black-Scholes-Merton) — mostra o <b>risco</b>, não uma promessa de retorno." : "Histórico: assume que o retorno dos últimos 12 meses se repete — muito sensível ao período escolhido."} Faixa de 80% dos 2.000 futuros simulados (P10–P90).</p>
      <h3 class="sec">Leitura</h3><ul class="reading">${bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>
      <p class="hint" style="margin:10px 2px 0">Conteúdo educativo, não é recomendação de investimento.</p>`;
    $("#sheetClose").onclick = () => closeSheet();
    $("#modes").onclick = (e) => { const b = e.target.closest("button[data-mode]"); if (b) { A.mode = b.dataset.mode; const y = $("#sheet").scrollTop; drawQuant(sym); $("#sheet").scrollTop = y; } };
  }

  /* ───────── eventos ───────── */
  document.addEventListener("click", (e) => {
    const q = e.target.closest("[data-quant]"); if (q) { openSheet("quant", q.dataset.quant); return; }
    const so = e.target.closest("[data-sort]"); if (so) { A.sort = so.dataset.sort; render(); }
  });

  return { show() { if (!A.tried && !A.loading) load(); else render(); }, render() { if (A.tried) render(); }, drawQuant };
})();
