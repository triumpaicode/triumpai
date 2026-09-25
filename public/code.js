/* TriumpCode Web — agent AI yang membangun project multi-file di browser. */
(function () {
  var $ = TA.$, esc = TA.esc;
  var el = {
    cw: $("#cw"), mtabs: $("#mtabs"), proj: $("#proj"), newp: $("#newp"), more: $("#more"),
    msgs: $("#msgs"), input: $("#input"), send: $("#send"), stop: $("#stop"), plan: $("#plan"),
    filesel: $("#filesel"), zip: $("#zip"), view: $("#view"), path: $("#path"), save: $("#save"),
    reload: $("#reload"), open: $("#open"), pv: $("#pv"), editor: $("#editor"), gate: $("#gate")
  };
  var S = { user: null, projects: [], p: null, file: null, view: "preview", busy: false, ac: null, changed: {}, dirty: false };

  /* ---------- tab HP ---------- */
  el.mtabs.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    TA.$$("button", el.mtabs).forEach(function (x) { x.classList.toggle("on", x === b); });
    el.cw.dataset.tab = b.dataset.t;
  });

  /* ---------- project ---------- */
  function loadProjects(selectId) {
    return TA.api("/api/code/list").then(function (r) {
      if (!r.ok) return;
      S.projects = r.projects;
      if (!r.projects.length) return createProject("My first project");
      el.proj.innerHTML = r.projects.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + "</option>"; }).join("");
      var want = selectId || new URLSearchParams(location.search).get("p") || localStore("tc_last") || r.projects[0].id;
      if (!r.projects.some(function (p) { return p.id === want; })) want = r.projects[0].id;
      el.proj.value = want;
      return openProject(want);
    });
  }
  function createProject(name) {
    return TA.api("/api/code/new", { name: name }).then(function (r) {
      if (!r.ok) { TA.toast(r.error, true); return; }
      return loadProjects(r.id);
    });
  }
  function openProject(id) {
    return TA.api("/api/code/get?id=" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) { TA.toast(r.error, true); return; }
      S.p = r.project; S.changed = {}; S.file = null; S.dirty = false;
      localStore("tc_last", id);
      history.replaceState(null, "", "?p=" + encodeURIComponent(id));
      renderChat(); renderTree();
      openFile(S.p.files["index.html"] !== undefined ? "index.html" : Object.keys(S.p.files)[0], true);
      setView("preview"); reloadPreview();
      if (S.p.busy) TA.toast("TriumpCode is still finishing a task on this project.");
    });
  }
  el.proj.addEventListener("change", function () { if (!guardDirty()) { el.proj.value = S.p.id; return; } openProject(el.proj.value); });
  el.newp.addEventListener("click", function () {
    if (S.busy) return;
    var n = prompt("Project name", "Untitled project"); if (n === null) return;
    createProject(n.trim() || "Untitled project");
  });
  el.more.addEventListener("click", function () {
    if (!S.p || S.busy) return;
    var a = prompt('Type a new name to rename, or type DELETE to delete "' + S.p.name + '"', S.p.name);
    if (a === null) return;
    if (a.trim() === "DELETE") {
      TA.api("/api/code/delete", { id: S.p.id }).then(function () { localStore("tc_last", ""); history.replaceState(null, "", location.pathname); loadProjects(); });
    } else if (a.trim() && a.trim() !== S.p.name) {
      TA.api("/api/code/rename", { id: S.p.id, name: a.trim() }).then(function (r) { if (r.ok) loadProjects(S.p.id); });
    }
  });
  el.zip.addEventListener("click", function () { if (S.p) location.href = "/api/code/zip?id=" + encodeURIComponent(S.p.id); });

  /* ---------- daftar file (hanya di mode Code, seperti Claude) ---------- */
  function renderTree() {
    var files = Object.keys(S.p.files).sort(function (a, b) {
      if (a === "index.html") return -1; if (b === "index.html") return 1;
      var da = a.split("/").length, db = b.split("/").length; return da - db || a.localeCompare(b);
    });
    el.filesel.innerHTML = files.map(function (f) { return '<option value="' + esc(f) + '">' + esc(f) + "</option>"; }).join("");
    if (S.file) el.filesel.value = S.file;
  }
  el.filesel.addEventListener("change", function () {
    if (!guardDirty()) { el.filesel.value = S.file; return; }
    openFile(el.filesel.value, true);
  });

  /* ---------- editor & preview ---------- */
  function openFile(f, quiet) {
    S.file = f || null; S.dirty = false;
    el.editor.value = f ? S.p.files[f] : "";
    el.save.style.display = "none";
    renderTree();
    if (!quiet && f) setView("code");
  }
  function setView(v) {
    S.view = v;
    TA.$$("button", el.view).forEach(function (b) { b.classList.toggle("on", b.dataset.v === v); });
    el.pv.style.display = v === "preview" ? "" : "none";
    el.editor.style.display = v === "code" ? "" : "none";
    el.filesel.style.display = v === "code" ? "" : "none";
    el.path.textContent = "";
    el.save.style.display = v === "code" && S.dirty ? "" : "none";
  }
  el.view.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setView(b.dataset.v); });
  el.editor.addEventListener("input", function () { S.dirty = true; el.save.style.display = ""; });
  el.editor.addEventListener("keydown", function (e) {
    if (e.key === "Tab") { e.preventDefault(); var s = el.editor.selectionStart; el.editor.setRangeText("  ", s, el.editor.selectionEnd, "end"); S.dirty = true; el.save.style.display = ""; }
    if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); saveFile(); }
  });
  function saveFile() {
    if (!S.p || !S.file || !S.dirty) return;
    if (S.busy) { TA.toast("Wait until TriumpCode finishes, then save.", true); return; }
    TA.api("/api/code/save-file", { id: S.p.id, path: S.file, content: el.editor.value }).then(function (r) {
      if (!r.ok) { TA.toast(r.error, true); return; }
      S.p.files = r.files; S.dirty = false; el.save.style.display = "none"; TA.toast("Saved " + S.file); reloadPreview();
    });
  }
  el.save.addEventListener("click", saveFile);
  function guardDirty() { return !S.dirty || confirm("You have unsaved changes in " + S.file + ". Discard them?"); }
  function reloadPreview() { if (S.p) el.pv.src = "/preview/c/" + encodeURIComponent(S.p.id) + "/?t=" + Date.now(); }
  el.reload.addEventListener("click", reloadPreview);
  el.open.addEventListener("click", function () { if (S.p) window.open("/preview/c/" + encodeURIComponent(S.p.id) + "/", "_blank", "noopener"); });

  /* ---------- chat ---------- */
  var TOOL_DONE = { write_file: "Wrote code", edit_file: "Edited code", read_file: "Read the code", list_files: "Looked over the project", delete_file: "Removed a file" };
  var TOOL_RUN = { write_file: "Writing code", edit_file: "Editing code", read_file: "Reading the code", list_files: "Looking over the project", delete_file: "Removing a file" };
  function fmt(t) {
    return esc(t).replace(/`([^`\n]+)`/g, "<code>$1</code>").replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  }
  function toolHtml(t) {
    var label = t.ok === false ? (TOOL_RUN[t.name] || "Working") + " — retried" : (TOOL_DONE[t.name] || "Worked on the project");
    return '<div class="tool' + (t.ok === false ? " err" : "") + '"><span class="d"></span>' + esc(label) + "</div>";
  }
  /* langkah berurutan yang sama digabung: "Edited code ×3" */
  function toolsHtml(list) {
    var out = [], last = null, n = 0;
    (list || []).forEach(function (t) {
      var k = (t.ok === false ? "e:" : "") + (TOOL_DONE[t.name] || t.name);
      if (k === last) { n++; out[out.length - 1] = toolHtml(t).replace("</div>", n > 1 ? ' <span class="muted">×' + n + "</span></div>" : "</div>"); }
      else { last = k; n = 1; out.push(toolHtml(t)); }
    });
    return out.join("");
  }
  function renderChat() {
    var chat = S.p.chat || [];
    if (!chat.length) {
      el.msgs.innerHTML = '<div class="empty" style="padding:6px 2px 0"><b style="color:#eaf4ef;font-size:15px">What are we building?</b><br>Describe an app, a game or a website. TriumpCode builds it and the result appears in the preview.</div>';
      return;
    }
    el.msgs.innerHTML = chat.map(function (m) {
      if (m.role === "user") return '<div class="msg user"><div class="who">YOU</div><div class="bubble">' + esc(m.text) + "</div></div>";
      return '<div class="msg ai"><div class="who">TRIUMPCODE</div>' + (m.tools && m.tools.length ? '<div class="tools">' + toolsHtml(m.tools) + "</div>" : "") + '<div class="body">' + fmt(m.text || "") + "</div></div>";
    }).join("");
    el.msgs.scrollTop = el.msgs.scrollHeight;
  }
  function setBusy(b) {
    S.busy = b; el.send.disabled = b; el.stop.style.display = b ? "" : "none"; el.input.disabled = b;
  }
  async function send() {
    var text = el.input.value.trim();
    if (!text || !S.p || S.busy) return;
    if (!S.user) { window.triumpSignIn(); return; }
    setBusy(true);
    el.input.value = "";
    S.p.chat = S.p.chat || [];
    S.p.chat.push({ role: "user", text: text });
    renderChat();
    var box = document.createElement("div"); box.className = "msg ai";
    box.innerHTML = '<div class="who">TRIUMPCODE <span class="dots"><i></i><i></i><i></i></span></div><div class="tools"></div><div class="body"></div>';
    el.msgs.appendChild(box);
    var toolsEl = $(".tools", box), bodyEl = $(".body", box), text2 = "", pending = null, anyChange = false, thinkEl = null, thinkBuf = "", doneTools = [];
    function scroll() { el.msgs.scrollTop = el.msgs.scrollHeight; }
    S.ac = new AbortController();
    var res = await TA.stream("/api/code/chat", { id: S.p.id, message: text }, function (ev) {
      if (ev.t === "start") TA.planBadge(el.plan, ev.plan);
      else if (ev.t === "thinking") {
        thinkBuf += ev.text;
        var last = thinkBuf.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/).filter(Boolean).pop() || "";
        if (!thinkEl) { thinkEl = document.createElement("div"); thinkEl.className = "thinking"; toolsEl.parentNode.insertBefore(thinkEl, toolsEl); }
        thinkEl.textContent = last.length > 140 ? last.slice(0, 138) + "…" : last; scroll();
      }
      else if (ev.t === "text") { text2 += ev.text; bodyEl.innerHTML = fmt(text2); if (thinkEl) { thinkEl.remove(); thinkEl = null; thinkBuf = ""; } scroll(); }
      else if (ev.t === "tool_start") {
        pending = document.createElement("div"); pending.className = "tool run";
        pending.innerHTML = '<span class="d"></span>' + esc(TOOL_RUN[ev.name] || "Working") + "…";
        toolsEl.appendChild(pending); scroll();
      } else if (ev.t === "tool") {
        if (thinkEl) { thinkEl.remove(); thinkEl = null; thinkBuf = ""; }
        var row = toolsEl.querySelector(".tool.run");
        if (row) row.remove();
        doneTools.push(ev);
        toolsEl.innerHTML = toolsHtml(doneTools) + TA.$$(".tool.run", toolsEl).map(function (x) { return x.outerHTML; }).join("");
        if (ev.changed) { S.changed[ev.changed] = true; anyChange = true; }
        scroll();
      } else if (ev.t === "error") { bodyEl.insertAdjacentHTML("beforeend", '<div style="color:var(--err);margin-top:6px">' + esc(ev.error) + "</div>"); }
    }, S.ac.signal);
    setBusy(false);
    var who = $(".who .dots", box); if (who) who.remove();
    if (res && res.error) { box.remove(); S.p.chat.pop(); renderChat(); el.input.value = text; res.quota ? TA.quotaMsg(res) : TA.toast(res.error, true); }
    if (res && res.aborted) TA.toast("Stopped.");
    // ambil state terbaru dari server (file + chat tersimpan)
    TA.api("/api/code/get?id=" + encodeURIComponent(S.p.id)).then(function (r) {
      if (!r.ok) return;
      var keep = S.changed;
      S.p = r.project; S.changed = keep;
      renderChat(); renderTree();
      if (S.file && S.p.files[S.file] !== undefined && !S.dirty) el.editor.value = S.p.files[S.file];
      if (anyChange) {
        setView("preview"); reloadPreview();
        if (window.innerWidth <= 900) { el.cw.dataset.tab = "preview"; TA.$$("button", el.mtabs).forEach(function (x) { x.classList.toggle("on", x.dataset.t === "preview"); }); }
      }
    });
    TA.refreshPlan(el.plan);
  }
  el.send.addEventListener("click", send);
  el.stop.addEventListener("click", function () { if (S.ac) S.ac.abort(); });
  el.input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  window.addEventListener("beforeunload", function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ""; } });

  function localStore(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

  /* ---------- login ---------- */
  var loaded = false;
  TA.onUser(function (u) {
    S.user = u;
    el.gate.classList.toggle("show", !u);
    if (u) { TA.refreshPlan(el.plan); if (!loaded) { loaded = true; loadProjects(); } }
    else { el.plan.style.display = "none"; }
  });
}());
