// Configuração do Intelinvest.
//
// PRODUÇÃO: coloque aqui o endereço do servidor de dados (Cloudflare Worker da pasta /api). O publicar.ps1 faz isso sozinho.
//   API_BASE: URL do servidor. Vazio = modo desenvolvimento (o app chama as APIs públicas direto, só para testes).
//   API_FULL: true quando o servidor tem um token pago da brapi (libera histórico, mini-gráficos, Ibovespa e Análise com 40 papéis).
//   GOOGLE_CLIENT_ID: ID do cliente OAuth do Google (Cloud Console). Vazio = sem login. O publicar.ps1 preenche com -GoogleClientId.
window.API_BASE = window.API_BASE || "";
window.API_FULL = window.API_FULL || false;
window.GOOGLE_CLIENT_ID = window.GOOGLE_CLIENT_ID || "";
//   DONATE: botão "Apoiar o projeto" (Pix). Vazio = sem botão. O publicar.ps1 preenche a partir de doacao.json.
window.DONATE = window.DONATE || { pixKey: "", name: "", city: "", cardUrl: "" };

// Só modo desenvolvimento: token gratuito da brapi.dev (https://brapi.dev/dashboard). Em produção o token fica no servidor.
window.BRAPI_TOKEN = window.BRAPI_TOKEN || "";
