/* TRIUMP AI Studio — deskripsi -> desain HTML lengkap, preview langsung, revisi lewat chat. */
(function () {
  var $ = TA.$, esc = TA.esc;
  var el = {
    prompt: $("#prompt"), go: $("#go"), goL: $("#go-l"), stop: $("#stop"), plan: $("#plan"), chips: $("#chips"),
    vers: $("#vers"), versSec: $("#vers-sec"), designs: $("#designs"), nw: $("#new"),
    title: $("#title"), frame: $("#frame"), code: $("#codeview"), empty: $("#empty"), live: $("#live"), liveT: $("#live-t"),
    codeT: $("#code-t"), open: $("#open"), dl: $("#dl"), device: $("#device"), gate: $("#gate")
  };
  var S = { user: null, design: null, html: "", viewVer: 0, busy: false, ac: null, showCode: false };

  var IDEAS = [
    "Landing page for a sunset coffee shop in Bali",
    "Crypto portfolio dashboard, dark mode",
    "Personal portfolio for a 3D artist",
    "Pricing page for an AI writing tool",
    "Event poster for a jazz night",
    "Mobile app onboarding, 3 screens"
  ];
  el.chips.innerHTML = IDEAS.map(function (t) { return '<button class="chip">' + esc(t) + "</button>"; }).join("");
  el.chips.addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    el.prompt.value = b.textContent; el.prompt.focus();
  });

  /* ---------- preview ---------- */
  function show(html) {
    S.html = html || "";
    var has = !!S.html;
    el.empty.style.display = has || S.busy ? "none" : "";
    el.frame.style.display = has ? "" : "none";
    if (has) el.frame.srcdoc = S.html;
    el.code.textContent = S.html;
    [el.open, el.dl, el.codeT].forEach(function (b) { b.disabled = !has; });
  }
  el.device.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    TA.$$("button", el.device).forEach(function (x) { x.classList.toggle("on", x === b); });
    el.frame.className = "frame " + (b.dataset.d === "desktop" ? "" : b.dataset.d);
  });
  el.codeT.addEventListener("click", function () {
    S.showCode = !S.showCode;
    el.code.classList.toggle("show", S.showCode); el.codeT.classList.toggle("on", S.showCode);
  });
  el.open.addEventListener("click", function () {
    if (S.design && !S.busy) window.open("/preview/s/" + S.design.id + (S.viewVer ? "/" + S.viewVer : ""), "_blank", "noopener");
  });
  el.dl.addEventListener("click", function () {
    if (!S.html) return;
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([S.html], { type: "text/html" }));
    a.download = ((S.design && S.design.title) || "design").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").toLowerCase() + ".html";
    a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  /* ---------- daftar & versi ---------- */
  function renderVersions() {
    var d = S.design;
    el.versSec.style.display = d && d.versions.length ? "" : "none";
    if (!d) return;
    el.vers.innerHTML = d.versions.map(function (v, i) {
      return '<div class="ver' + (i + 1 === S.viewVer ? " on" : "") + '" data-v="' + (i + 1) + '"><span class="n">v' + (i + 1) + '</span><span class="t">' + esc(v.prompt) + "</span></div>";
    }).reverse().join("");
  }
  el.vers.addEventListener("click", function (e) {
    var v = e.target.closest(".ver"); if (!v || S.busy || !S.design) return;
    var n = Number(v.dataset.v);
    fetch("/preview/s/" + S.design.id + "/" + n).then(function (r) { return r.text(); }).then(function (h) { S.viewVer = n; show(h); renderVersions(); });
  });
  function loadList() {
    if (!S.user) { el.designs.innerHTML = '<div class="empty">Sign in to see your designs.</div>'; return; }
    TA.api("/api/studio/list").then(function (r) {
      if (!r.ok) return;
      el.designs.innerHTML = r.designs.length ? r.designs.map(function (d) {
        return '<div class="dz' + (S.design && S.design.id === d.id ? " on" : "") + '" data-id="' + esc(d.id) + '"><span class="nm">' + esc(d.title) + '</span><span class="muted" style="font-size:11px">v' + d.versions + '</span><button class="x" title="Delete" data-del="' + esc(d.id) + '">&times;</button></div>';
      }).join("") : '<div class="empty">No designs yet — describe your first one above.</div>';
    });
  }
  el.designs.addEventListener("click", function (e) {
    var del = e.target.closest("[data-del]");
    if (del) {
      e.stopPropagation();
      if (!confirm("Delete this design?")) return;
      TA.api("/api/studio/delete", { id: del.dataset.del }).then(function () {
        if (S.design && S.design.id === del.dataset.del) reset();
        loadList();
      });
      return;
    }
    var row = e.target.closest(".dz"); if (row && !S.busy) openDesign(row.dataset.id);
  });
  function openDesign(id) {
    TA.api("/api/studio/get?id=" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) { TA.toast(r.error, true); return; }
      S.design = r.design; S.viewVer = r.design.versions.length;
      el.title.textContent = r.design.title;
      history.replaceState(null, "", "?d=" + encodeURIComponent(id));
      show(r.design.html); renderVersions(); loadList();
      el.goL.textContent = "Revise"; el.prompt.placeholder = "Describe a change: make the hero bolder, switch to green, add a pricing section…";
    });
  }
  function reset() {
    S.design = null; S.viewVer = 0; el.title.textContent = "New design";
    history.replaceState(null, "", location.pathname);
    show(""); renderVersions(); loadList();
    el.goL.textContent = "Generate"; el.prompt.placeholder = "A landing page for a sunset coffee shop in Bali, warm and minimal…";
  }
  el.nw.addEventListener("click", function () { if (!S.busy) { reset(); el.prompt.focus(); } });

  /* ---------- generate ---------- */
  function setBusy(b) {
    S.busy = b;
    el.go.disabled = b; el.stop.style.display = b ? "" : "none";
    el.live.classList.toggle("show", b);
    el.prompt.disabled = b;
  }
  function partialDoc(t) {
    var i = t.search(/<!doctype html|<html[\s>]/i);
    return i >= 0 ? t.slice(i) : "";
  }
  async function generate() {
    var prompt = el.prompt.value.trim();
    if (!prompt) { el.prompt.focus(); return; }
    if (!S.user) { window.triumpSignIn(); return; }
    setBusy(true);
    el.liveT.textContent = S.design ? "Revising your design…" : "Designing…";
    el.empty.style.display = "none";
    var acc = "", lastPaint = 0, isRevision = !!S.design, think = "", t0 = Date.now();
    var phase = isRevision ? "Revising" : "Designing";
    function status() {
      var sec = Math.round((Date.now() - t0) / 1000);
      if (acc) el.liveT.textContent = phase + "… " + Math.round(acc.length / 1024) + " KB · " + sec + "s";
      else {
        var last = think.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/).filter(Boolean).pop() || "";
        el.liveT.textContent = "Planning · " + sec + "s" + (last ? " — " + (last.length > 90 ? last.slice(0, 88) + "…" : last) : "");
      }
    }
    var tick = setInterval(status, 1000); status();
    S.ac = new AbortController();
    var res = await TA.stream("/api/studio/generate", { id: S.design && S.design.id, prompt: prompt }, function (ev) {
      if (ev.t === "start") {
        TA.planBadge(el.plan, ev.plan);
        if (!S.design) S.design = { id: ev.id, title: prompt.slice(0, 60), versions: [] };
      } else if (ev.t === "thinking") {
        think += ev.text; status();
      } else if (ev.t === "delta") {
        acc += ev.text;
        el.code.textContent = acc;
        if (S.showCode) el.code.scrollTop = el.code.scrollHeight;
        status();
        // gambar ulang preview sebagian tiap ~1,2 detik: desainnya "tumbuh" di depan mata
        var now = Date.now(), doc = partialDoc(acc);
        if (doc && /<body[\s>]/i.test(doc) && now - lastPaint > 1200) { lastPaint = now; el.frame.style.display = ""; el.frame.srcdoc = doc; }
      } else if (ev.t === "done") {
        S.design.id = ev.id; S.design.title = ev.title;
        S.design.versions.push({ prompt: prompt, at: Date.now() });
        S.viewVer = ev.version;
        el.title.textContent = ev.title;
        history.replaceState(null, "", "?d=" + encodeURIComponent(ev.id));
        el.prompt.value = "";
        el.goL.textContent = "Revise";
        el.prompt.placeholder = "Describe a change: make the hero bolder, switch to green, add a pricing section…";
        if (ev.truncated) TA.toast("The design was very long and may be cut off. Ask for a shorter version.", true);
      } else if (ev.t === "error") {
        TA.toast(ev.error, true);
      }
    }, S.ac.signal);
    clearInterval(tick);
    setBusy(false);
    if (res && res.error) { res.quota ? TA.quotaMsg(res) : TA.toast(res.error, true); if (!S.design || !S.design.versions.length) { S.design = null; } }
    if (res && res.aborted) TA.toast("Stopped.");
    // tampilkan versi final yang tersimpan (atau kembali ke versi terakhir kalau gagal)
    if (S.design && S.design.versions.length) {
      fetch("/preview/s/" + S.design.id + "/" + S.viewVer).then(function (r) { return r.ok ? r.text() : ""; }).then(function (h) { show(h); renderVersions(); loadList(); });
    } else { show(""); }
    TA.refreshPlan(el.plan);
  }
  el.go.addEventListener("click", generate);
  el.stop.addEventListener("click", function () { if (S.ac) S.ac.abort(); });
  el.prompt.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || !e.shiftKey)) { e.preventDefault(); generate(); }
  });

  /* ---------- login ---------- */
  var first = true;
  TA.onUser(function (u) {
    S.user = u;
    el.gate.classList.toggle("show", !u);
    if (u) TA.refreshPlan(el.plan); else el.plan.style.display = "none";
    loadList();
    if (first && u) {
      first = false;
      var q = new URLSearchParams(location.search);
      if (q.get("d")) openDesign(q.get("d"));
      else if (q.get("prompt")) {
        el.prompt.value = q.get("prompt"); history.replaceState(null, "", location.pathname);
        if (q.get("go") === "0") el.prompt.focus(); else generate();
      }
    } else if (first && !u) {
      var p = new URLSearchParams(location.search).get("prompt");
      if (p) el.prompt.value = p;
    }
  });
  show("");
}());
