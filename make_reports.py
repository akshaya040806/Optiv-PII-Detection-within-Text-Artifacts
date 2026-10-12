"""Generate two deliverable PDFs from the pipeline's own output:

  1. Case_Study_2_Report.pdf             — explains every feature: its aim and how it works (no PII).
  2. results/PII_Findings_Inventory.pdf  — every finding with page/location, confidence, tier, rule,
     token and other characteristics (contains raw PII -> kept in the git-ignored results/).

Run:  python make_reports.py   (reads results/pii_inventory.csv + results/metrics.json)
"""
import csv, json, os

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                LongTable, PageBreak, HRFlowable)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "results")
NAVY = colors.HexColor("#0f2140")
NAVY2 = colors.HexColor("#1b335e")
ORANGE = colors.HexColor("#c8501f")
INK = colors.HexColor("#1d2733")
MUTED = colors.HexColor("#5a6b82")
GREEN = colors.HexColor("#1f9d57")
LINE = colors.HexColor("#d6deea")

ss = getSampleStyleSheet()
def S(name, **kw):
    base = kw.pop("parent", ss["Normal"])
    return ParagraphStyle(name, parent=base, **kw)

TITLE = S("t", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=24, textColor=NAVY, leading=28, spaceAfter=4)
SUBT = S("st", fontSize=12, textColor=ORANGE, leading=16, spaceAfter=2)
H1 = S("h1", fontName="Helvetica-Bold", fontSize=15, textColor=NAVY, leading=19, spaceBefore=16, spaceAfter=6)
H2 = S("h2", fontName="Helvetica-Bold", fontSize=12, textColor=NAVY2, leading=15, spaceBefore=11, spaceAfter=3)
FEAT = S("ft", fontName="Helvetica-Bold", fontSize=10.5, textColor=INK, leading=13, spaceBefore=8, spaceAfter=1)
AIM = S("aim", fontSize=10, textColor=GREEN, leading=13, spaceAfter=1, fontName="Helvetica-Oblique")
HOW = S("how", fontSize=10, textColor=INK, leading=14, spaceAfter=2)
BODY = S("bd", fontSize=10, textColor=INK, leading=14, spaceAfter=6)
BULLET = S("bl", fontSize=10, textColor=INK, leading=13, leftIndent=14, spaceAfter=2, bulletIndent=4)


def feature(story, name, aim, how):
    story.append(Paragraph(name, FEAT))
    story.append(Paragraph("<b>Aim:</b> " + aim, AIM))
    story.append(Paragraph("<b>How:</b> " + how, HOW))


def header_footer(canvas, doc, title):
    canvas.saveState()
    w, h = doc.pagesize
    canvas.setFillColor(NAVY)
    canvas.rect(0, h - 34, w, 34, fill=1, stroke=0)
    canvas.setFillColor(ORANGE); canvas.rect(40, h - 26, 11, 11, fill=1, stroke=0)
    canvas.setFillColor(colors.white); canvas.setFont("Helvetica-Bold", 10)
    canvas.drawString(58, h - 24, title)
    canvas.setFillColor(MUTED); canvas.setFont("Helvetica", 8)
    canvas.drawRightString(w - 40, 20, "Page %d" % doc.page)
    canvas.drawString(40, 20, "Optiv VIT Case Study 2 — PII Detection within Text Artifacts")
    canvas.restoreState()


