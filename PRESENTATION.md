# Cadence PII Detection & Redaction — Project Explanation + Presentation Script

_Optiv VIT Case Study 2. This document has two parts: a detailed explanation of what the
system does, and a ready-to-deliver presentation script (good morning → thank you)._

---

# PART 1 — What this project does (in detail)

## The problem it solves
Cadence (a financial firm) lets employees feed business documents into an **LLM "document
analysis agent."** Company policy forbids personal data (PII) from reaching the LLM. So every
document must be **stripped of PII before the LLM sees it** — across messy real-world formats:
a **scanned PDF**, a **Word doc with embedded screenshots**, and a **PowerPoint**. The bar:
near-100% PII coverage, minimal false positives, ≥80% of the document's structure/context
preserved, and full traceability.

## The pipeline — six stages

**1. Extract (format-aware)**
- **Scanned PDF** → render each page at 300 DPI (Poppler), OCR every page (Tesseract) into
  words-with-coordinates. Then **classify page regions** with OpenCV — *narrative* callout
  boxes, *figures/images*, *tables*, *body text*. Figures and tables get a **second enhanced
  OCR pass** (crop → upscale 2.5× → invert dark themes → sharpen) to recover text the
  full-page pass mangles.
- **DOCX** → python-docx pulls paragraphs, tables, headers/footers, document metadata;
  embedded images are OCR'd.
- **PPTX** → python-pptx pulls shapes, tables, **speaker notes**, metadata.
- Every unit becomes a *segment* carrying its text, location, context tag, and word coordinates.

**2. Detect & classify (hybrid engine)**
- **Deterministic rules + checksums** for structured IDs: emails (incl. OCR-split
  `n.osadebe @…`), employee IDs, SSN (valid-range + context), India PAN (structure + entity
  char), PESEL (checksum), passport, TIN, credit cards (**Luhn**), masked cards, accounts, DOB,
  home address, phones (incl. OCR-wrapped fragments), IPs.
- **Names (PERSON)** = a hybrid: **spaCy NER (ML)** + pattern rules (first-initial-last,
  initial+surname, period-less initials like `KC Burney`, plain First-Last) gated by a
  first-name dictionary, **word-frequency scoring** (to tell real surnames from common words),
  and a stop-list — plus a **seeded gazetteer** that re-propagates every confirmed name across
  all three documents, and OCR-tolerant fuzzy matching.
- Every finding gets a **category, sensitivity tier, confidence, and a rule tag** → traceability.

**3. Resolve & pseudonymize**
- Deterministic, stable tokens (`PERSON-016`, `EMAIL-002`, `TEL-020`) **shared across all three
  files**, so the same person gets the same token everywhere. OCR variants
  (`Szewczyk`/`Szewezyk`) are merged via edit-distance; emails are linked to their owner.

**4. Redact (fail-closed)**
- **PDF**: boxes over detected spans with the token label; **seal every figure whole** (OCR
  inside images is unreliable) and **seal every table containing PII** (multi-column OCR can
  render a name it never read). Output is image-only — no recoverable text under the boxes.
- **DOCX/PPTX**: in-place token substitution in text, tables, notes, metadata; embedded
  screenshots sealed whole.

**5. Report**
- `pii_inventory.csv` (every finding, fully traceable), `person_token_map.csv` (the
  re-identification key, kept separate), `metrics.json` (counts, recall, coverage, seals,
  flagged uninspected media).

**6. Verify — the independent leakage gate**
- After redaction, it **re-opens the masked DOCX/PPTX and RE-OCRs the masked PDF**, then asserts
  **no detected PII value survives** in the output. This is the safety net that caught leaks our
  own eyes and external reviews missed.

## The design philosophy (the part recruiters care about)
1. **Hybrid detection** — ML for fuzzy entities (names), deterministic rules+checksums for
   structured IDs.
2. **Fail-closed** — if we can't verify a region is clean, we seal it. Safety over appearance.
3. **Independent verification** — don't trust the redactor; re-read the output and prove it's clean.
4. **Traceability** — every finding carries its rule and confidence.

**Current numbers:** 1002 distinct PII findings · 134 unique people · 67 figures/tables sealed ·
**0 residual leaks** (independently verified across all three formats). Proven to **generalize**
to an unseen document, and guarded by a **26-check self-test suite** (`test_detect.py`,
`test_generalize.py`).

---

# PART 2 — Presentation script (good morning → thank you)

> ~12 minutes, built for a team of 4 (reassign freely). Stage directions in _(italics)_.
> Maps to the brief's five deliverables: Blueprint, Architecture, Extraction Logic,
> Reliable Outcomes, Live Walkthrough.

### [0:00] Opening — Presenter 1
"Good morning, and thank you for having us. We're **[names]**, and we took on **Case Study 2 —
PII detection within text artifacts** for Cadence.

Let me frame the problem in one sentence. Cadence lets employees run business documents through
an **AI document-analysis agent** — but company policy says **personal data must never reach
that AI model.** So our job was to build a system that sits *in front* of the LLM: it reads each
document, finds every piece of PII, strips it out, and only then lets the content through.

The catch is the documents are messy and real: a **35-page scanned policy PDF**, a **Word
training doc full of screenshots**, and a **PowerPoint org pack**. Three formats, three
extraction problems, one promise — **no PII gets downstream.**"

### [1:30] Solution blueprint — Presenter 1
_(Show the Functional Design Diagram)_

