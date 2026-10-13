"use client"

import { useState, useEffect, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, XCircle, Download } from "lucide-react"
import type { ScanData } from "../page"

type Props = {
  scanData: ScanData | null
  reviews: Record<string, string>
  setReviews: React.Dispatch<React.SetStateAction<Record<string, string>>>
}

function exportCsv(rows: string[][], name: string) {
  const csv = rows
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\r\n")
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function IntelligencePage({ scanData, reviews, setReviews }: Props) {
  const [conf, setConf] = useState(0.8)
  const [activeIdx, setActiveIdx] = useState(-1)

  // refs for stable keyboard handler
  const queueRef = useRef<typeof scanData extends null ? never[] : ReturnType<typeof Array.prototype.filter>>([])
  const activeIdxRef = useRef(-1)
  activeIdxRef.current = activeIdx

  if (!scanData) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-neutral-500 text-sm font-mono">No scan data — run a scan from COMMAND CENTER first.</p>
      </div>
    )
  }

  const queue = scanData.audit.filter((r) => r._conf < conf)
  queueRef.current = queue as any

  function decide(id: number, dec: string) {
    setReviews((prev) => {
      const next = { ...prev }
      if (next[id] === dec) delete next[id]
      else next[id] = dec
      return next
    })
  }

  function exportLabels() {
    const rows = [
      ["token", "category", "tier", "location", "confidence", "rule", "human_label"],
      ...queue.map((r) => [
        r.token,
        r.category,
        r.tier,
        r.location,
        r._conf.toFixed(2),
        r.rule,
        reviews[r._id] || "pending",
      ]),
    ]
    exportCsv(rows, "human_review_labels.csv")
  }

  // keyboard navigation: ↑/↓ move, A confirm, R reject
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      if (["input", "textarea", "select"].includes(tag)) return
      const q = queueRef.current as any[]
      if (!q.length) return
      if (e.key === "ArrowDown" || e.key === "j") {
        setActiveIdx((i) => Math.min(q.length - 1, i + 1))
        e.preventDefault()
      } else if (e.key === "ArrowUp" || e.key === "k") {
        setActiveIdx((i) => Math.max(0, i - 1))
        e.preventDefault()
      } else if (e.key.toLowerCase() === "a" || e.key.toLowerCase() === "r") {
        setActiveIdx((prev) => {
          const idx = prev < 0 ? 0 : prev
          const row = q[idx] as any
          if (row) decide(row._id, e.key.toLowerCase() === "a" ? "confirmed" : "rejected")
          return Math.min(q.length - 1, idx + 1)
        })
        e.preventDefault()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, []) // stable — uses refs

  const tierColor = (t: string) =>
    t === "Critical" ? "text-red-500" : t === "High" ? "text-orange-500" : "text-neutral-300"

  const pending = queue.filter((r) => !reviews[r._id]).length
  const confirmed = queue.filter((r) => reviews[r._id] === "confirmed").length
  const rejected = queue.filter((r) => reviews[r._id] === "rejected").length

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wider">REVIEW QUEUE</h1>
          <p className="text-sm text-neutral-400">Human-in-the-loop labeling for low-confidence findings</p>
        </div>
        <Button
          onClick={exportLabels}
          variant="outline"
          className="border-neutral-700 text-neutral-300 bg-transparent hover:bg-neutral-800 text-sm"
        >
          <Download className="w-4 h-4 mr-2" />
          Export Labels (CSV)
        </Button>
      </div>

      {/* Threshold + stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-4">
            <p className="text-xs text-neutral-400 tracking-wider mb-3">
              REVIEW THRESHOLD — show findings below this confidence
            </p>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="0.5"
                max="1"
                step="0.05"
                value={conf}
                onChange={(e) => setConf(+e.target.value)}
                className="flex-1 accent-orange-500"
              />
              <span className="text-white font-mono text-sm w-12">{conf.toFixed(2)}</span>
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-3 gap-4">
          <Card className="bg-neutral-900 border-neutral-700">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold font-mono text-neutral-400">{pending}</div>
              <div className="text-xs text-neutral-500 tracking-wider">PENDING</div>
            </CardContent>
          </Card>
          <Card className="bg-neutral-900 border-white/20">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold font-mono text-white">{confirmed}</div>
              <div className="text-xs text-neutral-400 tracking-wider">CONFIRMED</div>
            </CardContent>
          </Card>
          <Card className="bg-neutral-900 border-red-900">
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold font-mono text-red-500">{rejected}</div>
              <div className="text-xs text-neutral-500 tracking-wider">REJECTED</div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="text-xs text-neutral-500 font-mono flex gap-6 flex-wrap">
        <span>
          Navigate:{" "}
          <kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300">↑</kbd>{" "}
          <kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300">↓</kbd>
        </span>
        <span>
          Confirm: <kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300">A</kbd>
        </span>
        <span>
          Reject: <kbd className="bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-300">R</kbd>
        </span>
      </div>

      {/* Queue items */}
      {queue.length === 0 ? (
        <Card className="bg-neutral-900 border-neutral-700">
          <CardContent className="p-10 text-center space-y-2">
            <CheckCircle className="w-10 h-10 text-white mx-auto" />
            <p className="text-white font-medium">All clear</p>
            <p className="text-sm text-neutral-400">
              Nothing below conf {conf.toFixed(2)} — the report is fully auto-cleared at this threshold.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map((r, i) => {
            const decision = reviews[r._id]
            return (
              <div
                key={r._id}
                onClick={() => setActiveIdx(i)}
                className={`border rounded-lg p-4 transition-colors cursor-pointer ${
                  activeIdx === i
                    ? "border-orange-500 bg-neutral-800"
                    : decision === "confirmed"
                      ? "border-white/30 bg-neutral-900"
                      : decision === "rejected"
                        ? "border-neutral-800 bg-neutral-900 opacity-50"
                        : "border-neutral-700 bg-neutral-900 hover:border-neutral-600"
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-orange-500 font-mono text-sm">{r.token}</span>
                      <span className={`text-xs tracking-wider ${tierColor(r.tier)}`}>
                        {r.category} · {r.tier.toUpperCase()}
                      </span>
                      <span className="text-xs text-neutral-500 font-mono">conf {r._conf.toFixed(2)}</span>
                      {activeIdx === i && (
                        <span className="text-xs text-orange-500 font-mono">← active</span>
                      )}
                    </div>
                    <div className="text-xs text-neutral-400">
                      {r.rule} · {r.location}
                    </div>
                    {r.snippet && (
                      <div className="text-xs text-neutral-600 font-mono truncate">…{r.snippet}…</div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        decide(r._id, "confirmed")
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        decision === "confirmed"
                          ? "bg-white text-black"
                          : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                      }`}
                    >
                      <CheckCircle className="w-3 h-3" />
                      CONFIRM
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        decide(r._id, "rejected")
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                        decision === "rejected"
                          ? "bg-red-600 text-white"
                          : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                      }`}
                    >
                      <XCircle className="w-3 h-3" />
                      NOT PII
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
