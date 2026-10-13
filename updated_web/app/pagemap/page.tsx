"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ScanData, AuditRow } from "../page"

// turn a finding's location into a page/section bucket + a sort order
function pageInfo(loc: string): { key: string; order: number } {
  let m = loc.match(/^p\.(\d+)/)
  if (m) return { key: `Page ${m[1]}`, order: Number(m[1]) }
  m = loc.match(/slide (\d+)/i)
  if (m) return { key: `Slide ${m[1]}`, order: 1000 + Number(m[1]) }
  if (/^para/.test(loc)) return { key: "Body text", order: 9001 }
  if (/^table/.test(loc)) return { key: "Tables", order: 9002 }
  if (/^header|footer/.test(loc)) return { key: "Header / Footer", order: 9003 }
  if (/^metadata/.test(loc)) return { key: "Metadata", order: 9004 }
  return { key: loc, order: 9999 }
}

const RISK_W: Record<string, number> = { Critical: 3, High: 2, Medium: 1 }
const tierColor = (t: string) =>
  t === "Critical" ? "text-red-500" : t === "High" ? "text-orange-500" : "text-neutral-300"

export default function PageMapPage({ scanData }: { scanData: ScanData | null }) {
  const [sel, setSel] = useState<string | null>(null)

  if (!scanData) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-neutral-500 text-sm font-mono">No scan data — run a scan from COMMAND CENTER first.</p>
      </div>
    )
  }

  const ocrPages = new Map((scanData.ocr?.pages ?? []).map((p) => [p.page, p.ocr_conf]))
  const ocrImages = scanData.ocr?.images ?? []
  const confColor = (c: number) => (c >= 90 ? "text-green-400" : c >= 75 ? "text-orange-400" : "text-red-400")

  const groups: Record<string, { order: number; items: AuditRow[] }> = {}
  scanData.audit.forEach((r) => {
    const { key, order } = pageInfo(r.location)
    ;(groups[key] ??= { order, items: [] }).items.push(r)
  })
  const pages = Object.entries(groups)
    .map(([key, v]) => {
      const pn = key.match(/^Page (\d+)/)
      return {
        key,
        order: v.order,
        items: v.items,
        count: v.items.length,
        crit: v.items.filter((r) => r.tier === "Critical").length,
        high: v.items.filter((r) => r.tier === "High").length,
        risk: v.items.reduce((s, r) => s + (RISK_W[r.tier] || 0), 0),
        ocr: pn ? ocrPages.get(Number(pn[1])) : undefined,
      }
    })
    .sort((a, b) => a.order - b.order)
  const max = Math.max(1, ...pages.map((p) => p.count))
  const selected = pages.find((p) => p.key === sel) ?? pages[0]

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-wider">PAGE MAP</h1>
        <p className="text-sm text-neutral-400">PII density per page/section — click a cell to inspect that page's findings</p>
      </div>

      {/* heatmap */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-neutral-400 tracking-wider">
            PII HEATMAP · {pages.length} page(s)/section(s) · {scanData.audit.length} findings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-10 gap-2">
            {pages.map((p) => (
              <button
                key={p.key}
                onClick={() => setSel(p.key)}
                title={`${p.key}: ${p.count} findings`}
                style={{ background: `rgba(249,115,22,${(0.1 + 0.85 * (p.count / max)).toFixed(3)})` }}
                className={`rounded-md p-2.5 text-center border transition-colors ${
                  selected?.key === p.key ? "border-orange-300 ring-1 ring-orange-400" : "border-neutral-700 hover:border-neutral-500"
                }`}
              >
                <div className="text-[10px] font-mono text-neutral-200 tracking-wider truncate">{p.key}</div>
                <div className="text-xl font-bold font-mono text-white leading-tight">{p.count}</div>
                {p.crit > 0 && <div className="text-[9px] font-mono text-red-300">{p.crit} crit</div>}
                {p.ocr != null && <div className={`text-[9px] font-mono ${confColor(p.ocr)}`}>OCR {p.ocr}%</div>}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-4 text-[10px] text-neutral-500 font-mono">
            <span>fewer</span>
            <div className="flex-1 h-2 rounded" style={{ background: "linear-gradient(90deg, rgba(249,115,22,.1), rgba(249,115,22,.95))" }} />
            <span>more PII</span>
          </div>
        </CardContent>
      </Card>

      {/* selected page detail — numbered findings */}
      {selected && (
        <Card className="bg-neutral-900 border-neutral-700">
          <CardHeader className="pb-2 flex-row items-center justify-between">
            <CardTitle className="text-sm text-white tracking-wider">
              {selected.key} <span className="text-neutral-500 text-xs font-mono">· {selected.count} finding(s) · risk {selected.risk}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {selected.items.map((r, i) => (
                <div key={r._id} className="flex items-start gap-3 border-l-2 border-orange-500/40 pl-3 py-1">
                  <span className="text-neutral-500 font-mono text-sm w-8 shrink-0">#{i + 1}</span>
                  <div className="min-w-0">
                    <div className="text-sm">
                      <span className={`font-mono font-bold ${tierColor(r.tier)}`}>{r.category}</span>
                      <span className="text-neutral-500"> · {r.tier}</span> ·{" "}
                      <span className="text-orange-500 font-mono">{r.token}</span>{" "}
                      <span className="text-neutral-500 font-mono text-xs">conf {r._conf.toFixed(2)}</span>
                    </div>
                    {r.snippet && <div className="text-xs text-neutral-500 font-mono truncate">…{r.snippet}…</div>}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-neutral-600 font-mono mt-3">
              e.g. "{selected.key}, 3rd PII" = #3 above.
            </p>
          </CardContent>
        </Card>
      )}

      {/* OCR quality — per scanned image */}
      {ocrImages.length > 0 && (
        <Card className="bg-neutral-900 border-neutral-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-neutral-400 tracking-wider">
              OCR QUALITY · {ocrImages.length} SCANNED IMAGE(S)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-neutral-500 mb-3 font-mono">
              Average Tesseract confidence per embedded image — low scores are where fail-closed sealing matters most.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {[...ocrImages]
                .sort((a, b) => a.ocr_conf - b.ocr_conf)
                .map((im, i) => (
                  <div key={i} className="bg-neutral-800 rounded p-2 border border-neutral-700">
                    <div className="text-[10px] text-neutral-400 font-mono truncate" title={im.image}>{im.image}</div>
                    <div className={`text-lg font-bold font-mono ${confColor(im.ocr_conf)}`}>{im.ocr_conf}%</div>
                    <div className="text-[9px] text-neutral-600 truncate">{im.artifact}</div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
