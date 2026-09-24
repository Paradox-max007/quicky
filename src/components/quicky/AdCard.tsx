'use client'

// Quicky — COMMUNITY FEED AD SLOT (Instagram-style)
//
// A "Sponsored" card rendered INSIDE the feed between posts (every 3rd post,
// both mobile feed and desktop compact feed). It mimics a post card so the
// rhythm stays Instagram-like, carries the standard "Sponsored · Ad" labels,
// and currently rotates HOUSE CREATIVES (Premium / Games / Coin Store).
//
// The `creative` prop is a placeholder seam: wire `loadAd()` to a real ad
// network (AdMob/GAM/Meta Audience Network) later and pass the fetched
// creative — the layout contract (media area + header + CTA) already matches.

import { Crown, Gamepad2, Coins, Megaphone } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'

export type AdCreative = {
  id: string
  advertiser: string
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  gradient: string
  onClick: () => void
}

/** Insert an ad card after every AD_EVERY posts. */
export const AD_EVERY = 3

export function AdCard({ index }: { index: number }) {
  const setView = useQuickyStore((s) => s.setView)
  const setGamesReturnView = useQuickyStore((s) => s.setGamesReturnView)

  const creatives: AdCreative[] = [
    {
      id: 'premium',
      advertiser: 'Quicky Premium',
      icon: <Crown className="w-10 h-10 text-[var(--qk-gold)]" />,
      title: 'Unlock Quicky Premium',
      body: 'Exclusive themes, unlimited likes, bonus coins on every pack and much more.',
      cta: 'Go Premium',
      gradient: 'from-[var(--qk-gold)]/25 via-[var(--qk-purple)]/20 to-transparent',
      onClick: () => setView('premium'),
    },
    {
      id: 'games',
      advertiser: 'Quicky Games',
      icon: <Gamepad2 className="w-10 h-10 text-[var(--qk-accent)]" />,
      title: 'Play. Compete. Rank up.',
      body: 'Spin the Bottle, Ludo and more — earn Realm Points and climb your cohort.',
      cta: 'Play now',
      gradient: 'from-[var(--qk-accent)]/25 via-[var(--qk-purple)]/20 to-transparent',
      onClick: () => {
        setGamesReturnView('community')
        setView('games')
      },
    },
    {
      id: 'coins',
      advertiser: 'Quicky Coin Store',
      icon: <Coins className="w-10 h-10 text-amber-300" />,
      title: 'Short on coins?',
      body: 'Kisses, gifts and table perks run on coins — top up from the coin store.',
      cta: 'Get coins',
      gradient: 'from-amber-400/20 via-[var(--qk-gold)]/15 to-transparent',
      onClick: () => setView('profile-me'),
    },
  ]

  const creative = creatives[index % creatives.length]

  return (
    <article
      className="relative rounded-3xl border border-white/8 bg-[var(--qk-card)]/50 overflow-hidden"
      data-testid={`feed-ad-${creative.id}`}
      role="complementary"
      aria-label="Sponsored content"
    >
      {/* Header — Instagram-style: advertiser + Sponsored + Ad badge */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center shrink-0">
          <Megaphone className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{creative.advertiser}</p>
          <p className="text-[11px] text-white/40">Sponsored</p>
        </div>
        <span
          className="text-[9px] font-black uppercase tracking-wider rounded-md border border-white/15 bg-white/5 px-1.5 py-0.5 text-white/70"
          aria-label="Advertisement"
        >
          Ad
        </span>
      </div>

      {/* Media area — house creative (replace with network creative later) */}
      <button onClick={creative.onClick} className="block w-full text-left group" aria-label={creative.title}>
        <div className={`relative bg-gradient-to-br ${creative.gradient} px-6 py-9 flex flex-col items-center text-center gap-3`}>
          <div className="w-16 h-16 rounded-3xl bg-black/25 border border-white/10 flex items-center justify-center transition-transform duration-200 group-hover:scale-105">
            {creative.icon}
          </div>
          <h3 className="text-lg font-bold">{creative.title}</h3>
          <p className="text-[13px] text-white/60 max-w-[40ch] leading-relaxed">{creative.body}</p>
        </div>
      </button>

      {/* CTA bar */}
      <div className="px-4 py-3">
        <button
          onClick={creative.onClick}
          className="w-full rounded-full bg-coral-gradient text-sm font-bold py-2.5 active:scale-[0.98] transition-transform"
        >
          {creative.cta}
        </button>
      </div>
    </article>
  )
}
