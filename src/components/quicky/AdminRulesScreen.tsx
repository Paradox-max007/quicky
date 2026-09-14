'use client'

// Quicky — Admin: "How It Works" rule management (lifecycle PRD §44/§48/§49)
// Full CRUD against /api/quicky/admin/game-rules:
//   • add a rule, edit title / description / icon, change display order
//     (sort_order drives the Play Now rotation order — §49),
//   • activate / deactivate (deactivated rules vanish from the game screen
//     without any frontend deploy — §44),
//   • delete (rules carry no transaction history, so a hard delete is safe).
// The screen itself is server-gated too: every admin API re-checks
// User.isAdmin on each request (§35/§36) — this UI is convenience, not the
// security boundary.

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, Pencil, Trash2, X } from 'lucide-react'
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
}

type RuleForm = {
  id?: string
  title: string
  description: string
  icon: string
  sortOrder: string
  isActive: boolean
}

const EMPTY_RULE: RuleForm = { title: '', description: '', icon: '🎲', sortOrder: '99', isActive: true }

export function AdminRulesScreen() {
  const setView = useQuickyStore((s) => s.setView)
  const [rules, setRules] = useState<AdminRule[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<RuleForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.admin.gameRules.list()
      setRules(res.rules ?? [])
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load rules')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!form || saving) return
    if (!form.title.trim()) return toast.error('Title is required')
    if (!form.description.trim()) return toast.error('Description is required')
    setSaving(true)
    const data = {
      title: form.title.trim(),
      description: form.description.trim(),
      icon: form.icon.trim() || '🎲',
      sortOrder: Math.floor(Number(form.sortOrder)) || 0,
      isActive: form.isActive,
    }
    try {
      if (form.id) await api.admin.gameRules.update(form.id, data)
      else await api.admin.gameRules.create(data)
      toast.success(form.id ? 'Rule updated' : 'Rule created')
      setForm(null)
      await load()
    } catch (e: any) {
      toast.error(e.message ?? 'Save failed')
    } finally {
      setSaving(false)
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

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white">
      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2">
        <button onClick={() => setView('settings')} className="p-2 rounded-full hover:bg-white/10" aria-label="Back to Settings">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-bold leading-none">Admin · How It Works</h1>
          <p className="text-[11px] text-white/40 mt-1">Spin the Bottle rules shown on the Play Now screen</p>
        </div>
        <button
          onClick={() => setForm(EMPTY_RULE)}
          className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-bold bg-white/10 border border-white/15 hover:bg-white/15"
        >
          <Plus className="w-4 h-4" /> New
        </button>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pb-8">
        {/* ─── RULE FORM (§48) ─── */}
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
              Description
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
            <button
              onClick={save}
              disabled={saving}
              className="bg-coral-gradient rounded-xl py-3 font-black text-sm active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Rule'}
            </button>
          </motion.div>
        )}

        {/* ─── RULE LIST (admin order = display order, §49) ─── */}
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
            {rules.map((rule) => (
              <div
                key={rule.id}
                className={cn(
                  'bg-[var(--qk-card)] border border-white/10 rounded-2xl p-3.5 flex items-center gap-3',
                  !rule.isActive && 'opacity-50'
                )}
              >
                <span className="text-2xl shrink-0" aria-hidden>
                  {rule.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-sm truncate">{rule.title}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 shrink-0">
                      #{rule.sortOrder}
                    </span>
                  </div>
                  <p className="text-xs text-white/50 line-clamp-2 mt-0.5">{rule.description}</p>
                </div>
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setForm({ id: rule.id, title: rule.title, description: rule.description, icon: rule.icon, sortOrder: String(rule.sortOrder), isActive: rule.isActive })}
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
                  <button
                    onClick={() => toggleActive(rule)}
                    className={cn(
                      'text-[10px] font-black px-2 py-0.5 rounded-full border',
                      rule.isActive
                        ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                        : 'bg-white/5 border-white/10 text-white/40'
                    )}
                  >
                    {rule.isActive ? 'ACTIVE' : 'HIDDEN'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
