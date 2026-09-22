'use client'

// Quicky — Admin: GIFT MULTIPLIER EVENTS (realm PRD §10-§13, §51, §75-§77)
// Events → Gift Multipliers console:
//   · table of every event (name, N×, window, derived status)
//   · create form: custom integer multiplier (2-100), duration dropdown
//     (1h → 7d), start now — with a LIVE PREVIEW (§75: "1 gift = N points,
//     10 gifts = 10N, self gift = 2N") before activation
//   · overlap validation (§13) shows the server's rejection inline
//   · cancel (live/scheduled) + delete (cancelled/expired only) — history
//     stays for reporting (§51)

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, X, Zap, Ban, Trash2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'

type MultiplierEvent = {
  id: string
  name: string
  multiplier: number
  startsAt: string
  expiresAt: string
  status: string
}

/** PRD §10 — suggested durations, max 7 days. */
const DURATIONS: { label: string; ms: number }[] = [
  { label: '1 hour', ms: 3600_000 },
  { label: '2 hours', ms: 7200_000 },
  { label: '6 hours', ms: 6 * 3600_000 },
  { label: '12 hours', ms: 12 * 3600_000 },
  { label: '24 hours', ms: 24 * 3600_000 },
  { label: '48 hours', ms: 48 * 3600_000 },
  { label: '72 hours', ms: 72 * 3600_000 },
  { label: '4 days', ms: 96 * 3600_000 },
  { label: '5 days', ms: 120 * 3600_000 },
  { label: '6 days', ms: 144 * 3600_000 },
  { label: '7 days', ms: 168 * 3600_000 },
]

