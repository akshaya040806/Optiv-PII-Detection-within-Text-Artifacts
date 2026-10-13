"use client"

import { useState, useEffect } from "react"
import { ChevronRight, Monitor, Search, BarChart2, ClipboardCheck, Activity, RefreshCw, LayoutGrid } from "lucide-react"
import { Button } from "@/components/ui/button"
import CommandCenterPage from "./command-center/page"
import AgentNetworkPage from "./agent-network/page"
import OperationsPage from "./operations/page"
import IntelligencePage from "./intelligence/page"
import SystemsPage from "./systems/page"
import PageMapPage from "./pagemap/page"

export type AuditRow = {
  category: string
  tier: string
  token: string
  rule: string
  location: string
  confidence: string
  snippet: string
  _id: number
  _conf: number
}

export type ScanData = {
  sid: string
  filename: string
  masked_name: string | null
  findings: number
  people: number
  sealed: number
  residual: number
  audit: AuditRow[]
}

// Preview data for ?demo — lets the dashboard show a populated state without waiting for a live scan.
const DEMO_AUDIT: [string, string, string, string, string, string][] = [
  ["PERSON", "Medium", "PERSON-001", "table 2 r3c1", "0.85", "Risk owner [PERSON-001] attested the control"],
  ["PERSON", "Medium", "PERSON-002", "para 44", "0.70", "escalated by [PERSON-002] on review"],
  ["PERSON", "Medium", "PERSON-003", "slide 6", "0.85", "prepared by [PERSON-003]"],
  ["PERSON", "Medium", "PERSON-004", "table 5 r2c4", "0.90", "reporter [PERSON-004] — Speak Up log"],
  ["PERSON", "Medium", "PERSON-005", "para 120", "0.70", "approved by [PERSON-005]"],
  ["PERSON", "Medium", "PERSON-006", "slide 11", "0.70", "contact [PERSON-006]"],
  ["EMAIL", "Medium", "EMAIL-001", "para 44", "0.99", "reach [EMAIL-001] for queries"],
  ["EMAIL", "Medium", "EMAIL-002", "table 2 r3c2", "0.99", "owner email [EMAIL-002]"],
  ["EMAIL", "Medium", "EMAIL-003", "slide 11", "0.90", "[EMAIL-003] role mailbox"],
  ["PHONE", "Medium", "PHONE-001", "slide 11", "0.90", "mobile [PHONE-001]"],
  ["PHONE", "Medium", "PHONE-002", "para 44", "0.80", "tel [PHONE-002]"],
  ["EMPLOYEE_ID", "Medium", "EMPLOYEE_ID-001", "table 2 r3c3", "0.97", "staff id [EMPLOYEE_ID-001]"],
  ["EMPLOYEE_ID", "Medium", "EMPLOYEE_ID-002", "table 5 r4c1", "0.97", "vendor id [EMPLOYEE_ID-002]"],
  ["SSN", "Critical", "SSN-001", "p.22", "0.95", "SSN on file [SSN-001]"],
  ["PAN_IN", "Critical", "PAN_IN-001", "p.25", "0.95", "PAN [PAN_IN-001]"],
  ["IBAN", "Critical", "IBAN-001", "para 70", "0.97", "settlement IBAN [IBAN-001]"],
  ["HOME_ADDRESS", "High", "HOME_ADDRESS-001", "p.7", "0.95", "home address [HOME_ADDRESS-001]"],
  ["DOB", "High", "DOB-001", "p.22", "0.95", "date of birth [DOB-001]"],
]
const DEMO_SCAN: ScanData = {
  sid: "demo",
  filename: "Cadence_TPRM_Training.docx",
  masked_name: "Cadence_TPRM_Training_MASKED.docx",
  findings: 18,
  people: 6,
  sealed: 2,
  residual: 0,
  audit: DEMO_AUDIT.map(([category, tier, token, location, confidence, snippet], i) => ({
    category, tier, token, rule: "demo", location, confidence, snippet, _id: i, _conf: parseFloat(confidence),
  })),
}

