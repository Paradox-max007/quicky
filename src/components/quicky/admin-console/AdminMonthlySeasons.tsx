'use client'

// Quicky — ADMIN: MONTHLY SEASONS (crate-pass PRD)
// Calendar-month competitive windows (the ❤ room chip). Admin owns:
//   · name / image / window (starts/ends) / active
//   · SEASONAL GIFTS — which catalog items are featured for the season
//   · SEASON EVENTS — name/emoji/window + a multiplier that boosts SEASON
//     points while running
// The active row auto-provisions (server) when a month has none; everything
// here is edits on top. Distinct from the realm-LADDER seasons below it.

import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, Gift, RefreshCw, Save, Trash2, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { ConsoleCard } from './AdminConsole'

type MonthlySeason = {
  id: string
  name: string
  imageUrl: string | null
  startsAt: string
  endsAt: string
  isActive: boolean
  giftCount: number
  eventCount: number
  players: number
  pointsAwarded: number
  giftIds: string[]
  events: SeasonEventRow[]
}

type SeasonEventRow = {
  id: string
  name: string
  emoji: string
  description: string | null
  multiplier: number
  startsAt: string
  endsAt: string
  running: boolean
}

type ItemOption = { id: string; name: string; emoji: string; iconType: string; iconValue: string | null }

const inputCls = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50'

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })
}

function toInputDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