function statusColor(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'text-[#30D158]'
    case 'SCHEDULED':
      return 'text-[#FFD60A]'
    case 'EXPIRED':
      return 'text-white/40'
    case 'CANCELLED':
      return 'text-white/35 line-through'
    default:
      return 'text-white/60'
  }
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function AdminMultiplierEventsScreen() {
  const [events, setEvents] = useState<MultiplierEvent[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [creating, setCreating] = useState(false)

  const [name, setName] = useState('')
  const [multiplier, setMultiplier] = useState('2')
  const [durationMs, setDurationMs] = useState(24 * 3600_000)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setFailed(false)
    try {
      const res = await api.admin.multiplierEvents.list()
      setEvents((res?.events ?? []) as MultiplierEvent[])
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const m = useMemo(() => Math.max(2, Math.floor(Number(multiplier) || 2)), [multiplier])

  const create = async () => {
    setFormError(null)
    if (!name.trim()) return setFormError('Event name is required.')
    if (!Number.isInteger(m) || m < 2 || m > 100) return setFormError('Multiplier must be a whole number between 2 and 100.')
    setCreating(true)
    try {
      await api.admin.multiplierEvents.create({ name: name.trim(), multiplier: m, durationMs })
      toast.success(`${m}× event activated`)
      setName('')
      await load()
    } catch (e: any) {
      // §13 — the server's overlap rejection (or validation) shows inline.
      setFormError(e?.body?.message ?? e?.message ?? 'Could not create the event.')
    } finally {
      setCreating(false)
    }
  }

  const cancel = async (id: string) => {
    try {
      await api.admin.multiplierEvents.cancel(id)
      toast.success('Event cancelled')
      await load()
    } catch (e: any) {
      toast.error(e?.body?.message ?? 'Could not cancel the event.')
    }
  }

  const remove = async (id: string) => {
    try {
      await api.admin.multiplierEvents.remove(id)
      await load()
    } catch {
      toast.error('Only cancelled/expired events can be removed.')
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      <ConsoleCard title="Create gift multiplier event">
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Event name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Double Gift Points"
                className="rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--qk-accent)]/50"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Multiplier (×)</span>
              <input
                value={multiplier}
                onChange={(e) => setMultiplier(e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                placeholder="2"
                className="rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2 text-sm font-semibold tabular-nums outline-none focus:border-[var(--qk-accent)]/50"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-white/40">Duration</span>
              <select
                value={durationMs}
                onChange={(e) => setDurationMs(Number(e.target.value))}
                className="rounded-xl bg-[#0B0E14] border border-white/10 px-3 py-2 text-sm font-semibold outline-none focus:border-[var(--qk-accent)]/50"
              >
                {DURATIONS.map((d) => (
                  <option key={d.ms} value={d.ms}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* §75 — event preview: exactly what players will earn. */}
          <div className="rounded-xl border border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/10 px-4 py-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/40">Event preview</p>
            <p className="mt-1 text-lg font-black" style={{ color: 'var(--qk-accent)' }}>
              ⚡ {m}× TIME
            </p>
            <p className="text-[11px] text-white/60">Send gifts and earn more points</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] font-semibold text-white/75">
              <span>1 gift = {m} points</span>
              <span>10 gifts = {10 * m} points</span>
              <span>Self gift = {2 * m} points</span>
              <span className="text-white/45">Coins never multiply</span>
            </div>
          </div>

          {formError && <p className="text-xs font-semibold text-rose-400">{formError}</p>}

          <button
            onClick={() => void create()}
            disabled={creating}
            className="self-start flex items-center gap-2 rounded-full px-4 py-2 text-xs font-black text-[var(--qk-on-accent)] transition-transform active:scale-95 disabled:opacity-50"
            style={{ background: 'var(--qk-accent)' }}
          >
            <Plus className="w-3.5 h-3.5" /> {creating ? 'Activating…' : 'Activate event'}
          </button>
        </div>
      </ConsoleCard>

      <ConsoleCard
        title="Gift multiplier events"
        action={
          <button onClick={() => void load()} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50" aria-label="Refresh events">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        }
      >
        {!loaded ? (
          <p className="text-sm text-white/50 py-6 text-center">Loading events…</p>
        ) : failed ? (
          <ConsoleRetry onRetry={() => void load()} />
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <Zap className="w-6 h-6 text-white/25" aria-hidden />
            <p className="text-sm text-white/50">No multiplier events yet — create the first one above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black uppercase tracking-wider text-white/35">
                  <th className="pb-2 pr-3">Event</th>
                  <th className="pb-2 pr-3">Multiplier</th>
                  <th className="pb-2 pr-3">Starts</th>
                  <th className="pb-2 pr-3">Expires</th>
                  <th className="pb-2 pr-3">Status</th>
                  <th className="pb-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => (
                  <tr key={ev.id} className="border-t border-white/8">
                    <td className="py-2.5 pr-3 font-semibold">{ev.name}</td>
                    <td className="py-2.5 pr-3 font-black tabular-nums" style={{ color: 'var(--qk-accent)' }}>
                      {ev.multiplier}×
                    </td>
                    <td className="py-2.5 pr-3 text-white/60 text-xs">{fmt(ev.startsAt)}</td>
                    <td className="py-2.5 pr-3 text-white/60 text-xs">{fmt(ev.expiresAt)}</td>
                    <td className={cn('py-2.5 pr-3 text-xs font-black uppercase tracking-wide', statusColor(ev.status))}>{ev.status}</td>
                    <td className="py-2.5">
                      <div className="flex items-center gap-1.5">
                        {(ev.status === 'ACTIVE' || ev.status === 'SCHEDULED' || ev.status === 'DRAFT') && (
                          <button
                            onClick={() => void cancel(ev.id)}
                            className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold text-white/70 hover:border-rose-400/50 hover:text-rose-300"
                          >
                            <Ban className="w-3 h-3" /> Cancel
                          </button>
                        )}
                        {(ev.status === 'CANCELLED' || ev.status === 'EXPIRED') && (
                          <button
                            onClick={() => void remove(ev.id)}
                            className="flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[10px] font-bold text-white/50 hover:text-rose-300"
                          >
                            <Trash2 className="w-3 h-3" /> Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[10px] text-white/35">
              Overlap guard: only ONE multiplier event may be live at a time — the effective multiplier is always deterministic. Expired events stay for reporting.
            </p>
          </div>
        )}
      </ConsoleCard>
    </div>
  )
}
