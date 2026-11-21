import type { CountryStatus, NodeState, Verdict } from './types'

export const STATUS_COLOR: Record<CountryStatus, string> = {
  ok: '#2dd4bf',
  watch: '#fbbf24',
  incident: '#f43f5e',
  explained: '#94a3b8',
  waiting: '#7c8db5',
}

export const STATUS_LABEL: Record<CountryStatus, string> = {
  ok: 'Healthy',
  watch: 'Watching',
  incident: 'Incident',
  explained: 'Explained',
  waiting: 'Waiting for data',
}

export const NODE_COLOR: Record<NodeState, string> = {
  root: '#f43f5e',
  broken: '#fb923c',
  symptom: '#facc15',
  normal: '#475569',
}

export const VERDICT_COLOR: Record<Verdict, string> = {
  supported: '#2dd4bf',
  partial: '#fbbf24',
  rejected: '#64748b',
}

// Potential gradient stops: deep indigo → violet → magenta → amber.
export const POTENTIAL_STOPS: [number, string][] = [
  [0, '#1e1b4b'],
  [0.35, '#6d28d9'],
  [0.7, '#d946ef'],
  [1, '#fcd34d'],
]

export function potentialColor(t: number) {
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < POTENTIAL_STOPS.length; i++) {
    const [b, cb] = POTENTIAL_STOPS[i]
    const [a, ca] = POTENTIAL_STOPS[i - 1]
    if (x <= b) return mix(ca, cb, (x - a) / (b - a))
  }
  return POTENTIAL_STOPS[POTENTIAL_STOPS.length - 1][1]
}

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

export const usd = (v: number, digits = 0) => {
  const a = Math.abs(v)
  const s = a >= 1_000_000 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(digits)}`
  return v < 0 ? `−${s}` : s
}

export const signed = (v: number, digits = 1) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits)

export const PLATFORM_LABEL: Record<string, string> = { ios: 'iOS', android: 'Android', iOS: 'iOS', Android: 'Android' }
