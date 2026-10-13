"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CheckCircle, Settings, Cpu, Database, Shield, Activity } from "lucide-react"

const components = [
  {
    id: "OCR",
    name: "TESSERACT OCR ENGINE",
    desc: "Extracts text from scanned PDF pages at 300 dpi with enhanced upscale pass for figures",
    note: "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
  },
  {
    id: "NLP",
    name: "SPACY NER ENGINE",
    desc: "Named entity recognition for person name detection; en_core_web_sm (fast) or en_core_web_trf (stronger)",
    note: "detect.py · person_spans_ner() + plausible_person()",
  },
  {
    id: "PDF",
    name: "POPPLER PDF RENDERER",
    desc: "Converts PDF pages to images for OCR; pdftotext extracts any embedded native text layer",
    note: "pdftoppm · pdftotext",
  },
  {
    id: "DETECT",
    name: "HYBRID DETECTION ENGINE",
    desc: "16+ PII types via regex + checksums (Luhn, PESEL, PAN-IN, SSN) + spaCy NER + wordfreq + gazetteer",
    note: "detect.py · regex_spans() + person_spans_pattern() + ocr_tolerant_spans()",
  },
  {
    id: "SEAL",
    name: "FAIL-CLOSED SEALING",
    desc: "Entire figures and PII-containing scanned tables sealed as dark image blocks — OCR is never fully trusted",
    note: "pipeline.py · mask_pdf() fail-closed logic",
  },
  {
    id: "GATE",
    name: "INDEPENDENT LEAKAGE GATE",
    desc: "Re-opens masked output and re-OCRs masked PDF pages to assert 0 PII values survive redaction",
    note: "pipeline.py · leakage_gate() — caught real leaks that manual review missed",
  },
]

const pipeline = [
  {
    n: "1",
    name: "EXTRACT",
    detail:
      "PDF → Poppler renders @300dpi → Tesseract OCR + enhanced 2nd pass for figures; DOCX/PPTX → python-docx/pptx; embedded images OCR'd",
  },
  {
    n: "2",
    name: "DETECT & CLASSIFY",
    detail:
      "Regex + checksums + spaCy NER + name patterns + wordfreq + gazetteer; OCR-tolerant fuzzy keyword matching for scanned docs",
  },
  {
    n: "3",
    name: "RESOLVE",
    detail:
      "Stable pseudonymous tokens (PER-016, EML-002) shared across all artifacts; OCR variants merged via edit-distance",
  },
  {
    n: "4",
    name: "REDACT",
    detail:
      "Text: in-place token substitution; Figures: sealed whole; Scanned tables with PII: sealed whole — fail-closed",
  },
  {
    n: "5",
    name: "REPORT",
    detail:
      "pii_inventory.csv · person_token_map.csv (re-ID key, server-side only) · metrics.json · run_meta.json",
  },
  {
    n: "6",
    name: "VERIFY",
    detail:
      "Re-opens masked DOCX/PPTX text + re-OCRs masked PDF; asserts 0 detected PII values survive in output",
  },
]

const piiTypes = [
  { cat: "SSN", tier: "Critical" },
  { cat: "PASSPORT", tier: "Critical" },
  { cat: "PAN_IN", tier: "Critical" },
  { cat: "PESEL", tier: "Critical" },
  { cat: "TIN", tier: "Critical" },
  { cat: "CARD_NUMBER", tier: "Critical" },
  { cat: "SSN_PARTIAL", tier: "High" },
  { cat: "CARD_PARTIAL", tier: "High" },
  { cat: "ACCOUNT_PARTIAL", tier: "High" },
  { cat: "DOB", tier: "High" },
  { cat: "HOME_ADDRESS", tier: "High" },
  { cat: "PHOTO", tier: "High" },
  { cat: "PHONE", tier: "Medium" },
  { cat: "EMAIL", tier: "Medium" },
  { cat: "PERSON", tier: "Medium" },
  { cat: "EMPLOYEE_ID", tier: "Medium" },
  { cat: "IP_ADDRESS", tier: "Medium" },
  { cat: "CREDENTIAL_ID", tier: "Medium" },
]

export default function SystemsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-wider">PIPELINE STATUS</h1>
        <p className="text-sm text-neutral-400">Detection engine components and 6-stage pipeline architecture</p>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "COMPONENTS", val: "6", icon: Settings },
          { label: "ALL ONLINE", val: "✓", icon: CheckCircle },
          { label: "PII TYPES", val: "18", icon: Database },
          { label: "FULLY OFFLINE", val: "100%", icon: Shield },
        ].map(({ label, val, icon: Icon }) => (
          <Card key={label} className="bg-neutral-900 border-neutral-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-neutral-400 tracking-wider">{label}</p>
                  <p className="text-2xl font-bold text-white font-mono">{val}</p>
                </div>
                <Icon className="w-8 h-8 text-white" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Component cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        {components.map((c) => (
          <Card key={c.id} className="bg-neutral-900 border-neutral-700">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white tracking-wider">{c.name}</p>
                  <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">{c.desc}</p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <div className="w-2 h-2 rounded-full bg-white"></div>
                  <span className="text-xs text-white">ON</span>
                </div>
              </div>
              <p className="text-xs text-neutral-600 font-mono truncate">{c.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline stages */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-xs text-neutral-400 tracking-wider">6-STAGE PIPELINE ARCHITECTURE</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pipeline.map((p) => (
            <div key={p.n} className="flex items-start gap-4 border-l-2 border-orange-500 pl-4">
              <div className="w-7 h-7 rounded-full bg-orange-500 text-black text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                {p.n}
              </div>
              <div>
                <p className="text-sm font-bold text-white tracking-wider">{p.name}</p>
                <p className="text-xs text-neutral-400 mt-0.5 leading-relaxed">{p.detail}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* PII categories */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-xs text-neutral-400 tracking-wider">
            DETECTED PII CATEGORIES · 18 TYPES ACROSS 3 TIERS
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {piiTypes.map(({ cat, tier }) => (
              <div
                key={cat}
                className={`text-xs px-2 py-1.5 rounded border font-mono text-center ${
                  tier === "Critical"
                    ? "border-red-900 text-red-400 bg-red-950/30"
                    : tier === "High"
                      ? "border-orange-900 text-orange-400 bg-orange-950/20"
                      : "border-neutral-700 text-neutral-400"
                }`}
              >
                {cat}
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-red-500 inline-block"></span>
              <span className="text-neutral-400">Critical</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-orange-500 inline-block"></span>
              <span className="text-neutral-400">High</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-neutral-500 inline-block"></span>
              <span className="text-neutral-400">Medium</span>
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
