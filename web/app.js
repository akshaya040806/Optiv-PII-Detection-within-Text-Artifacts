const $ = (id) => document.getElementById(id);
const dz = $("dropzone"), fileInput = $("fileInput"), scanBtn = $("scanBtn");
let chosenFiles = [];

// scan state + human-review decisions (survive re-filtering and page refresh)
let DATA = null;
const reviews = {};          // id -> "confirmed" | "rejected"
let wired = false;
let curCleared = [], curQueue = [], activeIdx = -1;
let pfDocs = [];             // batch results, for the "open document" action
const LS_KEY = "piiScan";
const RISK_W = { Critical: 3, High: 2, Medium: 1 };
const RING_C = 326.7;        // 2·π·r, r=52
const OK_EXT = [".pdf", ".docx", ".pptx"];

function pick(list) {
  const files = [...list].filter((f) => OK_EXT.some((e) => f.name.toLowerCase().endsWith(e)));
  if (!files.length) { alert("Please choose .pdf, .docx or .pptx file(s)."); return; }
  chosenFiles = files;
  $("fileName").textContent = files.length === 1 ? files[0].name : `${files.length} files selected`;
  scanBtn.disabled = false;
  scanBtn.textContent = files.length > 1 ? `Scan & Redact (${files.length})` : "Scan & Redact";
}

dz.addEventListener("click", () => fileInput.click());
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
fileInput.addEventListener("change", (e) => pick(e.target.files));
dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("drag"); });
dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("drag"); pick(e.dataTransfer.files); });

function setStep(n) {
  document.querySelectorAll("#stepper .step").forEach((el, i) => {
    el.classList.toggle("done", i < n); el.classList.toggle("active", i === n);
  });
}

// ───────── scan one file: stream its live stages, return the parsed result ─────────
async function scanOne(file, tag) {
  setStep(0);
  const fd = new FormData(); fd.append("file", file); fd.append("ner", $("ner").value);
  const res = await fetch("/scan", { method: "POST", body: fd });
  if (!res.ok) { let e; try { e = await res.json(); } catch (_) { e = { error: "Request failed (" + res.status + ")" }; } throw new Error(e.error || "Request failed"); }
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
      const t = line.slice(0, 2), rest = line.slice(2);
      if (t === "P:") {
        $("loadingStage").textContent = (tag ? `[${tag}] ` : "") + rest;
        if (rest.includes("Stage 1")) setStep(0);
        else if (rest.includes("Stage 2")) setStep(1);
        else if (rest.includes("Stage 3")) setStep(2);
        else if (rest.includes("gate") || rest.includes("re-OCR")) setStep(3);
        else if (rest.includes("Stage 4")) setStep(4);
      } else if (t === "R:") result = JSON.parse(rest);
      else if (t === "E:") err = JSON.parse(rest);
    }
  }
  setStep(4);
  if (err) throw new Error(err.error + (err.log ? "\n\n" + err.log : ""));
  if (!result) throw new Error("No result returned by the server.");
  return result;
}

scanBtn.addEventListener("click", async () => {
  if (!chosenFiles.length) return;
  $("results").classList.add("hidden");
  $("portfolio").classList.add("hidden");
  $("errorBox").classList.add("hidden");
  $("loading").classList.remove("hidden");
  const files = chosenFiles;

  if (files.length === 1) {
    $("loadingText").textContent = files[0].name.toLowerCase().endsWith(".pdf")
      ? "OCR + detecting + redacting + verifying…" : "Extracting → detecting → redacting → verifying…";
    $("loadingStage").textContent = "starting…";
    try { const r = await scanOne(files[0]); $("loading").classList.add("hidden"); render(r); }
    catch (e) { $("loading").classList.add("hidden"); showError(e.message); }
    return;
  }

  // batch
  const docs = [];
  for (let i = 0; i < files.length; i++) {
    $("loadingText").textContent = `Scanning document ${i + 1} of ${files.length}`;
    $("loadingStage").textContent = files[i].name;
    try { docs.push({ name: files[i].name, res: await scanOne(files[i], `${i + 1}/${files.length}`) }); }
    catch (e) { docs.push({ name: files[i].name, err: e.message || String(e) }); }
  }
  $("loading").classList.add("hidden");
  renderPortfolio(docs);
});

function showError(msg) { const e = $("errorBox"); e.textContent = msg; e.classList.remove("hidden"); }
function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function riskOf(a) { return a.reduce((s, r) => s + (RISK_W[r.tier] || 0), 0); }
function tierCounts(a) { const t = { Critical: 0, High: 0, Medium: 0 }; a.forEach((r) => { if (t[r.tier] !== undefined) t[r.tier]++; }); return t; }

