'use client'

// Quicky — DESKTOP PROFILE PAGE (Web Premium PRD §32-§36/§72)
// A dedicated desktop profile: hero with large identity, then separate
// visual areas for About, Quicky progression, Dating stats and Game stats —
// never one giant stretched mobile card. Profile completion reuses the REAL
// field checks (§36/§59).

import { Crown, BadgeCheck, PencilLine, MapPin, Sparkles, Trophy } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useDashboard } from './useDashboard'
import { getScoreTier } from '@/lib/quicky/constants'
import { DatingProfileCard } from './DatingProfileCard'
import { SectionHeader, SkeletonBlock } from './web-ui'

export function ProfileDesktop() {
  const user = useQuickyStore((s) => s.user)
  const setView = useQuickyStore((s) => s.setView)
  const { data, loaded } = useDashboard(true)
  const stats = data?.stats ?? null
  const tier = stats ? getScoreTier(stats.points) : null
  const avatar = user?.photos?.find((ph) => ph.isPrimary)?.url ?? user?.photos?.[0]?.url ?? null

  return (
    <div className="flex flex-col gap-8">
      {/* ── Profile hero (§34) ───────────────────────────────────────────── */}
      <section className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-7 flex items-center gap-7" data-testid="profile-hero">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="w-28 h-28 min-[1600px]:w-32 min-[1600px]:h-32 rounded-3xl object-cover border border-white/10"
          />
        ) : (
          <span className="w-28 h-28 rounded-3xl bg-white/10 flex items-center justify-center text-3xl font-bold" aria-hidden>
            {(user?.name ?? 'Q').slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-3xl font-bold tracking-tight truncate">
              {user?.name ?? 'You'}
              {user?.age != null && <span className="text-white/45 font-semibold">, {user.age}</span>}
            </h1>
            {user?.isVerified && (
              <BadgeCheck className="w-6 h-6 text-[var(--qk-accent)]" fill="currentColor" stroke="black" />
            )}
            {user?.isPremium && <Crown className="w-5 h-5 text-[var(--qk-gold)]" fill="currentColor" />}
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap text-xs">
            {tier && (
              <span
                className="font-bold rounded-full px-2.5 py-1"
                style={{ color: tier.current.color, backgroundColor: tier.current.color + '1f' }}
              >
                {tier.current.name}
              </span>
            )}
            {user?.city && (
              <span className="flex items-center gap-1 text-white/55">
                <MapPin className="w-3 h-3" /> {user.city}
              </span>
            )}
            {user?.lookingFor && (
              <span className="text-white/55">Looking for {user.lookingFor.replace(/-/g, ' ')}</span>
            )}
          </div>
        </div>
        <button
          onClick={() => setView('edit-profile')}
          className="shrink-0 flex items-center gap-2 rounded-full bg-coral-gradient px-5 py-2.5 text-sm font-bold active:scale-95 transition-transform"
          data-testid="profile-edit"
        >
          <PencilLine className="w-4 h-4" /> Edit Profile
        </button>
      </section>

      {/* ── About | Quicky profile (§33/§35) ─────────────────────────────── */}
      <section className="grid grid-cols-[1.25fr_1fr] gap-6 items-start">
        <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-6">
          <SectionHeader title="About" />
          {user?.bio ? (
            <p className="text-sm text-white/80 leading-relaxed whitespace-pre-line">{user.bio}</p>
          ) : (
            <p className="text-sm text-white/40">No bio yet — tell people what makes you you.</p>
          )}
          {(user?.interests ?? []).length > 0 && (
            <div className="mt-5">
              <SectionHeader title="Interests" className="mb-2.5" />
              <div className="flex flex-wrap gap-1.5">
                {(user?.interests ?? []).map((t) => (
                  <span key={t} className="text-[11px] font-medium bg-white/8 text-white/75 rounded-full px-2.5 py-1 capitalize">
                    {t.replace(/-/g, ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-6" data-testid="profile-quicky">
          <SectionHeader title="Quicky profile" />
          {!stats ? (
            <div className="flex flex-col gap-3">
              <SkeletonBlock className="h-5 w-3/5" />
              <SkeletonBlock className="h-5 w-2/5" />
              <SkeletonBlock className="h-5 w-1/2" />
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>✨</span>
                <span className="text-sm text-white/60 flex-1">Quicky Points</span>
                <span className="text-sm font-bold tabular-nums">{stats.points.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>🔥</span>
                <span className="text-sm text-white/60 flex-1">Streak</span>
                <span className="text-sm font-bold tabular-nums">
                  {stats.streak ? `${stats.streak.current} days` : '—'}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Trophy className="w-[18px] h-[18px] text-[var(--qk-gold)]" />
                <span className="text-sm text-white/60 flex-1">League</span>
                <span className="text-sm font-bold">{stats.league?.name ?? '—'}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>🎮</span>
                <span className="text-sm text-white/60 flex-1">Games played</span>
                <span className="text-sm font-bold tabular-nums">{stats.gamesPlayed.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>💋</span>
                <span className="text-sm text-white/60 flex-1">Kiss Points</span>
                <span className="text-sm font-bold tabular-nums">{stats.kisses.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── Dating stats | Game stats | Completion (§33/§36) ─────────────── */}
      <section className="grid grid-cols-[1fr_1fr_1.15fr] gap-6 items-start">
        <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-6">
          <SectionHeader title="Dating stats" />
          {!stats ? (
            <SkeletonBlock className="h-5 w-4/5" />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>❤️</span>
                <span className="text-sm text-white/60 flex-1">Likes received</span>
                <span className="text-sm font-bold tabular-nums">{stats.likesReceived.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>💌</span>
                <span className="text-sm text-white/60 flex-1">Likes sent</span>
                <span className="text-sm font-bold tabular-nums">{stats.likesSent.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-3">
                <Sparkles className="w-[18px] h-[18px] text-[var(--qk-purple)]" />
                <span className="text-sm text-white/60 flex-1">Matches</span>
                <span className="text-sm font-bold tabular-nums">{stats.matches.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-6">
          <SectionHeader title="Game stats" />
          {!stats ? (
            <SkeletonBlock className="h-5 w-4/5" />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>💋</span>
                <span className="text-sm text-white/60 flex-1">Kiss Points</span>
                <span className="text-sm font-bold tabular-nums">{stats.kisses.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>🎁</span>
                <span className="text-sm text-white/60 flex-1">Gifts sent</span>
                <span className="text-sm font-bold tabular-nums">{stats.giftsSent.toLocaleString()}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-lg" aria-hidden>📦</span>
                <span className="text-sm text-white/60 flex-1">Gifts received</span>
                <span className="text-sm font-bold tabular-nums">{stats.giftsReceived.toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* Real completeness with actionable hints (§36) */}
        <DatingProfileCard />
      </section>
    </div>
  )
}
