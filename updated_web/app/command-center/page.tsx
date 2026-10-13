"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle, XCircle } from "lucide-react"
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

  const RISK_W: Record<string, number> = { Critical: 3, High: 2, Medium: 1 }
  const riskScore = scanData ? scanData.audit.reduce((s, r) => s + (RISK_W[r.tier] || 0), 0) : 0
  const nCrit = scanData ? scanData.audit.filter((r) => r.tier === "Critical").length : 0
  const nHigh = scanData ? scanData.audit.filter((r) => r.tier === "High").length : 0

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-wider">COMMAND CENTER</h1>
        <p className="text-sm text-neutral-400">Strip PII from documents before they reach an AI model — and prove nothing leaked</p>
      </div>

      {/* Upload panel */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-neutral-300 tracking-wider">UPLOAD TARGET DOCUMENT</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragging(false)
              pick(e.dataTransfer.files[0])
            }}
            className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors ${
              dragging
                ? "border-orange-500 bg-orange-500/10"
                : chosen
                  ? "border-orange-500/50 bg-neutral-800"
                  : "border-neutral-600 hover:border-neutral-500"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.pptx"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0] || null)}
            />
            <Upload className="w-8 h-8 text-neutral-400 mx-auto mb-3" />
            {chosen ? (
              <p className="text-orange-500 font-mono text-sm">{chosen.name}</p>
            ) : (
              <>
                <p className="text-neutral-300 text-sm">
                  Drop a <b>PDF</b>, <b>Word</b> or <b>PowerPoint</b> file here
                </p>
                <p className="text-neutral-500 text-xs mt-1">or click to browse</p>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <label className="text-xs text-neutral-400 tracking-wider">NER MODEL</label>
              <select
                value={ner}
                onChange={(e) => setNer(e.target.value)}
                className="bg-neutral-800 border border-neutral-600 text-white text-sm rounded px-3 py-1.5 font-mono"
              >
                <option value="en_core_web_sm">Fast (sm)</option>
                <option value="en_core_web_trf">Stronger (trf)</option>
              </select>
            </div>
            <Button
              onClick={runScan}
              disabled={!chosen || scanStatus === "scanning"}
              className="bg-orange-500 hover:bg-orange-600 text-white ml-auto"
            >
              {scanStatus === "scanning" ? "SCANNING…" : "SCAN & REDACT"}
            </Button>
          </div>
          <p className="text-xs text-neutral-500">
            PDFs are OCR&apos;d page-by-page (~10-15 min first run, cached after). Office files are quick.
          </p>
        </CardContent>
      </Card>

      {/* Progress stepper */}
      {(scanStatus === "scanning" || scanStatus === "done" || scanStatus === "error") && (
        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-6">
            <div className="flex items-center mb-6">
              {STEPS.map((step, i) => (
                <div key={step} className="flex items-center flex-1">
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-mono transition-colors ${
                        i < currentStep
                          ? "border-white bg-white text-black"
                          : i === currentStep
                            ? "border-orange-500 bg-orange-500/20 text-orange-500 animate-pulse"
                            : "border-neutral-600 text-neutral-600"
                      }`}
                    >
                      {i < currentStep ? "✓" : i + 1}
                    </div>
                    <span
                      className={`text-xs mt-1 tracking-wider ${
                        i === currentStep
                          ? "text-orange-500"
                          : i < currentStep
                            ? "text-white"
                            : "text-neutral-600"
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-px mx-2 ${i < currentStep ? "bg-white" : "bg-neutral-700"}`} />
                  )}
                </div>
              ))}
            </div>
            {scanStatus === "scanning" && stageLog.length > 0 && (
              <div className="bg-neutral-800 rounded p-3 max-h-28 overflow-y-auto">
                {stageLog.slice(-6).map((line, i) => (
                  <p key={i} className="text-xs text-neutral-400 font-mono">
                    {line}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {errorMsg && (
        <Card className="bg-red-950 border-red-800">
          <CardContent className="p-4">
            <p className="text-red-400 text-sm font-mono whitespace-pre-wrap">{errorMsg}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {scanData && scanStatus === "done" && (
        <>
          {/* Gate banner */}
          <div
            className={`p-4 rounded-lg border flex items-center gap-3 ${
              scanData.residual === 0
                ? "bg-neutral-800 border-white/20"
                : "bg-red-950 border-red-700"
            }`}
          >
            {scanData.residual === 0 ? (
              <>
                <CheckCircle className="w-5 h-5 text-white flex-shrink-0" />
                <span className="text-sm text-white">
                  LEAKAGE GATE PASSED — 0 PII values survive in the redacted output (independently verified via
                  re-OCR).
                </span>
              </>
            ) : (
              <>
                <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <span className="text-sm text-red-400">
                  LEAKAGE GATE FAILED — {scanData.residual} residual leak(s) found. Review before sending to
                  LLM.
                </span>
              </>
            )}
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Card className="bg-neutral-900 border-neutral-700">
              <CardContent className="p-4 text-center">
                <div
                  className={`text-3xl font-bold font-mono mb-1 ${
                    nCrit > 0 ? "text-red-500" : nHigh > 0 ? "text-orange-500" : "text-white"
                  }`}
                >
                  {riskScore}
                </div>
                <div className="text-xs text-neutral-400 tracking-wider">RISK SCORE</div>
                <div className="text-xs text-neutral-600 mt-1">
                  {nCrit > 0 ? "CRITICAL" : nHigh > 0 ? "ELEVATED" : "LOW"}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-neutral-900 border-neutral-700">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold font-mono text-white mb-1">{scanData.findings}</div>
                <div className="text-xs text-neutral-400 tracking-wider">FINDINGS</div>
              </CardContent>
            </Card>
            <Card className="bg-neutral-900 border-neutral-700">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold font-mono text-white mb-1">{scanData.people}</div>
                <div className="text-xs text-neutral-400 tracking-wider">UNIQUE PEOPLE</div>
              </CardContent>
            </Card>
            <Card className="bg-neutral-900 border-neutral-700">
              <CardContent className="p-4 text-center">
                <div className="text-3xl font-bold font-mono text-white mb-1">{scanData.sealed}</div>
                <div className="text-xs text-neutral-400 tracking-wider">REGIONS SEALED</div>
              </CardContent>
            </Card>
            <Card
              className={`border ${
                scanData.residual === 0 ? "bg-neutral-900 border-neutral-700" : "bg-red-950 border-red-800"
              }`}
            >
              <CardContent className="p-4 text-center">
                <div
                  className={`text-3xl font-bold font-mono mb-1 ${
                    scanData.residual === 0 ? "text-white" : "text-red-400"
                  }`}
                >
                  {scanData.residual}
                </div>
                <div className="text-xs text-neutral-400 tracking-wider">RESIDUAL LEAKS</div>
              </CardContent>
            </Card>
          </div>

          {/* Tier breakdown */}
          <div className="grid grid-cols-3 gap-4">
            {(
              [
                { tier: "Critical", border: "border-red-900", text: "text-red-500" },
                { tier: "High", border: "border-orange-900", text: "text-orange-500" },
                { tier: "Medium", border: "border-neutral-700", text: "text-neutral-300" },
              ] as const
            ).map(({ tier, border, text }) => {
              const count = scanData.audit.filter((r) => r.tier === tier).length
              return (
                <Card key={tier} className={`bg-neutral-900 border ${border}`}>
                  <CardContent className="p-4 text-center">
                    <div className={`text-2xl font-bold font-mono ${text}`}>{count}</div>
                    <div className="text-xs text-neutral-400 tracking-wider mt-1">{tier.toUpperCase()} TIER</div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Scan log */}
          {stageLog.length > 0 && (
            <Card className="bg-neutral-900 border-neutral-700">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-neutral-400 tracking-wider">SCAN LOG</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {stageLog.slice(-12).map((line, i) => (
                    <div key={i} className="text-xs text-neutral-400 font-mono border-l-2 border-orange-500/40 pl-2">
                      {line}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
