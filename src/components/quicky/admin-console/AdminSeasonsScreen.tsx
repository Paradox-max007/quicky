'use client'

// Quicky — ADMIN SEASONS (admin-console PRD §7/§14)
//
// Seasons above the 15-realm ladder. Per-season realm NAME overrides let
// different seasons show different realm names; the active season is what
// players progress through. Player rollover (season N+1 after finishing
// every realm) happens server-side at settlement.
import { useCallback, useEffect, useState } from 'react'
import { CalendarPlus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { ConsoleCard, ConsoleRetry } from './AdminConsole'

type SeasonRow = {
  id: string
  seasonNumber: number
  name: string
  description: string | null
  realmNameOverrides: Record<string, string>
  isActive: boolean
  players: number
  createdAt: string
}

const inputCls = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50'

const REALM_LEVELS = Array.from({ length: 15 }, (_, i) => i + 1)

export function AdminSeasonsScreen() {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [seasons, setSeasons] = useState<SeasonRow[]>([])
  const [editing, setEditing] = useState<SeasonRow | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    // NOTE: every setState lives AFTER the first await — nothing is
    // synchronously reachable from the mount effect (react-hooks/
    // set-state-in-effect), and a failed refresh keeps the error banner
    // until a successful load clears it.
    try {
      const res = await api.admin.seasons.list()
      setSeasons((res?.seasons ?? []) as SeasonRow[])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (row: SeasonRow) => {
    if (!confirm(`Delete "${row.name}"?${row.players ? `\n\n${row.players} player(s) are on this season — it will be deactivated instead.` : ''}`)) return
    try {
      const res = await api.admin.seasons.remove(row.id)
      toast.success(res?.disabled ? 'Season deactivated (has players)' : 'Season deleted')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const toggleActive = async (row: SeasonRow) => {
    try {
      await api.admin.seasons.update(row.id, { isActive: !row.isActive })
      toast.success(row.isActive ? 'Season deactivated' : 'Season activated')
      await load()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Update failed')
    }
  }

  if (failed) return <ConsoleRetry onRetry={load} />
  if (!loaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-white/40 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin" aria-hidden /> Loading seasons…
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-white/8 bg-[#101623] p-4">
        <p className="text-[10px] font-black uppercase tracking-wider text-white/40">How seasons work</p>
        <p className="text-xs text-white/60 mt-1.5 leading-relaxed">
          Each season wraps the 15-realm ladder. When a player promotes out of <b>The Apex</b> (realm 15), the server rolls them into
          the next season and restarts the ladder at realm 1 — their realm names then come from the new season&apos;s overrides.
          Name overrides are optional: leave a field empty to keep the ladder&apos;s default name.
        </p>
      </div>

      <ConsoleCard
        title="Seasons"
        action={
          <button
            onClick={() => {
              setCreating(true)
              setEditing(null)
            }}
            className="flex items-center gap-1.5 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] px-3.5 py-1.5 text-xs font-bold"
          >
            <CalendarPlus className="w-3.5 h-3.5" aria-hidden /> New Season
          </button>
        }
      >
        {seasons.length === 0 ? (
          <p className="py-8 text-center text-sm text-white/40">No seasons yet — Season 1 is created by the migration.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {seasons.map((row) => (
              <div key={row.id} className="flex items-center gap-3 rounded-xl border border-white/8 bg-black/20 px-3 py-2.5">
                <div className="w-10 h-10 shrink-0 rounded-xl bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center text-sm font-black text-[var(--qk-accent)]">
                  S{row.seasonNumber}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate">{row.name}</p>
                    {row.isActive && <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-[#30D158]/15 text-[#30D158]">ACTIVE</span>}
                  </div>
                  <p className="text-[11px] text-white/35 truncate">
                    {row.description ?? 'No description'}
                    {Object.keys(row.realmNameOverrides ?? {}).length > 0 && ` · ${Object.keys(row.realmNameOverrides).length} realm name override(s)`}
                    {row.players > 0 && ` · ${row.players} player(s)`}
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => toggleActive(row)} className={`text-[10px] font-black px-2.5 py-1 rounded-full ${row.isActive ? 'bg-[#30D158]/15 text-[#30D158]' : 'bg-white/8 text-white/40'}`}>
                    {row.isActive ? 'ACTIVE' : 'INACTIVE'}
                  </button>
                  <button
                    onClick={() => {
                      setEditing(row)
                      setCreating(false)
                    }}
                    className="text-xs font-bold px-3 py-1.5 rounded-full bg-white/8 hover:bg-white/15 text-white/70"
                  >
                    Edit
                  </button>
                  <button onClick={() => remove(row)} className="p-2 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/40 hover:text-rose-300" title="Delete season">
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ConsoleCard>

      {(creating || editing) && (
        <SeasonEditor
          initial={editing}
          nextNumber={Math.max(0, ...seasons.map((s) => s.seasonNumber)) + 1}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

function SeasonEditor({ initial, nextNumber, onClose, onSaved }: { initial: SeasonRow | null; nextNumber: number; onClose: () => void; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)
  const [seasonNumber, setSeasonNumber] = useState(initial?.seasonNumber ?? nextNumber)
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [overrides, setOverrides] = useState<Record<string, string>>(initial?.realmNameOverrides ?? {})

  const save = async () => {
    if (!name.trim()) {
      toast.error('Season name is required')
      return
    }
    if (!Number.isInteger(seasonNumber) || seasonNumber < 1) {
      toast.error('Season number must be a positive whole number')
      return
    }
    setSaving(true)
    try {
      const cleanOverrides: Record<string, string> = {}
      for (const [k, v] of Object.entries(overrides)) {
        if (String(v ?? '').trim()) cleanOverrides[k] = String(v).trim().slice(0, 40)
      }
      const payload = { seasonNumber, name: name.trim(), description: description.trim() || null, realmNameOverrides: cleanOverrides }
      if (initial) await api.admin.seasons.update(initial.id, payload)
      else await api.admin.seasons.create({ ...payload, isActive: false })
      toast.success(initial ? 'Season updated' : 'Season created')
      onSaved()
    } catch (e: unknown) {
      const err = e as { message?: string; body?: { message?: string } }
      toast.error(err?.body?.message ?? err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" role="dialog">
      <div className="w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0E121A] p-5">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-white/8">
          <h3 className="text-sm font-black">{initial ? `Edit ${initial.name}` : 'New Season'}</h3>
          <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/50"><X className="w-4 h-4" aria-hidden /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Season number</label>
            <input type="number" min={1} value={seasonNumber} onChange={(e) => setSeasonNumber(Number(e.target.value))} className={`${inputCls} mt-1`} disabled={!!initial} />
          </div>
          <div>
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Season name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Season of Embers" className={`${inputCls} mt-1`} />
          </div>
          <div className="md:col-span-2">
            <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Shown with the season on the realm screen" className={`${inputCls} mt-1`} />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-white/8 bg-black/20 p-4">
          <p className="text-[11px] font-black uppercase tracking-wider text-white/40">Realm name overrides (optional — empty keeps the default)</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {REALM_LEVELS.map((level) => (
              <div key={level} className="flex items-center gap-2">
                <span className="text-[10px] font-black text-white/30 w-6 text-right">{level}</span>
                <input
                  value={overrides[String(level)] ?? ''}
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [String(level)]: e.target.value }))}
                  placeholder={`Realm ${level}`}
                  className="flex-1 min-w-0 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder:text-white/20 focus:outline-none focus:border-[var(--qk-accent)]/50"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-4 border-t border-white/8 mt-4">
          <button onClick={onClose} className="rounded-full px-4 py-2 text-xs font-bold text-white/50 hover:text-white">Cancel</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-full bg-[var(--qk-accent)] text-[var(--qk-on-accent)] px-5 py-2 text-xs font-bold disabled:opacity-50">
            <Save className="w-3.5 h-3.5" aria-hidden /> {saving ? 'Saving…' : initial ? 'Save changes' : 'Create season'}
          </button>
        </div>
      </div>
    </div>
  )
}
