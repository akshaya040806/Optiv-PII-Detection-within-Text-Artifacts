"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Download, CheckCircle, XCircle } from "lucide-react"
import type { ScanData } from "../page"

type Props = { scanData: ScanData | null }

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

export default function OperationsPage({ scanData }: Props) {
  const [conf, setConf] = useState(0.8)

  if (!scanData) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-neutral-500 text-sm font-mono">No scan data — run a scan from COMMAND CENTER first.</p>
      </div>
    )
  }

  const filtered = scanData.audit.filter((r) => r._conf >= conf)

  const byCat = Object.entries(
    filtered.reduce(
      (a, r) => {
        a[r.category] = (a[r.category] || 0) + 1
        return a
      },
      {} as Record<string, number>,
    ),
  ).sort((a, b) => b[1] - a[1])
  const maxCat = Math.max(1, ...byCat.map(([, n]) => n))

  const byTier = { Critical: 0, High: 0, Medium: 0 } as Record<string, number>
  filtered.forEach((r) => {
    if (r.tier in byTier) byTier[r.tier]++
  })

  function downloadFiltered() {
    const rows = [
      ["token", "category", "tier", "location", "confidence", "rule"],
      ...filtered.map((r) => [r.token, r.category, r.tier, r.location, r._conf.toFixed(2), r.rule]),
    ]
    exportCsv(rows, "pii_filtered.csv")
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wider">BREAKDOWN</h1>
          <p className="text-sm text-neutral-400">Category distribution, tier analysis, and redacted file exports</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-400 tracking-wider">CONF ≥</span>
          <input
            type="range"
            min="0.5"
            max="1"
            step="0.05"
            value={conf}
            onChange={(e) => setConf(+e.target.value)}
            className="w-28 accent-orange-500"
          />
          <span className="text-xs text-white font-mono">{conf.toFixed(2)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category chart */}
        <Card className="bg-neutral-900 border-neutral-700">
          <CardHeader>
            <CardTitle className="text-xs text-neutral-400 tracking-wider">FINDINGS BY CATEGORY</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {byCat.length === 0 ? (
              <p className="text-neutral-500 text-sm">No findings at this confidence threshold.</p>
            ) : (
              byCat.map(([cat, n]) => (
                <div key={cat} className="flex items-center gap-3">
                  <span className="text-xs text-neutral-300 w-36 truncate font-mono">{cat}</span>
                  <div className="flex-1 bg-neutral-800 rounded-full h-3">
                    <div
                      className="bg-orange-500 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${(n / maxCat) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-white font-mono w-8 text-right">{n}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Tier distribution */}
        <Card className="bg-neutral-900 border-neutral-700">
          <CardHeader>
            <CardTitle className="text-xs text-neutral-400 tracking-wider">SENSITIVITY TIER DISTRIBUTION</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            {[
              { tier: "Critical", bar: "bg-red-500", text: "text-red-500" },
              { tier: "High", bar: "bg-orange-500", text: "text-orange-500" },
              { tier: "Medium", bar: "bg-neutral-400", text: "text-neutral-300" },
            ].map(({ tier, bar, text }) => (
              <div key={tier}>
                <div className="flex justify-between mb-1">
                  <span className={`text-xs tracking-wider font-medium ${text}`}>{tier.toUpperCase()}</span>
                  <span className={`text-sm font-bold font-mono ${text}`}>{byTier[tier]}</span>
                </div>
                <div className="w-full bg-neutral-800 rounded-full h-2">
                  <div
                    className={`${bar} h-2 rounded-full transition-all duration-300`}
                    style={{
                      width: `${filtered.length ? (byTier[tier] / filtered.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
            <div className="pt-1 text-xs text-neutral-500 border-t border-neutral-800">
              Total at conf ≥ {conf.toFixed(2)}:{" "}
              <span className="text-white font-mono">{filtered.length}</span> of{" "}
              <span className="text-white font-mono">{scanData.audit.length}</span> findings
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Gold-set benchmark (Cadence policy PDF only) */}
      {scanData.gold && scanData.gold_recall && (
        <Card className="bg-neutral-900 border-neutral-700">
          <CardHeader>
            <CardTitle className="text-xs text-neutral-400 tracking-wider">
              GOLD-SET BENCHMARK · {scanData.gold_recall[0]}/{scanData.gold_recall[1]} recall ({scanData.gold_recall[2]}%)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-neutral-500 mb-3 font-mono">
              Detections vs a hand-verified ground-truth set — ✓ detected, ✗ missed (still covered by fail-closed sealing). Tokens only, no raw gold values.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {scanData.gold.map((g, i) => (
                <div
                  key={i}
                  className={`rounded p-2 border flex items-center gap-2 ${
                    g.found ? "bg-neutral-800 border-neutral-700" : "bg-red-950/40 border-red-900"
                  }`}
                >
                  {g.found ? (
                    <CheckCircle className="w-4 h-4 text-green-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-neutral-200 truncate">{g.category}</div>
                    <div className="text-[10px] text-neutral-500 font-mono">p.{g.page} · {g.context}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Exports */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-xs text-neutral-400 tracking-wider">EXPORT & DOWNLOAD</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {scanData.masked_name && (
            <a
              href={`/download/${scanData.sid}`}
              download
              className="flex items-center gap-4 p-4 bg-orange-500 hover:bg-orange-600 text-white rounded transition-colors"
            >
              <Download className="w-5 h-5 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium">Download Redacted File</div>
                <div className="text-xs opacity-80">
                  Safe to send to an LLM — PII replaced with tokens like [PER-016], [EML-002]
                </div>
              </div>
            </a>
          )}
          <a
            href={`/download/${scanData.sid}/inventory`}
            download
            className="flex items-center gap-4 p-4 bg-neutral-800 hover:bg-neutral-700 text-white rounded transition-colors border border-neutral-700"
          >
            <Download className="w-5 h-5 text-neutral-400 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium">Full PII Inventory (CSV)</div>
              <div className="text-xs text-neutral-400">
                All {scanData.audit.length} findings with category, tier, value, token, rule and snippet
              </div>
            </div>
          </a>
          <button
            onClick={downloadFiltered}
            className="w-full flex items-center gap-4 p-4 bg-neutral-800 hover:bg-neutral-700 text-white rounded transition-colors border border-neutral-700"
          >
            <Download className="w-5 h-5 text-neutral-400 flex-shrink-0" />
            <div className="text-left">
              <div className="text-sm font-medium">Filtered Findings (CSV)</div>
              <div className="text-xs text-neutral-400">
                {filtered.length} rows at conf ≥ {conf.toFixed(2)} — tokens only, no raw PII values
              </div>
            </div>
          </button>
          <p className="text-xs text-neutral-600 pt-2 border-t border-neutral-800">
            The re-identification key (person_token_map.csv) stays server-side and is never downloadable — by
            design. Keep it separate from the masked files.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
