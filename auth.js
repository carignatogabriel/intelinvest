/* Conta (login com Google). Só aparece se houver servidor (API_BASE) e GOOGLE_CLIENT_ID no config.js.
   O Google devolve um ID token; o servidor o verifica e devolve a sessão do Intelinvest, guardada neste aparelho. */
"use strict";

const Auth = (() => {
  const CID = String(window.GOOGLE_CLIENT_ID || "").trim();
  const enabled = !!(API && CID);
  let state = store.get("auth_v1", null); // { token, user:{name,email,picture} }
  let gsiState = "idle"; // idle | loading | ready | failed

  const hdr = () => ({ Authorization: `Bearer ${state.token}` });
  const save = () => store.set("auth_v1", state);

  function render() {
    const box = $("#accountBox");
    box.hidden = !enabled;
    if (!enabled) return;
    const u = state?.user;
    $("#accountOut").hidden = !!u;
    $("#accountIn").hidden = !u;
    if (u) {
      $("#acctName").textContent = u.name || "";
      $("#acctMail").textContent = u.email || "";
      const pic = $("#acctPic");
      if (u.picture) { pic.src = u.picture; pic.hidden = false; } else pic.hidden = true;
    } else loadGoogle();
  }

  function draw() {
    const el = $("#gsiBtn");
    el.textContent = "";
    google.accounts.id.initialize({ client_id: CID, callback: onCredential, ux_mode: "popup", auto_select: false, cancel_on_tap_outside: true });
    google.accounts.id.renderButton(el, { theme: "filled_black", size: "large", text: "signin_with", shape: "rectangular", locale: "pt-BR", width: 260 });
  }

  function loadGoogle() {
    if (gsiState === "ready") return draw();
    if (gsiState === "loading") return;
    gsiState = "loading";
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client"; s.async = true;
    s.onload = () => { gsiState = "ready"; draw(); };
    s.onerror = () => { gsiState = "failed"; $("#gsiBtn").textContent = "Não foi possível carregar o login do Google agora."; };
    document.head.appendChild(s);
  }

  async function onCredential(resp) {
    try {
      const r = await fetch(`${API}/auth/google`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: resp.credential }) });
      if (!r.ok) throw new Error(String(r.status));
      const j = await r.json();
      state = { token: j.token, user: j.user }; save();
      toast(`Olá, ${String(j.user.name || "").split(" ")[0] || "bem-vindo"}!`);
      render();
    } catch { toast("Não foi possível entrar agora. Tente de novo."); }
  }

  /** Confere no servidor se a sessão guardada ainda vale (e atualiza o perfil). */
  async function validate() {
    if (!enabled || !state) return;
    try {
      const r = await fetch(`${API}/auth/me`, { headers: hdr() });
      if (r.status === 401) { state = null; save(); }
      else if (r.ok) { state.user = (await r.json()).user; save(); }
    } catch { /* offline: mantém a sessão local */ }
    render();
  }

  function signOut() {
    state = null; save();
    try { google.accounts.id.disableAutoSelect(); } catch { /* script ainda não carregou */ }
    toast("Você saiu da conta."); render();
  }

  async function deleteAccount() {
    if (!state || !confirm("Excluir sua conta e todos os seus dados do Intelinvest? Isso não pode ser desfeito.")) return;
    try {
      const r = await fetch(`${API}/auth/account`, { method: "DELETE", headers: hdr() });
      if (!r.ok && r.status !== 401) throw new Error(String(r.status));
      state = null; save(); toast("Conta excluída."); render();
    } catch { toast("Não foi possível excluir agora. Tente de novo."); }
  }

  if (enabled) {
    $("#btnSignOut").onclick = signOut;
    $("#btnDelete").onclick = deleteAccount;
    validate();
  }
  return { render };
})();
