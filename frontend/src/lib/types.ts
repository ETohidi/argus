// Types mirror docs/API.md exactly.

export type CountryStatus = 'ok' | 'watch' | 'incident' | 'explained' | 'waiting'
export type IncidentStatus = 'open' | 'persisting' | 'fix_applied' | 'verified' | 'resolved'
export type Severity = 'low' | 'medium' | 'high'
export type Level = 'L1' | 'L2' | 'L3'
export type NodeState = 'root' | 'broken' | 'symptom' | 'normal'
export type Verdict = 'supported' | 'partial' | 'rejected'
export type InjectType = 'promo' | 'bot_farm' | 'tracking_break' | 'data_delay'

export interface Kpis {
  new_accounts: number
  completions: number
  revenue: number
  rewards: number
  margin: number
  quality_per_completion: number
}

export interface CountryState {
  iso: string
  name: string
  lat: number
  lng: number
  status: CountryStatus
  health_z: number
  kpis: Kpis
  potential_usd_day: number
}

export interface IncidentSummary {
  id: string
  title: string
  country: string
  status: IncidentStatus
  severity: Severity
  impact_usd_h: number
}

export interface ExplainedChange {
  t: number
  country: string
  event: string
  naive_z: number
  twin_z: number
}

export interface WorldState {
  clock: { t: number; label: string }
  countries: CountryState[]
  incidents: IncidentSummary[]
  explained: ExplainedChange[]
  attention: { watched_series: number; investigations: number; l3_runs: number }
}

export interface TrailStep {
  t: number
  level: Level
  action: string
  finding: string
}

export interface GraphNode {
  id: string
  label: string
  z: number
  state: NodeState
}

export interface GraphEdge {
  source: string
  target: string
  type: string
}

export interface Fix {
  id: string
  name: string
  description: string
  days: number[]
  p10: number[]
  p50: number[]
  p90: number[]
  delta_p50_usd: number
  advertiser_risk: string
}

export interface L3Result {
  summary: {
    n_users: number
    n_flagged: number
    coherence_flagged: number
    coherence_others: number
    top_devices: string[]
  }
  points: { coherence: number; payout_focus: number; flagged: boolean }[]
}

export interface IncidentDetail {
  id: string
  title: string
  status: IncidentStatus
  country: string
  platform: string
  category: string
  detected_at: number
  trail: TrailStep[]
  graph: { nodes: GraphNode[]; edges: GraphEdge[] }
  contributions: { mechanism: string; value_usd: number }[]
  hypotheses: { name: string; explained: number; verdict: Verdict }[]
  l3: L3Result | null
  fixes: Fix[]
  recommended: string
  applied: string | null
  verification: { status: 'pending' | 'verified' | 'missed'; predicted: number[]; actual: number | null }
  reports: { ceo: string; manager: string; engineer: string }
}

export interface CountryDetail {
  iso: string
  name: string
  segments: {
    platform: string
    category: string
    kpi_z: Record<string, number>
    deviation_usd_h: number
  }[]
}

export interface PotentialResponse {
  countries: { iso: string; potential_usd_day: number; top_categories: string[]; explain: string[] }[]
}

export interface MetricResponse {
  node: Record<string, unknown> | null
  validation: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] }
}

export interface DemoResponse {
  scene: string
  state: WorldState
  incident_id?: string
}

export const DEMO_SCENES = [
  'start',
  'promo',
  'bot_farm',
  'investigate',
  'approve',
  'verify',
  'new_metric',
  'tracking_break',
] as const
export type DemoScene = (typeof DEMO_SCENES)[number]
