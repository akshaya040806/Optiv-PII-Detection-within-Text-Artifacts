# Cadence PII Detection Pipeline: Windows setup and run guide

This tool reads the three Cadence case-study files, finds the personal data (PII) in them,
and writes masked copies plus a full inventory. It runs entirely on your own computer.
Nothing is uploaded anywhere.

Setup takes about 20–30 minutes, once. After that, a run takes about 10–15 minutes the
first time (it has to read 35 scanned pages) and about 1 minute on later runs.

---

## Step 1: Install Python

1. Go to https://www.python.org/downloads/ and download Python 3.11 or 3.12.
2. Run the installer. **On the first screen, tick "Add python.exe to PATH".** This is important.
3. Open **Command Prompt** (press the Windows key, type `cmd`, press Enter) and check that it works:
   ```
   python --version
   ```
   You should see something like `Python 3.12.x`.

## Step 2: Install Tesseract (the OCR engine that reads text from images)

1. Go to https://github.com/UB-Mannheim/tesseract/wiki and download the Windows installer (64-bit).
2. Install it with the default options. It usually lands in `C:\Program Files\Tesseract-OCR\`.
3. Note this path. You'll need `C:\Program Files\Tesseract-OCR\tesseract.exe` in Step 6.

## Step 3: Install Poppler (turns PDF pages into images)

1. Go to https://github.com/oschwartz10612/poppler-windows/releases and download the latest `Release-xx.zip`.
2. Unzip it somewhere simple, for example `C:\poppler`.
3. Inside it, find the folder that contains `pdftoppm.exe`. It's usually `C:\poppler\Library\bin`.
   Note this folder path for Step 6.

## Step 4: Install the Python packages

In Command Prompt, go to the folder where you unzipped this tool, for example:
```
cd C:\Users\Revathy\Documents\pii_pipeline
```
Then run these two commands:
```
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

## Step 5: Put the three case-study files in one folder

For example, `C:\Users\Revathy\Documents\CaseStudy\`, containing:
- `Cadence_Group_Risk_Management_Policy__v6.0.pdf`
- `Cadence_TPRM_Training.docx`
- `Cadence_Financial_Group_Organizational_Pack.pptx`

## Step 6: Run it

The easy way — just run it with no extra typing:
```
python pipeline.py
```
A window will pop up asking you to pick the PDF, then the Word file, then the PowerPoint file,
then a folder to save results in. It also looks for Tesseract and Poppler in their usual install
locations automatically; if it can't find one, it'll pop up one more window asking you to point
to the missing `.exe`.

If you'd rather not click through windows (or you're running this with no screen at all, e.g. over
SSH), pass everything on the command line instead (one long line; change the paths to match yours):
```
python pipeline.py --pdf "C:\Users\Revathy\Documents\CaseStudy\Cadence_Group_Risk_Management_Policy__v6.0.pdf" --docx "C:\Users\Revathy\Documents\CaseStudy\Cadence_TPRM_Training.docx" --pptx "C:\Users\Revathy\Documents\CaseStudy\Cadence_Financial_Group_Organizational_Pack.pptx" --out "C:\Users\Revathy\Documents\CaseStudy\results" --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe" --poppler "C:\poppler\Library\bin" --no-gui
```
Keep the quotation marks around every path. `--no-gui` just fails with a message instead of
opening a window if any path is missing — safe to leave off either way.

You'll see progress messages (Stage 1/4 … Stage 4/4) and finally `Done: … findings`.

### Run on a single file (any type)
You don't have to supply all three files. Pass just one with `--file` — the type is detected
automatically:
```
python pipeline.py --file "C:\path\to\anything.pdf" --out results --tesseract "C:\Program Files\Tesseract-OCR\tesseract.exe" --poppler "C:\poppler\Library\bin" --no-gui
```
(A `.docx` or `.pptx` needs no `--poppler`; a `.pptx` needs no `--tesseract` either.)

### Point-and-click web UI
For a drag-and-drop demo, launch the web app (needs `pip install flask`):
```
python server.py
```
Then open **http://127.0.0.1:5000** in your browser, drop in a PDF/Word/PowerPoint, click
**Scan & Redact**, and download the redacted file plus the findings. The UI (in `web/`, plain
HTML/CSS/JS so it's easy to restyle) shows only the replacement **tokens**, never the raw PII.
Set `TESSERACT` / `POPPLER` environment variables if they aren't in the usual install locations.

## What you get (in the `results` folder)

| File | What it is |
|---|---|
| `…_MASKED.pdf` / `.docx` / `.pptx` | Safe copies with PII replaced by tokens such as `PER-016`, `SSN-002` |
| `pii_inventory.csv` | Every finding: file, page, context type, category, value, token, rule, confidence. Opens in Excel. |
| `person_token_map.csv` | Which token belongs to which person. **This is the re-identification key; keep it separate from the masked files.** |
| `metrics.json` | Counts, recall on the hand-checked gold set, image-only findings |
| `_work\` | Scratch files (page images, OCR output). Safe to delete. Deleting it forces a full re-run. |

## The files in this tool

- `pipeline.py`: the main program (extract → classify → detect → resolve → mask → report)
- `detect.py`: the detection rules (patterns, checksums, context words, name rules)
- `metrics.py`: computes the numbers used in the presentation

## If something goes wrong

| Message | Fix |
|---|---|
| `'python' is not recognized` | Python wasn't added to PATH. Reinstall it and tick "Add python.exe to PATH". |
| `Cannot find 'tesseract'` | Check the `--tesseract` path points to `tesseract.exe` itself. |
| `Cannot find 'pdftoppm'` | Check the `--poppler` path is the folder that *contains* `pdftoppm.exe`. |
| `spaCy English model missing` | Run `python -m spacy download en_core_web_sm` |
| `File not found` | Check the file path and name. Copy the exact path from File Explorer (Shift + right-click the file → "Copy as path"). |
| `ModuleNotFoundError` | Run `pip install -r requirements.txt` again. |

Numbers may differ slightly from the presentation if your Tesseract version differs, because
OCR output varies a little between versions.
