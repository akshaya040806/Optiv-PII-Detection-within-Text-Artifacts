"""Tiny Flask backend for the PII gate web UI.

Serves web/ (HTML/CSS/JS) and runs the pipeline on an uploaded file. The masked output and the
re-identification key stay server-side; only tokens and the redacted file are exposed.

Run:  python server.py   then open http://127.0.0.1:5000
"""
import csv
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

from flask import (Flask, request, jsonify, send_file, send_from_directory,
                   Response, stream_with_context)

HERE = Path(__file__).parent
app = Flask(__name__, static_folder=str(HERE / "web"), static_url_path="")
SESSIONS = {}  # sid -> {outdir, masked}

TESS = os.environ.get("TESSERACT", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
_pop = glob.glob(r"C:\poppler*\**\pdftoppm.exe", recursive=True)
POPPLER = os.environ.get("POPPLER", str(Path(_pop[0]).parent) if _pop else "")


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


def _mask_snippet(snippet, value, token):
    """Tokens-only guarantee: blank the finding's own raw value out of its context preview."""
    if not value or not snippet:
        return snippet
    pat = re.compile(r"\s+".join(map(re.escape, value.split())))
    return pat.sub("[" + token + "]", snippet)


def _build_result(outdir, filename):
    metrics = json.load(open(outdir / "metrics.json", encoding="utf-8"))
    rows = list(csv.DictReader(open(outdir / "pii_inventory.csv", encoding="utf-8-sig")))
    masked = next((p for p in outdir.glob("*_MASKED.*")), None)
    sid = uuid.uuid4().hex
    SESSIONS[sid] = {"outdir": outdir, "masked": str(masked) if masked else None}
    return dict(
        sid=sid, filename=filename,
        masked_name=(masked.name if masked else None),
        findings=len(rows),
        people=metrics.get("unique_people", 0),
        sealed=len(metrics.get("figure_redactions", [])),
        residual=metrics.get("residual_leak_count", 0),
        audit=[{"category": x["category"], "tier": x["tier"], "token": x["token"],
                "rule": x["rule"], "location": x["location"], "confidence": x["confidence"],
                "snippet": _mask_snippet(x.get("snippet", ""), x.get("value", ""), x["token"])}
               for x in rows],
    )


@app.post("/scan")
def scan():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify(error="No file uploaded"), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in (".pdf", ".docx", ".pptx"):
        return jsonify(error="Only .pdf, .docx and .pptx are supported"), 400

    work = Path(tempfile.mkdtemp(prefix="pii_web_"))
    inp = work / f.filename
    f.save(str(inp))
    outdir = work / "out"
    filename = f.filename
    ner = request.form.get("ner", "en_core_web_sm")
    cmd = [sys.executable, str(HERE / "pipeline.py"), "--file", str(inp), "--out", str(outdir),
           "--ner-model", ner, "--no-gui"]
    if TESS:
        cmd += ["--tesseract", TESS]
    if POPPLER:
        cmd += ["--poppler", POPPLER]

    def generate():
        # Stream the pipeline's own stage output line-by-line (P:…), then the final JSON result (R:…).
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                text=True, bufsize=1, encoding="utf-8", errors="replace")
        tail = []
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                tail.append(line)
                yield "P:" + line + "\n"
        proc.wait()
        if proc.returncode != 0:
            yield "E:" + json.dumps({"error": "Pipeline failed", "log": "\n".join(tail[-40:])}) + "\n"
            return
        try:
            result = _build_result(outdir, filename)
        except Exception as e:  # noqa: BLE001  (surface any result-build failure to the client)
            yield "E:" + json.dumps({"error": "Result build failed: %s" % e}) + "\n"
            return
        yield "R:" + json.dumps(result) + "\n"

    return Response(stream_with_context(generate()), mimetype="text/plain",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/download/<sid>")
def download_masked(sid):
    s = SESSIONS.get(sid)
    if not s or not s["masked"]:
        return "Not found", 404
    return send_file(s["masked"], as_attachment=True, download_name=os.path.basename(s["masked"]))


@app.get("/download/<sid>/inventory")
def download_inventory(sid):
    s = SESSIONS.get(sid)
    if not s:
        return "Not found", 404
    return send_file(str(Path(s["outdir"]) / "pii_inventory.csv"),
                     as_attachment=True, download_name="pii_inventory.csv")


if __name__ == "__main__":
    print("PII Gate UI -> open http://127.0.0.1:5000  (Ctrl+C to stop)")
    app.run(host="127.0.0.1", port=5000, debug=False)
