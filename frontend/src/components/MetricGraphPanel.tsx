import { useEffect, useMemo } from 'react'
import CausalGraph from './charts/CausalGraph'
import type { GraphEdge, GraphNode, MetricGraph, MetricResponse } from '../lib/types'

type Props = {
  graph: MetricGraph | null
  highlight: string[]
  result?: MetricResponse | null // validation of the metric just added
  onClose: () => void
}

// Full-screen view of the metric graph the twin monitors, with metrics added at runtime highlighted.
export default function MetricGraphPanel({ graph, highlight, result, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const { nodes, edges, added } = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], added: [] as MetricGraph['nodes'] }
    const nodes: GraphNode[] = [
      ...graph.exogenous.map((x) => ({ id: x.id, label: x.label.replace(/\s*\(.*\)$/, ''), z: 0, state: 'normal' as const })),
      ...graph.nodes.map((n) => ({ id: n.id, label: n.label, z: 0, state: 'normal' as const })),
    ]
    const ids = new Set(nodes.map((n) => n.id))
    return { nodes, edges: graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)), added: graph.nodes.filter((n) => n.origin === 'extension') }
  }, [graph])
  const lit = highlight.length ? highlight : added.map((n) => n.id)
  const fresh = added.find((n) => lit.includes(n.id))
  const checks = result && (result.node as { id?: string } | null)?.id === fresh?.id ? result.validation.checks : null

  return (
    <div className="fade-in absolute inset-0 z-40 overflow-y-auto bg-bg/80 backdrop-blur-md">
      <div className="mx-auto max-w-[1040px] px-10 pb-16 pt-8">
        <button onClick={onClose} className="text-[13px] text-fg-2 hover:text-fg">
          ← Back to the Earth
        </button>
        <div className="mt-6 text-[13px] text-fg-2">Metric graph · {graph ? `${graph.nodes.length} metrics` : 'loading'}</div>
        <p className="mt-2 max-w-[760px] text-[24px] font-medium leading-snug text-fg">
          {fresh
            ? `“${fresh.label}” is now part of the twin: ${fresh.expr ? `${fresh.expr}, ` : ''}validated on history and watched in every market.`
            : 'Every metric Argus watches, and how they cause each other.'}
        </p>
        <div className="mt-10 grid grid-cols-[1.4fr_1fr] gap-8">
          <div className="rounded-2xl bg-panel/60 p-8 ring-1 ring-line">
            {graph ? <CausalGraph nodes={nodes} edges={edges} roles={Object.fromEntries(lit.map((id) => [id, 'new' as const]))} showWords={false} dims={{ W: 700, nodeW: 150, nodeH: 46, row: 70 }} /> : <div className="h-96 animate-pulse rounded-xl bg-line/50" />}
          </div>
          <div>
            {checks ? (
              <ul className="space-y-4">
                {checks.map((c, i) => (
                  <li key={c.name} className="fade-up" style={{ animationDelay: `${i * 120}ms` }}>
                    <div className={`text-[16px] ${c.ok ? 'text-ok' : 'text-problem'}`}>
                      {c.ok ? '✓' : '✕'} {c.name.charAt(0).toUpperCase() + c.name.slice(1)}
                    </div>
                    <div className="text-[13px] leading-relaxed text-fg-2">{c.detail}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] leading-relaxed text-fg-2">
                Solid lines are mechanisms the twin simulates; dashed lines are formulas and the marketing calendar. Metrics added live are shown in mint.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
