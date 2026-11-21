import { useMemo } from 'react'
import { NODE_COLOR } from '../../lib/theme'
import type { GraphEdge, GraphNode, NodeState } from '../../lib/types'

const W = 440
const NODE_W = 112
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
      row.forEach((p, i) => ((p as any)._b = bary(p) + i * 0.01 + (p.dummy ? 0.5 : 0)))
      row.sort((a, b) => (a as any)._b - (b as any)._b)
    }
    const units = row.reduce((s, p) => s + (p.dummy ? 0.35 : 1), 0)
    const unit = Math.min((W - 2 * PAD) / units, NODE_W + 34)
    let x = (W - unit * units) / 2
    row.forEach((p) => {
      const w = unit * (p.dummy ? 0.35 : 1)
      p.x = x + w / 2
      p.y = PAD + l * ROW + NODE_H / 2
      x += w
    })
  })
  return { byId, chains, height: PAD * 2 + (nLayers - 1) * ROW + NODE_H }
}

function pathFor(points: Placed[]) {
  let d = ''
  points.forEach((p, i) => {
    const top = p.dummy ? p.y : p.y - NODE_H / 2
    const bottom = p.dummy ? p.y : p.y + NODE_H / 2
    if (i === 0) {
      d = `M${p.x},${bottom}`
      return
    }
    const prev = points[i - 1]
    const py = prev.dummy ? prev.y : prev.y + NODE_H / 2
    const my = (py + top) / 2
    d += ` C${prev.x},${my} ${p.x},${my} ${p.x},${top}`
  })
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
                  strokeDasharray={edge.type === 'formula' && !h ? '3 3' : undefined}
                  markerEnd={`url(#${h ? 'arrow-hot' : 'arrow'})`}
                  opacity={h ? 0.9 : 0.8}
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
              <g key={p.id} transform={`translate(${p.x - NODE_W / 2},${p.y - NODE_H / 2})`} className="fade-up" style={{ animationDelay: `${i * 50}ms` }}>
                {n.state === 'root' && <rect width={NODE_W} height={NODE_H} rx={8} fill={c} opacity={0.35} filter="url(#glow)" />}
                <rect width={NODE_W} height={NODE_H} rx={8} fill={active ? `${c}22` : '#0e1724'} stroke={c} strokeWidth={active ? 1.4 : 1} />
                <text x={8} y={19} fontSize={10.5} fill={active ? '#f1f5f9' : '#94a3b8'} fontWeight={n.state === 'root' ? 700 : 500}>
                  {n.label.length > 15 ? n.label.slice(0, 14) + '…' : n.label}
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
        <span className="text-slate-500">z given parents</span>
      </div>
    </div>
  )
}