// ───────── batch / portfolio dashboard ─────────
function renderPortfolio(docs) {
  const ok = docs.filter((d) => d.res);
  ok.forEach((d) => { d.audit = d.res.audit; d.risk = riskOf(d.audit); d.tiers = tierCounts(d.audit); });
  ok.sort((a, b) => b.risk - a.risk);
  pfDocs = ok;

  const agg = {
    docs: docs.length, findings: ok.reduce((s, d) => s + d.audit.length, 0),
    people: ok.reduce((s, d) => s + d.res.people, 0), sealed: ok.reduce((s, d) => s + d.res.sealed, 0),
    residual: ok.reduce((s, d) => s + d.res.residual, 0), risk: ok.reduce((s, d) => s + d.risk, 0),
  };
  const bb = $("batchBanner");
  if (agg.residual === 0) { bb.className = "banner ok"; bb.textContent = `✅  Batch gate PASSED — ${agg.docs} document(s) redacted, 0 residual leaks across the portfolio.`; }
  else { bb.className = "banner bad"; bb.textContent = `❌  ${agg.residual} residual leak(s) across ${agg.docs} document(s).`; }

  $("pfKpis").innerHTML = [
    ["documents", agg.docs, ""], ["total findings", agg.findings, ""], ["people (per-doc sum)", agg.people, ""],
    ["regions sealed", agg.sealed, ""], ["residual leaks", agg.residual, agg.residual ? "" : "ok"], ["total risk", agg.risk, ""],
  ].map(([l, v, c]) => `<div class="kpi"><div class="kpi-num ${c}">${v}</div><div class="kpi-lbl">${l}</div></div>`).join("");

  const maxT = Math.max(1, ...ok.flatMap((d) => [d.tiers.Critical, d.tiers.High, d.tiers.Medium]));
  const hm = (n, rgb) => `<td class="hm" style="background:rgba(${rgb},${(n / maxT * 0.8).toFixed(3)})">${n || ""}</td>`;
  const rows = ok.map((d, i) => `<tr class="pfrow" data-i="${i}">
    <td class="pfname">${esc(d.name)}</td><td>${d.audit.length}</td>
    ${hm(d.tiers.Critical, "255,107,107")}${hm(d.tiers.High, "255,180,88")}${hm(d.tiers.Medium, "230,195,77")}
    <td><b>${d.risk}</b></td>
    <td>${d.res.residual === 0 ? '<span class="pill ok">PASSED</span>' : '<span class="pill bad">' + d.res.residual + ' leak</span>'}</td></tr>`).join("");
  const errRows = docs.filter((d) => d.err).map((d) =>
    `<tr><td class="pfname">${esc(d.name)}</td><td colspan="6" class="pferr">failed — ${esc(d.err)}</td></tr>`).join("");
  $("portfolioTable").querySelector("tbody").innerHTML = rows + errRows;

  if (!renderPortfolio.wired) {
    renderPortfolio.wired = true;
    $("portfolioTable").querySelector("tbody").addEventListener("click", (e) => {
      const tr = e.target.closest(".pfrow"); if (!tr) return;
      render(pfDocs[+tr.getAttribute("data-i")].res);
    });
  }
  $("portfolio").classList.remove("hidden");
  $("portfolio").scrollIntoView({ behavior: "smooth" });
}

// ───────── render a single document's results ─────────
function render(d, keepReviews) {
  DATA = d;
  d.audit.forEach((r, i) => { r._id = i; r._conf = parseFloat(r.confidence) || 0; });
  if (!keepReviews) for (const k in reviews) delete reviews[k];
  activeIdx = -1;

  const b = $("gateBanner");
  if (d.residual === 0) { b.className = "banner ok"; b.textContent = "✅  Leakage gate PASSED — 0 PII values survive in the redacted output (independently verified)."; }
  else { b.className = "banner bad"; b.textContent = "❌  Leakage gate FAILED — " + d.residual + " residual leak(s) found."; }

  $("dlMasked").href = "/download/" + d.sid;
  $("dlMasked").style.display = d.masked_name ? "flex" : "none";
  $("dlInv").href = "/download/" + d.sid + "/inventory";

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

function apply() {
  if (!DATA) return;
  const G = +$("confSlider").value;
  const tiers = selected("tierChk"), catsSel = selected("catChk");
  const labeling = $("reviewToggle").checked;
  const q = ($("searchBox").value || "").trim().toLowerCase();
  const over = {};
  document.querySelectorAll(".catThresh").forEach((i) => { const v = parseFloat(i.value); if (!isNaN(v)) over[i.dataset.cat] = v; });
  const thr = (cat) => (cat in over ? over[cat] : G);

  const match = (r) => !q || (r.token + " " + r.rule + " " + r.location + " " + r.category).toLowerCase().includes(q);
  const base = DATA.audit.filter((r) => tiers.has(r.tier) && catsSel.has(r.category) && match(r));
  curCleared = base.filter((r) => r._conf >= thr(r.category));
  curQueue = labeling ? base.filter((r) => r._conf < thr(r.category)) : [];

  const risk = curCleared.reduce((s, r) => s + (RISK_W[r.tier] || 0), 0);
  const nC = curCleared.filter((r) => r.tier === "Critical").length;
  const nH = curCleared.filter((r) => r.tier === "High").length;
  const sev = curCleared.length ? (nC + nH) / curCleared.length : 0;
  $("mRisk").textContent = risk;
  $("riskRing").style.strokeDashoffset = RING_C * (1 - sev);
  $("riskCard").className = "kpi kpi-risk " + (nC ? "r-crit" : nH ? "r-high" : "r-ok");
  $("riskLvl").textContent = nC ? "critical" : nH ? "elevated" : "low";
  $("mFindings").textContent = curCleared.length;
  $("mPeople").textContent = DATA.people;
  $("mSealed").textContent = DATA.sealed;
  $("mResidual").textContent = DATA.residual;

  const anyOver = Object.keys(over).length;
  $("summary").innerHTML = `Showing <b>${curCleared.length}</b> of <b>${DATA.audit.length}</b> findings at `
    + `&ge; <b>${G.toFixed(2)}</b> confidence` + (anyOver ? ` (+${anyOver} category override${anyOver > 1 ? "s" : ""})` : "")
    + (labeling ? ` · <b>${curQueue.length}</b> queued for human review.` : ".");

  const byCat = {};
  curCleared.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + 1; });
  const rows = Object.entries(byCat).sort((a, c) => c[1] - a[1]);
  const max = Math.max(1, ...rows.map((c) => c[1]));
  $("chart").innerHTML = rows.map(([name, n]) => `
    <div class="bar-row"><span>${name}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span>
      <span class="bar-val">${n}</span></div>`).join("") || "<p class='note'>No findings match the current filters.</p>";
  const t = tierCounts(curCleared);
  $("tiers").innerHTML = `<div class="tier crit"><b>${t.Critical}</b>Critical</div>
    <div class="tier high"><b>${t.High}</b>High</div><div class="tier med"><b>${t.Medium}</b>Medium</div>`;

  renderAudit(curCleared);
  $("queueCard").style.display = labeling ? "block" : "none";
  renderQueue(curQueue, G);
}

