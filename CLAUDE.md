# CLAUDE.md — project onboarding for a new session

## What this is
**Optiv VIT Case Study 2 — PII Detection within Text Artifacts.** A fully-offline tool that
strips Personally Identifiable Information (PII) out of business documents (scanned **PDF**,
**Word**, **PowerPoint**) **before** they are sent to an LLM, and then **independently verifies
nothing leaked**. Targets: ~100% PII coverage, minimal false positives, ≥80% structure preserved,
full traceability.

## The pipeline (6 stages, in `pipeline.py`)
1. **Extract** — PDF: Poppler renders pages @300dpi → Tesseract OCR → OpenCV region classify
   (narrative/table/figure/body); figures & dense tables get a 2nd upscaled OCR pass. DOCX/PPTX:
   python-docx/pptx pull text, tables, notes, metadata; embedded images are OCR'd.
2. **Detect & classify** (`detect.py`) — hybrid: deterministic regex + checksums (Luhn, PESEL,
   SSN range, India PAN, email incl. OCR-split, phone incl. OCR-wrapped, employee IDs, passport,
   TIN, cards, DOB, address, IP) **+** ML names (spaCy NER + name patterns + wordfreq + gazetteer).
3. **Resolve / pseudonymize** — deterministic stable tokens shared across all files
   (`PER-016`, `EML-002`…); OCR variants merged via edit-distance.
4. **Redact — FAIL CLOSED** — in-place token masking for text; **seal whole** any figure, and any
   scanned-PDF table containing PII (OCR can render text it never recognized). Masked PDF is
   image-only (no recoverable text under boxes).
5. **Report** — `pii_inventory.csv`, `person_token_map.csv` (the re-identification key — keep
   private), `metrics.json`, `run_meta.json`.
6. **Verify — leakage gate** (`leakage_gate` in pipeline.py) — re-opens masked DOCX/PPTX text AND
   **re-OCRs the masked PDF**, asserts **0 detected PII values survive**. This caught real leaks
   that manual review + two external audits missed.

## Design principles (the interview story)
Hybrid detection · **fail-closed** sealing · **independent verification** (re-OCR gate) ·
traceability (every finding tagged rule+confidence+tier) · de-overfit (no hard-coded company/city
names — generic rules only).

## File map
- `pipeline.py` — orchestrator (extract→detect→resolve→mask→report→verify)
- `detect.py` — all detection rules, checksums, NAME_STOP, person heuristics
- `metrics.py` — gold-set recall, effective coverage, structure-retention, residual leaks
- `server.py` + `web/` (index.html/style.css/app.js) — custom web UI (Flask API + vanilla JS,
  **dark theme**, CSS "atom" loader). UI shows tokens only, never raw PII.
- `test_detect.py` (26 checks) · `test_generalize.py` (13 checks, unseen synthetic doc)
- `README.md` (setup/run) · `SUMMARY.md` (full briefing + Mermaid diagrams + slide plan for the
  deck) · `PRESENTATION.md` (spoken script + Q&A prep)

## How to run (Windows, Python 3.13)
Input files live in the parent folder: `..\Cadence_*.pdf/.docx/.pptx`.
Tools: Tesseract `C:\Program Files\Tesseract-OCR\tesseract.exe`; Poppler
`C:\poppler\poppler-24.08.0\Library\bin`. spaCy `en_core_web_sm` (default) + `en_core_web_trf`
(optional, installed; slow on CPU).

```
# full 3-file run (first run OCRs 35 pages ~10-15 min; cached after in results/_work)
python pipeline.py --pdf "..\Cadence_Group_Risk_Management_Policy__v6.0.pdf" --docx "..\Cadence_TPRM_Training.docx" --pptx "..\Cadence_Financial_Group_Organizational_Pack.pptx" --out results --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe" --poppler "C:\poppler\poppler-24.08.0\Library\bin" --no-gui

# single file of any type
python pipeline.py --file "..\Cadence_TPRM_Training.docx" --out results --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe" --no-gui

python server.py            # web UI -> http://127.0.0.1:5000  (needs: pip install flask)
python test_detect.py       # fast self-checks (no OCR)
python test_generalize.py   # generalization proof on an unseen doc
```

## Current verified state
**1002 findings · 134 unique people · 67 figures/tables sealed · 0 residual leaks** (verified
across all 3 formats incl. full PDF re-OCR) · gold recall 20/25 (text 16/16, image sealed) ·
per-file: PDF 826 / DOCX 52 / PPTX 124 · tests 26+13 green.

## Known limitations (be honest about these)
- Text redaction is bounded by **OCR quality** (why we fail-closed seal unreadable regions).
- Recall measured on a **self-authored 25-item gold set** (roadmap: blind annotated corpus).
- 6 embedded **vector images (EMF/SVG)** can't be OCR'd → flagged `uninspected_media` for review.
- `en_core_web_trf` improves name recall but is slow on CPU (PDF detection ~7-15 min).
- A tiny amount of safe over-masking (e.g. one place name) — the correct direction for a gate.

## Status / what's left
Engineering is **done**. Remaining is non-code: assemble the `.pptx` deck (from `SUMMARY.md`) and
rehearse the 10-15 min walkthrough. Lead the story with the re-OCR gate catching real leaks.

## Repo / housekeeping
- Remote: `akshaya040806/Optiv-PII-Detection-within-Text-Artifacts`; commits as **Waterbottles792**.
- `results/`, `results_*/`, `pii_output/`, `brag-output/` are git-ignored (contain PII-derived
  output, the re-identification key, or large/third-party-music artifacts).
- A `/brag` launch video exists locally at `brag-output/brag.mp4` (not committed — bundled music).

## Rules for commits
- Commit/push only when the user asks.
- Do NOT add yourself (Claude) as a contributor, author, or co-author. No `Co-Authored-By`
  trailer and no "Generated with Claude" lines in commits or PRs.
