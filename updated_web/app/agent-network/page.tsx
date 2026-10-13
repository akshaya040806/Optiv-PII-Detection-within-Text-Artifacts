"use client"

import { useState, Fragment } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import type { ScanData } from "../page"

type Props = {
  scanData: ScanData | null
  reviews: Record<string, string>
}

export default function AgentNetworkPage({ scanData, reviews }: Props) {
  const [search, setSearch] = useState("")
  const [conf, setConf] = useState(0.8)
  const [tiers, setTiers] = useState({ Critical: true, High: true, Medium: true })
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  if (!scanData) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-neutral-500 text-sm font-mono">No scan data — run a scan from COMMAND CENTER first.</p>
      </div>
    )
  }

  const q = search.trim().toLowerCase()
  const rows = scanData.audit.filter(
    (r) =>
      r._conf >= conf &&
      tiers[r.tier as keyof typeof tiers] &&
      (!q || (r.token + " " + r.rule + " " + r.location + " " + r.category).toLowerCase().includes(q)),
  )

  const tierColor = (tier: string) =>
    tier === "Critical" ? "text-red-500" : tier === "High" ? "text-orange-500" : "text-neutral-300"

  const confColor = (c: number) =>
    c >= 0.9 ? "text-white" : c >= 0.75 ? "text-orange-500" : "text-red-400"

  function toggleRow(id: number) {
    setExpanded((prev) => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wider">FINDINGS ROSTER</h1>
          <p className="text-sm text-neutral-400">Audit trail — tokens only, no raw PII values shown</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "TOTAL FINDINGS", val: scanData.findings, danger: false },
          { label: "UNIQUE PEOPLE", val: scanData.people, danger: false },
          { label: "REGIONS SEALED", val: scanData.sealed, danger: false },
          { label: "RESIDUAL LEAKS", val: scanData.residual, danger: scanData.residual > 0 },
        ].map(({ label, val, danger }) => (
          <Card key={label} className="bg-neutral-900 border-neutral-700">
            <CardContent className="p-4">
              <p className="text-xs text-neutral-400 tracking-wider">{label}</p>
              <p className={`text-2xl font-bold font-mono ${danger ? "text-red-500" : "text-white"}`}>{val}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search token, rule, location, category…"
                className="pl-10 bg-neutral-800 border-neutral-600 text-white placeholder-neutral-500 font-mono text-sm"
              />
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
                className="w-24 accent-orange-500"
              />
              <span className="text-xs text-white font-mono w-10">{conf.toFixed(2)}</span>
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {(["Critical", "High", "Medium"] as const).map((t) => (
              <label key={t} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tiers[t]}
                  onChange={(e) => setTiers((prev) => ({ ...prev, [t]: e.target.checked }))}
                  className="accent-orange-500"
                />
                <span className={`text-xs tracking-wider ${tierColor(t)}`}>{t.toUpperCase()}</span>
              </label>
            ))}
            <span className="text-xs text-neutral-500 ml-auto font-mono">
              Showing {rows.length} of {scanData.audit.length}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Audit table */}
      <Card className="bg-neutral-900 border-neutral-700">
        <CardHeader>
          <CardTitle className="text-xs text-neutral-400 tracking-wider">
            AUDIT TRAIL · CLICK ROW FOR MASKED CONTEXT
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-700">
                  {["CATEGORY", "TIER", "TOKEN", "RULE", "LOCATION", "CONF"].map((h) => (
                    <th key={h} className="text-left py-3 px-4 text-xs text-neutral-400 tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r._id}>
                    <tr
                      onClick={() => toggleRow(r._id)}
                      className="border-b border-neutral-800 hover:bg-neutral-800 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4 text-white">{r.category}</td>
                      <td className={`py-3 px-4 text-xs tracking-wider ${tierColor(r.tier)}`}>
                        {r.tier.toUpperCase()}
                      </td>
                      <td className="py-3 px-4 text-orange-500 font-mono text-xs">{r.token}</td>
                      <td className="py-3 px-4 text-neutral-400 text-xs max-w-48 truncate">{r.rule}</td>
                      <td className="py-3 px-4 text-neutral-300 font-mono text-xs">{r.location}</td>
                      <td className={`py-3 px-4 font-mono text-xs ${confColor(r._conf)}`}>
                        {r._conf.toFixed(2)}
                      </td>
                    </tr>
                    {expanded.has(r._id) && (
                      <tr className="border-b border-neutral-800 bg-neutral-800/50">
                        <td colSpan={6} className="px-4 py-3">
                          <p className="text-xs text-neutral-400 tracking-wider mb-1">MASKED CONTEXT:</p>
                          <p className="text-xs text-neutral-300 font-mono">
                            …{r.snippet || "(no context captured)"}…
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-neutral-500 text-sm">
                      No findings match current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
