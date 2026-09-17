'use client'

// Quicky — ADMIN GAME CONFIGURATION (refactor PRD §19/§20/§84/§85/§86)
// Admin edits game presentation without code changes (§19): name, description,
// icon, artwork theme, supported modes, players, isPlayable, isActive,
// sort order — plus the rotating landing description texts (§20) with
// explicit sort_order reordering (§86). Follows the existing admin screen
// conventions (AdminGiftsScreen / AdminStickersScreen).
import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plus, Save, Trash2 } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'

type GameRow = {
  id: string
  slug: string
  name: string
  shortDescription: string
  description: string
  icon: string
  artwork: string
  supportedModes: string
  minPlayers: number
  maxPlayers: number
  isPlayable: boolean
  isFeatured: boolean
  isActive: boolean
  sortOrder: number
}

type DescRow = {
  id: string
  gameId: string
  text: string
  sortOrder: number
  isActive: boolean
}

const ARTWORK_KEYS = ['coral', 'purple', 'gold', 'sky', 'rose', 'lime', 'slate']
const MODES = ['GROUP', 'TWO_PLAYER', 'BOTH']

const inputCls =
  'w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50'

export function AdminGamesScreen({ onBack }: { onBack?: () => void } = {}) {
  const [games, setGames] = useState<GameRow[]>([])
  const [items, setItems] = useState<DescRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<GameRow | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.admin.games.list()
      setGames(res.games ?? [])
      setItems(res.descriptionItems ?? [])
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to load games')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveGame = async () => {
    if (!editing || saving) return
    setSaving(true)
    try {
      if (games.some((g) => g.id === editing.id)) {
        await api.admin.games.update('game', editing.id, editing)
      } else {
        await api.admin.games.create('game', editing)
      }
      toast.success('Game saved')
      setEditing(null)
      await load()
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const toggleField = async (g: GameRow, field: 'isActive' | 'isPlayable', value: boolean) => {
    try {
      await api.admin.games.update('game', g.id, { [field]: value })
      setGames((prev) => prev.map((x) => (x.id === g.id ? { ...x, [field]: value } : x)))
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed')
    }
  }

  const newGame = () =>
    setEditing({
      id: '',
      slug: '',
      name: '',
      shortDescription: '',
      description: '',
      icon: '🎲',
      artwork: 'coral',
      supportedModes: 'GROUP',
      minPlayers: 2,
      maxPlayers: 12,
      isPlayable: false,
      isFeatured: false,
      isActive: true,
      sortOrder: games.length + 1,
    })

  // ── Rotating description items (§20/§86) ─────────────────────────────────
  const addItem = async (gameId: string) => {
    try {
      const gameItems = items.filter((i) => i.gameId === gameId)
      await api.admin.games.create('description', { gameId, text: 'New line', sortOrder: gameItems.length })
      await load()
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed')
    }
  }

  const saveItem = async (item: DescRow) => {
    try {
      await api.admin.games.update('description', item.id, { text: item.text, sortOrder: item.sortOrder, isActive: item.isActive })
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed')
    }
  }

  const moveItem = async (item: DescRow, dir: -1 | 1) => {
    const siblings = items.filter((i) => i.gameId === item.gameId).sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = siblings.findIndex((i) => i.id === item.id)
    const swap = siblings[idx + dir]
    if (!swap) return
    const a = item.sortOrder
    const b = swap.sortOrder
    try {
      await Promise.all([
        api.admin.games.update('description', item.id, { sortOrder: b }),
        api.admin.games.update('description', swap.id, { sortOrder: a }),
      ])
      await load()
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed')
    }
  }

  const removeItem = async (item: DescRow) => {
    if (!confirm('Delete this description line?')) return
    try {
      await api.admin.games.remove('description', item.id)
      await load()
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed')
    }
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-5 pb-10" data-testid="admin-games">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-black">Game Configuration</h1>
          <p className="text-xs text-white/45 mt-0.5">Card content, availability, ordering and rotating landing texts.</p>
        </div>
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              onClick={onBack}
              className="rounded-full border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-bold text-white/70 hover:bg-white/10"
            >
              Back to Dashboard
            </button>
          )}
          <button
            onClick={newGame}
            className="flex items-center gap-1.5 rounded-full bg-coral-gradient px-4 py-2 text-xs font-bold active:scale-95 transition-transform"
          >
            <Plus className="w-4 h-4" /> New game
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-white/8 bg-white/5 p-6 text-sm text-white/50">Loading…</div>
      ) : (
        <>
          {/* Editor form */}
          {editing && (
            <div className="rounded-3xl border border-white/10 bg-[var(--qk-card)] p-5 flex flex-col gap-3">
              <p className="text-sm font-bold">{editing.id ? `Edit — ${editing.name}` : 'New game'}</p>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs text-white/50">
                  Name
                  <input className={inputCls} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/50">
                  Slug
                  <input className={inputCls} value={editing.slug} placeholder="auto from name" onChange={(e) => setEditing({ ...editing, slug: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/50">
                  Icon (emoji)
                  <input className={inputCls} value={editing.icon} onChange={(e) => setEditing({ ...editing, icon: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/50">
                  Artwork theme
                  <select className={inputCls} value={editing.artwork} onChange={(e) => setEditing({ ...editing, artwork: e.target.value })}>
                    {ARTWORK_KEYS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/50">
                  Supported modes
                  <select className={inputCls} value={editing.supportedModes} onChange={(e) => setEditing({ ...editing, supportedModes: e.target.value })}>
                    {MODES.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/50">
                  Sort order
                  <input type="number" className={inputCls} value={editing.sortOrder} onChange={(e) => setEditing({ ...editing, sortOrder: Number(e.target.value) })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/50">
                  Min players
                  <input type="number" className={inputCls} value={editing.minPlayers} onChange={(e) => setEditing({ ...editing, minPlayers: Number(e.target.value) })} />
                </label>
                <label className="flex flex-col gap-1 text-xs text-white/50">
                  Max players
                  <input type="number" className={inputCls} value={editing.maxPlayers} onChange={(e) => setEditing({ ...editing, maxPlayers: Number(e.target.value) })} />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-xs text-white/50">
                Short description (card subtitle)
                <input className={inputCls} value={editing.shortDescription} onChange={(e) => setEditing({ ...editing, shortDescription: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-white/50">
                Landing description
                <textarea rows={3} className={`${inputCls} resize-none`} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </label>
              <div className="flex flex-wrap gap-4 text-xs">
                {(['isPlayable', 'isActive', 'isFeatured'] as const).map((f) => (
                  <label key={f} className="flex items-center gap-2 text-white/70">
                    <input
                      type="checkbox"
                      checked={editing[f]}
                      onChange={(e) => setEditing({ ...editing, [f]: e.target.checked })}
                      className="accent-[var(--qk-accent)]"
                    />
                    {f === 'isPlayable' ? 'Playable (LIVE)' : f === 'isActive' ? 'Visible in catalog' : 'Featured'}
                  </label>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-full border border-white/12 text-xs font-semibold text-white/70">
                  Cancel
                </button>
                <button
                  onClick={saveGame}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-5 py-2 rounded-full bg-coral-gradient text-xs font-bold disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}

          {/* Game list */}
          <div className="flex flex-col gap-3">
            {games.map((g) => {
              const gameItems = items.filter((i) => i.gameId === g.id).sort((a, b) => a.sortOrder - b.sortOrder)
              return (
                <div key={g.id} className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl" aria-hidden>{g.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate">
                        {g.name} <span className="text-white/35 font-mono text-[11px]">/{g.slug}</span>
                      </p>
                      <p className="text-[11px] text-white/45 truncate">{g.shortDescription || '—'}</p>
                    </div>
                    <span className={`text-[10px] font-black rounded-full px-2 py-0.5 ${g.isPlayable ? 'bg-[#30D158]/15 text-[#30D158]' : 'bg-white/8 text-white/50'}`}>
                      {g.isPlayable ? 'LIVE' : 'SOON'}
                    </span>
                    <button
                      onClick={() => toggleField(g, 'isActive', !g.isActive)}
                      className={`text-[10px] font-black rounded-full px-2 py-0.5 ${g.isActive ? 'bg-white/8 text-white/70' : 'bg-[#FF6B6B]/15 text-[#FF6B6B]'}`}
                      title="Catalog visibility"
                    >
                      {g.isActive ? 'VISIBLE' : 'HIDDEN'}
                    </button>
                    <button
                      onClick={() => setEditing({ ...g })}
                      className="text-xs font-bold text-[var(--qk-accent)] px-3 py-1.5 rounded-full border border-[var(--qk-accent)]/30"
                    >
                      Edit
                    </button>
                  </div>

                  {/* Rotating texts (§20) */}
                  <div className="mt-3 pt-3 border-t border-white/6">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-white/40">Rotating landing texts</p>
                      <button onClick={() => addItem(g.id)} className="text-[11px] font-bold text-[var(--qk-accent)] flex items-center gap-1">
                        <Plus className="w-3 h-3" /> Add
                      </button>
                    </div>
                    {gameItems.length === 0 ? (
                      <p className="text-[11px] text-white/35">No custom lines — the built-in rotation is used.</p>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {gameItems.map((item, idx) => (
                          <div key={item.id} className="flex items-center gap-1.5">
                            <div className="flex flex-col">
                              <button onClick={() => moveItem(item, -1)} disabled={idx === 0} className="text-white/40 hover:text-white disabled:opacity-25" aria-label="Move up">
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => moveItem(item, 1)} disabled={idx === gameItems.length - 1} className="text-white/40 hover:text-white disabled:opacity-25" aria-label="Move down">
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <input
                              className={`${inputCls} py-1.5 text-xs`}
                              value={item.text}
                              onChange={(e) => setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, text: e.target.value } : x)))}
                              onBlur={() => saveItem(item)}
                            />
                            <button
                              onClick={() => {
                                const next = !item.isActive
                                setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, isActive: next } : x)))
                                void api.admin.games.update('description', item.id, { isActive: next }).catch(() => {})
                              }}
                              className={`text-[9px] font-black rounded-full px-1.5 py-0.5 ${item.isActive ? 'bg-[#30D158]/15 text-[#30D158]' : 'bg-white/8 text-white/45'}`}
                              title="Active"
                            >
                              {item.isActive ? 'ON' : 'OFF'}
                            </button>
                            <button onClick={() => removeItem(item)} className="text-white/35 hover:text-[#FF6B6B]" aria-label="Delete">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
