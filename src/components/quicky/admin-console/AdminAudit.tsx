'use client'

// Quicky ADMIN CONSOLE — Audit trail (Games PRD §67)
// Who changed what, when: GAME_UPDATED, GIFT_PRICE_CHANGED,
// STICKER_SET_PUBLISHED, ADMIN_GRANTED, … — straight from AdminAuditLog.

import { useEffect, useState } from 'react'
import { api } from '@/lib/quicky/api-client'

export function AdminAudit() {
  const [entries, setEntries] = useState<any[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Initial load runs after the fetch resolves — never setState synchronously
  // inside the effect body (react-hooks v6 set-state-in-effect).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await api.admin.audit.list({ take: 200 })
        if (cancelled) return
        setEntries((res as any)?.entries ?? [])
        setFailed(false)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-3" data-testid="admin-audit">
      <p className="text-xs text-white/45">Latest {200} sensitive actions, newest first (§67).</p>
      {failed && <p className="text-sm text-red-300/80">Could not load the audit log.</p>}
      {entries && entries.length === 0 && (
        <p className="text-sm text-white/50 py-8 text-center">No audit entries yet.</p>
      )}

      {entries && entries.length > 0 && (
        <section className="rounded-2xl border border-white/8 bg-[#101623] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-white/50">
                <tr>
                  <th className="px-4 py-2.5 font-black uppercase tracking-wider">When</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Admin</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Action</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Entity</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Meta</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-t border-white/6 align-top">
                    <td className="whitespace-nowrap px-4 py-2.5 text-white/50">
                      {new Date(e.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-white/80">{e.adminName ?? e.adminId.slice(0, 8)}</td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-black tracking-wide text-white/75">
                        {e.action}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-white/60">
                      {e.entityType}
                      <span className="block text-[10px] text-white/35 font-mono">{e.entityId.slice(0, 14)}…</span>
                    </td>
                    <td className="px-3 py-2.5 max-w-[22rem] truncate text-white/45" title={e.meta ?? ''}>
                      {e.meta ?? '—'}
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