export default function TacticalDashboard() {
  const [activeSection, setActiveSection] = useState("overview")
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [scanData, setScanData] = useState<ScanData | null>(null)
  const [scanStatus, setScanStatus] = useState<"idle" | "scanning" | "done" | "error">("idle")
  const [stageLog, setStageLog] = useState<string[]>([])
  const [currentStep, setCurrentStep] = useState(-1)
  const [reviews, setReviews] = useState<Record<string, string>>({})

  // restore from localStorage on mount (or seed demo data when ?demo is in the URL)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      const sec = params.get("section")
      if (sec) setActiveSection(sec) // deep-link to a section, e.g. ?section=agents
      if (params.has("demo")) {
        setScanData(DEMO_SCAN)
        setScanStatus("done")
        setReviews({ "1": "confirmed", "4": "rejected" }) // show a confirmed + a rejected example
        return
      }
    }
    try {
      const s = JSON.parse(localStorage.getItem("piiScan") || "null")
      if (s?.data?.audit) {
        const d = s.data as ScanData
        d.audit.forEach((r, i) => {
          r._id = i
          r._conf = parseFloat(r.confidence) || 0
        })
        setScanData(d)
        setScanStatus("done")
        setReviews(s.reviews || {})
      }
    } catch (_) {}
  }, [])

  // persist whenever scanData or reviews change
  useEffect(() => {
    if (scanData) {
      try {
        localStorage.setItem("piiScan", JSON.stringify({ data: scanData, reviews }))
      } catch (_) {}
    }
  }, [scanData, reviews])

  const sectionLabel: Record<string, string> = {
    overview: "COMMAND CENTER",
    agents: "FINDINGS",
    pagemap: "PAGE MAP",
    operations: "BREAKDOWN",
    intelligence: "REVIEW QUEUE",
    systems: "PIPELINE",
  }

  const navItems = [
    { id: "overview", icon: Monitor, label: "COMMAND CENTER" },
    { id: "agents", icon: Search, label: "FINDINGS" },
    { id: "pagemap", icon: LayoutGrid, label: "PAGE MAP" },
    { id: "operations", icon: BarChart2, label: "BREAKDOWN" },
    { id: "intelligence", icon: ClipboardCheck, label: "REVIEW QUEUE" },
    { id: "systems", icon: Activity, label: "PIPELINE" },
  ]

  const statusDot =
    scanStatus === "scanning"
      ? "bg-orange-500 animate-pulse"
      : scanStatus === "done"
        ? "bg-white"
        : scanStatus === "error"
          ? "bg-red-500"
          : "bg-neutral-500"

  const statusLabel =
    scanStatus === "scanning"
      ? "SCANNING…"
      : scanStatus === "done"
        ? "SCAN COMPLETE"
        : scanStatus === "error"
          ? "ERROR"
          : "IDLE"

  function clearSession() {
    if (!confirm("Clear session and reset all scan data?")) return
    localStorage.removeItem("piiScan")
    setScanData(null)
    setScanStatus("idle")
    setStageLog([])
    setCurrentStep(-1)
    setReviews({})
    setActiveSection("overview")
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div
        className={`${sidebarCollapsed ? "w-16" : "w-70"} bg-neutral-900 border-r border-neutral-700 transition-all duration-300 fixed md:relative z-50 md:z-auto h-full md:h-auto ${!sidebarCollapsed ? "md:block" : ""}`}
      >
        <div className="p-4">
          <div className="flex items-center justify-between mb-8">
            <div className={`${sidebarCollapsed ? "hidden" : "block"}`}>
              <h1 className="text-orange-500 font-bold text-lg tracking-wider">PII DETECTION OPS</h1>
              <p className="text-neutral-500 text-xs">OPTIV VIT · CASE STUDY 2</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-neutral-400 hover:text-orange-500"
            >
              <ChevronRight
                className={`w-4 h-4 transition-transform ${sidebarCollapsed ? "" : "rotate-180"}`}
              />
            </Button>
          </div>

          <nav className="space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveSection(item.id)}
                className={`w-full flex items-center gap-3 p-3 rounded transition-colors ${
                  activeSection === item.id
                    ? "bg-orange-500 text-white"
                    : "text-neutral-400 hover:text-white hover:bg-neutral-800"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {!sidebarCollapsed && <span className="text-sm font-medium">{item.label}</span>}
              </button>
            ))}
          </nav>

          {!sidebarCollapsed && (
            <div className="mt-8 p-4 bg-neutral-800 border border-neutral-700 rounded">
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-2 h-2 rounded-full ${statusDot}`}></div>
                <span className="text-xs text-white">{statusLabel}</span>
              </div>
              <div className="text-xs text-neutral-500">
                {scanData ? (
                  <>
                    <div>FINDINGS: {scanData.findings}</div>
                    <div>PEOPLE: {scanData.people}</div>
                    <div>LEAKS: {scanData.residual === 0 ? "NONE ✓" : scanData.residual + " !"}</div>
                  </>
                ) : (
                  <>
                    <div>NO SCAN YET</div>
                    <div>DROP A FILE TO BEGIN</div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Overlay */}
      {!sidebarCollapsed && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarCollapsed(true)} />
      )}

      {/* Main Content */}
      <div className={`flex-1 flex flex-col ${!sidebarCollapsed ? "md:ml-0" : ""}`}>
        {/* Top Toolbar */}
        <div className="h-16 bg-neutral-800 border-b border-neutral-700 flex items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="text-sm text-neutral-400">
              PII DETECTION OPS / <span className="text-orange-500">{sectionLabel[activeSection]}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-neutral-500 hidden sm:block">OFFLINE · NOTHING LEAVES THIS MACHINE</div>
            <Button
              variant="ghost"
              size="icon"
              title="Clear session"
              onClick={clearSession}
              className="text-neutral-400 hover:text-orange-500"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-auto">
          {activeSection === "overview" && (
            <CommandCenterPage
              scanData={scanData}
              setScanData={setScanData}
              scanStatus={scanStatus}
              setScanStatus={setScanStatus}
              stageLog={stageLog}
              setStageLog={setStageLog}
              currentStep={currentStep}
              setCurrentStep={setCurrentStep}
              reviews={reviews}
            />
          )}
          {activeSection === "agents" && <AgentNetworkPage scanData={scanData} reviews={reviews} />}
          {activeSection === "pagemap" && <PageMapPage scanData={scanData} />}
          {activeSection === "operations" && <OperationsPage scanData={scanData} />}
          {activeSection === "intelligence" && (
            <IntelligencePage scanData={scanData} reviews={reviews} setReviews={setReviews} />
          )}
          {activeSection === "systems" && <SystemsPage />}
        </div>
      </div>
    </div>
  )
}