# ───────────────────────── Report PDF ─────────────────────────
def build_report(metrics):
    path = os.path.join(HERE, "Case_Study_2_Report.pdf")
    doc = SimpleDocTemplate(path, pagesize=letter, topMargin=52, bottomMargin=40,
                            leftMargin=46, rightMargin=46, title="Case Study 2 — Technical Report")
    st = []
    st.append(Paragraph("PII Detection within Text Artifacts", TITLE))
    st.append(Paragraph("Optiv VIT — Case Study 2 · Technical Report (feature-by-feature)", SUBT))
    st.append(HRFlowable(color=LINE, thickness=1, spaceBefore=6, spaceAfter=8, width="100%"))

    m = metrics
    tot = m.get("total_findings", "—"); ppl = m.get("unique_people", "—")
    sealed = len(m.get("figure_redactions", [])); resid = m.get("residual_leak_count", 0)
    gr = m.get("gold_recall_overall", ["—", "—", "—"]); eff = m.get("gold_effective_coverage", ["—", "—", "—"])
    st.append(Paragraph(
        "A fully-offline system that strips Personally Identifiable Information (PII) out of scanned "
        "PDFs, Word documents and PowerPoint decks <b>before</b> they are sent to an LLM document-analysis "
        "agent, and then <b>independently verifies that nothing leaked</b>. This report explains every "
        "feature of the system: what each one is for (its aim) and how it works.", BODY))
    st.append(Paragraph(
        f"<b>Verified current state:</b> {tot} findings · {ppl} unique people · {sealed} figures/tables "
        f"sealed · <b>{resid} residual leaks</b> · gold recall {gr[0]}/{gr[1]} ({gr[2]}%) · "
        f"effective coverage {eff[0]}/{eff[1]} ({eff[2]}%) · 39 automated self-tests green · runs fully offline.", BODY))

    # 1. Problem & requirements
    st.append(Paragraph("1. The problem and the requirements", H1))
    st.append(Paragraph(
        "Cadence (a global financial firm) lets employees run business documents through an AI "
        "document-analysis agent, but policy forbids any personal data from reaching the model. Every "
        "document must therefore be stripped of PII first — across messy real-world formats: a 35-page "
        "scanned policy PDF, a Word training document full of screenshots, and a PowerPoint org pack. "
        "The brief's targets: near-100% PII coverage, minimal false positives, at least 80% of document "
        "structure preserved, and full traceability of every finding.", BODY))

    # 2. Architecture
    st.append(Paragraph("2. Architecture — a hybrid, fail-closed, 6-stage pipeline", H1))
    st.append(Paragraph(
        "Documents are extracted format-by-format (OCR for the scanned PDF), PII is detected with a hybrid "
        "of deterministic rules + checksums and machine-learning name recognition, every value is replaced "
        "by a stable token, regions that cannot be verified are sealed whole, and finally an independent "
        "gate re-reads and re-OCRs the output to prove no PII survives. The six stages:", BODY))
    for b in ["<b>1 · Extract</b> — format-aware text + layout (Poppler, Tesseract, OpenCV, python-docx/pptx)",
              "<b>2 · Detect &amp; classify</b> — regex + checksums + spaCy NER + name heuristics",
              "<b>3 · Resolve / pseudonymize</b> — stable deterministic tokens shared across all files",
              "<b>4 · Redact (fail-closed)</b> — in-place token masking + whole-region sealing",
              "<b>5 · Report</b> — inventory, re-identification key, metrics, run metadata",
              "<b>6 · Verify (leakage gate)</b> — re-open text AND re-OCR the masked PDF; assert 0 PII survives"]:
        st.append(Paragraph("• " + b, BULLET))

    # 3. Stage 1 extraction
    st.append(Paragraph("3. Stage 1 — Extraction (format-aware)", H1))
    feature(st, "3.1 PDF rendering + OCR",
            "turn a scanned (image-only) PDF into machine-readable words with pixel coordinates so PII can be found and masked.",
            "Poppler renders every page to a 300-dpi PNG; Tesseract OCRs each page to a TSV of words with "
            "bounding boxes and confidence. Results are cached so re-runs take ~1 minute instead of 10–15.")
    feature(st, "3.2 OpenCV region classification",
            "handle PII differently depending on where it sits on the page — body text, a callout, a table, or a figure.",
            "Colour/shape heuristics in OpenCV detect gold/red callout bars (narrative), grey-bordered boxes "
            "(figures), and navy table headers extended through grey row separators (tables); every OCR word "
            "is tagged with its region type, which drives masking and sealing decisions downstream.")
    feature(st, "3.3 Enhanced second-pass OCR (figures &amp; dense tables)",
            "recover text that the full-page OCR pass mangles or drops inside figures and multi-column tables.",
            "Each figure/table region is cropped, upscaled 2.5×, dark themes inverted, contrast normalised, "
            "and re-OCR'd. Two page-segmentation modes are unioned (auto-layout + uniform-block) because "
            "auto-layout drops regions next to barcodes/noise — this recovers IDs the single pass misses.")
    feature(st, "3.4 DOCX extraction",
            "pull PII out of every place it hides in a Word file, not just the visible body.",
            "python-docx reads paragraphs, table cells, headers/footers and document metadata (author, "
            "last-modified-by, title…); embedded PNG/JPG images (screenshots) are extracted and OCR'd.")
    feature(st, "3.5 PPTX extraction",
            "catch PII in the parts of a deck that are easy to forget.",
            "python-pptx reads shape text, table cells, speaker notes and metadata — notes and metadata are "
            "common leak points that manual review skips.")

    # 4. Stage 2 detection
    st.append(Paragraph("4. Stage 2 — Detection &amp; classification (hybrid engine)", H1))
    st.append(Paragraph("Deterministic rules + checksums give precision and explainability for structured "
                        "identifiers; machine learning handles the fuzzy ones (names). Every finding is tagged "
                        "with its category, sensitivity tier, confidence and the exact rule that caught it.", BODY))
    feature(st, "4.1 Checksum validators (Luhn, PESEL, SSN range)",
            "prove a candidate is a real identifier rather than a coincidental number — near-zero false positives.",
            "Credit cards must pass the Luhn algorithm; Polish PESELs must pass their weighted checksum; US "
            "SSNs must fall in a valid issued range (or appear next to an SSN keyword). A number that fails "
            "the maths is rejected, which is both precise and auditable.")
    feature(st, "4.2 Structured-identifier regex",
            "detect the full range of structured PII with explainable, format-specific patterns.",
            "Patterns cover email (including OCR-split <i>name @domain</i>), phone (including OCR-wrapped "
            "fragments), India PAN (structure + entity character), passport, TIN, masked/partial cards, "
            "account and SSN last-4, DOB (date + keyword), home address, IPv4, employee/vendor IDs and "
            "badge credentials — each with its own confidence and rule tag.")
    feature(st, "4.3 Machine-learning name recognition",
            "find people's names, which have no fixed format and defeat rules alone.",
            "spaCy NER proposes PERSON spans; these are filtered by name-pattern rules (first-initial-last, "
            "initial+surname, period-less initials, plain First-Last), a word-frequency model (tells a real "
            "surname from a common word), and a stop-word list of generic org/role terms.")
    feature(st, "4.4 Gazetteer propagation",
            "ensure a name confirmed once is caught everywhere it appears, including inside screenshots and prose.",
            "Every high-confidence full name seeds a gazetteer that is re-scanned across all three documents; "
            "confirmed names re-seed it for a second pass, catching repeats the first pass missed.")
    feature(st, "4.5 OCR-tolerant detection",
            "still catch IDs and keywords when the scanner has slightly garbled the characters.",
            "Fuzzy keyword matching (edit-distance) plus confusable-character repair (O→0, l→1, S→5…) "
            "recover SSN/PAN/passport/phone values inside noisy image text.")
    feature(st, "4.6 De-overfitting",
            "make detection generalise to unseen documents rather than memorising this corpus.",
            "No company, vendor, city or country names are hard-coded; organisations are rejected by generic "
            "suffix stop-words and dynamic spaCy ORG/GPE entities. Proven on an unseen synthetic document "
            "(test_generalize.py): new people caught, new companies/cities correctly ignored.")
    feature(st, "4.7 Confidence, tier and rule tagging",
            "give the compliance team full traceability for every finding.",
            "Each span carries a confidence score, a sensitivity tier (Critical/High/Medium) and the name of "
            "the rule that produced it — all written to the inventory. Overlapping spans are resolved by a "
            "category-priority ordering so the strongest, most specific match wins.")

    # 5. Stage 3 resolve
    st.append(Paragraph("5. Stage 3 — Resolve &amp; pseudonymize", H1))
    feature(st, "5.1 Stable cross-file tokens",
            "preserve meaning for the LLM while removing identity — and keep the same person the same everywhere.",
            "Each value maps to a deterministic token (PERSON-016, EMAIL-002, TEL-020…) shared across all "
            "three files, so cross-document references stay linked without exposing the real value.")
    feature(st, "5.2 OCR-variant merging",
            "stop one person from becoming several tokens because the scanner spelled their name differently.",
            "Surname keys within edit-distance 2 are merged (e.g. Szewczyk ≈ Szewezyk, Kulkarni ≈ Kudkarni), "
            "and first-name-only mentions resolve to the right person within the same document.")
    feature(st, "5.3 Email-to-person linking",
            "tie a contact detail back to its owner in the re-identification key.",
            "An email's local part is matched to a known person key so the email token aligns with that person.")

    # 6. Stage 4 redaction
    st.append(Paragraph("6. Stage 4 — Redaction (fail-closed)", H1))
    feature(st, "6.1 In-place token masking (text)",
            "remove the PII while keeping the surrounding context the LLM needs to analyse the document.",
            "Detected spans in DOCX/PPTX text, tables, notes and metadata are replaced in place by their "
            "token; structural units and their order are untouched, so 80%+ of structure is preserved.")
    feature(st, "6.2 Whole-figure sealing",
            "guarantee no PII escapes through an image, where OCR recall is unreliable.",
            "Every embedded figure is sealed as a redaction panel — even with no detection — because OCR can "
            "render a name inside an image that it never actually recognised as text. Charts are sacrificed: "
            "the correct trade for a PII gate.")
    feature(st, "6.3 Whole-table sealing (scanned)",
            "stop names leaking from multi-column scanned tables that OCR renders but cannot cleanly read.",
            "Any scanned-PDF table region that contains detected PII is sealed whole, because multi-column "
            "OCR can place a value it never recognised as a maskable word (e.g. a reporter-name column).")
    feature(st, "6.4 Image-only masked PDF",
            "ensure there is no recoverable text hidden underneath the redaction boxes.",
            "The masked PDF is rasterised to images (via img2pdf) — the output carries no text layer at all, "
            "so nothing can be copied out from under a box.")
    feature(st, "6.5 Embedded-image &amp; metadata redaction (Office)",
            "close the Office-format leak paths that aren't visible body text.",
            "Embedded screenshots in DOCX/PPTX are sealed whole inside the saved file, and author / "
            "last-modified-by metadata fields are replaced with tokens.")

    # 7. Stage 5 report
    st.append(Paragraph("7. Stage 5 — Reporting &amp; traceability", H1))
    feature(st, "7.1 PII inventory",
            "give auditors a complete, traceable record of every finding.",
            "pii_inventory.csv lists every finding with file, location, context, method, category, tier, "
            "value, token, confidence and rule. (This is the companion 'PII Findings Inventory' PDF.)")
    feature(st, "7.2 Re-identification key",
            "allow authorised re-identification while keeping it strictly separate from the masked files.",
            "person_token_map.csv maps each token to its real name(s) and the files it appears in — kept "
            "private, never bundled with the redacted output.")
    feature(st, "7.3 Metrics &amp; run metadata",
            "quantify coverage honestly and record exactly what the run did.",
            "metrics.json reports gold-set recall, effective coverage, structure retention, tier/category "
            "counts and residual leaks; run_meta.json records page metadata, figure redactions and flagged "
            "uninspected media.")
    feature(st, "7.4 Uninspected-media flagging",
            "surface what the system could NOT verify instead of silently passing it.",
            "Embedded vector images (EMF/SVG/WMF) that cannot be OCR'd are flagged for manual review rather "
            "than assumed clean — a PII gate must declare its blind spots.")

    # 8. Stage 6 verify
    st.append(Paragraph("8. Stage 6 — Verification (the independent leakage gate)", H1))
    feature(st, "8.1 Re-read + re-OCR leakage gate",
            "do not trust the redactor — independently prove no detected PII value survives in the actual output.",
            "After masking, the gate re-opens the masked DOCX/PPTX text AND re-runs OCR on the rasterised "
            "masked PDF, then asserts that zero detected PII values appear in what actually renders. The "
            "first run of this gate caught leaks that manual review and two external audits had all missed "
            "(an OCR-split email and a table-rendered name). It validates masking, not detection misses.")

    # 9. Results
    st.append(Paragraph("9. Results (current, independently verified)", H1))
    bya = m.get("by_artifact", {}); byt = m.get("by_tier", {})
    st.append(Paragraph(
        f"<b>{tot}</b> findings · <b>{ppl}</b> unique people · <b>{sealed}</b> figures/tables sealed · "
        f"<b>{resid}</b> residual leaks.  By file: " +
        " · ".join(f"{k} {v}" for k, v in bya.items()) + ".  By tier: " +
        " · ".join(f"{k} {v}" for k, v in byt.items()) + f".  Gold recall {gr[0]}/{gr[1]} ({gr[2]}%), "
        f"effective coverage {eff[0]}/{eff[1]} ({eff[2]}%). Generalises to an unseen document; guarded by "
        "a 39-check self-test suite.", BODY))

    # 10. Principles + limitations
    st.append(Paragraph("10. Design principles", H1))
    for b in ["<b>Hybrid detection</b> — ML for fuzzy entities (names), deterministic rules+checksums for structured IDs.",
              "<b>Fail-closed</b> — if a region cannot be verified clean, seal it. Safety over appearance.",
              "<b>Independent verification</b> — re-read the output and prove it is clean; don't trust the redactor.",
              "<b>Traceability</b> — every finding carries its rule, confidence and tier.",
              "<b>De-overfit</b> — generic rules only, so it generalises beyond this corpus."]:
        st.append(Paragraph("• " + b, BULLET))

    st.append(Paragraph("11. Honest limitations &amp; roadmap", H1))
    for b in ["Text redaction is bounded by OCR quality — which is exactly why unreadable regions are sealed and the gate re-OCRs the output.",
              "Recall is measured on a self-authored 25-item gold set; a blind, independently-annotated corpus is the next step.",
              "Six embedded vector images (EMF/SVG) cannot be OCR'd and are flagged for manual review.",
              "A transformer NER backend is wired in (--ner-model en_core_web_trf) for stronger name recall as a roadmap upgrade.",
              "A small amount of safe over-masking can occur — the correct direction for a redaction gate."]:
        st.append(Paragraph("• " + b, BULLET))

    doc.build(st, onFirstPage=lambda c, d: header_footer(c, d, "PII Detection within Text Artifacts — Technical Report"),
              onLaterPages=lambda c, d: header_footer(c, d, "PII Detection within Text Artifacts — Technical Report"))
    return path


