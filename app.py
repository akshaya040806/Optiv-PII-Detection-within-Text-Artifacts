"""Streamlit UI for the Cadence PII detection & redaction gate.

Upload a PDF / Word / PowerPoint file -> the pipeline extracts text, detects & classifies PII,
redacts it (fail-closed), and an independent gate verifies nothing leaked. You get the redacted
file plus an audit inventory. The UI shows TOKENS, never the raw PII.

Run:  streamlit run app.py
"""
import csv
import glob
import json
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

import pandas as pd
import streamlit as st

HERE = Path(__file__).parent
DEFAULT_TESS = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
_pop = glob.glob(r"C:\poppler*\**\pdftoppm.exe", recursive=True)
DEFAULT_POPPLER = str(Path(_pop[0]).parent) if _pop else ""

st.set_page_config(page_title="Cadence PII Gate", page_icon="🛡️", layout="wide")

st.title("🛡️ Cadence PII Detection & Redaction Gate")
st.caption("Strip every piece of personal data out of a document — and prove nothing leaked — "
           "before it ever reaches an AI model.")

with st.expander("How it works"):
    st.markdown(
        "1. **Extract** text (OCR for scanned PDFs; native text + screenshots for Office files)\n"
        "2. **Detect & classify** PII — deterministic rules + checksums for IDs, ML NER for names\n"
        "3. **Redact** — replace PII with stable tokens; **seal** figures & PII-heavy tables we can't verify\n"
        "4. **Verify** — an independent gate re-reads (and re-OCRs) the output and asserts **0 PII survives**\n\n"
        "_This UI never shows the raw PII — only the tokens that replaced it._")

with st.sidebar:
    st.header("⚙️ Settings")
    tess = st.text_input("Tesseract path", DEFAULT_TESS)
    poppler = st.text_input("Poppler bin folder", DEFAULT_POPPLER)
    ner = st.selectbox("Name-detection model",
                       ["en_core_web_sm (fast)", "en_core_web_trf (stronger, slower)"], 0)
    ner_model = ner.split()[0]
    st.caption("⏱️ PDFs are OCR'd page-by-page and can take a few minutes. Office files are quick.")

uploaded = st.file_uploader("Upload a PDF, Word (.docx) or PowerPoint (.pptx) file",
                            type=["pdf", "docx", "pptx"])

if uploaded and st.button("🔍 Scan & Redact", type="primary"):
    work = Path(tempfile.mkdtemp(prefix="pii_ui_"))
    inp = work / uploaded.name
    inp.write_bytes(uploaded.getbuffer())
    outdir = work / "out"
    cmd = [sys.executable, str(HERE / "pipeline.py"), "--file", str(inp), "--out", str(outdir),
           "--ner-model", ner_model, "--no-gui"]
    if tess:
        cmd += ["--tesseract", tess]
    if poppler:
        cmd += ["--poppler", poppler]

    with st.spinner("Extracting → detecting → redacting → verifying…"):
        r = subprocess.run(cmd, capture_output=True, text=True)

    if r.returncode != 0:
        st.error("Pipeline failed.")
        st.code((r.stderr or r.stdout)[-3000:])
        st.stop()

    metrics = json.load(open(outdir / "metrics.json", encoding="utf-8"))
    rows = list(csv.DictReader(open(outdir / "pii_inventory.csv", encoding="utf-8-sig")))
    masked = next((p for p in outdir.glob("*_MASKED.*")), None)
    leaked = metrics.get("residual_leak_count", 0)

    # headline verification banner
    if leaked == 0:
        st.success("✅ **Leakage gate PASSED** — 0 PII values survive in the redacted output "
                   "(independently verified).")
    else:
        st.error(f"❌ **Leakage gate FAILED** — {leaked} residual leak(s) found.")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("PII findings", len(rows))
    c2.metric("Unique people", metrics.get("unique_people", 0))
    c3.metric("Regions sealed", len(metrics.get("figure_redactions", [])))
    c4.metric("Residual leaks", leaked)

    tab1, tab2, tab3 = st.tabs(["📊 What we found", "⬇️ Download", "🧾 Audit trail"])

    with tab1:
        by_cat = Counter(r["category"] for r in rows)
        if by_cat:
            df = pd.DataFrame(sorted(by_cat.items(), key=lambda x: -x[1]),
                              columns=["PII category", "count"]).set_index("PII category")
            st.bar_chart(df)
        tiers = Counter(r["tier"] for r in rows)
        t1, t2, t3 = st.columns(3)
        t1.metric("🔴 Critical", tiers.get("Critical", 0))
        t2.metric("🟠 High", tiers.get("High", 0))
        t3.metric("🟡 Medium", tiers.get("Medium", 0))

    with tab2:
        if masked:
            st.download_button(f"⬇️ Download redacted file ({masked.name})",
                               masked.read_bytes(), masked.name)
        st.download_button("⬇️ Download PII inventory (CSV)",
                           (outdir / "pii_inventory.csv").read_bytes(), "pii_inventory.csv")
        st.info("The redacted file is safe to send to an LLM. Keep `person_token_map.csv` "
                "(the re-identification key) private — it is not downloadable here on purpose.")

    with tab3:
        st.caption("Every finding is traceable — shown by **token**, never raw value.")
        safe = [{"category": r["category"], "tier": r["tier"], "token": r["token"],
                 "rule": r["rule"], "location": r["location"], "confidence": r["confidence"]}
                for r in rows]
        st.dataframe(pd.DataFrame(safe), use_container_width=True, height=360)

    with st.expander("Pipeline log"):
        st.code(r.stdout[-4000:] or "(no output)")
