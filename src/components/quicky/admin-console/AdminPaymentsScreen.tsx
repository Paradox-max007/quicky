'use client'

// Quicky — ADMIN: PAYMENTS SCREEN (Monetization PRD §9.2)
//
// Orders + provider events oversight: purchase history with provider/status
// filters, user search, KPI cards (gross volume, refunds, fulfilled orders)
// and safe refunds. Product/provider-id mapping stays on the Game Store
// screen; prices live in Stripe/Play Console and are never edited here.
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Search, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'

type OrderRow = {
  id: string
  userId: string
  productId: string
  productType: string
  provider: string
  providerTransactionId: string | null
  currency: string
  amount: number
  coins: number | null
  bonusCoins: number | null
  status: string
  createdAt: string
  completedAt: string | null
}

type EventRow = {
  id: string
  provider: string
  providerEventId: string
  eventType: string
  status: string
  processedAt: string
}

type Payload = {
  orders: OrderRow[]
  events: EventRow[]
  kpis: {
    fulfilledOrders: number
    grossVolume: number
    refundedOrders: number
    refundedVolume: number
    byProvider: Array<{ provider: string; status: string; count: number; volume: number }>
  }
}

const inputCls = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50'

export function AdminPaymentsScreen() {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [data, setData] = useState<Payload | null>(null)
  const [userFilter, setUserFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [providerFilter, setProviderFilter] = useState('')
  const [refunding, setRefunding] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const params = new URLSearchParams()
      if (userFilter.trim()) params.set('userId', userFilter.trim())
      if (statusFilter) params.set('status', statusFilter)
      if (providerFilter) params.set('provider', providerFilter)
      const qs = params.toString()
      const res = await fetch(`/api/quicky/admin/payments${qs ? `?${qs}` : ''}`, { credentials: 'include' })
      if (!res.ok) throw new Error('load failed')
      const payload = (await res.json()) as Payload
      setData(payload)
      setLoaded(true)
    } catch {
      setFailed(true)
    }
  }, [userFilter, statusFilter, providerFilter])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refund = async (purchaseId: string) => {
    setRefunding(purchaseId)
    try {
      const res = await fetch('/api/quicky/admin/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'refund', purchaseId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error ?? 'Refund failed')
      toast.success('Refund recorded — currency reversed')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Refund failed')
    } finally {
      setRefunding(null)
    }
  }

  if (!loaded) {
    return failed ? <ConsoleRetry onRetry={() => void load()} /> : <p className="py-10 text-center text-sm text-white/50">Loading payments…</p>
  }

  const k = data?.kpis

  return (
    <div className="flex flex-col gap-4">
      {/* ── KPIs ─────────────────────────────────────────────────── */}
      <ConsoleCard
        title="Sales overview"
        action={
          <button onClick={() => void load()} className="flex items-center gap-1.5 text-xs font-bold text-white/50 hover:text-white">
            <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Refresh
          </button>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Fulfilled orders" value={k?.fulfilledOrders ?? 0} />
          <Stat label="Gross volume" value={`$${(k?.grossVolume ?? 0).toFixed(2)}`} />
          <Stat label="Refunded orders" value={k?.refundedOrders ?? 0} />
          <Stat label="Refunded volume" value={`$${(k?.refundedVolume ?? 0).toFixed(2)}`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
          {(k?.byProvider ?? []).map((g) => (
            <span key={`${g.provider}-${g.status}`} className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 font-bold text-white/60">
              {g.provider} · {g.status}: {g.count} (${g.volume.toFixed(2)})
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-white/35">
          Prices are managed in Stripe / Play Console — this console records fulfillment, never changes what providers charge.
        </p>
      </ConsoleCard>

      {/* ── Orders ───────────────────────────────────────────────── */}
      <ConsoleCard
        title="Orders"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <input value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="User id" className={`${inputCls} !w-40 !py-1.5`} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${inputCls} !w-32 !py-1.5`}>
              <option value="">All statuses</option>
              {['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select value={providerFilter} onChange={(e) => setProviderFilter(e.target.value)} className={`${inputCls} !w-32 !py-1.5`}>
              <option value="">All providers</option>
              {['stripe', 'google_play', 'mock'].map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              onClick={() => void load()}
              className="flex items-center gap-1.5 rounded-full border border-[var(--qk-accent)]/40 px-3 py-1.5 text-xs font-bold text-[var(--qk-accent)]"
            >
              <Search className="w-3.5 h-3.5" aria-hidden /> Apply
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-white/40 uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">Order</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Product</th>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Created</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(data?.orders ?? []).map((o) => (
                <tr key={o.id} className="text-white/75">
                  <td className="py-2 pr-3 font-mono text-[10px]">{o.id.slice(0, 10)}…</td>
                  <td className="py-2 pr-3 font-mono text-[10px]">{o.userId.slice(0, 10)}…</td>
                  <td className="py-2 pr-3">
                    {o.productType === 'SUBSCRIPTION' ? '👑' : o.productType === 'REALM_POINTS_PACK' ? '❤️' : '🪙'} {o.productType}
                  </td>
                  <td className="py-2 pr-3">{o.provider}</td>
                  <td className="py-2 pr-3 tabular-nums">${o.amount.toFixed(2)}</td>
                  <td className="py-2 pr-3">
                    <span className={`rounded-full px-2 py-0.5 font-bold ${
                      o.status === 'COMPLETED' ? 'bg-emerald-400/15 text-emerald-300' :
                      o.status === 'PENDING' || o.status === 'PROCESSING' ? 'bg-amber-400/15 text-amber-300' :
                      o.status === 'REFUNDED' ? 'bg-sky-400/15 text-sky-300' :
                      'bg-red-400/15 text-red-300'
                    }`}>{o.status}</span>
                  </td>
                  <td className="py-2 pr-3 text-white/40">{new Date(o.createdAt).toLocaleString()}</td>
                  <td className="py-2">
                    {o.status === 'COMPLETED' && (
                      <button
                        onClick={() => void refund(o.id)}
                        disabled={refunding === o.id}
                        className="flex items-center gap-1 rounded-full border border-red-400/40 px-2.5 py-1 text-[10px] font-bold text-red-300 hover:bg-red-400/10 disabled:opacity-50"
                        title="Refund the charge in the provider dashboard first, then record it here"
                      >
                        <Undo2 className="w-3 h-3" aria-hidden /> {refunding === o.id ? '…' : 'Refund'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {(data?.orders ?? []).length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-white/40">No orders match the filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ConsoleCard>

      {/* ── Provider events (dedup/audit) ───────────────────────── */}
      <ConsoleCard title="Provider events (dedup + audit)">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-white/40 uppercase tracking-wide">
              <tr>
                <th className="py-2 pr-3">Provider</th>
                <th className="py-2 pr-3">Event</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Processed</th>
                <th className="py-2">Event id</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(data?.events ?? []).map((e) => (
                <tr key={e.id} className="text-white/75">
                  <td className="py-2 pr-3">{e.provider}</td>
                  <td className="py-2 pr-3 font-mono text-[10px]">{e.eventType}</td>
                  <td className="py-2 pr-3">{e.status}</td>
                  <td className="py-2 pr-3 text-white/40">{new Date(e.processedAt).toLocaleString()}</td>
                  <td className="py-2 font-mono text-[10px] text-white/40">{e.providerEventId.slice(0, 22)}…</td>
                </tr>
              ))}
              {(data?.events ?? []).length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-white/40">No provider events yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ConsoleCard>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/30 p-3">
      <p className="text-[10px] uppercase tracking-wide text-white/40 font-bold">{label}</p>
      <p className="text-xl font-black tabular-nums mt-1">{value}</p>
    </div>
  )
}
