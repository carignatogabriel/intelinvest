<#
  Publica o Intelinvest no Cloudflare (gratuito): 1) servidor de dados (Worker)  2) site (arquivos estáticos).

  Antes (uma vez):   npx wrangler login          (abre o navegador para você autorizar sua conta Cloudflare)
  Publicar:          .\publicar.ps1
  Com token pago:    npx wrangler secret put BRAPI_TOKEN   (dentro da pasta api; depois)  .\publicar.ps1 -Plano startup
  Só montar o pacote (sem publicar, para testar):  .\publicar.ps1 -SoBuild -ApiUrl https://exemplo.workers.dev

  -Plano  gratis (padrão, 4 papéis livres) | startup (10 tickers/chamada) | pro (20 tickers/chamada)
  -Projeto nome do site no Cloudflare (padrão: intelinvest-site)
#>
param(
  [ValidateSet("gratis", "startup", "pro")] [string]$Plano = "gratis",
  [string]$Projeto = "intelinvest-site",
  [string]$ApiUrl = "",
  [string]$GoogleClientId = "",   # ID do cliente OAuth do Google (termina em .apps.googleusercontent.com). Fica salvo em api\wrangler.toml.
  [string]$PixKey = "",           # Chave Pix que recebe as doações (CPF/CNPJ, e-mail, +55DDDNÚMERO ou chave aleatória). Fica salva em doacao.json.
  [string]$PixNome = "",          # Nome do favorecido (até 25 caracteres)
  [string]$PixCidade = "",        # Cidade do favorecido (até 15 caracteres)
  [string]$LinkCartao = "",       # Opcional: link https de cartão/outro meio (Mercado Pago, Stripe, Apoia.se...)
  [string]$SiteUrl = "",          # Endereço público do site (para prévia de link e buscadores). Vazio = deduzido do endereço do servidor.
  [switch]$SoBuild
)
$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot
$dist = Join-Path $raiz "dist"
$perCall = @{ gratis = "1"; startup = "10"; pro = "20" }[$Plano]
$full = if ($Plano -eq "gratis") { "false" } else { "true" }
$enc = New-Object System.Text.UTF8Encoding $false

function Rodar($dir, $cmd) {
  Push-Location $dir
  try { $out = & cmd /c "$cmd 2>&1"; $out | ForEach-Object { Write-Host $_ }; if ($LASTEXITCODE -ne 0) { throw "Falhou: $cmd" }; return ($out -join "`n") }
  finally { Pop-Location }
}

