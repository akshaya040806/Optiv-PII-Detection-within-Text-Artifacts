"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle, XCircle, ShieldCheck, ShieldAlert } from "lucide-react"
import type { ScanData } from "../page"

type Props = {
  scanData: ScanData | null
  setScanData: (d: ScanData) => void
  scanStatus: string
  setScanStatus: (s: "idle" | "scanning" | "done" | "error") => void
  stageLog: string[]
  setStageLog: (fn: (prev: string[]) => string[]) => void
  currentStep: number
  setCurrentStep: (n: number) => void
}

const STEPS = ["EXTRACT", "DETECT", "REDACT", "VERIFY"]
const RISK_W: Record<string, number> = { Critical: 3, High: 2, Medium: 1 }

export default function CommandCenterPage({
  scanData,
  setScanData,
  scanStatus,
  setScanStatus,
  stageLog,
  setStageLog,
  currentStep,
  setCurrentStep,
}: Props) {
  const [chosen, setChosen] = useState<File | null>(null)
  const [ner, setNer] = useState("en_core_web_sm")
  const [errorMsg, setErrorMsg] = useState("")
  const [dragging, setDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function pick(file: File | null) {
    if (!file) return
    const ok = [".pdf", ".docx", ".pptx"].some((e) => file.name.toLowerCase().endsWith(e))
    if (!ok) {
      setErrorMsg("Only .pdf, .docx and .pptx files are supported.")
      return
    }
    setChosen(file)
    setErrorMsg("")
  }

  function stepFromLine(line: string) {
    if (line.includes("Stage 1")) return 0
    if (line.includes("Stage 2")) return 1
    if (line.includes("Stage 3")) return 2
    if (line.includes("gate") || line.includes("re-OCR")) return 3
    return -1
  }

  async function runScan() {
    if (!chosen || scanStatus === "scanning") return
    setErrorMsg("")
    setScanStatus("scanning")
    setStageLog(() => [])
    setCurrentStep(0)

    const fd = new FormData()
    fd.append("file", chosen)
    fd.append("ner", ner)

    try {
      const res = await fetch("/scan", { method: "POST", body: fd })
      if (!res.ok) {
        const e = await res.json().catch(() => ({ error: "Request failed (" + res.status + ")" }))
        setErrorMsg(e.error || "Request failed")
        setScanStatus("error")
        return
      }
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ""
      let result: ScanData | null = null
      let err: any = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let nl: number
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl)
          buf = buf.slice(nl + 1)
          if (!line) continue
          const tag = line.slice(0, 2)
          const rest = line.slice(2)
          if (tag === "P:") {
            setStageLog((prev) => [...prev.slice(-50), rest])
            const step = stepFromLine(rest)
            if (step >= 0) setCurrentStep(step)
          } else if (tag === "R:") {
            result = JSON.parse(rest) as ScanData
            result.audit.forEach((r, i) => {
              r._id = i
              r._conf = parseFloat(r.confidence) || 0
            })
          } else if (tag === "E:") {
            err = JSON.parse(rest)
          }
        }
      }

      setCurrentStep(4)
      if (err) {
        setErrorMsg(err.error + (err.log ? "\n\n" + err.log : ""))
        setScanStatus("error")
      } else if (result) {
        setScanData(result)
        setScanStatus("done")
      } else {
        setErrorMsg("No result returned by server.")
        setScanStatus("error")
      }
    } catch (e: any) {
      setErrorMsg("Request failed: " + e.message)
      setScanStatus("error")
    }
  }

  // ── derived summary data ──
  const audit = scanData?.audit ?? []
  const has = scanStatus === "done" && !!scanData
  const riskScore = audit.reduce((s, r) => s + (RISK_W[r.tier] || 0), 0)
  const tierCount = {
    Critical: audit.filter((r) => r.tier === "Critical").length,
    High: audit.filter((r) => r.tier === "High").length,
    Medium: audit.filter((r) => r.tier === "Medium").length,
  }
  const catCounts = Object.entries(
    audit.reduce<Record<string, number>>((m, r) => ((m[r.category] = (m[r.category] || 0) + 1), m), {}),
  ).sort((a, b) => b[1] - a[1])
  const maxCat = Math.max(1, ...catCounts.map((c) => c[1]))
  const recent = [...audit]
    .sort((a, b) => (RISK_W[b.tier] || 0) - (RISK_W[a.tier] || 0) || b._conf - a._conf)
    .slice(0, 14)
  const tierColor = (t: string) => (t === "Critical" ? "text-red-500" : t === "High" ? "text-orange-500" : "text-neutral-300")

  const Panel = ({ title, children, className = "" }: any) => (
    <Card className={`bg-neutral-900 border-neutral-700 ${className}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs text-neutral-400 tracking-wider">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-wider">COMMAND CENTER</h1>
        <p className="text-sm text-neutral-400">Strip PII from documents before they reach an AI model — and prove nothing leaked</p>
      </div>

      {/* ── INGEST bar (upload) ── */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardContent className="p-4">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) }}
              className={`flex-1 border-2 border-dashed rounded-lg px-6 py-5 text-center cursor-pointer transition-colors ${
                dragging ? "border-orange-500 bg-orange-500/10" : chosen ? "border-orange-500/50 bg-neutral-800" : "border-neutral-600 hover:border-neutral-500"
              }`}
            >
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.pptx" className="hidden" onChange={(e) => pick(e.target.files?.[0] || null)} />
              <div className="flex items-center justify-center gap-3">
                <Upload className="w-5 h-5 text-neutral-400" />
                {chosen ? (
                  <span className="text-orange-500 font-mono text-sm">{chosen.name}</span>
                ) : (
                  <span className="text-neutral-300 text-sm">
                    Drop a <b>PDF</b>, <b>Word</b> or <b>PowerPoint</b> file — or click to browse
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2">
                <label className="text-xs text-neutral-400 tracking-wider">NER</label>
                <select value={ner} onChange={(e) => setNer(e.target.value)}
                  className="bg-neutral-800 border border-neutral-600 text-white text-sm rounded px-3 py-1.5 font-mono">
                  <option value="en_core_web_sm">Fast (sm)</option>
                  <option value="en_core_web_trf">Stronger (trf)</option>
                </select>
              </div>
              <Button onClick={runScan} disabled={!chosen || scanStatus === "scanning"} className="bg-orange-500 hover:bg-orange-600 text-white">
                {scanStatus === "scanning" ? "SCANNING…" : "SCAN & REDACT"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── progress stepper ── */}
      {(scanStatus === "scanning" || scanStatus === "error") && (
        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-6">
            <div className="flex items-center mb-4">
              {STEPS.map((step, i) => (
                <div key={step} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-mono transition-colors ${
                      i < currentStep ? "border-white bg-white text-black" : i === currentStep ? "border-orange-500 bg-orange-500/20 text-orange-500 animate-pulse" : "border-neutral-600 text-neutral-600"
                    }`}>{i < currentStep ? "✓" : i + 1}</div>
                    <span className={`text-xs mt-1 tracking-wider ${i === currentStep ? "text-orange-500" : i < currentStep ? "text-white" : "text-neutral-600"}`}>{step}</span>
                  </div>
                  {i < STEPS.length - 1 && <div className={`flex-1 h-px mx-2 ${i < currentStep ? "bg-white" : "bg-neutral-700"}`} />}
                </div>
              ))}
            </div>
            {scanStatus === "scanning" && stageLog.length > 0 && (
              <div className="bg-neutral-800 rounded p-3 max-h-24 overflow-y-auto">
                {stageLog.slice(-5).map((line, i) => <p key={i} className="text-xs text-neutral-400 font-mono">{line}</p>)}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {errorMsg && (
        <Card className="bg-red-950 border-red-800"><CardContent className="p-4">
          <p className="text-red-400 text-sm font-mono whitespace-pre-wrap">{errorMsg}</p>
        </CardContent></Card>
      )}

      {/* ── top grid: SUMMARY · DETECTION LOG · VERIFICATION ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Detection summary (tier trio + top categories) */}
        <Panel title="DETECTION SUMMARY">
          {has ? (
            <>
              <div className="grid grid-cols-3 gap-2 text-center mb-4">
                <div><div className="text-3xl font-bold font-mono text-red-500">{tierCount.Critical}</div><div className="text-[11px] text-neutral-500 tracking-wider mt-1">CRITICAL</div></div>
                <div><div className="text-3xl font-bold font-mono text-orange-500">{tierCount.High}</div><div className="text-[11px] text-neutral-500 tracking-wider mt-1">HIGH</div></div>
                <div><div className="text-3xl font-bold font-mono text-neutral-300">{tierCount.Medium}</div><div className="text-[11px] text-neutral-500 tracking-wider mt-1">MEDIUM</div></div>
              </div>
              <div className="space-y-1.5">
                {catCounts.slice(0, 5).map(([c, n]) => (
                  <div key={c} className="flex items-center justify-between bg-neutral-800 rounded px-3 py-2">
                    <span className="text-sm text-neutral-300 font-mono">{c}</span>
                    <span className="text-sm text-orange-500 font-mono font-bold">{n}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <Awaiting />}
        </Panel>

        {/* Detection log (recent findings feed) */}
        <Panel title="DETECTION LOG">
          <div className="max-h-[260px] overflow-y-auto space-y-3">
            {has ? recent.map((r) => (
              <div key={r._id} className="border-l-2 border-orange-500/40 pl-3">
                <div className="text-xs text-neutral-500 font-mono">{r.location} · conf {r._conf.toFixed(2)}</div>
                <div className="text-sm text-neutral-300">
                  <span className={`font-mono font-bold ${tierColor(r.tier)}`}>{r.category}</span>{" "}
                  masked as <span className="text-orange-500 font-mono">{r.token}</span>
                </div>
              </div>
            )) : <Awaiting />}
          </div>
        </Panel>

        {/* Verification gate (radar + terminal) */}
        <Panel title="VERIFICATION GATE">
          <div className="flex justify-center mb-3">
            <svg viewBox="0 0 120 120" className="w-28 h-28">
              <circle cx="60" cy="60" r="52" fill="none" stroke="#404040" strokeWidth="1" />
              <circle cx="60" cy="60" r="34" fill="none" stroke="#404040" strokeWidth="1" />
              <circle cx="60" cy="60" r="16" fill="none" stroke="#404040" strokeWidth="1" />
              <line x1="60" y1="4" x2="60" y2="116" stroke="#404040" strokeWidth="1" />
              <line x1="4" y1="60" x2="116" y2="60" stroke="#404040" strokeWidth="1" />
              <circle cx="60" cy="60" r="52" fill="none" stroke={has ? (scanData!.residual === 0 ? "#f97316" : "#ef4444") : "#404040"}
                strokeWidth="2" strokeDasharray="4 6" opacity="0.8" />
              {has && <circle cx="60" cy="60" r="4" fill={scanData!.residual === 0 ? "#f97316" : "#ef4444"} />}
            </svg>
          </div>
          {has ? (
            <div className="font-mono text-xs space-y-1.5">
              <div className="flex items-center gap-2">
                {scanData!.residual === 0 ? <ShieldCheck className="w-4 h-4 text-orange-500" /> : <ShieldAlert className="w-4 h-4 text-red-500" />}
                <span className={scanData!.residual === 0 ? "text-orange-500" : "text-red-500"}>
                  {scanData!.residual === 0 ? "GATE PASSED" : "GATE FAILED"}
                </span>
              </div>
              <div className="text-neutral-500">&gt; re-OCR masked output</div>
              <div className="text-neutral-500">&gt; residual PII values :: <span className={scanData!.residual === 0 ? "text-orange-500" : "text-red-500"}>{scanData!.residual}</span></div>
              <div className="text-neutral-400">&gt; status :: {scanData!.residual === 0 ? "CLEARED FOR LLM" : "BLOCKED — REVIEW"}</div>
            </div>
          ) : <Awaiting />}
        </Panel>
      </div>

      {/* ── bottom grid: CATEGORY DISTRIBUTION (wide) · SCAN SUMMARY ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="CATEGORY DISTRIBUTION" className="lg:col-span-2">
          {has ? (
            <div className="space-y-2.5">
              {catCounts.map(([c, n]) => (
                <div key={c} className="grid grid-cols-[130px_1fr_40px] items-center gap-3">
                  <span className="text-xs text-neutral-300 font-mono truncate text-right">{c}</span>
                  <div className="h-3.5 bg-neutral-800 rounded overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${(n / maxCat) * 100}%`, background: "linear-gradient(90deg,#3f3f46,#f97316)" }} />
                  </div>
                  <span className="text-xs text-neutral-400 font-mono text-right">{n}</span>
                </div>
              ))}
            </div>
          ) : <Awaiting />}
        </Panel>

        <Panel title="SCAN SUMMARY">
          {has ? (
            <div className="space-y-2 font-mono text-sm">
              <Row label="RISK SCORE" value={riskScore} accent={tierCount.Critical ? "text-red-500" : tierCount.High ? "text-orange-500" : "text-white"} />
              <Row label="FINDINGS" value={scanData!.findings} />
              <Row label="UNIQUE PEOPLE" value={scanData!.people} />
              <Row label="REGIONS SEALED" value={scanData!.sealed} />
              <Row label="RESIDUAL LEAKS" value={scanData!.residual} accent={scanData!.residual === 0 ? "text-orange-500" : "text-red-500"} />
              <div className="pt-2 mt-2 border-t border-neutral-700 text-xs text-neutral-500 truncate">{scanData!.filename}</div>
            </div>
          ) : <Awaiting />}
        </Panel>
      </div>
    </div>
  )
}

function Awaiting() {
  return (
    <div className="flex items-center justify-center py-8 text-center">
      <div>
        <div className="w-2 h-2 rounded-full bg-neutral-600 mx-auto mb-2" />
        <p className="text-xs text-neutral-600 tracking-wider font-mono">AWAITING SCAN</p>
      </div>
    </div>
  )
}

function Row({ label, value, accent = "text-white" }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-400 text-xs tracking-wider">{label}</span>
      <span className={`font-bold ${accent}`}>{value}</span>
    </div>
  )
}