"Here's the flow end-to-end. Documents come in on the left. We **extract** text in a way tailored
to each format, **detect and classify** the PII, **pseudonymize** it with stable tokens,
**redact** it, and produce two things: a **safe, masked copy** for the LLM, and an **audit
inventory** for the compliance team. And critically — there's a **verification gate** at the end
that checks our own work before anything is cleared."

### [2:30] System architecture — Presenter 2
_(Show the Architecture Diagram)_

"Technically, this is a **hybrid engine**, and that's a deliberate choice.

For **structured identifiers** — SSNs, passports, PAN, credit cards — we use **deterministic
rules with checksums**. A credit card isn't 'probably a card' — it passes the **Luhn algorithm**
or it doesn't. That gives us precision and, just as importantly, **explainability**: every
finding is tagged with the exact rule that caught it.

For **fuzzy entities** — people's names — rules alone fail, so we layer in **machine learning**:
a spaCy NER model, backed by name patterns, a frequency model to tell a real surname from a
common word, and a gazetteer that propagates every confirmed name across all three files.

The stack is all **open-source and fully offline** — Tesseract for OCR, OpenCV for layout
analysis, spaCy for NER. Nothing leaves the machine, which matters for a financial client."

### [4:00] Extraction logic — Presenter 3
"Each format needed a different strategy.

The **PowerPoint and Word** docs have real text, so we read it directly — including the parts
people forget: **table cells, speaker notes, and document metadata.**

The **scanned PDF** is the hard one — it's images, not text. We render each page at 300 DPI and
OCR it, then we **classify every region** of the page — is this body text, a callout, a table, or
a figure? — because *how* we handle PII depends on *where* it is.

And this is where we learned the most important lesson of the project…"

_(hand to Presenter 4)_

### [5:30] Redaction & the verification gate — Presenter 4 _(the differentiator — slow down here)_
"We redact **fail-closed.** Here's what that means and why it matters.

For normal text, we replace each PII item in place with a token — `PERSON-016`, `EMAIL-002` — so
the surrounding context is preserved for the LLM.

But for **figures and dense tables**, OCR is unreliable — it can render a name on the page that it
never actually recognized as text. If we only redact what we *detected*, those slip through. So
our rule is: **if we can't verify a region is clean, we seal the whole thing.** A figure we can't
fully read becomes a redaction panel. A table full of contact details becomes a sealed block. We
trade a little visual polish for a **guarantee**.

And then the part we're most proud of — we **don't trust our own redactor.** We built an
**independent verification gate**: after masking, it re-opens the Word and PowerPoint files *and
re-runs OCR on the redacted PDF*, then checks that **not one piece of detected PII survives in the
output.**

The first time we ran that gate, **it found a leak that our own manual review and two rounds of
external audit had all missed** — an email address where the scanner had split the text around
the '@', and a name that a scanned table rendered but OCR never read. We fixed both. That's the
whole point of independent verification: **it catches what humans don't.**"

### [8:00] Live walkthrough — Presenter 2 _(run it)_
"Let me show it running. _(run `python pipeline.py`)_ It extracts, detects, masks, and finishes
with the line we care about: **'leakage gate PASSED — 0 PII values survive.'**

_(open the masked PDF)_ Here's a page: names and emails replaced with tokens, the identity-record
screenshot sealed, the contact table sealed — but the **policy narrative is fully intact**, which
is what the AI actually needs to analyze.

_(open `pii_inventory.csv`)_ And here's the audit trail — every single finding, with its file,
location, category, sensitivity tier, and the rule that caught it. Fully traceable."

### [10:00] Reliable outcomes & honesty — Presenter 3
"The numbers: **1002 distinct PII items** found across the three files, **134 unique people**,
**67 figures and tables sealed**, and — verified independently — **zero residual leaks.**

And it **generalizes**: we ran it on a document it had never seen, with new names, a new company,
and new cities — it caught all the new PII and correctly ignored the new company and cities,
*without any code changes*. The whole thing is guarded by a **self-test suite** so a future edit
can't silently reintroduce a leak.

We'll also be honest about limits, because a security review should be. Six embedded **vector
images we can't OCR** are *flagged for manual review* rather than silently passed. And text-based
redaction is ultimately bounded by **OCR quality** — which is exactly why we added the fail-closed
sealing and the verification gate. Our roadmap upgrade is a **transformer-based NER model** —
we've already wired it in as an option — for even stronger name recall."

### [11:30] Close — Presenter 1
"To sum up: we built a **repeatable, offline, fail-closed PII gate** that handles three document
formats, classifies PII with a hybrid of ML and deterministic checks, preserves document context,
and — most importantly — **verifies its own output** so nothing reaches the AI model unchecked.

Thank you. We'd love to take your questions."

---

## Q&A prep (likely questions)
- **"How do you know you caught everything?"** — We don't claim perfection; we claim
  *verified*. The independent leakage gate re-reads the output and proves no detected PII
  survives, and we fail-closed on anything we can't verify (figures, dense tables). That's a
  safer posture than a single detector with an unaudited accuracy number.
- **"Your recall is measured on a gold set you wrote — isn't that circular?"** — Yes, and we say
  so. The gold set proves we catch known items; the *fail-closed sealing + re-OCR gate* are what
  protect against the unknown. Next step is a blind, independently-annotated corpus.
- **"Why not just use an LLM / one ML model?"** — PII is a hybrid problem. ML is best for names;
  checksums are best (and provable) for IDs. And the whole point is to keep data *away* from an
  LLM. We did wire in an optional transformer NER (`--ner-model en_core_web_trf`) for stronger
  name recall.
- **"What breaks it?"** — OCR quality. A name a scanner mangles can't be masked by any text
  detector — which is exactly why we seal unreadable regions instead of trusting detection.
