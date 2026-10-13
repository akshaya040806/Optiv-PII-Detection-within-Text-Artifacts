"use client"

import { useState, useEffect, Fragment } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, CheckCircle, XCircle } from "lucide-react"
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
  const [selectedCats, setSelectedCats] = useState<Set<string>>(
    () => new Set(scanData?.audit.map((r) => r.category) ?? []),
  )
  type Pages = { label: string; count: number }[]
  const [term, setTerm] = useState("")
  const [finding, setFinding] = useState(false)
  const [result, setResult] = useState<{ term: string; count: number; pages: Pages } | null>(null)
  const [custom, setCustom] = useState<{ term: string; count: number; decision: string; pages: Pages }[]>([])
  // keep the category selection in sync with whatever document is loaded
  useEffect(() => {
    if (scanData) setSelectedCats(new Set(scanData.audit.map((r) => r.category)))
  }, [scanData])

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
      selectedCats.has(r.category) &&
      (!q || (r.token + " " + r.rule + " " + r.location + " " + r.category).toLowerCase().includes(q)),
  )

  // category chips (counts over the whole scan)
  const catList = Object.entries(
    scanData.audit.reduce<Record<string, number>>((m, r) => ((m[r.category] = (m[r.category] || 0) + 1), m), {}),
  ).sort((a, b) => b[1] - a[1])
  const allCatNames = catList.map((c) => c[0])
  function toggleCat(c: string) {
    setSelectedCats((prev) => {
      const n = new Set(prev)
      n.has(c) ? n.delete(c) : n.add(c)
      return n
    })
  }

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

  // custom watchword: count a user term in the document, then decide to track it or not
  async function findTerm() {
    const t = term.trim()
    if (!t) return
    setFinding(true)
    setResult(null)
    try {
      const res = await fetch("/api/v1/find", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: scanData!.sid, term: t }),
      })
      const d = await res.json()
      if (!res.ok) {
        alert(d.error || "Find failed")
        return
      }
      setResult({ term: d.term, count: d.count, pages: d.pages || [] })
    } catch (e: any) {
      alert("Request failed: " + e.message)
    } finally {
      setFinding(false)
    }
  }
  function decideCustom(decision: string) {
    if (!result) return
    setCustom((prev) => [{ term: result.term, count: result.count, decision, pages: result.pages }, ...prev.filter((c) => c.term !== result.term)])
    setResult(null)
    setTerm("")
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

          {/* Category picker */}
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-neutral-800">
            <span className="text-xs text-neutral-400 tracking-wider pt-2">CATEGORY</span>
            <button
              onClick={() => setSelectedCats(new Set(allCatNames))}
              className="text-xs tracking-wider px-2 py-1 rounded text-neutral-300 hover:text-white mt-1"
            >
              ALL
            </button>
            <button
              onClick={() => setSelectedCats(new Set())}
              className="text-xs tracking-wider px-2 py-1 rounded text-neutral-500 hover:text-neutral-300 mt-1"
            >
              NONE
            </button>
            {catList.map(([c, n]) => {
              const on = selectedCats.has(c)
              return (
                <button
                  key={c}
                  onClick={() => toggleCat(c)}
                  className={`mt-1 px-2.5 py-1 rounded text-xs font-mono tracking-wider border transition-colors ${
                    on
                      ? "bg-orange-500/20 text-orange-400 border-orange-500/50"
                      : "bg-neutral-800 text-neutral-500 border-neutral-700 hover:text-neutral-300"
                  }`}
                >
                  {c} <span className="opacity-60">{n}</span>
                </button>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Custom watchword search */}
      <Card className="bg-neutral-900 border-orange-500/60 ring-1 ring-orange-500/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-orange-400 tracking-wider">+ CUSTOM PII · WATCHWORD SEARCH</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-neutral-500 font-mono">
            Count a custom term (a name, project codename, keyword) in the scanned document, then decide whether to track it as PII.
          </p>
          <div className="flex gap-3">
            <Input
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") findTerm() }}
              placeholder="e.g. Project Falcon, a specific name…"
              className="flex-1 bg-neutral-800 border-neutral-600 text-white placeholder-neutral-500 font-mono text-sm"
            />
            <Button onClick={findTerm} disabled={finding || !term.trim()} className="bg-orange-500 hover:bg-orange-600 text-white">
              {finding ? "SEARCHING…" : "FIND"}
            </Button>
          </div>
          {result && (
            <div className="bg-neutral-800 rounded p-3 border border-neutral-700 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm">
                  <span className="text-orange-500 font-mono">"{result.term}"</span> found{" "}
                  <span className="text-white font-mono font-bold">{result.count}</span> time(s)
                </div>
                {result.count > 0 && (
                  <div className="flex gap-2">
                    <button onClick={() => decideCustom("confirmed")} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-neutral-700 hover:bg-green-900 text-neutral-200">
                      <CheckCircle className="w-3 h-3" /> ADD AS PII
                    </button>
                    <button onClick={() => decideCustom("rejected")} className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium bg-neutral-700 hover:bg-red-900 text-neutral-200">
                      <XCircle className="w-3 h-3" /> IGNORE
                    </button>
                  </div>
                )}
              </div>
              {result.pages.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[11px] text-neutral-500 font-mono">on:</span>
                  {result.pages.map((p, i) => (
                    <span key={i} className="text-[11px] font-mono bg-neutral-900 border border-neutral-700 rounded px-2 py-0.5 text-neutral-300">
                      {p.label} <span className="text-orange-400">{p.count}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-neutral-500 font-mono">Not found in this document.</div>
              )}
            </div>
          )}
          {custom.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-neutral-800">
              {custom.map((c, i) => (
                <div key={i} className={`flex items-center justify-between gap-3 text-xs font-mono border-l-2 pl-2 py-1 ${c.decision === "confirmed" ? "border-green-500" : "border-neutral-600"}`}>
                  <span className="text-neutral-300 min-w-0 truncate">
                    "{c.term}" · {c.count}×
                    {c.pages.length > 0 && <span className="text-neutral-500"> · {c.pages.map((p) => p.label).join(", ")}</span>}
                  </span>
                  <span className={`shrink-0 ${c.decision === "confirmed" ? "text-green-400" : "text-neutral-500"}`}>
                    {c.decision === "confirmed" ? "TRACKED AS PII" : "IGNORED"}
                  </span>
                </div>
              ))}
            </div>
          )}
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
