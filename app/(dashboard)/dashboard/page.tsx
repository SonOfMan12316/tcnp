"use client"
import { DASHBOARD_JOURNEY_SELECT } from '@/lib/dashboard-queries'

import { useEffect, useState, useCallback, useMemo } from "react"
import { JourneyAlerts } from "@/components/dashboard/JourneyAlerts"
import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn, canAccessCommandCentre, oscarToRole } from "@/lib/utils"
import { getCallSignLabel, resolveCallSignKey, TNCP_CALL_SIGN_COLORS } from "@/lib/constants/tncpCallSigns"
import {
  Users, Car, MapPin, AlertTriangle, Download, ChevronRight, ArrowRight, Radio,
  MessageSquare, Zap, Shield, Plane, Landmark, Hotel, Home, Camera,
  UtensilsCrossed, CheckCircle, BookOpen,
} from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { toast } from "sonner"
import { usePWAInstall } from "@/hooks/usePWAInstall"
import { PWAInstallModal } from "@/components/pwa/PWAInstallModal"
import { MissionRequestPrompt } from "@/components/missions/MissionAvailability"
import { useCurrentUser } from "@/hooks/useCurrentUser"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { CountUp } from "@/components/ui/count-up"
import * as Sentry from "@sentry/nextjs"

// ─── Lazy-loaded charts ────────────────────────────────────────────────────────

const DashboardCharts = dynamic(
  () => import("@/components/dashboard/DashboardCharts").then((m) => m.DashboardCharts),
  {
    ssr: false,
    loading: () => (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="h-56 rounded-2xl skeleton" />
        <div className="h-56 rounded-2xl skeleton" />
        <div className="h-56 rounded-2xl skeleton" />
      </div>
    ),
  }
)

// ─── Executive Stat Definitions ────────────────────────────────────────────────

const EXECUTIVE_STATS = [
  {
    key: "totalPapas",
    label: "Total Papas",
    sub: "Registered VIP guests",
    Icon: Users,
    color: "text-primary",
    bg: "bg-primary/10",
    ring: "ring-primary/20",
    glow: "from-primary/8",
  },
  {
    key: "totalCheetahs",
    label: "Fleet Size",
    sub: "Active Cheetah vehicles",
    Icon: Car,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    ring: "ring-emerald-500/20",
    glow: "from-emerald-500/8",
  },
  {
    key: "activeJourneys",
    label: "Active Journeys",
    sub: "In progress or planned",
    Icon: MapPin,
    color: "text-sky-500",
    bg: "bg-sky-500/10",
    ring: "ring-sky-500/20",
    glow: "from-sky-500/8",
  },
  {
    key: "incidents",
    label: "Open Incidents",
    sub: "Requires attention",
    Icon: AlertTriangle,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    ring: "ring-amber-500/20",
    glow: "from-amber-500/8",
  },
] as const

const FALLBACK_STATUS_COLORS: Record<string, string> = {
  planned: "bg-blue-500 text-white",
  in_progress: "bg-yellow-500 text-white",
  completed: "bg-green-500 text-white",
  cancelled: "bg-red-500 text-white",
  broken_arrow: "bg-red-600 text-white",
}

const FALLBACK_STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  broken_arrow: "BROKEN ARROW",
}

type DashboardLoadStage =
  | "active_program"
  | "auth_user"
  | "officer_assignments"
  | "assigned_journeys"
  | "global_metrics"
  | "recent_journeys"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toTitleCase = (v: string) =>
  v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase())

const getStatusColor = (status: string) => {
  const key = resolveCallSignKey(status)
  if (key && TNCP_CALL_SIGN_COLORS[key]) return TNCP_CALL_SIGN_COLORS[key]
  return FALLBACK_STATUS_COLORS[status] || "bg-gray-500 text-white"
}

const getStatusIndicatorClass = (status: string) =>
  getStatusColor(status).split(" ").find((c) => c.startsWith("bg-")) || "bg-gray-500"

