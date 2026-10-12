const $ = (id) => document.getElementById(id);
const dz = $("dropzone"), fileInput = $("fileInput"), scanBtn = $("scanBtn");
let chosen = null;

// scan state + human-review decisions (survive re-filtering and page refresh)
let DATA = null;
const reviews = {};          // id -> "confirmed" | "rejected"
let wired = false;
let curCleared = [], curQueue = [], activeIdx = -1;
const LS_KEY = "piiScan";
const RISK_W = { Critical: 3, High: 2, Medium: 1 };

function pick(file) {
  if (!file) return;
  const ok = [".pdf", ".docx", ".pptx"].some((e) => file.name.toLowerCase().endsWith(e));
  if (!ok) { alert("Please choose a .pdf, .docx or .pptx file."); return; }
  chosen = file;
  $("fileName").textContent = file.name;
  scanBtn.disabled = false;
}

dz.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", (e) => pick(e.target.files[0]));
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => {
  e.preventDefault(); dz.classList.remove("drag");
  pick(e.dataTransfer.files[0]);
});

// ───────── scan: stream the pipeline's live stage output, then render ─────────
scanBtn.addEventListener("click", async () => {
  if (!chosen) return;
  $("results").classList.add("hidden");
  $("errorBox").classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("loadingText").textContent = chosen.name.toLowerCase().endsWith(".pdf")
    ? "OCR + detecting + redacting + verifying… (a scanned PDF can take a few minutes)"
    : "Extracting → detecting → redacting → verifying…";
  $("loadingStage").textContent = "starting…";

  const fd = new FormData();
  fd.append("file", chosen);
  fd.append("ner", $("ner").value);

  try {
    const res = await fetch("/scan", { method: "POST", body: fd });
    if (!res.ok) {
      let e; try { e = await res.json(); } catch (_) { e = { error: "Request failed (" + res.status + ")" }; }
      $("loading").classList.add("hidden"); showError(e.error || "Request failed"); return;
    }
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "", result = null, err = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line) continue;
        const tag = line.slice(0, 2), rest = line.slice(2);
        if (tag === "P:") $("loadingStage").textContent = rest;
        else if (tag === "R:") result = JSON.parse(rest);
        else if (tag === "E:") err = JSON.parse(rest);
      }
    }
    $("loading").classList.add("hidden");
    if (err) showError(err.error + (err.log ? "\n\n" + err.log : ""));
    else if (result) render(result);
    else showError("No result returned by the server.");
  } catch (e) {
    $("loading").classList.add("hidden");
    showError("Request failed: " + e.message);
  }
});

function showError(msg) {
  const e = $("errorBox"); e.textContent = msg; e.classList.remove("hidden");
}

// ───────── render after a scan (or a restored session) ─────────
function render(d, keepReviews) {
  DATA = d;
  d.audit.forEach((r, i) => { r._id = i; r._conf = parseFloat(r.confidence) || 0; });
  if (!keepReviews) for (const k in reviews) delete reviews[k];
  activeIdx = -1;

  // gate banner (independent of filters)
  const b = $("gateBanner");
  if (d.residual === 0) {
    b.className = "banner ok";
    b.textContent = "✅  Leakage gate PASSED — 0 PII values survive in the redacted output (independently verified).";
  } else {
    b.className = "banner bad";
    b.textContent = "❌  Leakage gate FAILED — " + d.residual + " residual leak(s) found.";
  }

  // downloads (valid only while the server session is alive)
  $("dlMasked").href = "/download/" + d.sid;
  $("dlMasked").style.display = d.masked_name ? "block" : "none";
  $("dlInv").href = "/download/" + d.sid + "/inventory";

  // per-category checkboxes + optional threshold overrides
  const cats = {};
  d.audit.forEach((r) => { cats[r.category] = (cats[r.category] || 0) + 1; });
  $("catList").innerHTML = Object.entries(cats).sort((a, c) => c[1] - a[1]).map(([name, n]) => `
    <label class="chk catrow"><input type="checkbox" class="catChk" value="${name}" checked />
      <span class="cname">${name}</span><span class="cnt">${n}</span>
      <input type="number" class="catThresh" data-cat="${name}" min="0.5" max="1" step="0.05" placeholder="—" title="override threshold for ${name}" /></label>`).join("");

  $("sidePre").classList.add("hidden");
  $("sideControls").classList.remove("hidden");

  if (!wired) {
    wired = true;
    $("confSlider").addEventListener("input", () => { $("confVal").textContent = (+$("confSlider").value).toFixed(2); apply(); });
    document.querySelectorAll(".tierChk").forEach((c) => c.addEventListener("change", apply));
    $("reviewToggle").addEventListener("change", apply);
    $("searchBox").addEventListener("input", apply);
    $("resetFilters").addEventListener("click", resetFilters);
    $("clearSaved").addEventListener("click", clearSaved);
    $("exportLabels").addEventListener("click", (e) => { e.preventDefault(); exportCsv(queueLabelRows(), "human_review_labels.csv"); });
    $("exportFiltered").addEventListener("click", (e) => { e.preventDefault(); exportCsv(clearedRows(), "pii_filtered.csv"); });
    $("auditTable").querySelector("tbody").addEventListener("click", (e) => toggleSnippet(e, "a"));
    $("queueTable").querySelector("tbody").addEventListener("click", onQueueClick);
    document.addEventListener("keydown", onKey);
  }
  document.querySelectorAll(".catChk, .catThresh").forEach((c) => c.addEventListener("input", apply));

  $("results").classList.remove("hidden");
  apply();
  save();
  $("results").scrollIntoView({ behavior: "smooth" });
}