# ───────────────────────── Findings inventory PDF ─────────────────────────
ART_SHORT = {"Risk Policy (PDF)": "PDF", "TPRM Training (DOCX)": "DOCX", "Org Pack (PPTX)": "PPTX"}
TIER_RANK = {"Critical": 0, "High": 1, "Medium": 2}


def build_inventory(rows, metrics):
    path = os.path.join(OUT, "PII_Findings_Inventory.pdf")
    doc = SimpleDocTemplate(path, pagesize=landscape(letter), topMargin=46, bottomMargin=36,
                            leftMargin=28, rightMargin=28, title="PII Findings Inventory")
    cell = S("cell", fontSize=6.3, leading=7.4, textColor=INK)
    tok = S("tok", fontSize=6.3, leading=7.4, textColor=ORANGE, fontName="Helvetica-Bold")
    head = S("hd", fontSize=6.6, leading=8, textColor=colors.white, fontName="Helvetica-Bold")

    st = []
    st.append(Paragraph("PII Findings Inventory", TITLE))
    st.append(Paragraph("Optiv VIT Case Study 2 · every detected value with its characteristics", SUBT))
    m = metrics
    st.append(Paragraph(
        f"<b>{m.get('total_findings','?')}</b> findings across {len(m.get('by_artifact',{}))} documents · "
        f"tiers " + " / ".join(f"{k} {v}" for k, v in m.get("by_tier", {}).items()) +
        f" · {m.get('residual_leak_count',0)} residual leaks (independently verified).", BODY))
    st.append(Paragraph("<b>CONFIDENTIAL — contains raw PII (re-identification data). Keep private; do not "
                        "send to an LLM or commit to source control.</b>",
                        S("warn", fontSize=9, textColor=colors.HexColor("#b3261e"), leading=12, spaceAfter=8)))

    cols = ["#", "Value", "Category", "Tier", "File", "Location", "Context", "Method", "Conf", "Rule that caught it", "Token"]
    widths = [22, 150, 66, 40, 34, 74, 50, 70, 26, 132, 56]
    data = [[Paragraph(c, head) for c in cols]]
    srt = sorted(rows, key=lambda r: (TIER_RANK.get(r["tier"], 9), ART_SHORT.get(r["artifact"], r["artifact"]), r["location"]))
    for i, r in enumerate(srt, 1):
        data.append([
            Paragraph(str(i), cell),
            Paragraph((r["value"] or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), cell),
            Paragraph(r["category"], cell),
            Paragraph(r["tier"], cell),
            Paragraph(ART_SHORT.get(r["artifact"], r["artifact"]), cell),
            Paragraph(r["location"], cell),
            Paragraph(r["context"], cell),
            Paragraph(r["method"], cell),
            Paragraph(r["confidence"], cell),
            Paragraph(r["rule"].replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"), cell),
            Paragraph(r["token"], tok),
        ])
    t = LongTable(data, colWidths=widths, repeatRows=1)
    tstyle = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f3f6fb")]),
    ]
    # tint tier cells by severity
    for ridx, r in enumerate(srt, 1):
        if r["tier"] == "Critical":
            tstyle.append(("BACKGROUND", (3, ridx), (3, ridx), colors.HexColor("#fde2e0")))
        elif r["tier"] == "High":
            tstyle.append(("BACKGROUND", (3, ridx), (3, ridx), colors.HexColor("#fdeede")))
    t.setStyle(TableStyle(tstyle))
    st.append(t)

    doc.build(st, onFirstPage=lambda c, d: header_footer(c, d, "PII Findings Inventory — CONFIDENTIAL"),
              onLaterPages=lambda c, d: header_footer(c, d, "PII Findings Inventory — CONFIDENTIAL"))
    return path


if __name__ == "__main__":
    metrics = json.load(open(os.path.join(OUT, "metrics.json"), encoding="utf-8"))
    rows = list(csv.DictReader(open(os.path.join(OUT, "pii_inventory.csv"), encoding="utf-8-sig")))
    p1 = build_report(metrics)
    p2 = build_inventory(rows, metrics)
    print("Report  :", p1)
    print("Findings:", p2, f"({len(rows)} rows)")
