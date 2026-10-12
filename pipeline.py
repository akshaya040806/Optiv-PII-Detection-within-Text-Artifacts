import csv, io, json, os, re, shutil, subprocess, sys, zipfile, copy
from collections import defaultdict, Counter

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
import spacy
from docx import Document
from pptx import Presentation

sys.path.insert(0, os.path.dirname(__file__))
import detect as D

import argparse, glob

ap = argparse.ArgumentParser(description="Cadence PII detection pipeline (runs fully offline)")
ap.add_argument("--pdf", default=None, help="path to the Group Risk Management Policy PDF")
ap.add_argument("--docx", default=None, help="path to the TPRM Training .docx")
ap.add_argument("--pptx", default=None, help="path to the Organizational Pack .pptx")
ap.add_argument("--out", default=None, help="folder for results (created if missing)")
ap.add_argument("--tesseract", default=None, help="full path to tesseract.exe if it is not on PATH")
ap.add_argument("--poppler", default=None, help="folder holding pdftoppm.exe / pdftotext.exe if not on PATH")
ap.add_argument("--no-gui", action="store_true",
                 help="never pop up file-picker windows; fail instead if --pdf/--docx/--pptx are missing")
ap.add_argument("--ner-model", default="en_core_web_sm",
                 help="spaCy model for name NER; use en_core_web_trf (if installed) for stronger recall/generalization")
ap.add_argument("--file", default=None,
                 help="a single input file of any supported type (.pdf/.docx/.pptx); routed automatically by extension")
ARGS = ap.parse_args()

if ARGS.file:   # route a single generic file to the right slot by its extension
    _ext = os.path.splitext(ARGS.file)[1].lower()
    _slot = {".pdf": "pdf", ".docx": "docx", ".pptx": "pptx"}.get(_ext)
    if not _slot:
        sys.exit(f"--file must be a .pdf, .docx or .pptx (got {_ext or 'no extension'})")
    setattr(ARGS, _slot, getattr(ARGS, _slot) or ARGS.file)


def _pick_file(title, filetypes):
    """Pop up a 'choose file' window. Exits with a clear message if no display is available."""
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        sys.exit("No file path was given and the file-picker window isn't available here "
                  "(tkinter missing). Pass --pdf/--docx/--pptx on the command line instead, "
                  "or use --no-gui to get this message earlier. See README.md.")
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.askopenfilename(title=title, filetypes=filetypes)
    root.destroy()
    if not path:
        sys.exit(f"No file selected for: {title}. Re-run and pick a file, or pass it with the matching --flag.")
    return path


def _pick_folder(title):
    try:
        import tkinter as tk
        from tkinter import filedialog
    except ImportError:
        return "pii_output"
    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    path = filedialog.askdirectory(title=title)
    root.destroy()
    return path or "pii_output"


# At least one input file is required (any subset of the three is fine). If none given and a
# display is available, open one picker for any supported type.
if not (ARGS.pdf or ARGS.docx or ARGS.pptx):
    if ARGS.no_gui:
        sys.exit("No input given. Pass --file <a .pdf/.docx/.pptx>, or any of --pdf/--docx/--pptx. See README.md.")
    print("No input given: opening a file-picker (pick a .pdf, .docx or .pptx)…", flush=True)
    picked = _pick_file("Select a PDF, Word or PowerPoint file",
                        [("Documents", "*.pdf *.docx *.pptx"), ("All files", "*")])
    slot = {".pdf": "pdf", ".docx": "docx", ".pptx": "pptx"}.get(os.path.splitext(picked)[1].lower())
    if not slot:
        sys.exit("Unsupported file type: " + os.path.splitext(picked)[1])
    setattr(ARGS, slot, picked)
if not ARGS.out:
    if ARGS.no_gui:
        ARGS.out = "pii_output"
    else:
        print("No --out given: opening a folder-picker window for where to save results…", flush=True)
        ARGS.out = _pick_folder("Choose a folder for the results (will be created if needed)")

PDF = os.path.abspath(ARGS.pdf) if ARGS.pdf else None
DOCX = os.path.abspath(ARGS.docx) if ARGS.docx else None
PPTX = os.path.abspath(ARGS.pptx) if ARGS.pptx else None
OUT = os.path.abspath(ARGS.out)
WORK = os.path.join(OUT, "_work")
for d_ in (OUT, WORK, os.path.join(WORK, "pages"), os.path.join(WORK, "tsv")):
    os.makedirs(d_, exist_ok=True)
for f_ in (PDF, DOCX, PPTX):
    if f_ and not os.path.exists(f_):
        sys.exit(f"File not found: {f_}")