function selected(cls) {
  return new Set([...document.querySelectorAll("." + cls)].filter((c) => c.checked).map((c) => c.value));
}

// ───────── filter engine: search + tier + per-category threshold → report + queue ─────────
function apply() {
  if (!DATA) return;
  const G = +$("confSlider").value;
  const tiers = selected("tierChk");
  const catsSel = selected("catChk");
  const labeling = $("reviewToggle").checked;
  const q = ($("searchBox").value || "").trim().toLowerCase();

  const over = {};
  document.querySelectorAll(".catThresh").forEach((i) => { const v = parseFloat(i.value); if (!isNaN(v)) over[i.dataset.cat] = v; });
  const thr = (cat) => (cat in over ? over[cat] : G);

  const match = (r) => !q || (r.token + " " + r.rule + " " + r.location + " " + r.category).toLowerCase().includes(q);
  const base = DATA.audit.filter((r) => tiers.has(r.tier) && catsSel.has(r.category) && match(r));
  curCleared = base.filter((r) => r._conf >= thr(r.category));
  curQueue = labeling ? base.filter((r) => r._conf < thr(r.category)) : [];

  // risk score + metrics
  const risk = curCleared.reduce((s, r) => s + (RISK_W[r.tier] || 0), 0);
  $("mRisk").textContent = risk;
  const rc = $("riskCard"); rc.className = "metric risk " +
    (curCleared.some((r) => r.tier === "Critical") ? "r-crit" : curCleared.some((r) => r.tier === "High") ? "r-high" : "r-ok");
  $("mFindings").textContent = curCleared.length;
  $("mPeople").textContent = DATA.people;
  $("mSealed").textContent = DATA.sealed;
  $("mResidual").textContent = DATA.residual;
  const anyOver = Object.keys(over).length;
  $("summary").innerHTML = `Showing <b>${curCleared.length}</b> of <b>${DATA.audit.length}</b> findings at `
    + `&ge; <b>${G.toFixed(2)}</b> confidence` + (anyOver ? ` (+${anyOver} category override${anyOver > 1 ? "s" : ""})` : "")
    + (labeling ? ` · <b>${curQueue.length}</b> queued for human review.` : ".");

  // chart (by category) + tier chips, over the cleared set
  const byCat = {};
  curCleared.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + 1; });
  const rows = Object.entries(byCat).sort((a, c) => c[1] - a[1]);
  const max = Math.max(1, ...rows.map((c) => c[1]));
  $("chart").innerHTML = rows.map(([name, n]) => `
    <div class="bar-row"><span>${name}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span>
      <span class="bar-val">${n}</span></div>`).join("") || "<p class='note'>No findings match the current filters.</p>";
  const t = { Critical: 0, High: 0, Medium: 0 };
  curCleared.forEach((r) => { if (t[r.tier] !== undefined) t[r.tier]++; });
  $("tiers").innerHTML = `<div class="tier crit"><b>${t.Critical}</b>Critical</div>
    <div class="tier high"><b>${t.High}</b>High</div><div class="tier med"><b>${t.Medium}</b>Medium</div>`;

  renderAudit(curCleared);
  $("queueCard").style.display = labeling ? "block" : "none";
  renderQueue(curQueue, G);
}

function row(r) {
  return `<td>${r.category}</td><td>${r.tier}</td><td class="tok">${r.token}</td>
    <td>${r.rule}</td><td>${r.location}</td><td>${r._conf.toFixed(2)}</td>`;
}
function detail(r, cols) {
  const s = r.snippet ? esc(r.snippet) : "<i>no context captured</i>";
  return `<tr class="detail hidden"><td colspan="${cols}"><div class="snip"><b>context:</b> …${s}…</div></td></tr>`;
}
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderAudit(cleared) {
  document.querySelector("#auditTable tbody").innerHTML = cleared.map((r) =>
    `<tr class="arow" data-id="${r._id}">${row(r)}</tr>${detail(r, 6)}`).join("");
}

