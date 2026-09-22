'use client'

// Quicky ADMIN CONSOLE — Dashboard overview (Games PRD §55/§56)
// KPI cards + quick jumps. Live numbers come from the live-rooms monitor;
// user/content totals from the users + audit endpoints (all server-verified).

import { useEffect, useState } from 'react'
import { Users, Radio, Flag, Gamepad2, Crown, Sparkles } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'

type Kpis = {
  rooms: number
  players: number
  malePlayers: number
  femalePlayers: number
  complaintsOpen: number
  gamesTotal: number
  gamesPlayable: number
  usersTotal: number
  adminsTotal: number
}

type ConsoleStats = {
  seasons: number
  activeSeason: { seasonNumber: number; name: string } | null
  activeRewards: number
  activeStickerSets: number
  activeGifts: number
  pendingGrants: number
  claimedGrants: number
}

export function AdminOverview({ onNavigate }: { onNavigate: (section: string) => void }) {
  const [kpis, setKpis] = useState<Kpis | null>(null)
  const [stats, setStats] = useState<ConsoleStats | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [rooms, users, complaints, games, consoleRes] = await Promise.all([
          api.admin.liveRooms.list(),
          api.admin.users.list(),
          api.admin.complaints.list(),
          api.admin.games.list(),
          api.admin.consoleSettings.get().catch(() => null),
        ])
        if (cancelled) return
        const openComplaints = (complaints as any)?.complaints ?? []
        const gamesArr = (games as any)?.games ?? []
        const usersArr = (users as any)?.users ?? []
        setKpis({
          rooms: rooms?.totals?.rooms ?? 0,
          players: rooms?.totals?.players ?? 0,
          malePlayers: (rooms?.rooms ?? []).reduce((s, r) => s + r.maleCount, 0),
          femalePlayers: (rooms?.rooms ?? []).reduce((s, r) => s + r.femaleCount, 0),
          complaintsOpen: openComplaints.filter((c: any) => c.status === 'OPEN').length,
          gamesTotal: gamesArr.length,
          gamesPlayable: gamesArr.filter((g: any) => g.isPlayable).length,
          usersTotal: usersArr.length,
          adminsTotal: usersArr.filter((u: any) => u.isAdmin).length,
        })
        if (consoleRes) setStats((consoleRes?.stats ?? null) as ConsoleStats | null)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }
    void load()
    const t = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])

  const cards = [
    {
      label: 'Live tables',
      value: kpis ? `${kpis.rooms}` : '—',
      sub: kpis ? `${kpis.players} players seated` : '',
      icon: Radio,
      onClick: () => onNavigate('live'),
      testId: 'kpi-rooms',
    },
    {
      label: 'Players in game',
      value: kpis ? `${kpis.players}` : '—',
      sub: kpis ? `${kpis.malePlayers} · ${kpis.femalePlayers} across gender seats` : '',
      icon: Users,
      onClick: () => onNavigate('live'),
      testId: 'kpi-players',
    },
    {
      label: 'Open complaints',
      value: kpis ? `${kpis.complaintsOpen}` : '—',
      sub: 'Awaiting triage',
      icon: Flag,
      onClick: () => onNavigate('complaints'),
      testId: 'kpi-complaints',
    },
    {
      label: 'Games catalog',
      value: kpis ? `${kpis.gamesPlayable}/${kpis.gamesTotal}` : '—',
      sub: 'Playable / total',
      icon: Gamepad2,
      onClick: () => onNavigate('games'),
      testId: 'kpi-games',
    },
    {
      label: 'Active season',
      value: stats?.activeSeason ? `S${stats.activeSeason.seasonNumber}` : '—',
      sub: stats?.activeSeason?.name ?? `${stats?.seasons ?? 0} season(s) configured`,
      icon: Crown,
      onClick: () => onNavigate('seasons'),
      testId: 'kpi-season',
    },
    {
      label: 'Reward catalog',
      value: stats ? `${stats.activeRewards}` : '—',
      sub: stats ? `${stats.activeStickerSets} sticker sets · ${stats.activeGifts} gifts` : '',
      icon: Sparkles,
      onClick: () => onNavigate('rewards'),
      testId: 'kpi-rewards',
    },
    {
      label: 'Rewards awaiting collection',
      value: stats ? `${stats.pendingGrants}` : '—',
      sub: stats ? `${stats.claimedGrants} claimed all-time` : '',
      icon: Sparkles,
      onClick: () => onNavigate('realms'),
      testId: 'kpi-grants',
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map(({ label, value, sub, icon: Icon, onClick, testId }) => (
          <button
            key={label}
            onClick={onClick}
            className="text-left rounded-2xl border border-white/8 bg-[#101623] p-4 hover:border-white/20 transition-colors"
            data-testid={testId}
          >
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-[0.15em] text-white/40">{label}</p>
              <Icon className="w-4 h-4 text-white/30" aria-hidden />
            </div>
            <p className="mt-2 text-3xl font-black tracking-tight">{failed ? '—' : value}</p>
            <p className="text-[11px] text-white/45 mt-0.5">{sub}</p>
          </button>
        ))}
      </div>

      <section className="rounded-2xl border border-white/8 bg-[#101623] p-4 md:p-5">
        <h3 className="text-sm font-black tracking-tight pb-2 mb-3 border-b border-white/8">Console shortcuts</h3>
        <div className="flex flex-wrap gap-2">
          {[
            ['games', 'Configure games'],
            ['rules', 'How-It-Works slides'],
            ['gifts', 'Gift catalog'],
            ['rewards', 'Reward catalog'],
            ['realms', 'Realm rules'],
            ['seasons', 'Seasons'],
            ['stickers', 'Sticker sets'],
            ['users', 'User management'],
            ['settings', 'Console settings'],
            ['audit', 'Audit trail'],
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              className="rounded-full bg-white/5 border border-white/10 px-3.5 py-1.5 text-xs font-bold text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-white/40">
          Configuration changes made here (game copy, gift prices, sticker sets, unlock rules) go live
          for users immediately through the database — no deployment required (PRD §100).
        </p>
      </section>
    </div>
  )
}
