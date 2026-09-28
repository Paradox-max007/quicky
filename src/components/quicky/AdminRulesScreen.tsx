'use client'

// Quicky — Admin: "How It Works" rule management (lifecycle PRD §44/§48/§49)
// Full CRUD against /api/quicky/admin/game-rules:
//   • add a rule, edit title / description / icon, change display order
//     (sort_order drives the Play Now rotation order — §49),
//   • MOVE UP / MOVE DOWN per step (admin-console PRD §5.1 + §18.1 — the
//     accessible reorder control; the new order persists server-side),
//   • DRAFT ↔ PUBLISHED per step (§5.1 — drafts stay admin-only; publishing
//     validates the content is complete),
//   • activate / deactivate (deactivated rules vanish from the game screen
//     without any frontend deploy — §44),
//   • LIVE PREVIEW of how the step renders on the game's main screen (§5.1),
//   • delete (rules carry no transaction history, so a hard delete is safe).
// The screen itself is server-gated too: every admin API re-checks
// User.isAdmin on each request (§35/§36) — this UI is convenience, not the
// security boundary.

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, Pencil, Trash2, X, ChevronUp, ChevronDown } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { cn } from '@/lib/utils'

type AdminRule = {
  id: string
  gameType: string
  title: string
  description: string
  icon: string
  isActive: boolean
  sortOrder: number
  status: string // DRAFT | PUBLISHED (admin-console PRD §5.1)
}

type RuleForm = {
  id?: string
  title: string
  description: string
  icon: string
  sortOrder: string
  isActive: boolean
  status: 'DRAFT' | 'PUBLISHED'
}

type GameOption = { slug: string; name: string; isPlayable: boolean }

const EMPTY_RULE: RuleForm = { title: '', description: '', icon: '🎲', sortOrder: '99', isActive: true, status: 'PUBLISHED' }

/** gameType keys follow the GameRule rows; the playable games map to their
 * landing-screen slug, every other game to its slug as-is. */
function gameTypeForSlug(slug: string): string {
  if (slug === 'spin-the-bottle') return 'spin_the_bottle'
  return slug.replace(/-/g, '_')
}