function renderQueue(queue, T) {
  $("queueSub").innerHTML = `&mdash; ${queue.length} finding(s) below threshold`;
  const tb = document.querySelector("#queueTable tbody");
  if (!queue.length) {
    tb.innerHTML = `<tr><td colspan="7" class="queue-empty">Nothing below the threshold — the report is fully auto-cleared.</td></tr>`;
    return;
  }
  tb.innerHTML = queue.map((r, i) => {
    const st = reviews[r._id] || "";
    return `<tr class="qrow ${st}" data-id="${r._id}" data-idx="${i}">${row(r)}
      <td><div class="dec">
        <button class="dec-btn ok" data-dec="confirmed">✓ Confirm</button>
        <button class="dec-btn no" data-dec="rejected">✗ Not PII</button>
      </div></td></tr>${detail(r, 7)}`;
  }).join("");
  if (activeIdx >= queue.length) activeIdx = queue.length - 1;
  highlightActive();
}

// click a row (not a button) to expand its masked context
function toggleSnippet(e, kind) {
  if (e.target.closest(".dec-btn")) return;
  const tr = e.target.closest(kind === "a" ? ".arow" : ".qrow");
  if (!tr) return;
  const d = tr.nextElementSibling;
  if (d && d.classList.contains("detail")) d.classList.toggle("hidden");
}

function onQueueClick(e) {
  const btn = e.target.closest(".dec-btn");
  if (btn) {
    const id = btn.closest("tr").getAttribute("data-id");
    decide(id, btn.getAttribute("data-dec"));
    return;
  }
  toggleSnippet(e, "q");
}

function decide(id, dec) {
  reviews[id] = reviews[id] === dec ? undefined : dec;
  if (reviews[id] === undefined) delete reviews[id];
  save();
  apply();
}

// ───────── keyboard review: ↑/↓ move, A confirm, R reject ─────────
function highlightActive() {
  document.querySelectorAll("#queueTable .qrow").forEach((tr) => tr.classList.remove("active"));
  if (activeIdx < 0) return;
  const tr = document.querySelector(`#queueTable .qrow[data-idx="${activeIdx}"]`);
  if (tr) { tr.classList.add("active"); tr.scrollIntoView({ block: "nearest" }); }
}
function onKey(e) {
  const tag = (e.target.tagName || "").toLowerCase();
  if (["input", "textarea", "select"].includes(tag)) return;
  if (!$("reviewToggle").checked || !curQueue.length) return;
  const k = e.key.toLowerCase();
  if (k === "arrowdown" || k === "j") { activeIdx = Math.min(curQueue.length - 1, activeIdx + 1); highlightActive(); e.preventDefault(); }
  else if (k === "arrowup" || k === "k") { activeIdx = Math.max(0, activeIdx - 1); highlightActive(); e.preventDefault(); }
  else if (k === "a" || k === "r") {
    if (activeIdx < 0) activeIdx = 0;
    const r = curQueue[activeIdx];
    if (r) { const keep = activeIdx; decide(r._id, k === "a" ? "confirmed" : "rejected"); activeIdx = Math.min(curQueue.length - 1, keep + 1); highlightActive(); }
    e.preventDefault();
  }
}

// ───────── CSV exports ─────────
function clearedRows() {
  const out = [["token", "category", "tier", "location", "confidence", "rule"]];
  curCleared.forEach((r) => out.push([r.token, r.category, r.tier, r.location, r._conf.toFixed(2), r.rule]));
  return out;
}
function queueLabelRows() {
  const out = [["token", "category", "tier", "location", "confidence", "rule", "human_label"]];
  curQueue.forEach((r) => out.push([r.token, r.category, r.tier, r.location, r._conf.toFixed(2), r.rule, reviews[r._id] || "pending"]));
  return out;
}
function exportCsv(rows2d, name) {
  const csv = rows2d.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ───────── filters reset + session persistence ─────────
function resetFilters() {
  $("confSlider").value = 0.8; $("confVal").textContent = "0.80";
  $("searchBox").value = "";
  document.querySelectorAll(".tierChk, .catChk").forEach((c) => (c.checked = true));
  document.querySelectorAll(".catThresh").forEach((c) => (c.value = ""));
  $("reviewToggle").checked = true;
  apply();
}
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ data: DATA, reviews })); } catch (_) {}
}
function clearSaved() {
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
  location.reload();
}
(function boot() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (s && s.data && s.data.audit) { Object.assign(reviews, s.reviews || {}); render(s.data, true); }
  } catch (_) {}
})();