export function AdminMonthlySeasons() {
  const [seasons, setSeasons] = useState<MonthlySeason[]>([])
  const [itemOptions, setItemOptions] = useState<ItemOption[]>([])
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<MonthlySeason | null>(null)
  const [creating, setCreating] = useState(false)
  const [giftsFor, setGiftsFor] = useState<MonthlySeason | null>(null)
  const [giftIds, setGiftIds] = useState<string[]>([])
  const [eventsFor, setEventsFor] = useState<MonthlySeason | null>(null)
  const [events, setEvents] = useState<SeasonEventRow[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (): Promise<MonthlySeason[]> => {
    try {
      const res = await api.admin.monthlySeasons.list()
      const rows = (res?.seasons ?? []) as MonthlySeason[]
      setSeasons(rows)
      setItemOptions((res?.itemOptions ?? []) as ItemOption[])
      setFailed(false)
      return rows
    } catch {
      setFailed(true)
      return []
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = async (data: Record<string, unknown>, okMsg: string) => {
    setBusy(true)
    try {
      await api.admin.monthlySeasons.update(data)
      toast.success(okMsg)
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (row: MonthlySeason) => {
    if (!confirm(`Delete "${row.name}"?${row.players ? `\n\n${row.players} player(s) earned points — it will be deactivated instead.` : ''}`)) return
    try {
      const res = await api.admin.monthlySeasons.remove(row.id)
      if (res?.error) toast.error(res.message ?? 'Season deactivated (has history)')
      else toast.success('Season deleted')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const openGifts = (row: MonthlySeason) => {
    setGiftsFor(row)
    setGiftIds(row.giftIds ?? [])
  }

  const openEvents = (row: MonthlySeason) => {
    setEventsFor(row)
    setEvents(row.events ?? [])
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-white/40 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden /> Loading monthly seasons…
      </div>
    )
  }

  return (
    <ConsoleCard
      title="Monthly Seasons (❤ season points)"
      action={
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-full border border-[var(--qk-accent)]/40 px-3 py-1.5 text-[11px] font-bold text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/10"
        >
          <CalendarPlus className="w-3.5 h-3.5" aria-hidden /> New season
        </button>
      }
    >
      {failed && <p className="text-xs text-red-300/80 mb-3">Couldn&apos;t load — retry below.</p>}
      <p className="text-xs text-white/55 leading-relaxed mb-3">
        A calendar-month window. Players earn <b>season points</b> (❤ room chip) from gifts, boosted by any running season event. The active
        month auto-provisions with defaults — edit it here (name, image, seasonal gifts, events). Points reset with each new season row.
      </p>

      <div className="flex flex-col gap-2">
        {seasons.map((row) => {
          const now = Date.now()
          const running = row.isActive && new Date(row.startsAt).getTime() <= now && new Date(row.endsAt).getTime() > now
          const future = new Date(row.startsAt).getTime() > now
          return (
            <div key={row.id} className="rounded-xl border border-white/8 bg-black/20 p-3">
              <div className="flex items-center gap-3 flex-wrap">
                {row.imageUrl ? (
                  <img src={row.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-white/10" />
                ) : (
                  <span className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center text-lg" aria-hidden>🗓️</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold truncate flex items-center gap-2">
                    {row.name}
                    {running && <span className="text-[9px] font-black uppercase tracking-wide text-[#30D158] bg-[#30D158]/10 border border-[#30D158]/25 rounded-full px-1.5 py-0.5">Active</span>}
                    {future && <span className="text-[9px] font-black uppercase tracking-wide text-white/50 bg-white/5 border border-white/10 rounded-full px-1.5 py-0.5">Upcoming</span>}
                  </p>
                  <p className="text-[11px] text-white/45">
                    {fmtDate(row.startsAt)} → {fmtDate(row.endsAt)} · {row.players} players · {row.pointsAwarded.toLocaleString()} pts awarded
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setEditing(row)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold hover:bg-white/5">Edit</button>
                  <button onClick={() => openGifts(row)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold hover:bg-white/5 flex items-center gap-1">
                    <Gift className="w-3.5 h-3.5" aria-hidden /> {row.giftCount}
                  </button>
                  <button onClick={() => openEvents(row)} className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] font-bold hover:bg-white/5 flex items-center gap-1">
                    <Zap className="w-3.5 h-3.5" aria-hidden /> {row.eventCount}
                  </button>
                  <button
                    onClick={() => void patch({ id: row.id, isActive: !row.isActive }, row.isActive ? 'Season deactivated' : 'Season activated')}
                    disabled={busy}
                    className={`rounded-lg px-2.5 py-1.5 text-[11px] font-bold border ${row.isActive ? 'border-amber-400/30 text-amber-300 hover:bg-amber-400/10' : 'border-[#30D158]/30 text-[#30D158] hover:bg-[#30D158]/10'}`}
                  >
                    {row.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  <button onClick={() => void remove(row)} className="rounded-lg border border-red-400/25 text-red-300 px-2.5 py-1.5 text-[11px] font-bold hover:bg-red-400/10 flex items-center gap-1">
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
        {seasons.length === 0 && <p className="text-xs text-white/40 py-4 text-center">No seasons yet — the next status fetch auto-provisions the current month.</p>}
      </div>

      {/* ── Create / edit modal ─────────────────────────────────────────── */}
      {(creating || editing) && (
        <SeasonForm
          initial={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setCreating(false)
            setEditing(null)
            await load()
          }}
        />
      )}

      {/* ── Seasonal gifts manager ──────────────────────────────────────── */}
      {giftsFor && (
        <GiftsManager
          season={giftsFor}
          itemOptions={itemOptions}
          currentIds={giftIds}
          onClose={() => setGiftsFor(null)}
          onChanged={load}
        />
      )}

      {/* ── Season events manager ───────────────────────────────────────── */}
      {eventsFor && (
        <EventsManager
          season={eventsFor}
          events={events}
          onClose={() => setEventsFor(null)}
          onChanged={async (row) => {
            // Reload the list and refresh the open manager from the fresh row.
            const rows = await load()
            const fresh = rows.find((r) => r.id === row.id)
            if (fresh) setEvents(fresh.events ?? [])
          }}
        />
      )}
    </ConsoleCard>
  )
}

function SeasonForm({ initial, onClose, onSaved }: { initial: MonthlySeason | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? '')
  const [startsAt, setStartsAt] = useState(toInputDate(initial?.startsAt ?? new Date().toISOString()))
  const [endsAt, setEndsAt] = useState(toInputDate(initial?.endsAt ?? new Date(Date.now() + 30 * 86400000).toISOString()))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return toast.error('Name is required')
    setBusy(true)
    try {
      if (initial) {
        await api.admin.monthlySeasons.update({ id: initial.id, name: name.trim(), imageUrl: imageUrl.trim() || null, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() })
      } else {
        await api.admin.monthlySeasons.create({ name: name.trim(), imageUrl: imageUrl.trim() || null, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() })
      }
      toast.success(initial ? 'Season updated' : 'Season created')
      onSaved()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label={initial ? 'Edit season' : 'New season'}>
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#101623] p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">{initial ? 'Edit monthly season' : 'New monthly season'}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8"><X className="w-4 h-4" aria-hidden /></button>
        </div>
        <label className="text-[11px] font-bold text-white/50">Name<input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Season of October 2026" /></label>
        <label className="text-[11px] font-bold text-white/50">Image URL (optional)<input className={inputCls} value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[11px] font-bold text-white/50">Starts<input type="date" className={inputCls} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
          <label className="text-[11px] font-bold text-white/50">Ends<input type="date" className={inputCls} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
        </div>
        <div className="flex gap-2 justify-end mt-1">
          <button onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold">Cancel</button>
          <button onClick={() => void save()} disabled={busy} className="rounded-xl bg-[var(--qk-accent)] px-4 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-60">
            <Save className="w-3.5 h-3.5" aria-hidden /> Save
          </button>
        </div>
      </div>
    </div>
  )
}

function GiftsManager({ season, itemOptions, currentIds, onClose, onChanged }: { season: MonthlySeason; itemOptions: ItemOption[]; currentIds: string[]; onClose: () => void; onChanged: () => void }) {
  const [selected, setSelected] = useState<string[]>(currentIds)
  const [busy, setBusy] = useState(false)

  const toggle = async (itemId: string, isOn: boolean) => {
    setBusy(true)
    try {
      await api.admin.monthlySeasons.update({ id: season.id, action: isOn ? 'remove_gift' : 'add_gift', itemId })
      setSelected((prev) => (isOn ? prev.filter((i) => i !== itemId) : [...prev, itemId]))
      onChanged()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label="Seasonal gifts">
      <div className="w-full max-w-md max-h-[80vh] rounded-2xl border border-white/10 bg-[#101623] p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">Seasonal gifts — {season.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8"><X className="w-4 h-4" aria-hidden /></button>
        </div>
        <p className="text-[11px] text-white/45">Tap to feature/unfeature catalog gifts for this season.</p>
        <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
          {itemOptions.map((it) => {
            const on = selected.includes(it.id)
            return (
              <button
                key={it.id}
                onClick={() => void toggle(it.id, on)}
                disabled={busy}
                className={`w-full flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors ${on ? 'border-[var(--qk-accent)]/40 bg-[var(--qk-accent)]/10' : 'border-white/8 bg-black/20 hover:bg-white/5'}`}
              >
                <span className="text-lg" aria-hidden>{it.emoji}</span>
                <span className="flex-1 text-[13px] font-bold truncate">{it.name}</span>
                <span className={`text-[10px] font-black uppercase ${on ? 'text-[var(--qk-accent)]' : 'text-white/30'}`}>{on ? 'Featured' : 'Add'}</span>
              </button>
            )
          })}
          {itemOptions.length === 0 && <p className="text-xs text-white/40 py-4 text-center">No gifts in the catalog yet (create them under Gifts first).</p>}
        </div>
      </div>
    </div>
  )
}

function EventsManager({ season, events, onClose, onChanged }: { season: MonthlySeason; events: SeasonEventRow[]; onClose: () => void; onChanged: (row: MonthlySeason) => void }) {
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('✨')
  const [multiplier, setMultiplier] = useState('2')
  const [startsAt, setStartsAt] = useState(toInputDate(new Date().toISOString()))
  const [endsAt, setEndsAt] = useState(toInputDate(new Date(Date.now() + 7 * 86400000).toISOString()))
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!name.trim()) return toast.error('Event name is required')
    setBusy(true)
    try {
      await api.admin.monthlySeasons.update({
        id: season.id,
        action: 'add_event',
        name: name.trim(),
        emoji: emoji.trim() || '✨',
        multiplier: Number(multiplier) || 1,
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      })
      toast.success('Season event added')
      setName('')
      onChanged(season)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Add failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (eventId: string) => {
    setBusy(true)
    try {
      await api.admin.monthlySeasons.update({ id: season.id, action: 'remove_event', eventId })
      onChanged(season)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-label="Season events">
      <div className="w-full max-w-md max-h-[80vh] rounded-2xl border border-white/10 bg-[#101623] p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black">Season events — {season.name}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/8"><X className="w-4 h-4" aria-hidden /></button>
        </div>
        <p className="text-[11px] text-white/45">While an event runs it multiplies SEASON point awards (realm points are unaffected).</p>
        <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-1.5 pr-1">
          {events.map((ev) => (
            <div key={ev.id} className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${ev.running ? 'border-[#30D158]/30 bg-[#30D158]/5' : 'border-white/8 bg-black/20'}`}>
              <span className="text-lg" aria-hidden>{ev.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold truncate">{ev.name} <span className="text-[var(--qk-gold)] font-black">×{ev.multiplier}</span></p>
                <p className="text-[10.5px] text-white/40">{fmtDate(ev.startsAt)} → {fmtDate(ev.endsAt)}{ev.running ? ' · running' : ''}</p>
              </div>
              <button onClick={() => void remove(ev.id)} disabled={busy} className="rounded-lg border border-red-400/25 text-red-300 px-2 py-1.5 text-[10px] font-bold hover:bg-red-400/10">Remove</button>
            </div>
          ))}
          {events.length === 0 && <p className="text-xs text-white/40 py-3 text-center">No events for this season yet.</p>}
        </div>
        <div className="border-t border-white/8 pt-3 flex flex-col gap-2">
          <div className="grid grid-cols-[1fr_70px_80px] gap-2">
            <input className={inputCls} placeholder="Event name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className={inputCls} placeholder="✨" value={emoji} onChange={(e) => setEmoji(e.target.value)} />
            <input className={inputCls} placeholder="×2" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className={inputCls} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            <input type="date" className={inputCls} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          <button onClick={() => void add()} disabled={busy} className="rounded-xl bg-[var(--qk-accent)] px-4 py-2 text-xs font-bold disabled:opacity-60">Add event</button>
        </div>
      </div>
    </div>
  )
}
