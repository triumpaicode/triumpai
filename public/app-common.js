/* TRIUMP AI — helper bersama untuk halaman aplikasi (Studio, TriumpCode, CLI). */
(function () {
  var T = window.TA = {};

  T.$ = function (s, r) { return (r || document).querySelector(s); };
  T.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  T.esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };

  T.api = function (path, body) {
    return fetch(path, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return { ok: false, error: "Server error (" + r.status + ")" }; }); })
      .catch(function () { return { ok: false, error: "Network error — check your connection." }; });
  };

  /* POST lalu baca Server-Sent Events. onEvent(ev) per event; resolve saat selesai.
     Kalau server menjawab JSON biasa (mis. kuota habis), resolve dengan objek itu. */
  T.stream = async function (path, body, onEvent, signal) {
    var r;
    try {
      r = await fetch(path, { method: "POST", credentials: "same-origin", signal: signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    } catch (e) {
      if (e && e.name === "AbortError") return { ok: false, aborted: true };
      return { ok: false, error: "Network error — check your connection." };
    }
    if ((r.headers.get("content-type") || "").indexOf("event-stream") < 0) {
      return r.json().catch(function () { return { ok: false, error: "Server error (" + r.status + ")" }; });
    }
    var reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
    try {
      while (true) {
        var x = await reader.read();
        if (x.done) break;
        buf += dec.decode(x.value, { stream: true });
        var i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          var raw = buf.slice(0, i); buf = buf.slice(i + 2);
          if (raw.indexOf("data: ") === 0) { try { onEvent(JSON.parse(raw.slice(6))); } catch (e) { console.error(e); } }
        }
      }
    } catch (e) {
      if (e && e.name === "AbortError") return { ok: false, aborted: true };
      return { ok: false, error: "Connection lost." };
    }
    return { ok: true };
  };

  var toastEl, toastT;
  T.toast = function (msg, isErr) {
    if (!toastEl) { toastEl = document.createElement("div"); toastEl.className = "toast"; document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.className = "toast show" + (isErr ? " err" : "");
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.className = "toast"; }, isErr ? 6000 : 3000);
  };

  /* status login: panggil fn(user) sekarang (kalau sudah siap) dan setiap berubah */
  T.onUser = function (fn) {
    window.addEventListener("triump:user", function (e) { fn(e.detail); });
    if (window.TRIUMP_READY) fn(window.TRIUMP_USER || null);
  };

  /* badge paket + tombol cek holder */
  T.planBadge = function (el, plan) {
    if (!el) return;
    if (!plan || !plan.limits) { el.style.display = "none"; return; }
    el.style.display = "";
    el.className = "plan" + (plan.plan === "pro" ? " pro" : "");
    var kind = el.getAttribute("data-kind") || "studio";
    el.innerHTML = plan.plan === "pro" ? "<b>UNLIMITED</b> · until " + new Date(plan.proUntil).toLocaleDateString()
      : "FREE · " + plan.left[kind] + "/" + plan.limits[kind] + " left today";
    el.title = plan.plan === "pro" ? "Unlimited active until " + new Date(plan.proUntil).toLocaleDateString() : "Token holders get 3 months unlimited — tap to check your wallet";
    el.onclick = function () { T.holderCheck(el); };
  };
  T.refreshPlan = function (el) {
    return T.api("/api/plan").then(function (p) { if (p.ok) T.planBadge(el, p); return p; });
  };
  T.holderCheck = function (el) {
    var u = window.TRIUMP_USER;
    if (!u) { window.triumpSignIn && window.triumpSignIn(); return; }
    if (!u.wallet) { T.toast("Link the wallet that holds the token to unlock unlimited use."); window.triumpLinkWallet && window.triumpLinkWallet(); return; }
    T.toast("Checking your wallet on Robinhood Chain…");
    T.api("/api/plan/check-holder", {}).then(function (r) {
      if (!r.ok) { T.toast(r.error || "Check failed.", true); return; }
      T.toast(r.message, !r.holder);
      T.planBadge(el, r);
      if (r.holder && r.plan === "pro") window.dispatchEvent(new CustomEvent("triump:plan", { detail: r }));
    });
  };
  T.quotaMsg = function (res) {
    T.toast(res.error, true);
  };
}());