export function AdminRulesScreen({ onBack }: { onBack?: () => void } = {}) {
  const setView = useQuickyStore((s) => s.setView)
  const [rules, setRules] = useState<AdminRule[]>([])
  const [games, setGames] = useState<GameOption[]>([])
  const [gameSlug, setGameSlug] = useState('spin-the-bottle')
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<RuleForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const gameType = gameTypeForSlug(gameSlug)

  // Games list for the selector (admin-console PRD §5 — list ALL registered
  // games; each has independent instructions).
  useEffect(() => {
    let cancelled = false
    void api.admin.games
      .list()
      .then((res) => {
        if (cancelled) return
        setGames(((res?.games ?? []) as GameOption[]).map((g) => ({ slug: g.slug, name: g.name, isPlayable: !!g.isPlayable })))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const load = useCallback(
    async (type?: string) => {
      setLoading(true)
      try {
        const res = await api.admin.gameRules.list(type ?? gameType)
        setRules(res.rules ?? [])
      } catch (e: any) {
        toast.error(e.message ?? 'Failed to load rules')
      } finally {
        setLoading(false)
      }
    },
    [gameType]
  )

  useEffect(() => {
    void load(gameType)
  }, [load, gameType])

  const save = async () => {
    if (!form || saving) return
    if (!form.title.trim()) return toast.error('Title is required')
    // admin-console PRD §5.1 — empty content can't be published (drafts can).
    if (form.status === 'PUBLISHED' && !form.description.trim()) {
      return toast.error('Description is required to publish — save as a draft instead, or add the copy.')
    }
    setSaving(true)
    const data = {
      gameType,
      title: form.title.trim(),
      description: form.description.trim() || '—',
      icon: form.icon.trim() || '🎲',
      sortOrder: Math.floor(Number(form.sortOrder)) || 0,
      isActive: form.isActive,
      status: form.status,
    }
    try {
      if (form.id) await api.admin.gameRules.update(form.id, data)
      else await api.admin.gameRules.create(data)
      toast.success(form.id ? 'Rule updated' : 'Rule created')
      setForm(null)
      await load(gameType)
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // admin-console PRD §5.1/§18.1 — persistent move-up / move-down reorder.
  const move = async (rule: AdminRule, direction: 'up' | 'down') => {
    if (movingId) return
    setMovingId(rule.id)
    try {
      const res = await api.admin.gameRules.move(rule.id, direction)
      if (res && res.moved === false) toast.info('Already at the ' + (direction === 'up' ? 'top' : 'bottom'))
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Reorder failed')
    } finally {
      setMovingId(null)
    }
  }

  const toggleActive = async (rule: AdminRule) => {
    try {
      await api.admin.gameRules.update(rule.id, { isActive: !rule.isActive })
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Update failed')
    }
  }

  // §5.1 — publish validates completeness server-side on the merged row.
  const toggleStatus = async (rule: AdminRule) => {
    const next = rule.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED'
    try {
      await api.admin.gameRules.update(rule.id, { status: next })
      toast.success(next === 'PUBLISHED' ? 'Step published — live on the game screen' : 'Step moved to drafts')
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Publish failed — add a description first')
    }
  }

  const remove = async (id: string) => {
    setConfirmDeleteId(null)
    try {
      await api.admin.gameRules.remove(id)
      toast.success('Rule deleted')
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Delete failed')
    }
  }

  const draftCount = rules.filter((r) => r.status === 'DRAFT').length

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white">
      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2">
        <button onClick={() => (onBack ? onBack() : setView('settings'))} className="p-2 rounded-full hover:bg-white/10" aria-label="Back to Settings">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold leading-none">Admin · How It Works</h1>
          <p className="text-[11px] text-white/40 mt-1">
            Per-game rules shown on the game&apos;s main screen
            {draftCount > 0 && <span className="text-amber-300/80"> · {draftCount} draft{draftCount > 1 ? 's' : ''}</span>}
          </p>
        </div>
        <button
          onClick={() => setForm(EMPTY_RULE)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold bg-white/10 border border-white/15 hover:bg-white/15"
        >
          <Plus className="w-4 h-4" /> New
        </button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-8">
        {/* ─── GAME SELECTOR (admin-console PRD §5 — per-game content) ─── */}
        <div className="mb-4 bg-[var(--qk-card)] border border-white/10 rounded-2xl p-3 flex items-center gap-3">
          <label className="text-xs font-semibold text-white/60 shrink-0">Game</label>
          <select
            value={gameSlug}
            onChange={(e) => {
              setGameSlug(e.target.value)
              setForm(null)
            }}
            className="qk-input flex-1 min-w-0"
          >
            {(games.length > 0
              ? games
              : [
                  { slug: 'spin-the-bottle', name: 'Spin the Bottle', isPlayable: true },
                  { slug: 'ludo', name: 'Quicky Ludo', isPlayable: true },
                ]
            ).map((g) => (
              <option key={g.slug} value={g.slug}>
                {g.name}
                {g.isPlayable ? '' : ' (coming soon)'}
              </option>
            ))}
          </select>
          <span className="text-[10px] text-white/35 shrink-0 hidden sm:block">gameType: {gameType}</span>
        </div>

        {/* ─── RULE FORM (§48 + §5.1 draft/publish) ─── */}
        {form && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 bg-[var(--qk-card)] border border-white/10 rounded-2xl p-4 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-black text-sm">{form.id ? 'EDIT RULE' : 'CREATE RULE'}</h3>
              <button onClick={() => setForm(null)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Cancel">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-[80px_1fr] gap-3">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Icon
                <input
                  className="qk-input text-center text-lg"
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  placeholder="🎲"
                  maxLength={8}
                />
              </label>
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Title
                <input
                  className="qk-input"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Take Your Seat"
                  maxLength={60}
                />
              </label>
            </div>
            <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
              Description {form.status === 'DRAFT' && <span className="text-white/30 normal-case font-normal">(optional while drafting)</span>}
              <textarea
                className="qk-input min-h-[64px] resize-y"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Join a room and meet other players around the table."
                maxLength={200}
              />
            </label>
            <div className="grid grid-cols-2 gap-3 items-end">
              <label className="text-xs font-semibold text-white/60 flex flex-col gap-1">
                Display order
                <input
                  className="qk-input"
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                />
              </label>
              <label className="text-xs font-semibold text-white/70 flex items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                  className="w-4 h-4 accent-[var(--qk-accent)]"
                />
                Active
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, status: 'PUBLISHED' })}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-xs font-black border transition-colors',
                  form.status === 'PUBLISHED'
                    ? 'bg-emerald-500/15 border-emerald-400/40 text-emerald-300'
                    : 'bg-white/5 border-white/10 text-white/40 hover:text-white/70'
                )}
              >
                ● Publish now
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, status: 'DRAFT' })}
                className={cn(
                  'rounded-xl px-3 py-2.5 text-xs font-black border transition-colors',
                  form.status === 'DRAFT'
                    ? 'bg-amber-500/15 border-amber-400/40 text-amber-300'
                    : 'bg-white/5 border-white/10 text-white/40 hover:text-white/70'
                )}
              >
                ✎ Save as draft
              </button>
            </div>

            {/* ─── LIVE PREVIEW (admin-console PRD §5.1 — "preview how the
                   text will appear on the game's main screen"; mirrors the
                   GamePrimaryScreen How-It-Works card) ─── */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/35 mb-2">Preview · game main screen</p>
              <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-2.5">
                  <p className="font-semibold text-sm">How it works</p>
                  <div className="flex items-center gap-1.5" aria-hidden>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--qk-accent)]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                    <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                  </div>
                </div>
                <div className="h-[72px] flex items-start gap-3">
                  <span className="text-2xl leading-none mt-0.5" aria-hidden>
                    {form.icon.trim() || '🎲'}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold leading-snug">{form.title.trim() || 'Step title'}</p>
                    <p className="text-white/60 text-xs leading-relaxed line-clamp-2 mt-0.5">
                      {form.description.trim() || 'Step description — shown under the title on the game screen.'}
                    </p>
                  </div>
                </div>
              </div>
              {form.status === 'DRAFT' && (
                <p className="text-[10px] text-amber-300/70 mt-1.5">Drafts never reach the game screen until published.</p>
              )}
            </div>

            <button
              onClick={save}
              disabled={saving}
              className="bg-coral-gradient rounded-xl py-3 font-black text-sm active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {saving ? 'Saving…' : form.status === 'PUBLISHED' ? 'Save & Publish' : 'Save Draft'}
            </button>
          </motion.div>
        )}

        {/* ─── RULE LIST (admin order = display order, §49; up/down = §5.1) ─── */}
        {loading ? (
          <div className="flex justify-center py-10">
            <div className="w-8 h-8 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center text-white/40 text-sm py-10">
            No rules yet — the game screen shows its built-in fallback until you add one.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rules.map((rule, i) => (
              <div
                key={rule.id}
                className={cn(
                  'bg-[var(--qk-card)] border border-white/10 rounded-2xl p-3.5 flex items-center gap-3',
                  (!rule.isActive || rule.status === 'DRAFT') && 'opacity-60'
                )}
              >
                <div className="flex flex-col items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => void move(rule, 'up')}
                    disabled={movingId === rule.id || i === 0}
                    className="p-1 rounded-full hover:bg-white/10 disabled:opacity-25"
                    aria-label={`Move ${rule.title} up`}
                    title="Move up (persists the new order)"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <span className="text-[10px] font-black text-white/35" title="Display order">
                    {i + 1}
                  </span>
                  <button
                    onClick={() => void move(rule, 'down')}
                    disabled={movingId === rule.id || i === rules.length - 1}
                    className="p-1 rounded-full hover:bg-white/10 disabled:opacity-25"
                    aria-label={`Move ${rule.title} down`}
                    title="Move down (persists the new order)"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                </div>
                <span className="text-2xl shrink-0" aria-hidden>
                  {rule.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-sm truncate">{rule.title}</p>
                    {rule.status === 'DRAFT' && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/25 text-amber-300 shrink-0 font-black tracking-wide">
                        DRAFT
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/50 line-clamp-2 mt-0.5">{rule.description}</p>
                </div>
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setForm({ id: rule.id, title: rule.title, description: rule.description, icon: rule.icon, sortOrder: String(rule.sortOrder), isActive: rule.isActive, status: rule.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED' })}
                      className="p-2 rounded-full hover:bg-white/10"
                      aria-label={`Edit ${rule.title}`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    {confirmDeleteId === rule.id ? (
                      <button
                        onClick={() => remove(rule.id)}
                        className="px-2.5 py-1.5 rounded-full text-[11px] font-black bg-red-500/90 text-white"
                      >
                        Sure?
                      </button>
                    ) : (
                      <button
                        onClick={() => {
                          setConfirmDeleteId(rule.id)
                          setTimeout(() => setConfirmDeleteId((c) => (c === rule.id ? null : c)), 3000)
                        }}
                        className="p-2 rounded-full hover:bg-white/10 text-white/50"
                        aria-label={`Delete ${rule.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleStatus(rule)}
                      className={cn(
                        'text-[10px] font-black px-2 py-0.5 rounded-full border',
                        rule.status === 'PUBLISHED'
                          ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                          : 'bg-amber-500/15 border-amber-400/30 text-amber-300'
                      )}
                      title={rule.status === 'PUBLISHED' ? 'Move back to drafts (hidden from the game screen)' : 'Publish — live on the game screen'}
                    >
                      {rule.status === 'PUBLISHED' ? 'PUBLISHED' : 'PUBLISH'}
                    </button>
                    <button
                      onClick={() => toggleActive(rule)}
                      className={cn(
                        'text-[10px] font-black px-2 py-0.5 rounded-full border',
                        rule.isActive
                          ? 'bg-white/5 border-white/10 text-white/45'
                          : 'bg-white/5 border-white/10 text-white/40'
                      )}
                      title={rule.isActive ? 'Hide from the game screen' : 'Show on the game screen'}
                    >
                      {rule.isActive ? 'ACTIVE' : 'HIDDEN'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
