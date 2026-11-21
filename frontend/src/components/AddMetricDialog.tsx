import { useState } from 'react'
import { api } from '../lib/api'
import type { MetricResponse } from '../lib/types'

type Props = {
  onClose: () => void
  onAdded: (nodeId?: string) => void
  // Result already produced elsewhere (the new_metric demo scene): show it instead of submitting again.
  initial?: MetricResponse | null
}

export default function AddMetricDialog({ onClose, onAdded, initial }: Props) {
  const initialNode = initial?.node as Record<string, unknown> | null | undefined
  const [name, setName] = useState(String(initialNode?.label ?? 'Reward cost per completed offer'))
  const [desc, setDesc] = useState('How much we pay users in rewards for each completed offer (rewards / completions)')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<MetricResponse | null>(initial ?? null)
  const [err, setErr] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await api.addMetric(name, desc)
      setRes(r)
      if (r.validation.ok) onAdded((r.node as { id?: string } | null)?.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const node = res?.node as Record<string, unknown> | null | undefined
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="fade-up w-[520px] rounded-2xl border border-line/60 bg-panel p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-fg">Add a metric</h3>
          <button onClick={onClose} className="text-fg-2 hover:text-fg">✕</button>
        </div>
        <p className="mt-1 text-[13px] text-fg-2">Describe it in plain words. Argus proposes a formula over known nodes, validates it on history, and starts monitoring.</p>
        <label className="mt-4 block text-[13px] font-medium text-fg-2">Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg bg-panel px-3 py-2 text-[13px] text-fg outline-none ring-1 ring-line focus:ring-ok/60" />
        <label className="mt-3 block text-[13px] font-medium text-fg-2">Description</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="mt-1 w-full resize-none rounded-lg bg-panel px-3 py-2 text-[13px] text-fg outline-none ring-1 ring-line focus:ring-ok/60" />

        {res && (
          <div className="fade-up mt-4 rounded-xl bg-panel/70 p-3.5 ring-1 ring-line/50">
            {node && (
              <div className="mb-3 flex items-center gap-2">
                <code className="num rounded bg-ok/10 px-2 py-1 text-[13px] text-ok">
                  {String(node.id ?? node.name ?? name)} = {String(node.expr ?? node.formula ?? node.expression ?? '?')}
                </code>
                {node.aggregation != null && <span className="rounded bg-line px-1.5 py-0.5 text-[13px] text-fg">{String(node.aggregation)}</span>}
              </div>
            )}
            <ul className="space-y-1.5">
              {res.validation.checks.map((c, i) => (
                <li key={c.name} className="fade-up flex gap-2 text-[13px]" style={{ animationDelay: `${i * 140}ms` }}>
                  <span className={c.ok ? 'text-ok' : 'text-problem'}>{c.ok ? '✓' : '✕'}</span>
                  <span className="font-medium capitalize text-fg">{c.name}</span>
                  <span className="text-fg-2">{c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {err && <div className="mt-3 text-[13px] text-problem">{err}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-fg hover:bg-line">
            {res?.validation.ok ? 'Done' : 'Cancel'}
          </button>
          {!res?.validation.ok && (
            <button disabled={busy || !name.trim()} onClick={submit} className="rounded-lg bg-ok px-4 py-2 text-[13px] font-semibold text-bg hover:brightness-110 disabled:opacity-50">
              {busy ? 'Validating…' : 'Propose & validate'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
