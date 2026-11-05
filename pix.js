/* Pix "copia e cola" / QR Code estático (BR Code, padrão do Banco Central). Roda no navegador e no Node (para testes).
   Gera o código no próprio aparelho: sem servidor, sem intermediário, sem taxa. O dinheiro vai direto para a chave Pix informada. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PixBR = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const tlv = (id, v) => id + String(v.length).padStart(2, "0") + v;

  /** CRC16/CCITT-FALSE (poly 0x1021, início 0xFFFF), 4 hex maiúsculos — exigido pelo BR Code. */
  function crc16(str) {
    let crc = 0xFFFF;
    for (let i = 0; i < str.length; i++) {
      crc ^= str.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, "0");
  }

  const cpfOk = (s) => {
    if (!/^\d{11}$/.test(s) || /^(\d)\1{10}$/.test(s)) return false;
    for (let t = 9; t < 11; t++) { let sum = 0; for (let i = 0; i < t; i++) sum += +s[i] * (t + 1 - i); if (((sum * 10) % 11) % 10 !== +s[t]) return false; }
    return true;
  };
  const cnpjOk = (s) => {
    if (!/^\d{14}$/.test(s) || /^(\d)\1{13}$/.test(s)) return false;
    const dv = (len) => { let sum = 0, pos = len - 7; for (let i = len; i >= 1; i--) { sum += +s[len - i] * pos--; if (pos < 2) pos = 9; } const r = sum % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === +s[12] && dv(13) === +s[13];
  };

  /** Normaliza e valida a chave Pix. Devolve a chave no formato do BR Code ou null.
      CPF/CNPJ (com ou sem pontuação), e-mail, telefone (+55DDDNÚMERO) ou chave aleatória (UUID). */
  function normalizeKey(raw) {
    const s = String(raw == null ? "" : raw).trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return s.toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 77) return s.toLowerCase();
    if (s.startsWith("+")) { const p = "+" + s.replace(/\D/g, ""); return /^\+55\d{10,11}$/.test(p) ? p : null; }
    const d = s.replace(/[.\-/\s]/g, "");
    if (cpfOk(d)) return d;
    if (cnpjOk(d)) return d;
    return null;
  }

  /** Nome/cidade do BR Code: sem acento, maiúsculas, só letras/números/espaço, com limite de tamanho. */
  const clean = (s, max) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, "").replace(/\s+/g, " ").trim().toUpperCase().slice(0, max);

  /** Monta o BR Code estático. amount (opcional) em reais. Lança erro se algo for inválido. */
  function payload({ key, name, city, amount }) {
    const k = normalizeKey(key); if (!k) throw new Error("chave Pix inválida");
    const nm = clean(name, 25), ct = clean(city, 15); if (!nm || !ct) throw new Error("nome e cidade são obrigatórios");
    let p = tlv("00", "01") + tlv("26", tlv("00", "br.gov.bcb.pix") + tlv("01", k)) + tlv("52", "0000") + tlv("53", "986");
    if (amount != null) {
      const a = Number(amount);
      if (!(a >= 0.01 && a <= 999999.99)) throw new Error("valor inválido");
      p += tlv("54", a.toFixed(2));
    }
    p += tlv("58", "BR") + tlv("59", nm) + tlv("60", ct) + tlv("62", tlv("05", "***")) + "6304";
    return p + crc16(p);
  }

  /** Lê um BR Code (para testes): devolve {campos, crcOk}. */
  function parse(code) {
    const out = {}; let i = 0; const body = code.slice(0, -4);
    while (i < body.length) { const id = body.slice(i, i + 2), len = +body.slice(i + 2, i + 4); out[id] = body.slice(i + 4, i + 4 + len); i += 4 + len; }
    const crcOk = code.slice(-8, -4) === "6304" && crc16(code.slice(0, -4)) === code.slice(-4);
    return { fields: out, crcOk };
  }

  /** "12,50" / "12.5" → 12.5 ; fora de R$ 1 a R$ 9.999,99 → null. */
  function parseAmount(text) {
    const t = String(text).trim().replace(/^R\$\s*/i, "").replace(/\./g, (m, off, s) => (s.includes(",") ? "" : m)).replace(",", ".");
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
    const v = Number(t);
    return v >= 1 && v <= 9999.99 ? Math.round(v * 100) / 100 : null;
  }

  return { crc16, normalizeKey, payload, parse, parseAmount, clean };
}));
