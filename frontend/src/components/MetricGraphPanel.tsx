import { useMemo } from 'react'
import CausalGraph from './charts/CausalGraph'
import type { GraphEdge, GraphNode, MetricGraph, MetricResponse } from '../lib/types'

type Props = {
  graph: MetricGraph | null
  highlight: string[]
  result?: MetricResponse | null // validation of the metric just added, shown with its card
  onBack: () => void
}

// The whole metric graph the twin monitors, with metrics added at runtime highlighted.
export default function MetricGraphPanel({ graph, highlight, result, onBack }: Props) {
  const { nodes, edges, added } = useMemo(() => {
    if (!graph) return { nodes: [] as GraphNode[], edges: [] as GraphEdge[], added: [] as MetricGraph['nodes'] }
    const nodes: GraphNode[] = [
      ...graph.exogenous.map((x) => ({ id: x.id, label: x.label.replace(/\s*\(.*\)$/, ''), z: 0, state: 'normal' as const })),
      ...graph.nodes.map((n) => ({ id: n.id, label: n.label, z: 0, state: 'normal' as const })),
    ]
    const ids = new Set(nodes.map((n) => n.id))
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    return { nodes, edges, added: graph.nodes.filter((n) => n.origin === 'extension') }
  }, [graph])
  const lit = highlight.length ? highlight : added.map((n) => n.id)

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-700/50 px-5 pb-3 pt-4">
        <button onClick={onBack} className="mb-2 text-[11px] text-slate-400 hover:text-slate-200">
          ← All incidents
        </button>
        <h2 className="text-[16px] font-semibold text-slate-50">Metric graph</h2>
        <div className="mt-0.5 text-[11.5px] text-slate-400">
          {graph ? `${graph.nodes.length} metrics in the causal twin` : 'Loading…'}
          {added.length > 0 && <span className="text-teal-300"> · {added.length} added live</span>}
        </div>
      </div>
      <div className="scroll-thin flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {added
          .filter((n) => lit.includes(n.id))
          .map((n) => (
            <div key={n.id} className="fade-up rounded-xl border border-teal-400/40 bg-teal-400/10 p-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-teal-400 px-1.5 text-[9.5px] font-bold text-slate-950">NEW</span>
                <span className="text-[13px] font-semibold text-teal-100">{n.label}</span>
              </div>
              {n.expr && <code className="num mt-1.5 block text-[12px] text-teal-200">{n.id} = {n.expr}</code>}
              {result && (result.node as { id?: string } | null)?.id === n.id ? (
                <ul className="mt-2 space-y-1">
                  {result.validation.checks.map((c, i) => (
                    <li key={c.name} className="fade-up flex gap-2 text-[11.5px]" style={{ animationDelay: `${i * 120}ms` }}>
                      <span className={c.ok ? 'text-teal-300' : 'text-rose-300'}>{c.ok ? '✓' : '✕'}</span>
                      <span className="shrink-0 font-medium capitalize text-slate-200">{c.name}</span>
                      <span className="text-slate-400">{c.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-1 text-[11px] text-slate-400">Validated on history and now monitored in every country.</div>
              )}
            </div>
          ))}
        <section className="card p-3.5">
          <div className="section-title mb-3">Causal structure · L2 country × platform × category</div>
          {graph ? <CausalGraph nodes={nodes} edges={edges} highlight={lit} legend={false} /> : <div className="h-72 animate-pulse rounded-lg bg-slate-800/50" />}
          <div className="mt-2 flex flex-wrap gap-x-3 text-[10.5px] text-slate-400">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-slate-500" /> mechanism</span>
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-slate-400" /> formula / calendar</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-teal-400" /> added live</span>
          </div>
        </section>
      </div>
    </div>
  )
}