function rowCells(r) {
  return `<td>${r.category}</td><td>${r.tier}</td><td class="tok">${r.token}</td>
    <td>${r.rule}</td><td>${r.location}</td><td>${r._conf.toFixed(2)}</td>`;
}
function detail(r, cols) {
  const s = r.snippet ? esc(r.snippet) : "<i>no context captured</i>";
  return `<tr class="detail hidden"><td colspan="${cols}"><div class="snip"><b>context:</b> …${s}…</div></td></tr>`;
}
function renderAudit(cleared) {
  document.querySelector("#auditTable tbody").innerHTML = cleared.map((r) =>
    `<tr class="arow" data-id="${r._id}">${rowCells(r)}</tr>${detail(r, 6)}`).join("");
}
function renderQueue(queue, T) {
  $("queueSub").textContent = `${queue.length} finding(s) below threshold`;
  const tb = document.querySelector("#queueTable tbody");
  if (!queue.length) { tb.innerHTML = `<tr><td colspan="7" class="queue-empty">Nothing below the threshold — the report is fully auto-cleared.</td></tr>`; return; }
  tb.innerHTML = queue.map((r, i) => {
    const st = reviews[r._id] || "";
    return `<tr class="qrow ${st}" data-id="${r._id}" data-idx="${i}">${rowCells(r)}
      <td><div class="dec">
        <button class="dec-btn ok" data-dec="confirmed">✓ Confirm</button>
        <button class="dec-btn no" data-dec="rejected">✗ Not PII</button>
      </div></td></tr>${detail(r, 7)}`;
  }).join("");
  if (activeIdx >= queue.length) activeIdx = queue.length - 1;
  highlightActive();
}

function toggleSnippet(e, kind) {
  if (e.target.closest(".dec-btn")) return;
  const tr = e.target.closest(kind === "a" ? ".arow" : ".qrow");
  if (!tr) return;
  const d = tr.nextElementSibling;
  if (d && d.classList.contains("detail")) d.classList.toggle("hidden");
}
function onQueueClick(e) {
  const btn = e.target.closest(".dec-btn");
  if (btn) { decide(btn.closest("tr").getAttribute("data-id"), btn.getAttribute("data-dec")); return; }
  toggleSnippet(e, "q");
}
function decide(id, dec) {
  reviews[id] = reviews[id] === dec ? undefined : dec;
  if (reviews[id] === undefined) delete reviews[id];
  save(); apply();
}
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

function resetFilters() {
  $("confSlider").value = 0.8; $("confVal").textContent = "0.80";
  $("searchBox").value = "";
  document.querySelectorAll(".tierChk, .catChk").forEach((c) => (c.checked = true));
  document.querySelectorAll(".catThresh").forEach((c) => (c.value = ""));
  $("reviewToggle").checked = true;
  apply();
}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify({ data: DATA, reviews })); } catch (_) {} }
function clearSaved() { try { localStorage.removeItem(LS_KEY); } catch (_) {} location.reload(); }
(function boot() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || "null");
    if (s && s.data && s.data.audit) { Object.assign(reviews, s.reviews || {}); render(s.data, true); }
  } catch (_) {}
})();
