# Intelinvest

App web instalável (PWA) com **todas as ações, FIIs e BDRs da B3**, dólar, gráficos e uma aba **educativa** sobre métodos clássicos de avaliação de investimentos (Fisher, Graham, Sharpe, Markowitz, Kelly, Black-Scholes e outros), calculados sobre dados públicos de hoje.

> Conteúdo informativo e educativo. Não é recomendação de compra, venda ou manutenção de ativos.

Direitos reservados © 2026 Gabriel Carignato. A biblioteca `vendor/qrcode.js` é de terceiros (qrcode-generator 1.4.4, MIT).

## Como é feito

| Parte | Tecnologia |
|---|---|
| App (site) | HTML + CSS + JavaScript puro, sem build. Service worker (abre offline) e manifesto (instala no celular). |
| Servidor de dados | Cloudflare Worker (`api/`): cache na borda, esconde o token pago, limita e valida entradas. |
| Fontes de dados | [brapi.dev](https://brapi.dev) (B3), Banco Central (Selic/IPCA e PTAX do dólar), AwesomeAPI (opcional). |
| Doação | Pix (BR Code estático) gerado no aparelho (`pix.js`), QR com `vendor/qrcode.js`. |
| Login (opcional) | Google Identity Services; o servidor verifica o ID token e guarda o usuário no D1 (`api/auth.js`). **Desligado** até haver um `GOOGLE_CLIENT_ID`. |

```
index.html, app.js, analise.js, auth.js, donate.js, pix.js, styles.css   o app
sw.js, manifest.webmanifest, config.js                                    PWA e configuração
termos.html, privacidade.html                                             textos legais (modelos: revisar com advogado)
api/                                                                      Worker, login, schema do banco, servidor local
publicar.ps1                                                              publica site + servidor no Cloudflare
loja/                                                                     capturas, imagem de destaque e textos das lojas
tests/                                                                    testes automáticos (Pix, login, servidor)
PUBLICAR.txt                                                              passo a passo de lançamento
```

## Rodar localmente (modo desenvolvimento)

```powershell
node servidor.js          # http://localhost:8080  (ou: set PORT=8765 && node servidor.js)
```

Sem servidor de dados (`API_BASE` vazio em `config.js`) o app chama as APIs públicas direto. Isso serve **só para testes**: em produção use o Worker.

## Testes

```powershell
npm install               # só jsqr, usado para ler o QR Code nos testes
npm test                  # Pix (CRC contra o exemplo oficial do BCB, QR ida e volta) e login (token falso, expirado, adulterado...)
npm run test:api          # servidor: rotas, cache, validações (usa a rede; a brapi sem token limita rajadas)
```

## Publicar

Veja `PUBLICAR.txt`. Resumo:

```powershell
npx wrangler login
powershell -ExecutionPolicy Bypass -File .\publicar.ps1
```

Segredos (token da brapi, segredo da sessão) ficam **só** no Cloudflare (`wrangler secret put`), nunca neste repositório.
