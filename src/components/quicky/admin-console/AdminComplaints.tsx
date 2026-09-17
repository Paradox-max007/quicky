'use client'

// Quicky ADMIN CONSOLE — Complaints queue (Games PRD §86/§87)
// view / filter by status / change status. Backend existed (admin/complaints);
// this is the missing console surface.

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/quicky/api-client'

const STATUSES = ['OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'] as const

export function AdminComplaints() {
  const [complaints, setComplaints] = useState<any[] | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [failed, setFailed] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.admin.complaints.list(statusFilter || undefined)
      setComplaints((res as any)?.complaints ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const setStatus = async (id: string, status: string) => {
    setBusyId(id)
    try {
      await api.admin.complaints.setStatus(id, status)
      await load()
    } catch {
      setFailed(true)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3" data-testid="admin-complaints">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatusFilter('')}
          className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${!statusFilter ? 'bg-[var(--qk-accent)] text-white' : 'bg-white/5 text-white/60'}`}
        >
          All
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1.5 text-[11px] font-bold ${statusFilter === s ? 'bg-[var(--qk-accent)] text-white' : 'bg-white/5 text-white/60'}`}
          >
            {s}
          </button>
        ))}
      </div>

      {failed && <p className="text-sm text-red-300/80">Could not load complaints.</p>}
      {complaints && complaints.length === 0 && (
        <p className="text-sm text-white/50 py-8 text-center">No complaints in this view.</p>
      )}

      <div className="flex flex-col gap-3">
        {(complaints ?? []).map((c) => (
          <section key={c.id} className="rounded-2xl border border-white/8 bg-[#101623] p-4">
            <div className="flex flex-wrap items-center gap-2 pb-2">
              <span className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-black tracking-wide text-white/70">
                {c.status ?? 'OPEN'}
              </span>
              <span className="text-[11px] text-white/40">{new Date(c.createdAt).toLocaleString()}</span>
              <span className="ml-auto text-[11px] text-white/50">
                reason: <span className="font-bold text-white/75">{c.reason ?? '—'}</span>
              </span>
            </div>
            {c.description && <p className="text-xs leading-relaxed text-white/70 pb-2">{c.description}</p>}
            <div className="flex flex-wrap items-center gap-1.5 pb-3 text-[10px] text-white/45">
              {c.senderUserId && (
                <span className="rounded-full bg-white/5 px-2 py-0.5">
                  reporter: {c.senderName ?? c.senderUserId.slice(0, 8)}
                </span>
              )}
              {c.reportedUserId && (
                <span className="rounded-full bg-white/5 px-2 py-0.5">
                  reported: {c.reportedName ?? c.reportedUserId.slice(0, 8)}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.filter((s) => s !== c.status).map((s) => (
                <button
                  key={s}
                  disabled={busyId === c.id}
                  onClick={() => void setStatus(c.id, s)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] font-bold text-white/70 hover:bg-white/10 disabled:opacity-40"
                >
                  Mark {s}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
