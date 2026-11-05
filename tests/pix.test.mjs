// Testes do Pix: CRC contra o exemplo do Banco Central, montagem, chaves, valores e QR (ida e volta com jsQR).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const Pix = require("../pix.js");
const qrcode = require("../vendor/qrcode.js");
const jsQR = require("jsqr");
let fails = 0; const ok = (c, m) => { if (!c) fails++; console.log(c ? "OK   " : "FALHA", m); };

// 1) CRC: exemplo do Manual de Padrões para Iniciação do Pix (Banco Central)
const bcb = "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***6304";
ok(Pix.crc16(bcb) === "1D3D", `CRC16 do exemplo oficial do BCB = ${Pix.crc16(bcb)} (esperado 1D3D)`);
ok(Pix.crc16("123456789") === "29B1", "CRC16/CCITT-FALSE de '123456789' = 29B1 (vetor padrão)");

// 2) payload: estrutura e CRC
const key = "123e4567-e12b-12d1-a456-426655440000";
const p0 = Pix.payload({ key, name: "Fulano de Tal", city: "Brasília" });
const q0 = Pix.parse(p0);
ok(q0.crcOk, "payload sem valor: CRC válido");
ok(q0.fields["00"] === "01" && q0.fields["52"] === "0000" && q0.fields["53"] === "986" && q0.fields["58"] === "BR", "campos fixos (versão, MCC, moeda 986, país BR)");
ok(q0.fields["59"] === "FULANO DE TAL" && q0.fields["60"] === "BRASILIA", "nome e cidade normalizados (sem acento, maiúsculas)");
ok(q0.fields["26"] === `0014br.gov.bcb.pix0136${key}`, "conta Pix (GUI + chave) correta");
ok(q0.fields["54"] === undefined, "sem valor: campo 54 ausente");
const p10 = Pix.payload({ key, name: "Teste", city: "Sao Paulo", amount: 10 });
ok(Pix.parse(p10).fields["54"] === "10.00" && Pix.parse(p10).crcOk, "valor 10 → '10.00' e CRC válido");
ok(Pix.parse(Pix.payload({ key, name: "T", city: "C", amount: 12.5 })).fields["54"] === "12.50", "valor 12,5 → '12.50'");
ok(Pix.payload({ key, name: "A".repeat(40), city: "B".repeat(30) }).includes("5925" + "A".repeat(25)) && Pix.payload({ key, name: "A".repeat(40), city: "B".repeat(30) }).includes("6015" + "B".repeat(15)), "nome limitado a 25 e cidade a 15 caracteres");
ok(Pix.payload({ key, name: "José & Cia, Ltda.", city: "São José" }).includes("JOSE CIA LTDA"), "símbolos e acentos removidos do nome");
for (const [nome, args] of [["chave inválida", { key: "123", name: "A", city: "B" }], ["sem nome", { key, name: "", city: "B" }], ["sem cidade", { key, name: "A", city: "" }], ["valor zero", { key, name: "A", city: "B", amount: 0 }], ["valor negativo", { key, name: "A", city: "B", amount: -5 }], ["valor NaN", { key, name: "A", city: "B", amount: "abc" }]]) {
  let threw = false; try { Pix.payload(args); } catch { threw = true; } ok(threw, `recusa: ${nome}`);
}

// 3) chaves
const K = Pix.normalizeKey;
ok(K("529.982.247-25") === "52998224725", "CPF válido com pontuação → só dígitos");
ok(K("52998224724") === null, "CPF com dígito verificador errado → recusado");
ok(K("111.111.111-11") === null, "CPF com dígitos repetidos → recusado");
ok(K("11.222.333/0001-81") === "11222333000181", "CNPJ válido");
ok(K("11222333000182") === null, "CNPJ inválido → recusado");
ok(K("  Ana@Exemplo.com ") === "ana@exemplo.com", "e-mail → minúsculas");
ok(K("+55 (11) 91234-5678") === "+5511912345678", "telefone com +55 e pontuação");
ok(K("11912345678") === null, "11 dígitos sem +55 que não é CPF → recusado (evita confundir telefone com CPF)");
ok(K("123E4567-E12B-12D1-A456-426655440000") === key, "chave aleatória (UUID) → minúsculas");
ok(K("") === null && K(null) === null && K("abc") === null, "vazio/nulo/lixo → recusado");

// 4) valores digitados
const A = Pix.parseAmount;
ok(A("10") === 10 && A("12,50") === 12.5 && A("12.5") === 12.5 && A("R$ 7,5") === 7.5, "aceita 10, 12,50, 12.5 e R$ 7,5");
ok(A("1.234,56") === 1234.56, "milhar com ponto e centavos com vírgula");
ok(A("0,5") === null && A("0") === null && A("-3") === null && A("10000") === null && A("abc") === null && A("1,234") === null && A("") === null, "recusa < R$1, > R$9.999,99, negativos, texto e 3 casas");

// 5) QR: gera com a biblioteca embutida e decodifica com outro leitor (jsQR)
function matrix(text) { const qr = qrcode(0, "M"); qr.addData(text); qr.make(); const n = qr.getModuleCount(); return { n, dark: (r, c) => qr.isDark(r, c) }; }
function decode(text) {
  const { n, dark } = matrix(text), scale = 8, quiet = 4, size = (n + 2 * quiet) * scale, data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const o = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
  const res = jsQR(data, size, size); return res ? res.data : null;
}
const samples = [p0, p10, Pix.payload({ key: "52998224725", name: "Gabriel Carignato", city: "Sao Paulo", amount: 25 }), Pix.payload({ key: "ana.souza@exemplo.com.br", name: "Ana Souza", city: "Rio de Janeiro", amount: 9999.99 }), Pix.payload({ key: "+5511912345678", name: "Joao", city: "Recife", amount: 1 })];
samples.forEach((s, i) => ok(decode(s) === s, `QR ${i + 1} (${s.length} caracteres, versão ${matrix(s).n}) decodifica exatamente igual ao BR Code`));
console.log(fails ? `\n${fails} FALHA(S)` : "\nTodos os testes de Pix passaram");
process.exit(fails ? 1 : 0);
