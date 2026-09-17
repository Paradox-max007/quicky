'use client'

// Quicky ADMIN CONSOLE — User management (Games PRD §66)
// Searchable user list + admin role toggle. Role checks are SERVER-side
// (requireAdmin on every request); the console only calls the API.

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/quicky/api-client'

export function AdminUsers() {
  const [users, setUsers] = useState<any[] | null>(null)
  const [q, setQ] = useState('')
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

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
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-white/6 hover:bg-white/3">
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