_COMMON_TESSERACT = [r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                     r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe"]
_COMMON_POPPLER_GLOBS = [r"C:\poppler*\Library\bin", r"C:\Program Files\poppler*\Library\bin",
                         r"C:\Program Files\poppler*\bin"]


def _tool(name, folder):
    exe = name + (".exe" if os.name == "nt" else "")
    if folder:
        cand = os.path.join(folder, exe)
        if os.path.exists(cand):
            return cand
        if os.path.exists(folder) and os.path.isfile(folder):
            return folder
    found = shutil.which(name)
    if found:
        return found
    # try common Windows install locations before giving up
    if name == "tesseract":
        for c in _COMMON_TESSERACT:
            if os.path.exists(c):
                return c
    else:
        for pat in _COMMON_POPPLER_GLOBS:
            for d in glob.glob(pat):
                cand = os.path.join(d, exe)
                if os.path.exists(cand):
                    return cand
                
    # ask with a file picker instead of just failing
    if not ARGS.no_gui:
        flag = "--tesseract" if name == "tesseract" else "--poppler"
        print(f"Cannot find '{name}' automatically: opening a file-picker window for {exe}…", flush=True)
        picked = _pick_file(f"Select {exe}", [("Executable", "*.exe")] if os.name == "nt" else [("All files", "*")])
        if os.path.basename(picked).lower().startswith(name):
            return picked
    sys.exit(f"Cannot find '{name}'. Install it or pass its location "
             f"({'--tesseract' if name == 'tesseract' else '--poppler'}). See README.md.")


TESSERACT = _tool("tesseract", ARGS.tesseract) if (PDF or DOCX) else None   # OCR: PDF pages + DOCX images
PDFTOPPM = _tool("pdftoppm", ARGS.poppler) if PDF else None
PDFTOTEXT = _tool("pdftotext", ARGS.poppler) if PDF else None


def _font_path():
    for c in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeuib.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"):
        if os.path.exists(c):
            return c
    return None


def get_font(size):
    fp = _font_path()
    try:
        return ImageFont.truetype(fp, size) if fp else ImageFont.load_default(size)
    except Exception:
        return ImageFont.load_default()


def _run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")


def stem(path):
    return os.path.splitext(os.path.basename(path))[0]


def render_pdf_pages():
    """Stage 1a: turn each scanned PDF page into a 300-dpi image and OCR it (cached in _work)."""
    pages = sorted(glob.glob(os.path.join(WORK, "pages", "p-*.png")))
    if not pages:
        print("  rendering PDF pages at 300 dpi…", flush=True)
        r = _run([PDFTOPPM, "-r", "300", "-png", PDF, os.path.join(WORK, "pages", "p")])
        if r.returncode != 0:
            sys.exit("pdftoppm failed: " + r.stderr)
        pages = sorted(glob.glob(os.path.join(WORK, "pages", "p-*.png")))
    for n, pg in enumerate(pages, 1):
        tsv = os.path.join(WORK, "tsv", f"p-{n:03d}.tsv")
        if not os.path.exists(tsv):
            print(f"  OCR page {n}/{len(pages)}", flush=True)
            open(tsv, "w", encoding="utf-8").write(ocr_tsv(pg))
    return pages

A_PDF, A_DOCX, A_PPTX = "Risk Policy (PDF)", "TPRM Training (DOCX)", "Org Pack (PPTX)"

def _load_nlp(name):
    try:
        return spacy.load(name)
    except OSError:
        if name != "en_core_web_sm":
            print(f"NER model '{name}' not installed; falling back to en_core_web_sm "
                  f"(install:  python -m spacy download {name})", flush=True)
            return _load_nlp("en_core_web_sm")
        sys.exit("spaCy English model missing. Run:  python -m spacy download en_core_web_sm")


nlp = _load_nlp(ARGS.ner_model)


class Seg:
    def __init__(self, artifact, loc, ctx, text, method, words=None, page=None, image=None):
        self.artifact, self.loc, self.ctx, self.text, self.method = artifact, loc, ctx, text, method
        self.words = words or []   # list of (cstart, cend, (x0,y0,x1,y1))
        self.page, self.image = page, image
        self.spans = []


def tsv_words(tsv_text, ox=0, oy=0, scale=1.0, min_conf=-1):
    rows = list(csv.DictReader(io.StringIO(tsv_text), delimiter="\t", quoting=csv.QUOTE_NONE))
    words = []
    for r in rows:
        if r["level"] != "5" or not r["text"].strip():
            continue
        if float(r["conf"]) < min_conf:
            continue
        x, y, w, h = (int(r[k]) for k in ("left", "top", "width", "height"))
        words.append(dict(b=int(r["block_num"]), p=int(r["par_num"]), l=int(r["line_num"]), t=r["text"],
                          box=(ox + x / scale, oy + y / scale, ox + (x + w) / scale, oy + (y + h) / scale)))
    return words


def group_paras(words):
    paras = defaultdict(list)
    for w in words:
        paras[(w["b"], w["p"])].append(w)
    out = []
    for key, ws in paras.items():
        text, idx = "", []
        last_line = None
        for w in ws:
            if text:
                text += " "
            s = len(text)
            text += w["t"]
            idx.append((s, len(text), w["box"]))
        out.append((text, idx))
    return out


# ---------------- PDF: region classification ----------------
def pdf_regions(img):
    a = np.asarray(img.convert("RGB")).astype(int)
    H, W, _ = a.shape
    regions = []  # (ctx, x0,y0,x1,y1)
    # callouts: gold / red vertical bar near left margin
    for x in range(300, 340, 2):
        col = a[:, x, :]
        sat = ((col.max(1) - col.min(1)) > 60) & (col[:, 0] > 150)
        ys = np.where(sat)[0]
        if len(ys) > 80:
            runs = np.split(ys, np.where(np.diff(ys) > 3)[0] + 1)
            for r in runs:
                if len(r) > 80:
                    regions.append(("narrative", x, r[0], W - 280, r[-1]))
            break
    import cv2
    g = ((np.abs(a[:, :, 0] - a[:, :, 2]) < 12) & (a[:, :, 0] > 195) & (a[:, :, 0] < 240)).astype(np.uint8) * 255
    cnts, _ = cv2.findContours(g, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        if w > 0.3 * W and h > 300 and h < 0.8 * H:
            regions.append(("image", x, y, x + w, y + h))
    # keep only outermost figure frames
    imgs = [r for r in regions if r[0] == "image"]
    inner = {i for i, r in enumerate(imgs) for j, q in enumerate(imgs)
             if i != j and q[1] <= r[1] + 5 and q[2] <= r[2] + 5 and q[3] >= r[3] - 5 and q[4] >= r[4] - 5 and
             (q[3] - q[1]) * (q[4] - q[2]) >= (r[3] - r[1]) * (r[4] - r[2]) and (i > j or (q[3]-q[1])*(q[4]-q[2]) > (r[3]-r[1])*(r[4]-r[2]))}
    regions = [r for r in regions if r[0] != "image"] + [r for i, r in enumerate(imgs) if i not in inner]
    # tables: navy header bar, extended down through grey row separators
    navy = (a[:, :, 0] < 60) & (a[:, :, 1] < 75) & (a[:, :, 2] > 55) & (a[:, :, 2] < 140)
    nrows = np.where(navy[:, 300:W - 300].mean(1) > 0.6)[0]
    grey = (np.abs(a[:, :, 0] - a[:, :, 2]) < 12) & (a[:, :, 0] > 200) & (a[:, :, 0] < 240)
    grows = np.where(grey[:, 300:W - 300].mean(1) > 0.6)[0]
    if len(nrows):
        for r in np.split(nrows, np.where(np.diff(nrows) > 3)[0] + 1):
            y0, y = r[0], r[-1]
            while True:
                nxt = grows[(grows > y + 2) & (grows < y + 230)]
                if not len(nxt):
                    break
                y = nxt[0]
            regions.append(("table", 290, y0, W - 290, y + 4))
    return regions


def ctx_for(box, regions):
    cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
    found = [r[0] for r in regions if r[1] <= cx <= r[3] and r[2] <= cy <= r[4]]
    for c in ("image", "narrative", "table"):
        if c in found:
            return c
    return "body"


def ocr_tsv(img_path, psm=3):
    return _run([TESSERACT, img_path, "stdout", "--psm", str(psm), "tsv"]).stdout


def enhance_and_ocr(page_img, box, tag):
    """Figures get a second OCR pass: crop, upscale x2.5, invert dark themes, binarise."""
    x0, y0, x1, y1 = [int(v) for v in box]
    crop = page_img.crop((x0, y0, x1, y1)).convert("L")
    arr = np.asarray(crop)
    if arr.mean() < 128:
        crop = ImageOps.invert(crop)
    sc = 2.5
    crop = crop.resize((int(crop.width * sc), int(crop.height * sc)), Image.LANCZOS)
    crop = ImageOps.autocontrast(crop)
    p = os.path.join(WORK, f"enh_{tag}.png")
    crop.save(p)
    # Union two layout modes: psm 3 (auto) reads clean columns but DROPS regions next to barcodes/noise
    # (e.g. the DOB line under the p28 ID-card barcode); psm 6 (uniform block) recovers those. Offset the
    # second pass's block ids so group_paras keeps the passes in separate paragraphs; dupes dedup downstream.
    psms = (6,) if "11" in tag else (3, 6)
    words = []
    for pi, ps in enumerate(psms):
        for w in tsv_words(ocr_tsv(p, psm=ps), ox=x0, oy=y0, scale=sc):
            w["b"] += pi * 1000
            words.append(w)
    return words


def extract_pdf():
    segs, pages_meta = [], []
    native = _run([PDFTOTEXT, PDF, "-"]).stdout
    for i, page_path in enumerate(PAGES, 1):
        img = Image.open(page_path)
        regions = pdf_regions(img)
        base = tsv_words(open(os.path.join(WORK, "tsv", f"p-{i:03d}.tsv"), encoding="utf-8").read())
        figs = [r for r in regions if r[0] == "image"]
        # replace words inside figures with enhanced OCR words
        enh_words = []
        for k, f in enumerate(figs):
            enh_words += [dict(w, src="ocr-enhanced", fig=k) for w in enhance_and_ocr(img, f[1:], f"p{i}_f{k}")]
        # dense tables: whole-page OCR merges columns and can drop names (e.g. the Speak Up reporter column),
        # leaving them un-maskable. A focused crop+upscale pass recovers them so detection can mask them.
        enh_table_words = []
        for k, tb in enumerate(r for r in regions if r[0] == "table"):
            enh_table_words += enhance_and_ocr(img, tb[1:], f"p{i}_tb{k}")
        base_kept, base_fig = [], []
        for w in base:
            (base_fig if ctx_for(w["box"], figs) == "image" else base_kept).append(w)
        pages_meta.append(dict(page=i, native_chars=0, ocr_words=len(base), figures=len(figs),
                               regions=Counter(r[0] for r in regions)))
        for src_words, method in ((base_kept, "ocr"), (base_fig, "ocr-baseline-figure"),
                                  (enh_words, "ocr-enhanced"), (enh_table_words, "ocr-enhanced")):
            for text, idx in group_paras(src_words):
                c = ctx_for(idx[0][2], regions)
                if method == "ocr-baseline-figure":
                    c = "image"
                segs.append(Seg(A_PDF, f"p.{i}", c, text, method, idx, page=i))
    return segs, pages_meta, len(native.strip())


def extract_docx():
    segs = []
    d = Document(DOCX)
    for n, p in enumerate(d.paragraphs):
        if p.text.strip():
            segs.append(Seg(A_DOCX, f"para {n}", "body", p.text, "native"))
    for t, tb in enumerate(d.tables):
        for r, row in enumerate(tb.rows):
            seen = set()
            for c, cell in enumerate(row.cells):
                if id(cell._tc) in seen or not cell.text.strip():
                    continue
                seen.add(id(cell._tc))
                segs.append(Seg(A_DOCX, f"table {t+1} r{r+1}c{c+1}", "table", cell.text.replace("\n", " ; "), "native"))
    for s, sec in enumerate(d.sections):
        for part in (sec.header, sec.footer):
            for p in part.paragraphs:
                if p.text.strip():
                    segs.append(Seg(A_DOCX, f"header/footer s{s}", "body", p.text, "native"))
    cp = d.core_properties
    for f in ("author", "last_modified_by", "title", "subject", "comments"):
        v = getattr(cp, f)
        if v and v.strip():
            segs.append(Seg(A_DOCX, f"metadata:{f}", "metadata", v, "native"))
    z = zipfile.ZipFile(DOCX)
    for name in sorted(z.namelist()):
        if name.startswith("word/media/") and name.lower().endswith((".png", ".jpg", ".jpeg")):
            p = os.path.join(WORK, f"docx_{os.path.basename(name)}")
            open(p, "wb").write(z.read(name))
            ws = tsv_words(ocr_tsv(p))
            for text, idx in group_paras(ws):
                segs.append(Seg(A_DOCX, os.path.basename(name), "image", text, "ocr", idx, image=name))
    return segs


def extract_pptx():
    segs = []
    pr = Presentation(PPTX)
    for i, s in enumerate(pr.slides, 1):
        for sh in s.shapes:
            if sh.has_text_frame:
                for k, p in enumerate(sh.text_frame.paragraphs):
                    t = "".join(r.text for r in p.runs)
                    if t.strip():
                        segs.append(Seg(A_PPTX, f"slide {i}", "body", t, "native"))
            if getattr(sh, "has_table", False) and sh.has_table:
                for r, row in enumerate(sh.table.rows):
                    for c, cell in enumerate(row.cells):
                        if cell.text.strip():
                            segs.append(Seg(A_PPTX, f"slide {i} table r{r+1}c{c+1}", "table",
                                            cell.text.replace("\n", " "), "native"))
        if s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip():
            segs.append(Seg(A_PPTX, f"slide {i} notes", "body", s.notes_slide.notes_text_frame.text, "native"))
    cp = pr.core_properties
    for f in ("author", "last_modified_by", "title", "subject"):
        v = getattr(cp, f)
        if v and v.strip():
            segs.append(Seg(A_PPTX, f"metadata:{f}", "metadata", v, "native"))
    return segs


def detect_all(segs):
    # De-overfit note: company/vendor/city names are NO LONGER hard-coded in NAME_STOP. Multi-word orgs are
    # still rejected by generic suffix stop-words (Partners, Services, Group...). A handful of bare two-word
    # place names may now be masked as PERSON - harmless over-masking, the safe direction for a redaction gate.
    # pass 1: strong patterns only
    gaz_full = set()
    for s in segs:
        for a, b, cat, conf, rule in D.person_spans_pattern(s.text):
            if conf >= 0.9:
                name = re.sub(r"\s+", " ", s.text[a:b])
                toks = name.split()
                gaz_full.add(name)
                gaz_full.add(f"{toks[0]} {toks[-1]}")
        if s.ctx == "metadata":
            nm = re.sub(r"\[.*?\]\s*", "", s.text).strip()
            if re.fullmatch(r"[A-Z][a-z]+ [A-Z][a-z]+", nm):
                gaz_full.add(nm)
    # structured name columns 
    for s in segs:
        if s.ctx == "table" and s.method == "native":
            for part in re.split(r" ; |\n", s.text):
                part = part.strip()
                if re.fullmatch(r"[A-Z][a-z]+(?:-[A-Z][a-z]+)? [A-Z][a-z]+(?:-[A-Z][a-z]+)?", part) and \
                        D.plausible_person(part.split()):
                    gaz_full.add(part)

    full_by_art = defaultdict(set)
    for s in segs:
        for n in gaz_full:
            if n in s.text:
                full_by_art[s.artifact].add(" ".join([n.split()[0], n.split()[-1]]))
    gaz_first = {}
    for art, names in full_by_art.items():
        firsts = Counter(n.split()[0] for n in names)
        gaz_first[art] = {f for f, c in firsts.items() if c == 1 and f not in D.NAME_STOP and len(f) > 3}

    for s in segs:
        sp = D.regex_spans(s.text) + D.person_spans_pattern(s.text) + D.gazetteer_spans(s.text, gaz_full)
        if s.ctx in ("narrative", "body", "image", "table"):
            sp += D.person_spans_ner(nlp, s.text, ocr=s.method.startswith("ocr"))
        if s.ctx == "image":
            sp += D.ocr_tolerant_spans(s.text)
        if s.ctx == "narrative":
            for f in gaz_first.get(s.artifact, ()):
                for m in re.finditer(r"\b" + f + r"(?:'s)?\b", s.text):
                    sp.append((m.start(), m.end(), "PERSON", 0.7, "first-name via gazetteer (narrative)"))
        if s.ctx == "metadata" and not sp:
            nm = re.sub(r"\[.*?\]\s*", "", s.text).strip()
            if re.fullmatch(r"[A-Z][a-z]+ [A-Z][a-z]+", nm):
                sp.append((s.text.index(nm), s.text.index(nm) + len(nm), "PERSON", 0.9, "metadata author field"))
        s.spans = D.resolve_overlaps(sp)
    # pass 3: every confirmed full name re-seeds the gazetteer (catches repeats in screenshots/prose)
    extra = set()
    for s in segs:
        for a, b, cat, conf, rule in s.spans:
            if cat == "PERSON":
                toks = s.text[a:b].split()
                if len(toks) >= 2 and not any(re.fullmatch(r"[A-Z]\.?", t) for t in toks):
                    extra.add(" ".join(toks))
    extra -= gaz_full
    for s in segs:
        add = D.gazetteer_spans(s.text, extra)
        if add:
            s.spans = D.resolve_overlaps(s.spans + add)
    return gaz_full | extra

class Tokens:
    """Stable, deterministic pseudonyms shared across all artifacts."""
    def __init__(self):
        self.person_by_key, self.person_names, self.by_value = {}, defaultdict(set), {}
        self.counters = Counter()
        self.person_arts = defaultdict(set)

    def person(self, name, artifact=None):
        clean = re.sub(r"'s$", "", re.sub(r"\s+", " ", name.strip()))
        k = D.person_key(clean)
        toks = clean.split()
        if len(toks) == 1:  # first name only -> resolve among persons in the same artifact
            for key, tok in self.person_by_key.items():
                if (artifact is None or artifact in self.person_arts[tok]) and \
                        any(n.split()[0] == toks[0] and len(n.split()) > 1 for n in self.person_names[tok]):
                    self.person_names[tok].add(clean)
                    return tok
        if k not in self.person_by_key and k:
            from rapidfuzz.distance import Levenshtein
            for kk in list(self.person_by_key):
                if kk and kk[0] == k[0] and len(k[1]) > 4 and Levenshtein.distance(kk[1], k[1]) <= 2:
                    k = kk  # OCR variant (Szewezyk ~ Szewczyk, Kudkarni ~ Kulkarni)
                    break
        if k not in self.person_by_key:
            self.counters["PERSON"] += 1
            self.person_by_key[k] = f"PERSON-{self.counters['PERSON']:03d}"
        tok = self.person_by_key[k]
        self.person_names[tok].add(clean)
        if artifact:
            self.person_arts[tok].add(artifact)
        return tok

    def value(self, cat, val):
        norm = re.sub(r"[\s().-]", "", val.lower())
        if cat == "EMAIL":
            k = D.email_key(val)
            if k and k in self.person_by_key:
                return self.person_by_key[k].replace("PERSON", "EMAIL")
        if (cat, norm) not in self.by_value:
            self.counters[cat] += 1
            self.by_value[(cat, norm)] = f"{cat}-{self.counters[cat]:03d}"
        return self.by_value[(cat, norm)]


def build_inventory(segs):
    T = Tokens()
    rows = []
    # persons first (full names before partial) so emails/initials link to them
    order = sorted([(s, sp) for s in segs for sp in s.spans if sp[2] == "PERSON"],
                   key=lambda x: -len(x[0].text[x[1][0]:x[1][1]].split()))
    for s, sp in order:
        if len(s.text[sp[0]:sp[1]].split()) > 1:
            T.person(s.text[sp[0]:sp[1]], s.artifact)
    seen = set()
    for s in segs:
        for a, b, cat, conf, rule in s.spans:
            val = re.sub(r"\s+", " ", s.text[a:b]).strip()
            tok = T.person(val, s.artifact) if cat == "PERSON" else T.value(cat, val)
            key = (s.artifact, s.loc, cat, tok)   # base + enhanced table passes can re-find the same value
            if key in seen:
                continue
            seen.add(key)
            rows.append(dict(artifact=s.artifact, location=s.loc, context=s.ctx, method=s.method,
                             category=cat, tier=D.TIER.get(cat, "Medium"), value=val, token=tok,
                             confidence=conf, rule=rule,
                             snippet=s.text[max(0, a - 40):b + 40].replace("\n", " ")))
    return rows, T


def mask_text(text, spans, toktext):
    out, last = "", 0
    for a, b, cat, conf, rule in spans:
        out += text[last:a] + "[" + toktext(text[a:b], cat) + "]"
        last = b
    return out + text[last:]


SHORT = {"PERSON": "PER", "EMPLOYEE_ID": "EID", "PHONE": "TEL", "EMAIL": "EML", "HOME_ADDRESS": "ADR",
         "PASSPORT": "PPT", "PAN_IN": "PAN", "SSN_PARTIAL": "SSN4", "CARD_PARTIAL": "CRD4", "CARD_NUMBER": "CRD",
         "ACCOUNT_PARTIAL": "ACC4", "IP_ADDRESS": "IP", "CREDENTIAL_ID": "CRED", "PHOTO": "PHOTO"}


def short(tok):
    pre, num = tok.rsplit("-", 1)
    return f"{SHORT.get(pre, pre)}-{num}"


def mask_pdf(segs, T, conf_min=0.6):
    by_page = defaultdict(list)
    for s in segs:
        if s.artifact == A_PDF:
            by_page[s.page].append(s)
    paths, redactions = [], []
    for i, page_path in enumerate(PAGES, 1):
        img = Image.open(page_path).convert("RGB")
        dr = ImageDraw.Draw(img)
        for s in by_page[i]:
            for a, b, cat, conf, rule in s.spans:
                if conf < conf_min:
                    continue
                val = re.sub(r"\s+", " ", s.text[a:b]).strip()
                tok = T.person(val, A_PDF) if cat == "PERSON" else T.value(cat, val)
                tok = short(tok)
                boxes = [w[2] for w in s.words if not (w[1] <= a or w[0] >= b)]
                # group boxes by line (similar y)
                lines = defaultdict(list)
                for bx in boxes:
                    lines[round(bx[1] / 25)].append(bx)
                for ln in lines.values():
                    x0 = min(b_[0] for b_ in ln) - 3; y0 = min(b_[1] for b_ in ln) - 3
                    x1 = max(b_[2] for b_ in ln) + 3; y1 = max(b_[3] for b_ in ln) + 3
                    dr.rectangle([x0, y0, x1, y1], fill=(20, 30, 50))
                    fs = 22
                    while fs > 9:
                        f2 = get_font(fs)
                        if dr.textlength(tok, font=f2) <= (x1 - x0 - 6) and fs <= (y1 - y0):
                            break
                        fs -= 2
                    f2 = get_font(fs)
                    dr.text((x0 + 3, y0 + max(0, (y1 - y0 - fs) / 2) - 1), tok, fill=(240, 200, 90), font=f2)
        # Fail closed: every embedded figure is sealed whole. OCR recall inside figures is unreliable -
        # a name or ID can be missed (e.g. the identity screenshot on p9), so we never pass a figure
        # through on the strength of detection alone. Charts are sacrificed: the correct trade for a PII
        # gate (brief: no unidentified instances passed downstream).
        page_img = Image.open(page_path)
        page_regions = pdf_regions(page_img)
        figs = [r for r in page_regions if r[0] == "image"]
        for f in figs:
            cats = sorted({sp[2] for s in by_page[i] if s.ctx == "image" for sp in s.spans
                           for w in s.words[:1] if f[1] <= w[2][0] <= f[3] and f[2] <= w[2][1] <= f[4]})
            redactions.append(dict(page=i, reason=("pii" if cats else "precaution"), detected=cats,
                                   box=[int(f[1]), int(f[2]), int(f[3]), int(f[4])]))
            dr.rectangle([f[1], f[2], f[3], f[4]], fill=(20, 30, 50))
            fl = get_font(40); fs_ = get_font(30)
            head = "FIGURE REDACTED - image contains personal data" if cats else \
                   "FIGURE REDACTED - sealed, contents not passed to the LLM"
            detail = ", ".join(cats) if cats else "all embedded figures are sealed by policy"
            dr.text((f[1] + 40, f[2] + 40), head, fill=(240, 200, 90), font=fl)
            dr.text((f[1] + 40, f[2] + 100), "Detected: " + detail, fill=(220, 225, 235), font=fs_)
            dr.text((f[1] + 40, f[2] + 145), "Original held in restricted store; see pii_inventory.csv", fill=(220, 225, 235), font=fs_)
        # Fail closed on scanned tables with personal data: multi-column OCR can render a name it never
        # recognized as text (e.g. the Speak Up reporter column), so per-name masking isn't trustworthy -
        # seal the whole table instead.
        for tb in [r for r in page_regions if r[0] == "table"]:
            x0, y0, x1, y1 = tb[1], tb[2], tb[3], tb[4]
            cats = sorted({sp[2] for s in by_page[i] for sp in s.spans for w in s.words
                           if not (w[1] <= sp[0] or w[0] >= sp[1]) and x0 <= w[2][0] <= x1 and y0 <= w[2][1] <= y1})
            if not cats:
                continue
            redactions.append(dict(page=i, reason="table-pii", detected=cats,
                                   box=[int(x0), int(y0), int(x1), int(y1)]))
            dr.rectangle([x0, y0, x1, y1], fill=(20, 30, 50))
            dr.text((x0 + 30, y0 + 20), "TABLE REDACTED - contains personal data", fill=(240, 200, 90), font=get_font(34))
            dr.text((x0 + 30, y0 + 70), "Detected: " + ", ".join(cats), fill=(220, 225, 235), font=get_font(26))
            dr.text((x0 + 30, y0 + 105), "Original held in restricted store; see pii_inventory.csv", fill=(220, 225, 235), font=get_font(26))
        p = os.path.join(WORK, f"masked_p{i:03d}.jpg")
        img.save(p, quality=72, optimize=True)
        paths.append(p)
    import img2pdf
    out = os.path.join(OUT, stem(PDF) + "_MASKED.pdf")
    w0, h0 = Image.open(PAGES[0]).size          # rendered at 300 dpi -> keep original page size
    with open(out, "wb") as f:
        f.write(img2pdf.convert(paths, layout_fun=img2pdf.get_layout_fun((img2pdf.in_to_pt(w0 / 300), img2pdf.in_to_pt(h0 / 300)))))
    return out, redactions


def _tok(T):
    return lambda v, cat: short(T.person(re.sub(r"\s+", " ", v).strip()) if cat == "PERSON" else T.value(cat, re.sub(r"\s+", " ", v).strip()))


def mask_paragraph(p, T):
    text = "".join(r.text for r in p.runs)
    if not text.strip():
        return 0
    sp = [s for s in SPAN_CACHE.get(text, [])]
    if not sp:
        return 0
    new = mask_text(text, sp, _tok(T))
    p.runs[0].text = new
    for r in p.runs[1:]:
        r.text = ""
    return len(sp)


SPAN_CACHE = {}


def mask_docx(segs, T):
    d = Document(DOCX)
    n = 0
    for p in d.paragraphs:
        n += mask_paragraph(p, T)
    for tb in d.tables:
        for row in tb.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    n += mask_paragraph(p, T)
    cp = d.core_properties
    for f in ("author", "last_modified_by"):
        v = getattr(cp, f)
        if v:
            nm = re.sub(r"\[.*?\]\s*", "", v).strip()
            setattr(cp, f, "[" + short(T.person(nm)) + "]")
    tmp = os.path.join(WORK, "docx_masked_tmp.docx")
    d.save(tmp)
    # Fail closed: seal every embedded image that OCR found text in (i.e. a screenshot) whole, not just the
    # detected word boxes - OCR can miss a name inside the shot (e.g. the user-management screenshots).
    seal = {s.image for s in segs if s.artifact == A_DOCX and s.image and s.text.strip()}
    out = os.path.join(OUT, stem(DOCX) + "_MASKED.docx")
    zin, zout = zipfile.ZipFile(tmp), zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
    for item in zin.infolist():
        data = zin.read(item.filename)
        if item.filename in seal:
            img = Image.open(io.BytesIO(data)).convert("RGB")
            dr = ImageDraw.Draw(img)
            dr.rectangle([0, 0, img.width, img.height], fill=(20, 30, 50))
            try:
                dr.text((15, 15), "IMAGE REDACTED - embedded screenshot sealed, not passed to the LLM",
                        fill=(240, 200, 90), font=get_font(max(12, img.width // 45)))
            except Exception:
                pass
            fmt = "JPEG" if item.filename.lower().endswith((".jpg", ".jpeg")) else "PNG"
            buf = io.BytesIO(); img.save(buf, fmt); data = buf.getvalue()
        zout.writestr(item, data)
    zout.close()
    zin.close()
    return out, n


def leakage_gate(rows):
    """Independent verification: re-open the masked outputs and confirm no detected PII value survives.
    DOCX/PPTX are checked in their text layer; the rasterized PDF is RE-OCR'd from the masked page images.
    Catches masking bugs (detected but not removed), not detection misses."""
    texts = {}
    if DOCX:
        d = Document(os.path.join(OUT, stem(DOCX) + "_MASKED.docx"))
        parts = [p.text for p in d.paragraphs] + [c.text for tb in d.tables for row in tb.rows for c in row.cells]
        texts[A_DOCX] = "\n".join(parts)
    if PPTX:
        pr = Presentation(os.path.join(OUT, stem(PPTX) + "_MASKED.pptx"))
        parts = []
        for s in pr.slides:
            for sh in s.shapes:
                if sh.has_text_frame:
                    parts.append(sh.text_frame.text)
                if getattr(sh, "has_table", False) and sh.has_table:
                    parts += [c.text for row in sh.table.rows for c in row.cells]
            if s.has_notes_slide:
                parts.append(s.notes_slide.notes_text_frame.text)
        texts[A_PPTX] = "\n".join(parts)
    if PDF:
        # PDF output is rasterized, so re-OCR the masked page images to read what actually renders
        print("  re-OCR of masked PDF pages for the leakage gate…", flush=True)
        masked_pages = sorted(glob.glob(os.path.join(WORK, "masked_p*.jpg")))
        texts[A_PDF] = " ".join(_run([TESSERACT, p, "stdout", "--psm", "3"]).stdout for p in masked_pages)
    survivors = []
    for r in rows:
        t = texts.get(r["artifact"])
        if t and len(r["value"]) >= 5 and r["value"] in t:   # >=5 chars: skip short partials that collide with words
            survivors.append(dict(artifact=r["artifact"], category=r["category"],
                                  value=r["value"], location=r["location"]))
    return survivors


def mask_pptx(T):
    pr = Presentation(PPTX)
    n = 0
    for s in pr.slides:
        for sh in s.shapes:
            if sh.has_text_frame:
                for p in sh.text_frame.paragraphs:
                    n += mask_paragraph(p, T)
            if getattr(sh, "has_table", False) and sh.has_table:
                for row in sh.table.rows:
                    for cell in row.cells:
                        for p in cell.text_frame.paragraphs:
                            n += mask_paragraph(p, T)
        if s.has_notes_slide:                       # speaker notes can carry PII too
            for p in s.notes_slide.notes_text_frame.paragraphs:
                n += mask_paragraph(p, T)
    cp = pr.core_properties
    for f in ("author", "last_modified_by"):
        v = getattr(cp, f)
        if v:
            setattr(cp, f, "[" + short(T.person(re.sub(r"\[.*?\]\s*", "", v).strip())) + "]")
    out = os.path.join(OUT, stem(PPTX) + "_MASKED.pptx")
    pr.save(out)
    return out, n


if __name__ == "__main__":
    import pickle
    print("Stage 1/4  extracting text (first run can take minutes: OCR of every page)…", flush=True)
    PAGES = render_pdf_pages() if PDF else []
    cache = os.path.join(WORK, "extract.pkl")
    cache_key = (PDF, DOCX, PPTX)
    saved = pickle.load(open(cache, "rb")) if os.path.exists(cache) else None
    if isinstance(saved, dict) and saved.get("key") == cache_key:
        pdf_segs, pages_meta, pdf_native_chars, docx_segs, pptx_segs = saved["data"]
    else:
        pdf_segs, pages_meta, pdf_native_chars = extract_pdf() if PDF else ([], [], 0)
        if DOCX:
            print("  reading Word file and its screenshots…", flush=True)
            docx_segs = extract_docx()
        else:
            docx_segs = []
        pptx_segs = extract_pptx() if PPTX else []
        pickle.dump({"key": cache_key, "data": (pdf_segs, pages_meta, pdf_native_chars, docx_segs, pptx_segs)},
                    open(cache, "wb"))
    with open(os.path.join(WORK, "all_text.txt"), "w", encoding="utf-8") as f_:
        f_.write("\n".join(s.text for s in pdf_segs + docx_segs + pptx_segs))
    segs = pdf_segs + docx_segs + pptx_segs
    print("Stage 2/4  detecting PII…", flush=True)
    gaz = detect_all(segs)

    # for metrics
    inv_segs = [s for s in segs if s.method != "ocr-baseline-figure"]
    rows, T = build_inventory(inv_segs)
    base_fig_rows = [(s.page, sp[2], re.sub(r"\s+", " ", s.text[sp[0]:sp[1]]).strip())
                     for s in segs if s.method == "ocr-baseline-figure" for sp in s.spans]

    for s in docx_segs + pptx_segs:
        if s.method == "native" and s.ctx != "metadata":
            SPAN_CACHE[s.text] = s.spans
    # docx/pptx paragraph text may differ from cell text joined with ' ; ' -> re-detect per paragraph
    def para_spans(text):
        sp = D.regex_spans(text) + D.person_spans_pattern(text) + D.gazetteer_spans(text, gaz) + D.person_spans_ner(nlp, text)
        return D.resolve_overlaps(sp)
    for doc_path, kind in ([(DOCX, "docx")] if DOCX else []) + ([(PPTX, "pptx")] if PPTX else []):
        if kind == "docx":
            d = Document(doc_path)
            paras = list(d.paragraphs) + [p for tb in d.tables for row in tb.rows for c in row.cells for p in c.paragraphs]
        else:
            pr = Presentation(doc_path)
            paras = []
            for s in pr.slides:
                for sh in s.shapes:
                    if sh.has_text_frame:
                        paras += list(sh.text_frame.paragraphs)
                    if getattr(sh, "has_table", False) and sh.has_table:
                        paras += [p for row in sh.table.rows for c in row.cells for p in c.text_frame.paragraphs]
                if s.has_notes_slide:
                    paras += list(s.notes_slide.notes_text_frame.paragraphs)
        for p in paras:
            t = "".join(r.text for r in p.runs)
            if t.strip() and t not in SPAN_CACHE:
                SPAN_CACHE[t] = para_spans(t)

    print("Stage 3/4  writing masked copies…", flush=True)
    pdf_out = docx_out = pptx_out = None
    fig_redactions = []
    if PDF:
        pdf_out, fig_redactions = mask_pdf(inv_segs, T)
    if DOCX:
        docx_out, nd = mask_docx(inv_segs, T)
    if PPTX:
        pptx_out, np_ = mask_pptx(T)

    INV_FIELDS = ["artifact", "location", "context", "method", "category", "tier",
                  "value", "token", "confidence", "rule", "snippet"]
    with open(os.path.join(OUT, "pii_inventory.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=INV_FIELDS)
        w.writeheader(); w.writerows(rows)
    xref = []
    for tok, names in sorted(T.person_names.items()):
        arts = sorted({r["artifact"] for r in rows if r["token"] in (tok, tok.replace("PERSON", "EMAIL"))})
        xref.append(dict(token=tok, names=" | ".join(sorted(names)), artifacts=" + ".join(arts),
                         mentions=sum(1 for r in rows if r["token"] == tok)))
    with open(os.path.join(OUT, "person_token_map.csv"), "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["token", "names", "artifacts", "mentions"]); w.writeheader(); w.writerows(xref)
    text_chars = Counter()
    for s in inv_segs:
        text_chars[s.artifact] += len(s.text)
    # embedded media we cannot OCR (vector EMF/SVG/WMF) -> flag for manual review, don't claim it's clean
    uninspected_media = []
    for path, art in (([(DOCX, A_DOCX)] if DOCX else []) + ([(PPTX, A_PPTX)] if PPTX else [])):
        for name in zipfile.ZipFile(path).namelist():
            if "/media/" in name and not name.lower().endswith((".png", ".jpg", ".jpeg")):
                uninspected_media.append(dict(artifact=art, media=os.path.basename(name)))
    if uninspected_media:
        print(f"  note: {len(uninspected_media)} embedded vector media (EMF/SVG/WMF) flagged for manual review "
              f"(cannot OCR to verify)", flush=True)

    residual_leaks = leakage_gate(rows)
    if residual_leaks:
        print(f"  !! LEAKAGE GATE: {len(residual_leaks)} detected PII value(s) still present in masked text:", flush=True)
        for L in residual_leaks[:10]:
            print(f"       {L['artifact']} | {L['category']} | {L['value']!r} | {L['location']}", flush=True)
    else:
        print("  leakage gate PASSED: 0 detected PII values survive in masked DOCX/PPTX text or re-OCR'd PDF", flush=True)
    json.dump(dict(pages=pages_meta, pdf_native_chars=pdf_native_chars, text_chars=text_chars,
                   figure_redactions=fig_redactions, residual_leaks=residual_leaks,
                   uninspected_media=uninspected_media,
                   base_fig=base_fig_rows, masked=[x for x in (pdf_out, docx_out, pptx_out) if x]),
              open(os.path.join(OUT, "run_meta.json"), "w", encoding="utf-8"), default=str, indent=1)
    print("Stage 4/4  computing metrics…", flush=True)
    import metrics
    metrics.run(OUT, os.path.join(WORK, "all_text.txt"))
    print(f"\nDone: {len(rows)} findings, {len(xref)} people. Results in: {OUT}")
