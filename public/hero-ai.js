/* TRIUMP AI — kotak prompt di tengah homepage.
   Belum sign in -> popup Sign in dulu; setelah masuk, lanjut ke Studio dengan prompt tadi.
   Prompt disimpan sementara supaya tetap terbawa walau sign in lewat X (pindah halaman). */
(function () {
  var KEY = "triump_pending_prompt";
  function ready(fn){ if(document.readyState!=="loading") fn(); else document.addEventListener("DOMContentLoaded", fn); }
  function store(v){ try { if (v === undefined) return sessionStorage.getItem(KEY); if (v === null) sessionStorage.removeItem(KEY); else sessionStorage.setItem(KEY, v); } catch (e) { return null; } }
  function toStudio(q){ store(null); location.href = "studio.html" + (q ? "?prompt=" + encodeURIComponent(q) : ""); }

  ready(function () {
    function go(q){
      q = (q || "").trim();
      if (window.TRIUMP_USER) { toStudio(q); return; }
      store(q || "");
      if (window.triumpSignIn) window.triumpSignIn();
    }
    // sudah/baru sign in dan ada prompt tertunda -> langsung ke Studio
    window.addEventListener("triump:user", function (e) {
      var p = store();
      if (e.detail && p !== null && p !== undefined) toStudio(p);
    });

    document.querySelectorAll("textarea[data-old-placeholder]").forEach(function (ta) {
      var form = ta.closest("form");
      if (form && !form.dataset.trimAi) {
        form.dataset.trimAi = "1";
        form.addEventListener("submit", function (e) { e.preventDefault(); go(ta.value); });
      }
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(ta.value); }
      });
      var send = (form || ta.parentNode).querySelector('button[type="submit"],button[aria-label*="end" i]');
      if (send) send.addEventListener("click", function (e) { e.preventDefault(); go(ta.value); });
      var up = (form || document).querySelector('[aria-label="Upload image"]');
      if (up) up.style.display = "none";
    });
  });
}());
