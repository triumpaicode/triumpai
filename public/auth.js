/* TRIUMP AI — auth.js (dipakai semua halaman)
   Satu tombol "Sign in" -> popup berisi 3 cara masuk:
     1. Wallet EVM (MetaMask, Rabby, Coinbase Wallet + wallet lain yang terdeteksi).
        Wallet menandatangani pesan (tanpa gas) -> server membuktikan pemiliknya.
        Jaringan otomatis dipindah / ditambah ke Robinhood Chain.
     2. Sign in with X (OAuth X, server-side).
     3. Sign in with email -> kode OTP (email palsu/sekali pakai ditolak server).
   Satu akun bisa menautkan ketiganya lewat panel akun. */
(function () {
  var API = "/api/";
  var CHAIN = window.TRIUMP_CHAIN || { name: "Robinhood Chain", chainIdHex: "0x1237" };
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }

  /* ---------- EIP-6963: wallet yang terpasang ---------- */
  var announced = [];
  window.addEventListener("eip6963:announceProvider", function (e) {
    var d = e.detail; if (!d || !d.provider || !d.info) return;
    var id = d.info.rdns || d.info.name;
    if (!announced.some(function (p) { return (p.info.rdns || p.info.name) === id; })) announced.push(d);
    if (window.__trimRedrawWallets) window.__trimRedrawWallets();
  });
  function requestProviders(){ try { window.dispatchEvent(new Event("eip6963:requestProvider")); } catch (e) {} }
  requestProviders(); [100, 400, 1000, 2000].forEach(function (ms) { setTimeout(requestProviders, ms); });

  /* Tiga wallet utama selalu tampil (terpasang atau belum). */
  var MAIN = [
    { key: "metamask", name: "MetaMask", icon: "img/wallets/metamask.svg", rdns: /metamask/i, flag: "isMetaMask",
      install: "https://metamask.io/download/", mobile: function () { return "https://metamask.app.link/dapp/" + location.host + location.pathname; } },
    { key: "rabby", name: "Rabby Wallet", icon: "img/wallets/rabby.svg", rdns: /rabby/i, flag: "isRabby",
      install: "https://rabby.io/", mobile: null },
    { key: "coinbase", name: "Coinbase Wallet", icon: "img/wallets/coinbase.svg", rdns: /coinbase/i, flag: "isCoinbaseWallet",
      install: "https://www.coinbase.com/wallet/downloads", mobile: function () { return "https://go.cb-w.com/dapp?cb_url=" + encodeURIComponent(location.href); } }
  ];
  /* Wallet Solana tidak bisa masuk Robinhood Chain — tidak ditawarkan. */
  var EXCLUDE = /phantom|solflare|backpack/i;

  function legacyList(){
    var eth = window.ethereum;
    if (!eth) return [];
    return (Array.isArray(eth.providers) ? eth.providers : [eth]).filter(function (p) { return p && !p.isPhantom; });
  }
  /* cari provider untuk wallet utama: EIP-6963 dulu, lalu window.ethereum lama */
  function findMain(w){
    var hit = announced.filter(function (d) { return w.rdns.test(d.info.rdns || "") || w.rdns.test(d.info.name || ""); })[0];
    if (hit) return { provider: hit.provider, name: w.name };
    var lg = legacyList().filter(function (p) {
      // Rabby juga memasang isMetaMask=true; jangan salah tebak
      if (w.key === "metamask") return p.isMetaMask && !p.isRabby && !p.isCoinbaseWallet;
      return !!p[w.flag];
    })[0];
    return lg ? { provider: lg, name: w.name } : null;
  }
  /* wallet EVM lain yang terdeteksi (OKX, Trust, Brave, ...) */
  function others(){
    return announced.filter(function (d) {
      var s = (d.info.rdns || "") + " " + (d.info.name || "");
      return !EXCLUDE.test(s) && !MAIN.some(function (w) { return w.rdns.test(s); });
    });
  }
  var isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  async function ensureChain(p){
    var cur = await p.request({ method: "eth_chainId" });
    if (String(cur).toLowerCase() === CHAIN.chainIdHex.toLowerCase()) return true;
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN.chainIdHex }] });
      return true;
    } catch (err) {
      if (err && (err.code === 4902 || /unrecognized|not been added|unknown chain/i.test(err.message || ""))) {
        await p.request({ method: "wallet_addEthereumChain", params: [{
          chainId: CHAIN.chainIdHex, chainName: CHAIN.name, nativeCurrency: CHAIN.currency,
          rpcUrls: CHAIN.rpcUrls, blockExplorerUrls: CHAIN.explorer ? [CHAIN.explorer] : undefined
        }] });
        return true;
      }
      return false;
    }
  }
  function utf8Hex(s){ var b = new TextEncoder().encode(s), h = "0x"; for (var i = 0; i < b.length; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16); return h; }

  ready(function () {
    /* ---------- styles ---------- */
    var css = document.createElement("style");
    css.textContent =
      ".trim-authbar{display:inline-flex;align-items:center;gap:8px;margin-left:6px}"
      +".trim-btn{display:inline-flex;align-items:center;gap:7px;height:40px;padding:0 14px;border:0;border-radius:10px;font-size:12px;font-weight:800;letter-spacing:-.01em;cursor:pointer;font-family:inherit;white-space:nowrap;transition:filter .15s,transform .15s;text-decoration:none;box-sizing:border-box}"
      +".trim-btn:hover{filter:brightness(1.07);transform:translateY(-1px)}"
      +".trim-btn:disabled{opacity:.6;cursor:wait;transform:none}"
      +".trim-btn.login{background:linear-gradient(135deg,#0e8a3e,#39ff14);color:#04130b}"
      +".trim-btn.xbtn{background:#000;color:#fff}"
      +".trim-btn.xicon{width:40px;padding:0;justify-content:center}"
      +".trim-btn.pill{background:rgba(120,120,120,.15);color:inherit;border:1px solid rgba(120,120,120,.35)}"
      +".trim-btn svg,.trim-btn img{width:15px;height:15px;border-radius:4px;flex:0 0 auto}"
      +".trim-ov{position:fixed;inset:0;z-index:100000;display:none;align-items:center;justify-content:center;background:rgba(4,10,8,.72);backdrop-filter:blur(6px);padding:16px;font-family:Inter,system-ui,-apple-system,Arial,sans-serif}"
      +".trim-card{width:100%;max-width:410px;max-height:calc(100vh - 32px);overflow:auto;background:#0d1f1a;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:24px;color:#eaf4ef;box-shadow:0 30px 90px rgba(0,0,0,.5);box-sizing:border-box}"
      +".trim-card h3{margin:0 0 4px;font-size:21px;font-weight:900;letter-spacing:-.02em}"
      +".trim-card p.sub{margin:0 0 16px;color:#9fbdb2;font-size:13.5px;line-height:1.5}"
      +".trim-card label,.trim-sec{display:block;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#7fa99c;margin:0 0 7px}"
      +".trim-sec{margin:16px 0 4px;display:flex;justify-content:space-between}"
      +".trim-sec span{color:#5bd1ff;letter-spacing:.06em}"
      +".trim-card input{width:100%;box-sizing:border-box;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:11px;padding:13px 15px;color:#fff;font-size:15px;outline:none;font-family:inherit}"
      +".trim-card input:focus{border-color:#39ff14}"
      +".trim-card input.otp{text-align:center;letter-spacing:12px;font-size:24px;font-weight:800}"
      +".trim-act{margin-top:16px;display:flex;gap:10px}"
      +".trim-act .trim-btn{flex:1;justify-content:center;height:46px;font-size:14px}"
      +".trim-msg{margin-top:12px;font-size:12.5px;min-height:16px;line-height:1.45}"
      +".trim-msg:empty{min-height:0;margin:0}"
      +".trim-msg.err{color:#ff7a7a}.trim-msg.ok{color:#39ff14}.trim-msg.info{color:#9fbdb2}"
      +".trim-x{float:right;cursor:pointer;color:#7fa99c;font-size:22px;line-height:1;border:0;background:0;padding:0 0 0 8px}"
      +".trim-link{background:0;border:0;color:#5bd1ff;cursor:pointer;font-size:12.5px;font-family:inherit;padding:0;margin:0 0 12px}"
      +".trim-promo{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:12px;background:linear-gradient(135deg,rgba(57,255,20,.14),rgba(91,209,255,.14));border:1px solid rgba(57,255,20,.38)}"
      +".trim-promo b{display:block;font-size:13px;font-weight:900;letter-spacing:.06em;color:#39ff14}"
      +".trim-promo small{display:block;font-size:12.5px;color:#cfe6dd;line-height:1.45;margin-top:2px}"
      +".trim-promo .n{flex:0 0 auto;font-size:26px;font-weight:900;line-height:1;color:#04130b;background:linear-gradient(135deg,#39ff14,#5bd1ff);border-radius:10px;padding:8px 10px;text-align:center}"
      +".trim-promo .n i{display:block;font-size:9px;font-style:normal;letter-spacing:.1em}"
      +".trim-opt{display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;margin-top:8px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.04);color:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;text-align:left;text-decoration:none;box-sizing:border-box;transition:border-color .15s,background .15s}"
      +".trim-opt:hover{border-color:#5bd1ff;background:rgba(91,209,255,.07)}"
      +".trim-opt:disabled{opacity:.6;cursor:wait}"
      +".trim-opt img,.trim-opt .ic{width:30px;height:30px;border-radius:8px;flex:0 0 30px;object-fit:contain}"
      +".trim-opt .ic{display:flex;align-items:center;justify-content:center;background:#000;color:#fff}"
      +".trim-opt .ic.mail{background:linear-gradient(135deg,#0e8a3e,#39ff14);color:#04130b}"
      +".trim-opt .ic.gmail{background:#fff}.trim-opt .ic.gmail svg{width:19px;height:19px}"
      +".trim-gpick{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;height:46px;margin:4px 0 14px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#fff;color:#1f1f1f;font:600 14px inherit;cursor:pointer}"
      +".trim-gpick svg{width:18px;height:18px}.trim-gpick[hidden]{display:none}"
      +".trim-opt .ic svg{width:16px;height:16px}"
      +".trim-opt small{margin-left:auto;font-size:11px;color:#7fa99c;font-weight:600;white-space:nowrap}"
      +".trim-opt small.on{color:#39ff14}"
      +".trim-or{display:flex;align-items:center;gap:10px;margin:16px 0 4px;color:#5f7a70;font-size:11px;font-weight:800;letter-spacing:.14em}"
      +".trim-or:before,.trim-or:after{content:'';flex:1;height:1px;background:rgba(255,255,255,.1)}"
      +".trim-row{display:flex;align-items:center;gap:10px;padding:12px 14px;border:1px solid rgba(255,255,255,.1);border-radius:12px;margin-top:10px;background:rgba(255,255,255,.03)}"
      +".trim-row .k{font-size:11px;font-weight:800;letter-spacing:.1em;color:#7fa99c;text-transform:uppercase}"
      +".trim-row .v{font-size:14px;font-weight:700;word-break:break-all}"
      +".trim-row .v.none{color:#7fa99c;font-weight:600}"
      +".trim-row .grow{flex:1;min-width:0}"
      +".trim-row .trim-btn{height:34px;font-size:12px}"
      +".trim-legal{margin:14px 0 0;font-size:11px;color:#5f7a70;line-height:1.5}"
      +".trim-burger{display:none;align-items:center;justify-content:center;width:40px;height:40px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}"
      +".trim-mnav{position:fixed;left:12px;right:12px;top:76px;z-index:99990;display:none;flex-direction:column;gap:6px;padding:14px;border-radius:16px;background:#0d1f1a;border:1px solid rgba(255,255,255,.12);box-shadow:0 24px 70px rgba(0,0,0,.45);font-family:Inter,system-ui,-apple-system,Arial,sans-serif;max-height:calc(100vh - 96px);overflow:auto}"
      +".trim-mnav.open{display:flex}"
      +".trim-mnav .dot{display:inline-block;width:7px;height:7px;border-radius:99px;background:#39ff14;box-shadow:0 0 7px #39ff14}"
      +".trim-mnav>a{display:flex;align-items:center;gap:8px;padding:12px 14px;border-radius:10px;color:#eaf4ef;font-size:15px;font-weight:700;text-decoration:none;background:rgba(255,255,255,.04)}"
      +".trim-mnav>a svg{width:15px;height:15px}"
      +".trim-mnav .trim-authbar{display:flex;flex-direction:row;align-items:stretch;margin:6px 0 0;gap:8px}"
      +".trim-mnav .trim-authbar .trim-btn{height:46px;font-size:14px}"
      +".trim-mnav .trim-authbar .trim-btn:not(.xicon){flex:1;justify-content:center}"
      +".trim-mnav .trim-authbar .trim-btn.xicon{width:46px}"
      +"@media(max-width:820px){.nav .trim-burger{display:inline-flex}}"
      +"@media(max-width:640px){.trim-authbar{gap:6px}}";
    document.head.appendChild(css);

    function modal(inner){
      var ov = document.createElement("div"); ov.className = "trim-ov";
      ov.innerHTML = '<div class="trim-card" role="dialog" aria-modal="true"><button class="trim-x" aria-label="Close">&times;</button>' + inner + '<div class="trim-msg"></div></div>';
      document.body.appendChild(ov);
      ov.addEventListener("click", function (e) { if (e.target === ov) hide(ov); });
      ov.querySelector(".trim-x").addEventListener("click", function () { hide(ov); });
      return ov;
    }
    function show(ov){ document.querySelectorAll(".trim-ov").forEach(hide); ov.style.display = "flex"; msg(ov, ""); }
    function hide(ov){ ov.style.display = "none"; }
    function msg(ov, t, cls){ var m = ov.querySelector(".trim-msg"); m.textContent = t || ""; m.className = "trim-msg " + (cls || ""); }
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") document.querySelectorAll(".trim-ov").forEach(hide); });

    function api(path, body, method){
      return fetch(API + path, {
        method: method || "POST", headers: { "Content-Type": "application/json" },
        credentials: "same-origin", body: method === "GET" ? undefined : JSON.stringify(body || {})
      }).then(function (r) { return r.json().catch(function () { return { ok: false, error: "Server error (" + r.status + ")" }; }); })
        .catch(function () { return { ok: false, error: "Network error — server is not reachable." }; });
    }
    var backPath = location.pathname;
    function xLoginUrl(){ return API + "x/login?back=" + encodeURIComponent(backPath); }
    var PROMO = '<div class="trim-promo"><div class="n">3<i>MONTHS</i></div><div><b>UNLIMITED FOR TOKEN HOLDERS</b>'
      + '<small>Hold $TRIUMPAI on Robinhood Chain and everything is unlimited for 3 months. Sign in with that wallet to claim. <a href="pricing.html" style="color:#5bd1ff">Pricing</a></small></div></div>';

    /* ======================= popup SIGN IN ======================= */
    var signOv = modal(
      '<div data-step="choose">'
      +   '<h3>Sign in to TRIUMP AI</h3><p class="sub">Pick how you want to sign in.</p>'
      +   PROMO
      +   '<div class="trim-sec">Wallet <span>' + esc(CHAIN.name) + '</span></div><div id="trim-wlist"></div>'
      +   '<div class="trim-or">OR</div>'
      +   '<a class="trim-opt" id="trim-xopt" href="#"><span class="ic">' + xSvg() + '</span>Sign in with X</a>'
      +   '<button type="button" class="trim-opt" id="trim-emopt"><span class="ic gmail">' + gmailSvg() + '</span>Sign in with Gmail</button>'
      +   '<p class="trim-legal">Wallet sign-in only asks for a signature — no transaction, no gas fee.</p>'
      + '</div>'
      + '<div data-step="email" style="display:none">'
      +   '<button class="trim-link" data-back>&larr; All sign-in options</button>'
      +   '<h3>Sign in with email</h3><p class="sub">We\'ll send a one-time code to your inbox. Temporary / disposable emails are not accepted.</p>'
      +   '<button type="button" class="trim-gpick" id="trim-gpick" hidden>' + gmailSvg() + 'Choose a Google account</button>'
      +   '<label>Email</label><input id="trim-em" type="email" placeholder="you@example.com" autocomplete="email">'
      +   '<div class="trim-act"><button class="trim-btn login" id="trim-send">Send code</button></div>'
      + '</div>'
      + '<div data-step="otp" style="display:none">'
      +   '<button class="trim-link" id="trim-resend">&larr; Use another email / resend</button>'
      +   '<h3>Enter code</h3><p class="sub">We sent a 6-digit code to <b id="trim-em-label"></b>.</p>'
      +   '<label>One-time code</label><input id="trim-otp" class="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••">'
      +   '<div class="trim-act"><button class="trim-btn login" id="trim-verify">Verify &amp; sign in</button></div>'
      + '</div>');
    var emInput = signOv.querySelector("#trim-em"), otpInput = signOv.querySelector("#trim-otp"), curEmail = "";
    function step(s){ ["choose", "email", "otp"].forEach(function (k) { signOv.querySelector('[data-step="' + k + '"]').style.display = k === s ? "" : "none"; }); }
    /* mode: "signin" (semua opsi) atau "link-wallet" / "link-email" dari panel akun */
    var mode = "signin";
    function openSignIn(m){
      mode = m || "signin";
      var linking = mode !== "signin";
      signOv.querySelector("h3").textContent = linking ? "Link a wallet" : "Sign in to TRIUMP AI";
      signOv.querySelector('[data-step="choose"] p.sub').textContent = linking ? "Sign a message to prove you own it." : "Pick how you want to sign in.";
      ["#trim-xopt", "#trim-emopt", ".trim-or"].forEach(function (q) { signOv.querySelector(q).style.display = linking ? "none" : ""; });
      signOv.querySelector("[data-back]").style.display = linking ? "none" : "";
      renderWallets();
      show(signOv);
      if (mode === "link-email") { step("email"); setTimeout(function () { emInput.focus(); }, 40); } else step("choose");
    }
    signOv.querySelector("#trim-xopt").addEventListener("click", function (e) { e.preventDefault(); location.href = xLoginUrl(); });
    function manualEmail(){ step("email"); setTimeout(function () { emInput.focus(); }, 40); }
    signOv.querySelector("#trim-emopt").addEventListener("click", function () { msg(signOv, ""); if (!pickGoogle()) manualEmail(); });
    signOv.querySelector("#trim-gpick").addEventListener("click", function () { msg(signOv, ""); pickGoogle(); });

    /* ---------- pilih akun Google (hanya mengambil alamat email; login tetap lewat OTP) ---------- */
    var GID = String(window.TRIUMP_GOOGLE_CLIENT_ID || "").trim(), gClient = null;
    function loadGoogle(){
      if (!GID || gClient || document.getElementById("trim-gsi")) return;
      var sc = document.createElement("script"); sc.id = "trim-gsi"; sc.async = true; sc.src = "https://accounts.google.com/gsi/client";
      sc.onload = function () {
        try {
          gClient = google.accounts.oauth2.initTokenClient({
            client_id: GID, scope: "openid email", prompt: "select_account",
            callback: function (r) {
              if (!r || r.error || !r.access_token) { manualEmail(); return; }
              fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: "Bearer " + r.access_token } })
                .then(function (x) { return x.json(); })
                .then(function (j) {
                  try { google.accounts.oauth2.revoke(r.access_token, function () {}); } catch (e) {}
                  if (!j || !j.email) { manualEmail(); return; }
                  step("email"); emInput.value = j.email; sendBtn.click();
                })
                .catch(manualEmail);
            },
            error_callback: function () { manualEmail(); }
          });
          signOv.querySelector("#trim-gpick").hidden = false;
        } catch (e) {}
      };
      document.head.appendChild(sc);
    }
    function pickGoogle(){ if (!gClient) return false; gClient.requestAccessToken(); return true; }
    loadGoogle();
    signOv.querySelector("[data-back]").addEventListener("click", function () { step("choose"); msg(signOv, ""); });

    var sendBtn = signOv.querySelector("#trim-send");
    sendBtn.addEventListener("click", function () {
      var em = emInput.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { msg(signOv, "Please enter a valid email.", "err"); return; }
      sendBtn.disabled = true; msg(signOv, "Checking your email and sending the code…", "info");
      api("otp/send", { email: em }).then(function (res) {
        sendBtn.disabled = false;
        if (res.ok) { curEmail = res.email || em; signOv.querySelector("#trim-em-label").textContent = curEmail; step("otp"); msg(signOv, "Code sent. Check your inbox (and spam).", "ok"); setTimeout(function () { otpInput.focus(); }, 40); }
        else msg(signOv, res.error || "Failed to send code.", "err");
      });
    });
    emInput.addEventListener("keydown", function (e) { if (e.key === "Enter") sendBtn.click(); });

    var verifyBtn = signOv.querySelector("#trim-verify");
    verifyBtn.addEventListener("click", function () {
      var code = otpInput.value.replace(/\D/g, "");
      if (code.length !== 6) { msg(signOv, "Enter the 6-digit code.", "err"); return; }
      verifyBtn.disabled = true; msg(signOv, "Verifying…", "info");
      api("otp/verify", { email: curEmail, otp: code }).then(function (res) {
        verifyBtn.disabled = false;
        if (res.ok) { otpInput.value = ""; done(res.user, mode === "signin" ? "Signed in!" : "Email linked."); }
        else msg(signOv, res.error || "Incorrect code.", "err");
      });
    });
    otpInput.addEventListener("keydown", function (e) { if (e.key === "Enter") verifyBtn.click(); });
    signOv.querySelector("#trim-resend").addEventListener("click", function () { step("email"); msg(signOv, ""); otpInput.value = ""; emInput.focus(); });

    function done(u, text){
      setUser(u);
      msg(signOv, text, "ok");
      setTimeout(function () { hide(signOv); if (mode !== "signin") { renderAccount(); show(accOv); } }, 450);
    }

    /* ---------- daftar wallet ---------- */
    function renderWallets(){
      var box = signOv.querySelector("#trim-wlist");
      box.innerHTML = "";
      MAIN.forEach(function (w) {
        var found = findMain(w);
        var el = document.createElement(found ? "button" : "a");
        el.className = "trim-opt";
        if (found) { el.type = "button"; el.onclick = function () { walletSignIn(found.provider, w.name, el); }; }
        else {
          el.href = isMobile && w.mobile ? w.mobile() : w.install;
          el.target = "_blank"; el.rel = "noopener noreferrer";
        }
        el.innerHTML = '<img alt="" src="' + w.icon + '"><span></span><small class="' + (found ? "on" : "") + '">'
          + (found ? "Detected" : isMobile && w.mobile ? "Open app" : "Install") + "</small>";
        el.querySelector("span").textContent = w.name;
        box.appendChild(el);
      });
      others().forEach(function (d) {
        var el = document.createElement("button"); el.type = "button"; el.className = "trim-opt";
        el.innerHTML = (d.info.icon ? '<img alt="">' : '<span class="ic"></span>') + '<span></span><small class="on">Detected</small>';
        if (d.info.icon) el.querySelector("img").src = d.info.icon;
        el.querySelector("span:not(.ic)").textContent = d.info.name;
        el.onclick = function () { walletSignIn(d.provider, d.info.name, el); };
        box.appendChild(el);
      });
    }
    window.__trimRedrawWallets = function () { if (signOv.style.display === "flex") renderWallets(); };

    var busy = false;
    async function walletSignIn(p, name, el){
      if (busy) return; busy = true; el.disabled = true;
      try {
        msg(signOv, "Confirm the connection in " + name + "…", "info");
        var acc = await p.request({ method: "eth_requestAccounts" });
        var address = acc && acc[0];
        if (!address) throw new Error("No account selected.");
        msg(signOv, "Switching to " + CHAIN.name + "…", "info");
        try { await ensureChain(p); } catch (e) { /* tetap boleh sign in walau batal pindah jaringan */ }
        var n = await api("wallet/nonce", { address: address });
        if (!n.ok) throw new Error(n.error);
        msg(signOv, "Sign the message in " + name + " (free, no gas)…", "info");
        var sig = await p.request({ method: "personal_sign", params: [utf8Hex(n.message), address] });
        var v = await api("wallet/verify", { address: address, signature: sig });
        if (!v.ok) throw new Error(v.error);
        done(v.user, mode === "signin" ? "Signed in with " + name + "!" : "Wallet linked.");
      } catch (e) {
        msg(signOv, e && e.code === 4001 ? "Request rejected in wallet." : (e && e.message) || "Could not sign in.", "err");
      } finally { busy = false; el.disabled = false; }
    }

    /* ======================= panel AKUN ======================= */
    var accOv = modal('<h3>Your account</h3><p class="sub">Link more ways to sign in to the same account.</p>'
      + PROMO + '<div id="trim-acc"></div>'
      + '<div class="trim-act"><a class="trim-btn login" href="dashboard.html">Dashboard</a><button class="trim-btn pill" id="trim-signout">Sign out</button></div>');
    var user = null;
    function renderAccount(){
      var box = accOv.querySelector("#trim-acc");
      if (!user) { box.innerHTML = ""; return; }
      var rows = [
        { k: "Wallet", v: user.wallet ? shorten(user.wallet, 4) : null, title: user.wallet, add: "Link wallet", drop: "wallet/disconnect",
          addFn: function () { openSignIn("link-wallet"); } },
        { k: "X account", v: user.x ? "@" + user.x.username : null, add: "Connect X", drop: "x/disconnect",
          addFn: function () { location.href = xLoginUrl(); } },
        { k: "Email", v: user.email, add: "Add email", drop: null,
          addFn: function () { openSignIn("link-email"); } }
      ];
      box.innerHTML = "";
      rows.forEach(function (r) {
        var row = document.createElement("div"); row.className = "trim-row";
        row.innerHTML = '<div class="grow"><div class="k"></div><div class="v"></div></div>';
        row.querySelector(".k").textContent = r.k;
        var v = row.querySelector(".v");
        v.textContent = r.v || "Not linked"; if (!r.v) v.className = "v none"; if (r.title) v.title = r.title;
        var b = document.createElement("button"); b.type = "button";
        if (r.v) {
          if (!r.drop) { box.appendChild(row); return; }
          b.className = "trim-btn pill"; b.textContent = "Unlink";
          b.onclick = function () { api(r.drop, {}).then(function (res) { if (res.ok) setUser(res.user); else msg(accOv, res.error, "err"); }); };
        } else {
          b.className = "trim-btn " + (r.k === "X account" ? "xbtn" : "login"); b.textContent = r.add; b.onclick = r.addFn;
        }
        row.appendChild(b); box.appendChild(row);
      });
    }
    accOv.querySelector("#trim-signout").addEventListener("click", function () {
      api("logout", {}).then(function () { setUser(null); hide(accOv); });
    });

    /* ======================= navbar ======================= */
    var menu = document.querySelector(".menu"), host = menu;
    if (!host) {
      var tools = Array.prototype.slice.call(document.querySelectorAll("nav a,nav button")).filter(function (a) { return a.textContent.trim() === "Tools"; })[0];
      host = tools ? tools.parentNode : document.querySelector("nav");
    }
    if (!host) return;
    var bar = document.createElement("div"); bar.className = "trim-authbar";
    if (menu && !document.querySelector("[data-x-link]")) {
      var xl = document.createElement("a"); xl.className = "trim-btn xbtn xicon"; xl.setAttribute("data-x-link", "");
      xl.href = "https://x.com/triumpAI"; xl.target = "_blank"; xl.rel = "noopener noreferrer";
      xl.setAttribute("aria-label", "TRIUMP AI on X"); xl.title = "TRIUMP AI on X";
      xl.innerHTML = xSvg();
      bar.appendChild(xl);
    }
    var loginBtn = document.createElement("button"); loginBtn.type = "button";
    bar.appendChild(loginBtn);
    host.appendChild(bar);

    var ready = false;
    /* logo di kiri navbar: ke Dashboard kalau sudah login, ke Home kalau belum */
    var logos = Array.prototype.slice.call(document.querySelectorAll("nav a")).filter(function (a) {
      return a.classList.contains("brand") || a.querySelector('img[alt="TRIUMP AI"]');
    });
    function setUser(u){
      user = u || null;
      window.TRIUMP_USER = user;
      logos.forEach(function (a) { a.setAttribute("href", user ? "dashboard.html" : "index.html"); a.title = user ? "Dashboard" : "Home"; });
      if (ready) window.dispatchEvent(new CustomEvent("triump:user", { detail: user }));
      if (user) {
        loginBtn.className = "trim-btn pill";
        var label = user.wallet ? shorten(user.wallet, 4) : user.x ? "@" + user.x.username : shorten(user.email || "Account", 14);
        loginBtn.innerHTML = (user.wallet ? walletSvg() : user.x ? xSvg() : "") + "<span></span>";
        loginBtn.querySelector("span").textContent = label;
        loginBtn.onclick = function () { renderAccount(); show(accOv); };
      } else {
        loginBtn.className = "trim-btn login";
        loginBtn.innerHTML = "<span>Sign in</span>";
        loginBtn.onclick = function () { openSignIn("signin"); };
      }
      renderAccount();
    }
    setUser(null);
    /* halaman aplikasi (Studio, TriumpCode) mendengarkan "triump:user" */
    window.triumpSignIn = function () { openSignIn("signin"); };
    window.triumpAccount = function () { if (user) { renderAccount(); show(accOv); } else openSignIn("signin"); };
    window.triumpLinkWallet = function () { openSignIn("link-wallet"); };
    api("me", null, "GET").then(function (res) { ready = true; window.TRIUMP_READY = true; setUser(res && res.ok ? res.user : null); });

    /* hasil balik dari OAuth X (?x=...) */
    (function () {
      var q = new URLSearchParams(location.search), r = q.get("x");
      if (!r) return;
      q.delete("x"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
      var text = { signedin: "Signed in with X.", connected: "X account linked.", denied: "X sign-in was cancelled.",
        notconfigured: "Sign in with X is not available yet.", error: "Could not sign in with X. Please try again.",
        taken: "That X account is already linked to another account." }[r];
      if (!text) return;
      setTimeout(function () {
        if (r === "signedin" || r === "connected") { renderAccount(); show(accOv); msg(accOv, text, "ok"); }
        else { openSignIn("signin"); msg(signOv, text, "err"); }
      }, 300);
    })();

    /* ---------- menu HP: hamburger -> panel berisi link + tombol akun ---------- */
    (function () {
      var mq = window.matchMedia(menu ? "(max-width:820px)" : "(max-width:1023px)");
      var burger = document.querySelector('button[aria-label="Open menu"]');
      if (!burger && menu) {
        burger = document.createElement("button"); burger.type = "button"; burger.className = "trim-burger"; burger.setAttribute("aria-label", "Open menu");
        burger.innerHTML = '<svg width="16" height="12" viewBox="0 0 12 8" fill="currentColor" aria-hidden="true"><path d="M0 0h12v1.5H0zm0 3.25h12v1.5H0zm0 3.25h12v1.5H0z"/></svg>';
        menu.parentNode.appendChild(burger);
      }
      if (!burger) return;
      var panel = document.createElement("div"); panel.className = "trim-mnav";
      var links = Array.prototype.slice.call((menu || host).querySelectorAll("a[href]")).filter(function (a) { return !bar.contains(a) && !a.hasAttribute("data-x-link"); });
      links.forEach(function (a) {
        var c = document.createElement("a"); c.href = a.getAttribute("href");
        if (a.target) { c.target = a.target; c.rel = "noopener noreferrer"; }
        c.innerHTML = a.innerHTML;
        panel.appendChild(c);
      });
      // ikon X homepage ikut pindah ke baris tombol di panel
      var navX = menu ? null : host.querySelector("[data-x-link]");
      var xHome = navX && navX.parentNode, xNext = navX && navX.nextSibling;
      document.body.appendChild(panel);
      burger.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); panel.classList.toggle("open"); });
      document.addEventListener("click", function (e) { if (!panel.contains(e.target) && e.target !== burger) panel.classList.remove("open"); });
      panel.addEventListener("click", function (e) { if (e.target.closest("button")) panel.classList.remove("open"); });
      var navXClass = navX ? navX.className : "";
      function place(){
        if (mq.matches) {
          if (navX) { navX.className = "trim-btn xbtn xicon"; bar.insertBefore(navX, bar.firstChild); }
          panel.appendChild(bar);
        } else {
          if (navX) { navX.className = navXClass; xHome.insertBefore(navX, xNext); }
          host.appendChild(bar); panel.classList.remove("open");
        }
      }
      place(); mq.addEventListener("change", place);
    })();

    function shorten(s, n){ s = String(s); if (s.indexOf("@") > 0) { var p = s.split("@"); return (p[0].length > n ? p[0].slice(0, n) + "…" : p[0]) + "@" + p[1]; } return s.length > 2 * n + 2 ? s.slice(0, n + 2) + "…" + s.slice(-n) : s; }
  });

  function esc(s){ return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function xSvg(){ return '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'; }
  function gmailSvg(){ return '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>'; }
  function mailSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>'; }
  function walletSvg(){ return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/><path d="M21 12h-4a2 2 0 0 0 0 4h4v-4z"/></svg>'; }
}());
