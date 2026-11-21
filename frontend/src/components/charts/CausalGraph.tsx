import { useMemo } from 'react'
import { NODE_COLOR } from '../../lib/theme'
import type { GraphEdge, GraphNode, NodeState } from '../../lib/types'

const W = 460
const NODE_W = 128
const NODE_H = 30
const ROW = 50
const PAD = 8

type Placed = { id: string; x: number; y: number; dummy: boolean; node?: GraphNode }

// Sugiyama-lite: longest-path layering, dummy nodes for long edges, one barycenter pass.
function layout(nodes: GraphNode[], edges: GraphEdge[]) {
  const ids = new Set(nodes.map((n) => n.id))
  const es = edges.filter((e) => ids.has(e.source) && ids.has(e.target))
  const layer = new Map<string, number>()
  const parents = (id: string) => es.filter((e) => e.target === id).map((e) => e.source)
  const depth = (id: string, seen = new Set<string>()): number => {
    if (layer.has(id)) return layer.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const ps = parents(id)
    const d = ps.length ? Math.max(...ps.map((p) => depth(p, seen) + 1)) : 0
    layer.set(id, d)
    return d
  }
  nodes.forEach((n) => depth(n.id))
  const nLayers = Math.max(0, ...layer.values()) + 1

  // Split long edges into chains through dummy nodes.
  const rows: Placed[][] = Array.from({ length: nLayers }, () => [])
  const byId = new Map<string, Placed>()
  nodes.forEach((n) => {
    const p: Placed = { id: n.id, x: 0, y: 0, dummy: false, node: n }
    rows[layer.get(n.id)!].push(p)
    byId.set(n.id, p)
  })
  const chains: { edge: GraphEdge; path: string[] }[] = []
  es.forEach((e, i) => {
    const a = layer.get(e.source)!
    const b = layer.get(e.target)!
    const path = [e.source]
    for (let l = a + 1; l < b; l++) {
      const id = `__d${i}_${l}`
      const p: Placed = { id, x: 0, y: 0, dummy: true }
      rows[l].push(p)
      byId.set(id, p)
      path.push(id)
    }
    path.push(e.target)
    chains.push({ edge: e, path })
  })
  const preds = new Map<string, string[]>()
  chains.forEach((c) => c.path.slice(1).forEach((id, k) => preds.set(id, [...(preds.get(id) ?? []), c.path[k]])))

  rows.forEach((row, l) => {
    if (l > 0) {
      const bary = (p: Placed) => {
        const ps = preds.get(p.id) ?? []
        return ps.length ? ps.reduce((s, q) => s + byId.get(q)!.x, 0) / ps.length : W / 2
      }
      // Sort by barycenter; within a tie, dummies go to the middle so long edges pass between nodes.
      const groups = new Map<number, Placed[]>()
      row.forEach((p) => {
        const k = Math.round(bary(p))
        groups.set(k, [...(groups.get(k) ?? []), p])
      })
      const sorted = [...groups.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, g]) => {
        const real = g.filter((p) => !p.dummy)
        const mid = Math.ceil(real.length / 2)
        return [...real.slice(0, mid), ...g.filter((p) => p.dummy), ...real.slice(mid)]
      })
      row.splice(0, row.length, ...sorted)
    }
    const units = row.reduce((s, p) => s + (p.dummy ? 0.2 : 1), 0)
    const unit = Math.min((W - 2 * PAD) / units, NODE_W + 30)
    let x = (W - unit * units) / 2
    row.forEach((p) => {
      const w = unit * (p.dummy ? 0.2 : 1)
      p.x = x + w / 2
      p.y = PAD + l * ROW + NODE_H / 2
      x += w
    })
  })
  return { byId, chains, height: PAD * 2 + (nLayers - 1) * ROW + NODE_H }
}

function pathFor(points: Placed[]) {
  const a = points[0]
  const b = points[points.length - 1]
  const start: [number, number] = [a.x, a.y + NODE_H / 2]
  const end: [number, number] = [b.x, b.y - NODE_H / 2]
  if (points.length === 2) {
    const my = (start[1] + end[1]) / 2
    return `M${start[0]},${start[1]} C${start[0]},${my} ${end[0]},${my} ${end[0]},${end[1]}`
  }
  // Long edge: smooth Catmull-Rom curve through the dummy waypoints.
  const pts: [number, number][] = [start, ...points.slice(1, -1).map((p) => [p.x, p.y] as [number, number]), end]
  let d = `M${start[0]},${start[1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

const LEGEND: [NodeState, string][] = [
  ['root', 'Root cause'],
  ['broken', 'Broken mechanism'],
  ['symptom', 'Symptom'],
  ['normal', 'Normal'],
]

export default function CausalGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const { byId, chains, height } = useMemo(() => layout(nodes, edges), [nodes, edges])
  const state = (id: string) => byId.get(id)?.node?.state ?? 'normal'
  const hot = (e: GraphEdge) => state(e.source) !== 'normal' && state(e.target) !== 'normal'

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height: 'auto' }}>
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#475569" />
          </marker>
          <marker id="arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#fb7185" />
          </marker>
        </defs>
        {chains
          .slice()
          .sort((a, b) => Number(hot(a.edge)) - Number(hot(b.edge)))
          .map(({ edge, path }) => {
            const d = pathFor(path.map((id) => byId.get(id)!))
            const h = hot(edge)
            return (
              <g key={`${edge.source}-${edge.target}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={h ? '#fb7185' : '#334155'}
                  strokeWidth={h ? 1.8 : 1.1}
                  strokeDasharray={edge.type === 'exogenous' ? '2 4' : edge.type === 'formula' && !h ? '3 3' : undefined}
                  markerEnd={`url(#${h ? 'arrow-hot' : 'arrow'})`}
                  opacity={h ? 0.9 : edge.type === 'exogenous' ? 0.5 : 0.8}
                />
                {h && <path d={d} fill="none" stroke="#fecdd3" strokeWidth={1.4} className="flow" opacity={0.7} />}
              </g>
            )
          })}
        {[...byId.values()]
          .filter((p) => !p.dummy)
          .map((p, i) => {
            const n = p.node!
            const c = NODE_COLOR[n.state]
            const active = n.state !== 'normal'
            return (
              <g key={p.id} transform={`translate(${p.x - NODE_W / 2},${p.y - NODE_H / 2})`} className="fade-in" style={{ animationDelay: `${i * 50}ms` }}>
                {n.state === 'root' && <rect width={NODE_W} height={NODE_H} rx={8} fill={c} opacity={0.35} filter="url(#glow)" />}
                <rect width={NODE_W} height={NODE_H} rx={8} fill={active ? `${c}22` : '#0e1724'} stroke={c} strokeWidth={active ? 1.4 : 1} />
                <text x={8} y={19} fontSize={10} fill={active ? '#f1f5f9' : '#94a3b8'} fontWeight={n.state === 'root' ? 700 : 500}>
                  {n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label}
                </text>
                <text x={NODE_W - 7} y={19} fontSize={10} textAnchor="end" fill={active ? c : '#64748b'} className="num" fontWeight={600}>
                  {Math.abs(n.z) >= 0.05 ? (n.z > 0 ? '+' : '−') + Math.abs(n.z).toFixed(1) : '0'}
                </text>
              </g>
            )
          })}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-400">
        {LEGEND.map(([s, l]) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: NODE_COLOR[s] }} />
            {l}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-rose-400" /> propagation
        </span>
        <span className="text-slate-500">number = z-score</span>
      </div>
    </div>
  )
}