# ID do Google: usa o informado ou o já salvo no wrangler.toml
$api = Join-Path $raiz "api"; $toml = Join-Path $api "wrangler.toml"
$tomlTxt = [IO.File]::ReadAllText($toml, $enc)
if ($GoogleClientId) {
  if ($GoogleClientId -notmatch '^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$') { throw "O ID do cliente Google deve terminar em .apps.googleusercontent.com" }
  $tomlTxt = [regex]::Replace($tomlTxt, 'GOOGLE_CLIENT_ID\s*=\s*"[^"]*"', "GOOGLE_CLIENT_ID = `"$GoogleClientId`"")
  if (-not $SoBuild) { [IO.File]::WriteAllText($toml, $tomlTxt, $enc) }   # -SoBuild não altera a configuração salva
} else { $GoogleClientId = [regex]::Match($tomlTxt, 'GOOGLE_CLIENT_ID\s*=\s*"([^"]*)"').Groups[1].Value }
$login = [bool]$GoogleClientId

# Doação (Pix): usa o informado ou o já salvo em doacao.json
$docF = Join-Path $raiz "doacao.json"
$doa = [IO.File]::ReadAllText($docF, $enc) | ConvertFrom-Json
foreach ($par in @(@("pixKey", $PixKey), @("name", $PixNome), @("city", $PixCidade), @("cardUrl", $LinkCartao))) { if ($par[1]) { $doa.($par[0]) = $par[1] } }
if ($doa.pixKey -or $doa.name -or $doa.city) {
  $env:PIXJS = Join-Path $raiz "pix.js"; $env:DOA = ($doa | ConvertTo-Json -Compress)
  $chk = (& node -e "const P=require(process.env.PIXJS);const d=JSON.parse(process.env.DOA);try{P.payload({key:d.pixKey,name:d.name,city:d.city,amount:1});console.log('ok')}catch(e){console.log('ERRO: '+e.message)}") -join ""
  Remove-Item Env:PIXJS, Env:DOA -ErrorAction SilentlyContinue
  if ($chk -ne "ok") { throw "Doação (Pix): $chk. Confira -PixKey (CPF/CNPJ, e-mail, +55DDDNÚMERO ou chave aleatória), -PixNome e -PixCidade." }
  if ($doa.cardUrl -and $doa.cardUrl -notmatch '^https://\S+$') { throw "-LinkCartao deve começar com https://" }
}
if (-not $SoBuild -and ($PixKey -or $PixNome -or $PixCidade -or $LinkCartao)) { [IO.File]::WriteAllText($docF, (($doa | ConvertTo-Json) + "`n"), $enc) }
$doaJson = $doa | ConvertTo-Json -Compress

# 1) servidor de dados -------------------------------------------------------
if (-not $SoBuild) {
  Write-Host "`n[1/3] Verificando login no Cloudflare..." -ForegroundColor Yellow
  $who = Rodar $raiz "npx --yes wrangler whoami"
  if ($who -match "not authenticated|You are not logged in") { throw "Faça login primeiro:  npx wrangler login" }

  if ($login) { # login com Google: banco D1 para os usuários
    $tomlTxt = [IO.File]::ReadAllText($toml, $enc)
    if ($tomlTxt -notmatch 'database_id') {
      Write-Host "Preparando o banco de usuários (D1)..." -ForegroundColor Yellow
      $id = ""
      try { $j = [regex]::Match((Rodar $api "npx --yes wrangler d1 list --json"), '(?s)\[.*\]').Value | ConvertFrom-Json; $id = ($j | Where-Object { $_.name -eq "intelinvest" } | Select-Object -First 1).uuid } catch { }
      if (-not $id) { $id = [regex]::Match((Rodar $api "npx --yes wrangler d1 create intelinvest"), 'database_id\s*=\s*"([0-9a-f-]{36})"').Groups[1].Value }
      if (-not $id) { throw "Não consegui criar/achar o banco D1 'intelinvest'." }
      $bloco = "# >>> d1 (gerenciado pelo publicar.ps1: banco dos usuários do login)`n[[d1_databases]]`nbinding = `"DB`"`ndatabase_name = `"intelinvest`"`ndatabase_id = `"$id`"`n# <<< d1"
      $tomlTxt = [regex]::Replace($tomlTxt, '(?s)# >>> d1.*?# <<< d1', $bloco.Replace('$', '$$'))
      [IO.File]::WriteAllText($toml, $tomlTxt, $enc)
    }
    Rodar $api "npx --yes wrangler d1 execute intelinvest --remote --file schema.sql" | Out-Null
  }

  Write-Host "`n[2/3] Publicando o servidor de dados..." -ForegroundColor Yellow
  $out = Rodar $api "npx --yes wrangler deploy --var BRAPI_PER_CALL:$perCall"
  $m = [regex]::Match($out, "https://[a-z0-9.-]+\.workers\.dev")
  if (-not $m.Success) { throw "Não consegui descobrir o endereço do servidor. Veja a saída acima." }
  $ApiUrl = $m.Value

  if ($login) { # segredo que assina as sessões: criado só na 1ª vez (trocar desconectaria todos os usuários)
    $lista = Rodar $api "npx --yes wrangler secret list"
    if ($lista -notmatch "SESSION_SECRET") {
      $bytes = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      $tmp = Join-Path $env:TEMP ("intelinvest-" + [guid]::NewGuid().ToString("N") + ".txt")
      [IO.File]::WriteAllText($tmp, [Convert]::ToBase64String($bytes), $enc)
      try { Rodar $api "type `"$tmp`" | npx --yes wrangler secret put SESSION_SECRET" | Out-Null } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
      Write-Host "Segredo da sessão criado (guardado só no Cloudflare)." -ForegroundColor Green
    }
  }
}
if (-not $ApiUrl) { throw "Informe -ApiUrl (endereço do servidor) quando usar -SoBuild." }
$ApiUrl = $ApiUrl.TrimEnd("/")
Write-Host "Servidor de dados: $ApiUrl" -ForegroundColor Green

# 2) pacote do site ----------------------------------------------------------
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory $dist | Out-Null
foreach ($f in "index.html", "app.js", "analise.js", "auth.js", "donate.js", "pix.js", "styles.css", "sw.js", "manifest.webmanifest", "termos.html", "privacidade.html",
               "icon.svg", "icon-192.png", "icon-512.png", "icon-maskable-512.png") { Copy-Item (Join-Path $raiz $f) $dist }
New-Item -ItemType Directory (Join-Path $dist "vendor") | Out-Null
Copy-Item (Join-Path $raiz "vendor\qrcode.js") (Join-Path $dist "vendor")
# divulgação: imagem de prévia do link, robots, sitemap e chave IndexNow (arquivo <32 hex>.txt)
foreach ($f in "og.png", "robots.txt", "sitemap.xml") { Copy-Item (Join-Path $raiz $f) $dist }
Get-ChildItem $raiz -Filter "*.txt" | Where-Object { $_.Name -match '^[0-9a-f]{32}\.txt$' } | ForEach-Object { Copy-Item $_.FullName $dist }
if (-not $SiteUrl) { $SiteUrl = $ApiUrl -replace '//intelinvest-api\.', "//$Projeto." }
$SiteUrl = $SiteUrl.TrimEnd("/")
foreach ($f in "index.html", "robots.txt", "sitemap.xml") { $pf = Join-Path $dist $f; [IO.File]::WriteAllText($pf, ([IO.File]::ReadAllText($pf, $enc)).Replace("__SITE_URL__", $SiteUrl), $enc) }
Write-Host "Endereço público do site: $SiteUrl" -ForegroundColor Green
[IO.File]::WriteAllText((Join-Path $dist "config.js"), "window.API_BASE = `"$ApiUrl`";`nwindow.API_FULL = $full;`nwindow.GOOGLE_CLIENT_ID = `"$GoogleClientId`";`nwindow.DONATE = $doaJson;`nwindow.BRAPI_TOKEN = `"`";`n", $enc)
# política de segurança: com login, libera só o que o "Entrar com Google" precisa (script, estilo, quadro e conexão do Google; foto do perfil)
$gScript = if ($login) { " https://accounts.google.com/gsi/client" } else { "" }
$gStyle = if ($login) { " https://accounts.google.com/gsi/style" } else { "" }
$gImg = if ($login) { " https://*.googleusercontent.com" } else { "" }
$gConn = if ($login) { " https://accounts.google.com/gsi/" } else { "" }
$gFrame = if ($login) { "https://accounts.google.com/gsi/" } else { "'none'" }
$csp = "default-src 'self'; script-src 'self'$gScript; style-src 'self' 'unsafe-inline'$gStyle; img-src 'self' data: https://icons.brapi.dev$gImg; connect-src 'self' $ApiUrl$gConn; frame-src $gFrame; manifest-src 'self'; worker-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'"
$headers = @"
/*
  Content-Security-Policy: $csp
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
/index.html
  Cache-Control: no-cache
/config.js
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/app.js
  Cache-Control: no-cache
/analise.js
  Cache-Control: no-cache
/auth.js
  Cache-Control: no-cache
"@
[IO.File]::WriteAllText((Join-Path $dist "_headers"), $headers, $enc)
Set-Content (Join-Path $raiz "csp.txt") $csp -Encoding ascii   # só para testes locais; fora do pacote publicado
Write-Host "Pacote montado em $dist" -ForegroundColor Green
if ($SoBuild) { return }

# 3) site (arquivos estáticos servidos pelo Cloudflare, sem custo e sem limite de banda) ----
Write-Host "`n[3/3] Publicando o site..." -ForegroundColor Yellow
$out = Rodar $raiz "npx --yes wrangler deploy --assets dist --name $Projeto --compatibility-date 2026-11-01"
$m = [regex]::Match($out, "https://$Projeto[a-z0-9.-]*\.workers\.dev")
Write-Host "`nPRONTO." -ForegroundColor Green
Write-Host ("Site:      " + $(if ($m.Success) { $m.Value } else { "(veja a saída acima)" }))
Write-Host "Servidor:  $ApiUrl"
Write-Host "Próximo:   abra o link no celular, teste, e só então divulgue. Domínio próprio: veja PUBLICAR.txt."
