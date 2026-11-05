/* Doação via Pix. Gera o QR Code e o "copia e cola" no próprio aparelho (pix.js + vendor/qrcode.js), sem servidor e sem taxa.
   Só aparece se config.js tiver DONATE.pixKey/name/city válidos. É escondida na versão empacotada para a Google Play
   (a política de pagamentos da Play restringe pedidos de doação de desenvolvedores comuns). */
"use strict";

const Donate = (() => {
  const cfg = window.DONATE || {};
  const inPlayApp = (document.referrer || "").startsWith("android-app://");
  let ready = false;
  try { PixBR.payload({ key: cfg.pixKey, name: cfg.name, city: cfg.city, amount: 1 }); ready = true; } catch { ready = false; }
  const enabled = ready && !inPlayApp;

  const AMOUNTS = [5, 10, 20, 50];
  let amount = 10, other = false, opener = null;
  const brl = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function qrSvg(text) {
    const qr = qrcode(0, "M"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(), m = 4; let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m},${r + m}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 2 * m} ${n + 2 * m}" shape-rendering="crispEdges" role="img" aria-label="QR Code Pix de ${brl(amount)}"><rect width="100%" height="100%" fill="#FBFBFB"/><path d="${d}" fill="#000000"/></svg>`;
  }

  function paint() {
    $("#donAmounts").innerHTML = AMOUNTS.map((a) => `<button data-a="${a}" aria-pressed="${!other && amount === a}">R$ ${a}</button>`).join("") +
      `<button data-a="other" aria-pressed="${other}">Outro</button>`;
    $("#donCustom").hidden = !other;
    const valid = amount != null;
    $("#donErr").hidden = !other || valid;
    $("#donCopy").disabled = !valid;
    if (!valid) { $("#donQr").innerHTML = ""; $("#donCode").value = ""; return; }
    const code = PixBR.payload({ key: cfg.pixKey, name: cfg.name, city: cfg.city, amount });
    $("#donQr").innerHTML = qrSvg(code);
    $("#donCode").value = code;
    $("#donWho").textContent = `Favorecido: ${PixBR.clean(cfg.name, 25)} · ${PixBR.clean(cfg.city, 15)}`;
    $("#donCopy").textContent = `Copiar código Pix · ${brl(amount)}`;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch { // alguns navegadores bloqueiam a área de transferência: tenta o método antigo
      const ta = $("#donCode"); ta.removeAttribute("readonly"); ta.select(); ta.setSelectionRange(0, 99999);
      let ok = false; try { ok = document.execCommand("copy"); } catch { /* sem suporte */ }
      ta.setAttribute("readonly", ""); return ok;
    }
  }

  function open() {
    opener = document.activeElement; amount = 10; other = false;
    $("#donValue").value = "";
    const link = $("#donCard"), url = String(cfg.cardUrl || "");
    if (/^https:\/\/[^\s]+$/.test(url)) { link.href = url; link.hidden = false; } else link.hidden = true;
    paint(); $("#donate").hidden = false;
    $("#donAmounts button")?.focus();
  }
  function close() { $("#donate").hidden = true; opener?.focus?.(); }

  if (enabled) {
    for (const id of ["#btnSupport", "#btnSupport2"]) { $(id).hidden = false; }
    $("#btnSupport").onclick = open;
    $("#btnSupport2").onclick = () => { $("#settings").hidden = true; open(); };
    $("#donClose").onclick = close;
    $("#donate").addEventListener("click", (e) => { if (e.target.id === "donate") close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#donate").hidden) close(); });
    $("#donAmounts").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-a]"); if (!b) return;
      if (b.dataset.a === "other") { other = true; amount = PixBR.parseAmount($("#donValue").value); paint(); $("#donValue").focus(); }
      else { other = false; amount = Number(b.dataset.a); paint(); }
    });
    $("#donValue").addEventListener("input", (e) => { amount = PixBR.parseAmount(e.target.value); paint(); });
    $("#donCopy").onclick = async () => toast(await copy($("#donCode").value) ? "Código Pix copiado. Cole no app do seu banco." : "Toque no código e copie manualmente.");
  }
  return { enabled };
})();