const getStatusLabel = (status: string) =>
  getCallSignLabel(status) || FALLBACK_STATUS_LABELS[status] || toTitleCase(status)

function getUnitActionForRole(role?: string | null, oscar?: string | null) {
  const r = (oscarToRole(oscar) || oscarToRole(role) || oscar || role || "").toLowerCase()
  if (r.includes("alpha")) {
    return { href: "/alpha", label: "Alpha Aviation Hub", sub: "Eagle Squares & Flights", Icon: Plane, color: "text-primary", bg: "bg-primary/10" }
  }
  if (r.includes("tango")) {
    return { href: "/tango", label: "Tango Fleet", sub: "Cheetah vehicle management", Icon: Car, color: "text-emerald-500", bg: "bg-emerald-500/10" }
  }
  if (r.includes("victor")) {
    return { href: "/victor", label: "Victor Venues", sub: "Theatres & seat layouts", Icon: Landmark, color: "text-amber-500", bg: "bg-amber-500/10" }
  }
  if (r.includes("nest")) {
    return { href: "/nests", label: "November Nest", sub: "Hotel accommodations & rooms", Icon: Hotel, color: "text-primary", bg: "bg-primary/10" }
  }
  if (r.includes("den") || r.includes("theatre")) {
    return { href: "/den", label: "November Den", sub: "VIP Lounges & Menus", Icon: Home, color: "text-primary", bg: "bg-primary/10" }
  }
  if (r.includes("serial") || r.includes("sierra")) {
    return { href: "/serial", label: "Serial Media", sub: "Social media & press coverage", Icon: Camera, color: "text-pink-500", bg: "bg-pink-500/10" }
  }
  if (r.includes("training")) {
    return { href: "/training", label: "Training Hub", sub: "Courses, resources & attendance", Icon: BookOpen, color: "text-blue-500", bg: "bg-blue-500/10" }
  }
  if (r.includes("compliance")) {
    return { href: "/compliance", label: "Compliance", sub: "Dress code & team standards", Icon: Shield, color: "text-primary", bg: "bg-primary/10" }
  }
  if (r.includes("welfare")) {
    return { href: "/welfare", label: "Welfare Portal", sub: "Officer welfare & meals", Icon: UtensilsCrossed, color: "text-emerald-500", bg: "bg-emerald-500/10" }
  }
  return null
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function DashboardSkeleton() {
  return (
    <div className="space-y-6 page-enter">

      <div className="space-y-1.5">
        <div className="h-3.5 w-32 rounded skeleton" />
        <div className="h-8 w-56 rounded skeleton" />
        <div className="h-4 w-72 rounded skeleton" />
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border bg-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-3.5 w-24 rounded skeleton" />
              <div className="h-9 w-9 rounded-xl skeleton" />
            </div>
            <div className="h-9 w-14 rounded skeleton" />
            <div className="h-3 w-28 rounded skeleton" />
          </div>
        ))}
      </div>
      <div className="rounded-2xl border bg-card p-5 space-y-3">
        <div className="h-5 w-36 rounded skeleton" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-14 rounded-xl skeleton" />
        ))}
      </div>
    </div>
  )
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const supabase = createClient()
  const [stats, setStats] = useState({ totalPapas: 0, totalCheetahs: 0, activeJourneys: 0, incidents: 0 })
  const [myAssignmentsCount, setMyAssignmentsCount] = useState(0)
  const [recentJourneys, setRecentJourneys] = useState<any[]>([])
  const [myScheduledJourneys, setMyScheduledJourneys] = useState<any[]>([])
  const [activeProgram, setActiveProgram] = useState<{ id: string; name: string } | null>(null)
  const [myAssignment, setMyAssignment] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const { isInstalled, install, platform: pwaplatform } = usePWAInstall()
  const [showInstallModal, setShowInstallModal] = useState(false)
  const { data: currentUser, isLoading: userLoading, refetch: refetchCurrentUser } = useCurrentUser()

  // Global operational summaries contain sensitive journey, Papa, fleet and
  // incident information. Keep them strictly within Command/Admin scope.
  const canViewGlobalDashboard = useMemo(() => {
    if (!currentUser) return false
    return canAccessCommandCentre(currentUser.role, currentUser.oscar)
  }, [currentUser])

  const handleInstallClick = async () => {
    const result = await install()
    if (result === "show-instructions") setShowInstallModal(true)
    else if (result === "accepted") toast.success("TCNP is now installed. Check your home screen.")
  }

  const loadDashboardData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    let stage: DashboardLoadStage = "active_program"
    try {
      // The program name is contextual. A failure here must not suppress a
      // user's independently verified assignments or the rest of the page.
      const { data: programData, error: programError } = await supabase
        .from("programs")
        .select(canViewGlobalDashboard ? "id, name" : "id")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(1)

      if (programError) {
        setActiveProgram(null)
        Sentry.captureException(programError, {
          level: "warning",
          tags: { feature: "dashboard", dashboard_stage: "active_program" },
        })
      } else {
        setActiveProgram((programData?.[0] as any) ?? null)
      }

      stage = "auth_user"
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) throw authError || new Error("Session unavailable")

      // 2. Fetch officer-specific assigned duties
      if (user) {
        stage = "officer_assignments"
        const { data: myDORows, error: assignmentError } = await (supabase as any)
          .from("journey_duty_officers")
          .select("journey_id, status")
          .eq("user_id", user.id)

        if (assignmentError) throw assignmentError
        const activeDutyRows = (myDORows || []).filter((row: any) =>
          row.status == null || ["pending", "acknowledged"].includes(row.status),
        )
        const doIds: string[] = activeDutyRows.map((row: any) => row.journey_id).filter(Boolean)
        const rejectedJourneyIds: string[] = (myDORows || [])
          .filter((row: any) => row.status === "rejected")
          .map((row: any) => row.journey_id)
          .filter(Boolean)
        const orParts = [`assigned_duty_officer_id.eq.${user.id}`, `assigned_do_id.eq.${user.id}`]
        if (doIds.length > 0) orParts.push(`id.in.(${doIds.join(",")})`)

        stage = "assigned_journeys"
        let myJourneysQuery = (supabase as any)
          .from("journeys")
          .select(DASHBOARD_JOURNEY_SELECT, { count: "exact" })
          .not("status", "in", "(completed,cancelled)")
          .or("is_deleted.is.null,is_deleted.eq.false")
          .or(orParts.join(","))
        if (rejectedJourneyIds.length > 0) {
          myJourneysQuery = myJourneysQuery.not("id", "in", `(${rejectedJourneyIds.join(",")})`)
        }
        const { data: myJourneysList, count: myCount, error: journeyError } = await myJourneysQuery
          .order("etd", { ascending: true, nullsFirst: false })
          .limit(5)

        if (journeyError) throw journeyError
        setMyScheduledJourneys(myJourneysList || [])
        setMyAssignmentsCount(myCount || 0)
        setMyAssignment(myJourneysList?.[0] ?? null)
      }

      // 3. Only Command/Admin receive cross-program metrics or journey details.
      if (canViewGlobalDashboard) {
        stage = "global_metrics"
        const [papasRes, cheetahsRes, journeysRes, incidentsRes] = await Promise.all([
          supabase.from("papas").select("id", { count: "exact", head: true }),
          supabase.from("cheetahs").select("id", { count: "exact", head: true }),
          (supabase as any).from("journeys").select("id", { count: "exact", head: true })
            .not("status", "in", "(completed,cancelled)")
            .or("is_deleted.is.null,is_deleted.eq.false"),
          supabase.from("incidents").select("id", { count: "exact", head: true }).eq("status", "open"),
        ])

        for (const result of [papasRes, cheetahsRes, journeysRes, incidentsRes]) {
          if (result.error) throw result.error
          if (result.count === null) throw new Error("Metric unavailable")
        }
        setStats({
          totalPapas: papasRes.count || 0,
          totalCheetahs: cheetahsRes.count || 0,
          activeJourneys: journeysRes.count || 0,
          incidents: incidentsRes.count || 0,
        })

        stage = "recent_journeys"
        const { data: journeys, error: recentError } = await (supabase as any)
          .from("journeys")
          .select(DASHBOARD_JOURNEY_SELECT)
          .or("is_deleted.is.null,is_deleted.eq.false")
          .order("created_at", { ascending: false })
          .limit(5)

        if (recentError) throw recentError
        setRecentJourneys(journeys || [])
      }
      setUpdatedAt(new Date())
    } catch (err) {
      setLoadError(true)
      console.error("Dashboard load failed at stage:", stage, err)
      Sentry.captureException(err, {
        tags: { feature: "dashboard", dashboard_stage: stage },
      })
    } finally {
      setLoading(false)
    }
  }, [supabase, canViewGlobalDashboard])

  const handleDashboardRetry = async () => {
    setLoading(true)
    setLoadError(false)
    await refetchCurrentUser()
    void loadDashboardData()
  }

  useEffect(() => {
    if (!userLoading) {
      void loadDashboardData()
    }
  }, [loadDashboardData, userLoading])

  // ── Leadership quick actions — must be a useMemo BEFORE any early return ──
  const leadershipQuickActions = useMemo(() => {
    const canCmd = Boolean(currentUser && canAccessCommandCentre(currentUser.role, currentUser.oscar))
    const actions: Array<{ href: string; label: string; sub: string; Icon: any; color: string; bg: string }> = [
      { href: "/journeys", label: "Create Journey", sub: "Plan a new Papa movement", Icon: MapPin, color: "text-primary", bg: "bg-primary/10" },
      { href: "/papas", label: "Add Papa", sub: "Register a new guest", Icon: Users, color: "text-emerald-500", bg: "bg-emerald-500/10" },
    ]
    if (canCmd) {
      actions.push({ href: "/command", label: "Command Centre", sub: "Live ops & tracking", Icon: Radio, color: "text-sky-500", bg: "bg-sky-500/10" })
    } else {
      actions.push({ href: "/chat", label: "Team Chat", sub: "Program rooms & team channel", Icon: MessageSquare, color: "text-sky-500", bg: "bg-sky-500/10" })
    }
    return actions
  }, [currentUser])

  if (loading || userLoading) return <DashboardSkeleton />

  if (loadError) return <section role="alert" className="mx-auto max-w-xl space-y-4 rounded-xl border p-6"><h1 className="text-xl font-semibold">Dashboard data unavailable</h1><p className="text-sm text-muted-foreground">We could not verify the latest operational data. Counts and assignments are hidden to avoid showing incomplete information.</p><Button onClick={() => void handleDashboardRetry()}>Retry dashboard</Button></section>

  const firstName = currentUser?.full_name?.split(" ")[0]
  const officerUnit = currentUser?.oscar || (currentUser?.role ? toTitleCase(currentUser.role) : "General Duty")
  const officerTeam = currentUser?.team ? `Team ${toTitleCase(currentUser.team)}` : "Unassigned Team"

  // Dynamic quick actions for officers (plain const — no hooks needed)
  const officerUnitAction = getUnitActionForRole(currentUser?.role, currentUser?.oscar)
  const officerQuickActions = [
    { href: "/my-operations", label: "My Operations", sub: "Your assignments & call-sign", Icon: Zap, color: "text-orange-500", bg: "bg-orange-500/10" },
    { href: "/chat", label: "Team Chat", sub: "Program rooms & team channel", Icon: MessageSquare, color: "text-sky-500", bg: "bg-sky-500/10" },
    ...(officerUnitAction ? [officerUnitAction] : []),
  ]

  const quickActions = canViewGlobalDashboard ? leadershipQuickActions : officerQuickActions

  return (
    <div className="space-y-6 page-enter">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-card via-card/95 to-background p-6 shadow-xs">
        <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {canViewGlobalDashboard ? "Command Overview" : `${officerUnit} Portal`}
              </span>
              {activeProgram && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  {canViewGlobalDashboard && activeProgram.name ? `Latest active program: ${activeProgram.name}` : "Active program"}
                </span>
              )}
            </div>
            <h1 className="mt-1 text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
              {firstName ? `Welcome back, ${firstName}` : canViewGlobalDashboard ? "Command Dashboard" : "Operations Dashboard"}
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
              {canViewGlobalDashboard ? (
                activeProgram ? (
                  <>Active operational protocol is currently engaged for <span className="font-semibold text-foreground">{activeProgram.name}</span>.</>
                ) : (
                  "All systems nominal — stand by for program assignments and journey dispatch."
                )
              ) : (
                <>Operational duty assigned to <span className="font-semibold text-foreground">{officerUnit}</span> • <span className="font-semibold text-foreground">{officerTeam}</span>.</>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            {!isInstalled ? (
              <Button onClick={handleInstallClick} variant="outline" size="sm" className="gap-2 rounded-xl self-start shrink-0 text-xs font-medium bg-background/80 shadow-xs">
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Install App
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground px-3 py-1.5 rounded-xl bg-background/80 border border-border/60 shadow-xs">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                App Installed
              </span>
            )}
          </div>
        </div>
      </div>

      {showInstallModal && (
        <PWAInstallModal platform={pwaplatform} onClose={() => setShowInstallModal(false)} />
      )}

      {/* ── Mission prompt ────────────────────────────────────────────────── */}
      <MissionRequestPrompt currentUserId={currentUser?.id ?? null} />

      {/* ── My active assignment banner ──────────────────────────────────── */}
      {myAssignment && (
        <button
          onClick={() => router.push("/my-operations")}
          className="group w-full rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/8 via-primary/4 to-transparent p-4 text-left transition-all hover:border-primary/60 hover:from-primary/12 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label="Open My Operations"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <MapPin className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">My Active Assignment</p>
                <p className="truncate font-semibold text-sm mt-0.5">
                  {myAssignment.papas?.title} {myAssignment.papas?.full_name ?? "Papa"} — {myAssignment.origin || "Origin"} → {myAssignment.destination || "Destination"}
                </p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge className={`${getStatusColor(myAssignment.status)} text-[10px] uppercase px-2 py-0`}>
                    {getStatusLabel(myAssignment.status)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {myAssignment.etd
                      ? `ETD ${new Date(myAssignment.etd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "No ETD set"}
                  </span>
                </div>
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-primary transition-gap group-hover:gap-1.5">
              Open My Operations
              <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </div>
        </button>
      )}

      {/* ── Leadership Only: Live alerts ─────────────────────────────────── */}
      {canViewGlobalDashboard && <JourneyAlerts />}

      {/* ── Stat cards ────────────────────────────────────────────────────── */}
      {canViewGlobalDashboard ? (
        <div className="grid gap-4 grid-cols-2 nav:grid-cols-4">
          {EXECUTIVE_STATS.map(({ key, label, sub, Icon, color, bg, ring, glow }, idx) => (
            <div
              key={key}
              className={cn(
                "relative overflow-hidden rounded-2xl border bg-card p-5",
                "transition-all duration-200 hover:shadow-elevation-lg hover:-translate-y-0.5",
                `ring-1 ${ring}`
              )}
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${glow} to-transparent pointer-events-none`} aria-hidden="true" />
              <div className="relative flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">{label}</p>
                  <p className="stat-figure mt-2 text-3xl font-bold tracking-tight">
                    <CountUp value={stats[key]} />
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
                </div>
                <div className={`shrink-0 rounded-xl ${bg} p-2.5`}>
                  <Icon className={`h-4.5 w-4.5 ${color}`} aria-hidden="true" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Regular Officer Stat Cards */
        <div className="grid gap-4 grid-cols-2 nav:grid-cols-4">
          {/* Card 1: My Assignments */}
          <div className="relative overflow-hidden rounded-2xl border bg-card p-5 ring-1 ring-sky-500/20 transition-all duration-200 hover:shadow-elevation-lg hover:-translate-y-0.5">
            <div className="absolute inset-0 bg-gradient-to-br from-sky-500/8 to-transparent pointer-events-none" />
            <div className="relative flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">My Assignments</p>
                <p className="stat-figure mt-2 text-3xl font-bold tracking-tight text-sky-600 dark:text-sky-400">
                  <CountUp value={myAssignmentsCount} />
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Active & planned journeys</p>
              </div>
              <div className="shrink-0 rounded-xl bg-sky-500/10 p-2.5">
                <MapPin className="h-4.5 w-4.5 text-sky-500" aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* Card 2: Protocol Unit */}
          <div className="relative overflow-hidden rounded-2xl border bg-card p-5 ring-1 ring-primary/20 transition-all duration-200 hover:shadow-elevation-lg hover:-translate-y-0.5">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/8 to-transparent pointer-events-none" />
            <div className="relative flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Protocol Unit</p>
                <p className="mt-2 text-xl font-bold tracking-tight text-foreground truncate max-w-[140px]">
                  {officerUnit}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">Operational assignment</p>
              </div>
              <div className="shrink-0 rounded-xl bg-primary/10 p-2.5">
                <Shield className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* Card 3: Protocol Team */}
          <div className="relative overflow-hidden rounded-2xl border bg-card p-5 ring-1 ring-emerald-500/20 transition-all duration-200 hover:shadow-elevation-lg hover:-translate-y-0.5">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/8 to-transparent pointer-events-none" />
            <div className="relative flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Protocol Team</p>
                <p className="mt-2 text-xl font-bold tracking-tight text-foreground truncate max-w-[140px]">
                  {currentUser?.team ? `Team ${toTitleCase(currentUser.team)}` : "Unassigned"}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {currentUser?.is_team_head ? "★ Team Lead" : "Team Member"}
                </p>
              </div>
              <div className="shrink-0 rounded-xl bg-emerald-500/10 p-2.5">
                <Users className="h-4.5 w-4.5 text-emerald-500" aria-hidden="true" />
              </div>
            </div>
          </div>

          {/* Card 4: Program Status */}
          <div className="relative overflow-hidden rounded-2xl border bg-card p-5 ring-1 ring-amber-500/20 transition-all duration-200 hover:shadow-elevation-lg hover:-translate-y-0.5">
            <div className="absolute inset-0 bg-gradient-to-br from-amber-500/8 to-transparent pointer-events-none" />
            <div className="relative flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Active Program</p>
                <p className="mt-2 text-base font-bold tracking-tight text-foreground truncate max-w-[140px]">
                  {activeProgram?.name || (activeProgram ? "Active" : "Standby")}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {activeProgram ? "Protocol engaged" : "Awaiting activation"}
                </p>
              </div>
              <div className="shrink-0 rounded-xl bg-amber-500/10 p-2.5">
                <Radio className="h-4.5 w-4.5 text-amber-500" aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Leadership Only: Analytics Charts ─────────────────────────────── */}
      {canViewGlobalDashboard && (
        <ErrorBoundary>
          <DashboardCharts />
        </ErrorBoundary>
      )}

      {/* ── Journeys Section ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <h2 className="text-sm font-semibold">
              {canViewGlobalDashboard ? "Recent VIP Journeys" : "My Scheduled Journeys"}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {canViewGlobalDashboard ? "Latest convoy activities across the program" : "Your assigned missions and schedule"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => router.push(canViewGlobalDashboard ? "/journeys" : "/my-operations")}
          >
            {canViewGlobalDashboard ? "View all" : "My Operations"} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>

        {canViewGlobalDashboard ? (
          // Leadership View: Global Journeys
          recentJourneys.length === 0 ? (
            <div className="empty-state py-12">
              <MapPin className="h-10 w-10" aria-hidden="true" />
              <p className="font-medium text-sm">No journeys yet</p>
              <p className="text-xs text-muted-foreground">Create your first journey to see it here</p>
              <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={() => router.push("/journeys")}>
                <ArrowRight className="h-3.5 w-3.5" /> Create Journey
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {recentJourneys.map((journey) => {
                const createdDate = journey.created_at ? new Date(journey.created_at) : null
                const isValidDate = createdDate && !isNaN(createdDate.getTime())

                return (
                  <li key={journey.id}>
                    <button
                      className="w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:bg-accent/50"
                      onClick={() => router.push("/journeys")}
                    >
                      <div
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusIndicatorClass(journey.status)}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {journey.papas?.title} {journey.papas?.full_name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {[journey.cheetahs?.call_sign, journey.cheetahs?.registration_number].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge
                          variant={journey.status === "broken_arrow" ? "destructive" : "secondary"}
                          className="uppercase tracking-wide text-[10px] px-2 py-0 hidden sm:flex"
                        >
                          {getStatusLabel(journey.status)}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {isValidDate ? formatDistanceToNow(createdDate!, { addSuffix: true }) : "Just now"}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        ) : (
          // Officer View: Assigned Journeys Only
          myScheduledJourneys.length === 0 ? (
            <div className="empty-state py-12">
              <MapPin className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
              <p className="font-medium text-sm">No duty assignments yet</p>
              <p className="text-xs text-muted-foreground max-w-sm text-center mt-1">
                You currently have no scheduled journeys assigned. When Command assigns you to a convoy, it will appear here and in My Operations.
              </p>
              <Button variant="outline" size="sm" className="mt-4 gap-2" onClick={() => router.push("/my-operations")}>
                <Zap className="h-3.5 w-3.5 text-orange-500" /> Open My Operations
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {myScheduledJourneys.map((journey) => {
                const createdDate = journey.created_at ? new Date(journey.created_at) : null
                const isValidDate = createdDate && !isNaN(createdDate.getTime())

                return (
                  <li key={journey.id}>
                    <button
                      className="w-full flex items-center gap-4 px-5 py-3.5 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:bg-accent/50"
                      onClick={() => router.push("/my-operations")}
                    >
                      <div
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusIndicatorClass(journey.status)}`}
                        aria-hidden="true"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {journey.papas?.title} {journey.papas?.full_name} — {journey.origin || "Origin"} → {journey.destination || "Destination"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {[journey.cheetahs?.call_sign, journey.cheetahs?.registration_number].filter(Boolean).join(" · ") || "Fleet details pending"}
                        </p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <Badge
                          variant={journey.status === "broken_arrow" ? "destructive" : "secondary"}
                          className="uppercase tracking-wide text-[10px] px-2 py-0 hidden sm:flex"
                        >
                          {getStatusLabel(journey.status)}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                          {journey.etd ? `ETD ${new Date(journey.etd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No ETD"}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/40" aria-hidden="true" />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )
        )}
      </div>

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-[0.1em] mb-3">
          {canViewGlobalDashboard ? "Command Actions" : `${officerUnit} Quick Actions`}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {quickActions.map(({ href, label, sub, Icon, color, bg }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="group flex items-center gap-4 rounded-2xl border bg-card p-4 text-left transition-all duration-200 hover:shadow-elevation-md hover:-translate-y-0.5 hover:border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <div className={`shrink-0 rounded-xl ${bg} p-2.5 transition-transform group-hover:scale-110`}>
                <Icon className={`h-4 w-4 ${color}`} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">{label}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 shrink-0" aria-hidden="true" />
            </button>
          ))}

          {/* PWA install quick action */}
          {!isInstalled && (
            <button
              onClick={handleInstallClick}
              className="group flex items-center gap-4 rounded-2xl border border-dashed border-border bg-card/50 p-4 text-left transition-all duration-200 hover:bg-card hover:shadow-elevation-sm hover:border-border/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <div className="shrink-0 rounded-xl bg-primary/10 p-2.5 transition-transform group-hover:scale-110">
                <Download className="h-4 w-4 text-primary" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm">Install App</p>
                <p className="text-xs text-muted-foreground mt-0.5">Faster access on this device</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/30 transition-transform group-hover:translate-x-0.5 shrink-0" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
