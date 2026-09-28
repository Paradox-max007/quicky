'use client'

// Quicky ADMIN CONSOLE — User management (Games PRD §66 + admin-console PRD
// §12). Searchable user list + admin role toggle + per-user reset actions:
//   · Reset progress  — realm ladder / season progression back to square one
//   · Reset inventory — owned items, sticker bundles, cosmetics, grants
// (The same operations the designated test account exposes in Settings,
// available for ANY user here.) Role checks are SERVER-side (requireAdmin on
// every request); the console only calls the API.

import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, PackageX, X } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type ResetKind = 'reset-progress' | 'reset-inventory'

export function AdminUsers() {
  const [users, setUsers] = useState<any[] | null>(null)
  const [q, setQ] = useState('')
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  // The user whose reset-confirmation row is expanded (admin-console PRD §12).
  const [resetFor, setResetFor] = useState<string | null>(null)

  const load = useCallback(async (query: string) => {
    try {
      const res = await api.admin.users.list(query ? { q: query } : undefined)
      setUsers((res as any)?.users ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => {
    void load('')
  }, [load])

  const search = () => void load(q)

  const toggleAdmin = async (u: any) => {
    setBusyId(u.id)
    try {
      await api.admin.users.setAdmin(u.id, !u.isAdmin)
      await load(q)
    } catch {
      setFailed(true)
    } finally {
      setBusyId(null)
    }
  }

  const resetUser = async (u: any, kind: ResetKind) => {
    setBusyId(u.id)
    try {
      await api.admin.users.reset(u.id, kind)
      toast.success(
        kind === 'reset-progress'
          ? `${u.name ?? 'User'} — progression reset (realm 1 · season 1 on next play)`
          : `${u.name ?? 'User'} — inventory cleared (items, stickers, cosmetics, grants)`
      )
      setResetFor(null)
      await load(q)
    } catch (e: any) {
      toast.error(e?.message ?? 'Reset failed')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="admin-users">
      <div className="flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search by name, email or phone…"
          className="flex-1 rounded-xl border border-white/10 bg-[#101623] px-3.5 py-2.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50"
        />
        <button
          onClick={search}
          className="rounded-xl bg-[var(--qk-accent)] px-4 py-2.5 text-xs font-bold text-white"
        >
          Search
        </button>
      </div>

      {failed && <p className="text-sm text-red-300/80">Could not load users.</p>}
      {users && users.length === 0 && <p className="text-sm text-white/50 py-8 text-center">No users match.</p>}

      {users && users.length > 0 && (
        <section className="rounded-2xl border border-white/8 bg-[#101623] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-white/50">
                <tr>
                  <th className="px-4 py-2.5 font-black uppercase tracking-wider">User</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Gender</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Coins</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Game Points</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Games</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Premium</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Role</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Reset</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={cn('border-t border-white/6 hover:bg-white/3', resetFor === u.id && 'bg-white/[0.04]')}>
                    <td className="px-4 py-2.5">
                      <p className="font-bold text-white/85">{u.name ?? 'Unnamed'}</p>
                      <p className="text-[10px] text-white/35">{u.email ?? u.phone ?? u.id.slice(0, 10)}</p>
                    </td>
                    <td className="px-3 py-2.5 text-white/60">{u.gender ?? '—'}</td>
                    <td className="px-3 py-2.5 font-bold text-[var(--qk-gold)]">{(u.coinBalance ?? 0).toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-white/70">{u.kissPoints ?? 0}</td>
                    <td className="px-3 py-2.5 text-white/70">{u.gamesPlayed ?? 0}</td>
                    <td className="px-3 py-2.5">
                      {u.isPremium ? (
                        <span className="rounded-full bg-[var(--qk-gold)]/15 px-2 py-0.5 text-[10px] font-black text-[var(--qk-gold)]">
                          PREMIUM
                        </span>
                      ) : (
                        <span className="text-white/30">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <button
                        disabled={busyId === u.id}
                        onClick={() => void toggleAdmin(u)}
                        className={`rounded-full px-2.5 py-1 text-[10px] font-black tracking-wide disabled:opacity-40 ${
                          u.isAdmin
                            ? 'bg-[var(--qk-accent)]/20 text-[var(--qk-accent)]'
                            : 'bg-white/5 text-white/50'
                        }`}
                      >
                        {u.isAdmin ? 'ADMIN' : 'USER'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5">
                      {resetFor === u.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            disabled={busyId === u.id}
                            onClick={() => void resetUser(u, 'reset-progress')}
                            className="flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-400/30 px-2 py-1 text-[10px] font-black text-amber-300 disabled:opacity-40"
                            title="Realm/season progression back to Realm 1 · Season 1"
                          >
                            <RotateCcw className="w-3 h-3" aria-hidden /> Progress
                          </button>
                          <button
                            disabled={busyId === u.id}
                            onClick={() => void resetUser(u, 'reset-inventory')}
                            className="flex items-center gap-1 rounded-full bg-rose-500/15 border border-rose-400/30 px-2 py-1 text-[10px] font-black text-rose-300 disabled:opacity-40"
                            title="Clear items, sticker bundles, cosmetics and reward grants"
                          >
                            <PackageX className="w-3 h-3" aria-hidden /> Inventory
                          </button>
                          <button
                            onClick={() => setResetFor(null)}
                            className="p-1 rounded-full text-white/40 hover:text-white/70"
                            aria-label="Cancel reset"
                          >
                            <X className="w-3 h-3" aria-hidden />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setResetFor(u.id)}
                          disabled={busyId === u.id}
                          className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] font-black tracking-wide text-white/50 hover:text-white/80 disabled:opacity-40"
                          title="Reset this user's progression or inventory"
                        >
                          RESET…
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="text-[10px] text-white/30">
        Resets are permanent and server-side only (admin-console PRD §12) — progression restarts at Realm 1 · Season 1 on the
        user&apos;s next play; inventory clears owned items, sticker bundles, cosmetics and reward grants. Your own admin
        account is protected from accidental self-resets.
      </p>
    </div>
  )
}
