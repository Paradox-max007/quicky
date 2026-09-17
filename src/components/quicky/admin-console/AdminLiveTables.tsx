'use client'

// Quicky ADMIN CONSOLE — Live Tables monitor (Games PRD §64/§65)
// Read-only inspection: Room ID, players, male/female seat counts, round
// state, status, created + last activity. Polls every 15s. Room detail rows
// expand to the player/seats list (§65) — no state manipulation here.

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'

type LiveRoom = {
  id: string
  status: string
  maxPlayers: number
  playerCount: number
  maleCount: number
  femaleCount: number
  canSpin: boolean
  currentSpin: { status: string; result: string | null } | null
  createdAt: string
  lastActivityAt: string
  players: { userId: string; name: string | null; gender: string | null; seatIndex: number; connection: string; isActive: boolean }[]
}

export function AdminLiveTables() {
  const [rooms, setRooms] = useState<LiveRoom[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await api.admin.liveRooms.list()
      setRooms(res?.rooms ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])

  const roundLabel = (r: LiveRoom) => r.currentSpin?.status ?? 'idle'

  return (
    <div className="flex flex-col gap-3" data-testid="admin-live-tables">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/45">
          {rooms ? `${rooms.length} active table${rooms.length === 1 ? '' : 's'}` : 'Loading…'} · auto-refresh 15s
        </p>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden /> Refresh
        </button>
      </div>

      {failed && <p className="text-sm text-red-300/80">Could not load live tables.</p>}
      {loading && !rooms && <p className="text-sm text-white/50">Loading live tables…</p>}
      {rooms && rooms.length === 0 && (
        <p className="text-sm text-white/50 py-8 text-center">No active tables right now.</p>
      )}

      {rooms && rooms.length > 0 && (
        <section className="rounded-2xl border border-white/8 bg-[#101623] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-white/50">
                <tr>
                  <th className="px-4 py-2.5 font-black uppercase tracking-wider">Room</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Players</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Seats M/F</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Round</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2.5 font-black uppercase tracking-wider">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <>
                    <tr
                      key={r.id}
                      className="border-t border-white/6 hover:bg-white/3 cursor-pointer"
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      data-testid={`live-room-${r.id}`}
                    >
                      <td className="px-4 py-2.5 font-mono font-bold text-white/85">
                        #SPIN-{r.id.slice(-5).toUpperCase()}
                      </td>
                      <td className="px-3 py-2.5 font-bold">
                        {r.playerCount} / {r.maxPlayers}
                      </td>
                      <td className="px-3 py-2.5 text-white/70">
                        {r.maleCount}M / {r.femaleCount}F
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cnRound(
                            r.currentSpin?.result === 'cancelled'
                              ? 'bad'
                              : r.currentSpin
                                ? 'live'
                                : r.canSpin
                                  ? 'ok'
                                  : 'idle'
                          )}
                        >
                          {r.currentSpin?.result === 'cancelled' ? 'cancelled' : roundLabel(r)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-white/70">{r.status}</td>
                      <td className="px-3 py-2.5 text-white/50">{new Date(r.lastActivityAt).toLocaleTimeString()}</td>
                    </tr>
                    {expanded === r.id && (
                      <tr key={`${r.id}-detail`} className="border-t border-white/6 bg-black/20">
                        <td colSpan={6} className="px-4 py-3">
                          <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40 pb-2">
                            Seats & players (§65 room detail)
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {r.players.filter((p) => p.isActive).map((p) => (
                              <span
                                key={p.userId}
                                className="rounded-full bg-white/5 border border-white/10 px-2.5 py-1 text-[10px] font-semibold text-white/75"
                              >
                                seat {p.seatIndex} · {p.name ?? 'Someone'} · {p.connection}
                              </span>
                            ))}
                            {r.players.filter((p) => p.isActive).length === 0 && (
                              <span className="text-[11px] text-white/40">No active players.</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}

function cnRound(kind: 'live' | 'ok' | 'idle' | 'bad') {
  const base = 'rounded-full px-2 py-0.5 text-[10px] font-black tracking-wide'
  if (kind === 'live') return `${base} bg-amber-400/15 text-amber-300`
  if (kind === 'ok') return `${base} bg-[#30D158]/15 text-[#30D158]`
  if (kind === 'bad') return `${base} bg-red-400/15 text-red-300`
  return `${base} bg-white/8 text-white/50`
}
