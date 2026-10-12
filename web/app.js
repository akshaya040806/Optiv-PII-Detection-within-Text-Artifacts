const $ = (id) => document.getElementById(id);
const dz = $("dropzone"), fileInput = $("fileInput"), scanBtn = $("scanBtn");
let chosen = null;

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

scanBtn.addEventListener("click", async () => {
  if (!chosen) return;
  $("results").classList.add("hidden");
  $("errorBox").classList.add("hidden");
  $("loading").classList.remove("hidden");
  $("loadingText").textContent = chosen.name.toLowerCase().endsWith(".pdf")
    ? "OCR + detecting + redacting + verifying… (a scanned PDF can take a few minutes)"
    : "Extracting → detecting → redacting → verifying…";

  const fd = new FormData();
  fd.append("file", chosen);
  fd.append("ner", $("ner").value);

  try {
    const res = await fetch("/scan", { method: "POST", body: fd });
    const data = await res.json();
    $("loading").classList.add("hidden");
    if (!res.ok) { showError(data.error + (data.log ? "\n\n" + data.log : "")); return; }
    render(data);
  } catch (err) {
    $("loading").classList.add("hidden");
    showError("Request failed: " + err.message);
  }
});

function showError(msg) {
  const e = $("errorBox");
  e.textContent = msg;
  e.classList.remove("hidden");
}

function render(d) {
  // gate banner
  const b = $("gateBanner");
  if (d.residual === 0) {
    b.className = "banner ok";
    b.textContent = "✅  Leakage gate PASSED — 0 PII values survive in the redacted output (independently verified).";
  } else {
    b.className = "banner bad";
    b.textContent = "❌  Leakage gate FAILED — " + d.residual + " residual leak(s) found.";
  }

  $("mFindings").textContent = d.findings;
  $("mPeople").textContent = d.people;
  $("mSealed").textContent = d.sealed;
  $("mResidual").textContent = d.residual;

  // category chart
  const cats = Object.entries(d.by_category).sort((a, b2) => b2[1] - a[1]);
  const max = Math.max(1, ...cats.map((c) => c[1]));
  $("chart").innerHTML = cats.map(([name, n]) => `
    <div class="bar-row">
      <span>${name}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span>
      <span class="bar-val">${n}</span>
    </div>`).join("") || "<p class='note'>No PII found.</p>";

  const t = d.by_tier || {};
  $("tiers").innerHTML = `
    <div class="tier crit"><b>${t.Critical || 0}</b>Critical</div>
    <div class="tier high"><b>${t.High || 0}</b>High</div>
    <div class="tier med"><b>${t.Medium || 0}</b>Medium</div>`;

  // downloads
  $("dlMasked").href = "/download/" + d.sid;
  $("dlMasked").style.display = d.masked_name ? "block" : "none";
  $("dlInv").href = "/download/" + d.sid + "/inventory";

  // audit table
  const tb = document.querySelector("#auditTable tbody");
  tb.innerHTML = d.audit.map((r) => `
    <tr>
      <td>${r.category}</td><td>${r.tier}</td>
      <td class="tok">${r.token}</td>
      <td>${r.rule}</td><td>${r.location}</td><td>${r.confidence}</td>
    </tr>`).join("");

  $("results").classList.remove("hidden");
  $("results").scrollIntoView({ behavior: "smooth" });
}
