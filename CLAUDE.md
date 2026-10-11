# CLAUDE.md

Cadence PII detection pipeline (Optiv Case Study 2): read scanned PDF / DOCX / PPTX,
detect and classify PII, write masked copies plus an inventory. Runs fully offline.

## Layout
- `pipeline.py` — main program: extract → classify → detect → resolve → mask → report
- `detect.py` — detection rules (patterns, checksums, context words, name heuristics)
- `metrics.py` — gold-set recall and false-positive numbers for the presentation
- Run: `python pipeline.py` (see README.md for Tesseract/Poppler setup)

## Rules for commits
- Do NOT add yourself (Claude) as a contributor, author, or co-author. No
  `Co-Authored-By` trailer and no "Generated with Claude" lines in commits or PRs.
