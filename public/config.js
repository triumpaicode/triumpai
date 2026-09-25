/* ============================================================
   TRIUMP AI — KONFIG TOKEN (ticker $TRIUMPAI — sengaja TIDAK ditampilkan di web)  (semua setelan token ada di sini)
   ------------------------------------------------------------
   EDIT BAGIAN INI SAJA, lalu SAVE. Otomatis kebawa ke:
       index.html (strip CA di bawah navbar)  +  token.html
   ============================================================ */

window.TRIUMP_CA = "soon today";   /* Contract Address. Tempel CA asli (0x...) di sini  */

/* Tanggal & jam launch (UTC). Kosongkan "" kalau tidak mau ada hitung mundur.
   format: "2026-09-25T15:00:00Z"  (Z = waktu UTC)                              */
window.TRIUMP_LAUNCH = "";

/* Google Client ID (untuk "Sign in with Gmail" -> pilih akun Google yang sudah login di browser).
   Kosong = user mengetik email sendiri. Setelah memilih akun, login tetap lewat kode OTP.  */
window.TRIUMP_GOOGLE_CLIENT_ID = "";

/* Link tombol BUY. {CA} otomatis diganti CA asli begitu CA diisi.
   Selama CA belum diisi, tombol membuka halaman utama tiap platform.           */
window.TRIUMP_BUY = {
  fomo:  "https://fomo.family/tokens/robinhood/{CA}",
  axiom: "https://axiom.trade",                         /* tempel link token axiom di sini kalau sudah ada */
  pons:  "https://ponsfamily.com/launchpad/{CA}"
};

/* Jaringan: Robinhood Chain (EVM). Dipakai tombol Connect Wallet.
   RPC mirror sengaja di depan: endpoint resmi diblokir sebagian ISP Indonesia. */
window.TRIUMP_CHAIN = {
  name: "Robinhood Chain",
  chainId: 4663,
  chainIdHex: "0x1237",
  currency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [
    "https://robinhood-rpc.publicnode.com",
    "https://robinhood.drpc.org",
    "https://rpc.mainnet.chain.robinhood.com"
  ],
  explorer: "https://robinhoodchain.blockscout.com"
};

/* ====== JANGAN UBAH DI BAWAH INI ====== */
(function () {
  var MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
  var HOME = { fomo: "https://fomo.family", axiom: "https://axiom.trade", pons: "https://ponsfamily.com/launchpad" };

  function isRealCA(ca) { return /^0x[0-9a-fA-F]{40}$/.test(String(ca || "").trim()); }
  window.TRIUMP_HAS_CA = isRealCA(window.TRIUMP_CA);

  function launchLabel(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return "";
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    var ap = h < 12 ? "AM" : "PM", h12 = h % 12 || 12;
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear() +
           " · " + h12 + ":" + (m < 10 ? "0" : "") + m + " " + ap + " UTC";
  }

  function buyUrl(k) {
    var tpl = (window.TRIUMP_BUY || {})[k] || HOME[k];
    if (tpl.indexOf("{CA}") < 0) return tpl;
    return window.TRIUMP_HAS_CA ? tpl.replace("{CA}", window.TRIUMP_CA.trim()) : HOME[k];
  }

  function copy(text, btn) {
    function ok() { var o = btn.getAttribute("data-l") || btn.textContent; btn.setAttribute("data-l", o); btn.textContent = "Copied!"; setTimeout(function () { btn.textContent = o; }, 1400); }
    try { navigator.clipboard.writeText(text).then(ok, fallback); } catch (e) { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); ok();
    }
  }

  function apply() {
    var ca = String(window.TRIUMP_CA || "").trim(), lab = launchLabel(window.TRIUMP_LAUNCH);

    document.querySelectorAll("[data-ca]").forEach(function (el) { if (ca) { el.textContent = ca; el.title = ca; } });
    document.querySelectorAll("[data-buy]").forEach(function (el) {
      var k = el.getAttribute("data-buy"); if (k) el.href = buyUrl(k);
    });
    document.querySelectorAll("[data-launch]").forEach(function (el) {
      if (lab) el.textContent = "LAUNCH · " + lab.toUpperCase(); else el.style.display = "none";
    });
    document.querySelectorAll("[data-chain]").forEach(function (el) {
      el.textContent = window.TRIUMP_CHAIN.name;
    });
    /* tombol Copy: cari elemen [data-ca] terdekat, salin CA penuh */
    document.querySelectorAll("[data-copy-ca]").forEach(function (b) {
      b.onclick = function (e) { e.preventDefault(); copy(ca, b); };
    });
    /* klik CA-nya sendiri juga menyalin */
    document.querySelectorAll("[data-ca]").forEach(function (el) {
      el.style.cursor = "copy";
      el.addEventListener("click", function () {
        var b = el.parentNode.querySelector("[data-copy-ca]"); if (b) b.click(); else copy(ca, el);
      });
    });
  }

  /* tombol Buy tunggal -> popup kecil berisi Fomo / Axiom / Pons */
  var VENUES = [
    { k: "fomo", name: "Fomo", note: "fomo.family" },
    { k: "axiom", name: "Axiom", note: "axiom.trade" },
    { k: "pons", name: "Pons", note: "ponsfamily.com" }
  ];
  var menu;
  function buyMenu() {
    if (!menu) {
      menu = document.createElement("div");
      menu.setAttribute("role", "dialog");
      menu.style.cssText = "position:fixed;inset:0;z-index:100002;display:none;align-items:center;justify-content:center;background:rgba(4,10,8,.6);backdrop-filter:blur(5px);padding:16px;font-family:Inter,system-ui,-apple-system,Arial,sans-serif";
      menu.innerHTML = '<div style="width:100%;max-width:320px;background:#0d1f1a;border:1px solid rgba(255,255,255,.12);border-radius:16px;padding:18px;color:#eaf4ef;box-shadow:0 30px 80px rgba(0,0,0,.5)">'
        + '<div style="display:flex;align-items:center;margin-bottom:10px"><b style="flex:1;font-size:16px;font-weight:900">Buy on</b>'
        + '<button type="button" data-x aria-label="Close" style="border:0;background:0;color:#7fa99c;font-size:22px;cursor:pointer;line-height:1">&times;</button></div>'
        + VENUES.map(function (v) {
            return '<a data-v="' + v.k + '" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;gap:10px;padding:13px 14px;margin-top:8px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:#fff;text-decoration:none;font-weight:800;font-size:15px">'
              + v.name + '<span style="margin-left:auto;font-size:11.5px;font-weight:600;color:#7fa99c">' + v.note + '</span>'
              + '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#39ff14" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M9 7h8v8"/></svg></a>';
          }).join("")
        + "</div>";
      document.body.appendChild(menu);
      menu.addEventListener("click", function (e) { if (e.target === menu || e.target.closest("[data-x]") || e.target.closest("a")) menu.style.display = "none"; });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") menu.style.display = "none"; });
    }
    menu.querySelectorAll("a[data-v]").forEach(function (a) { a.href = buyUrl(a.getAttribute("data-v")); });
    menu.style.display = "flex";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-buy-menu]");
    if (b) { e.preventDefault(); buyMenu(); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
})();
