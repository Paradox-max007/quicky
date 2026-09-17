'use client'

// Quicky — LUDO LANDING (Ludo PRD §71/§72/§74/§75)
//
// The Quicky Ludo landing page, reached from its Game Card. It follows the
// EXISTING game-landing architecture (GameLanding.tsx — hero, records,
// progress, game information; Ludo PRD §71: "Do not create a new landing
// architecture") with one difference: a REAL [Play Now] CTA wired to the
// server-authoritative join API (§5/§6: the server assigns the room+seat).
//
// Stats use the generic records structure (§74): Ludo Games, Ludo Wins,
// Tokens Finished, Captures + the shared Quicky Points/coins. No Kiss
// Points anywhere (§74).

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowLeft, Dice5, Trophy, Target, Swords, Gamepad2, Plus, Users, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { CoinStoreSheet } from '../CoinStoreSheet'

type LudoStats = {
  coins: number
  gamesPlayed: number
  quickyPoints: number
  ludoGames: number
  ludoWins: number
  tokensFinished: number
  captures: number
}

export function LudoLanding({
  onClose,
  onJoined,
}: {
  onClose: () => void
  onJoined: (roomId: string) => void
}) {
  const [stats, setStats] = useState<LudoStats | null>(null)
  const [failed, setFailed] = useState(false)
  const [joining, setJoining] = useState(false)
  const [coinStoreOpen, setCoinStoreOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setFailed(false)
      try {
        const s = await api.ludo.landing()
        if (!cancelled) setStats(s)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const playNow = async () => {
    if (joining) return
    setJoining(true)
    try {
      // Server-authoritative matchmaking (Ludo PRD §6/§117): the client
      // never decides which room or seat it gets.
      const res = await api.ludo.join()
      if (res?.ok && res.roomId) {
        onJoined(res.roomId)
      } else {
        toast.error('Could not find a table')
        setJoining(false)
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't join the table")
      setJoining(false)
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* Ambient glow */}
      <div
        className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-72 rounded-full bg-[var(--qk-gold)]/12 blur-3xl"
        aria-hidden
      />

      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2 relative z-20">
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10" aria-label="Back to Games" data-testid="ludo-landing-back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold truncate">Quicky Ludo</h1>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 px-5 pb-10">
        <div className="w-full max-w-2xl mx-auto flex flex-col gap-5">
          {/* ── Hero ─────────────────────────────────────────────────────── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="relative rounded-3xl overflow-hidden border border-white/10"
          >
            <div className="relative aspect-[16/9] bg-gradient-to-br from-[var(--qk-gold)] via-[#C99640] to-[#8A6420] flex items-center justify-center">
              <div
                className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,0.25),transparent_55%)]"
                aria-hidden
              />
              <span className="text-7xl drop-shadow-xl" aria-hidden>🎲</span>
              <span className="absolute top-3 right-3 rounded-full bg-black/50 backdrop-blur px-3 py-1 text-[10px] font-black tracking-wider text-emerald-300">
                ● LIVE
              </span>
            </div>
            <div className="bg-[var(--qk-card)]/80 border-t border-white/8 px-5 py-4">
              <h2 className="text-2xl font-black tracking-tight">Quicky Ludo</h2>
              <p className="text-sm text-white/60 mt-1">
                Classic Ludo — play with up to 4 players.
              </p>
              <p className="text-[11px] font-semibold text-white/45 mt-2">👥 Group · 2–4</p>
            </div>
          </motion.div>

          {/* ── Coin chip ────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-[var(--qk-card)]/70 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-bold tabular-nums">
              🪙 {(stats?.coins ?? 0).toLocaleString('en-US')}
            </span>
            <button
              onClick={() => setCoinStoreOpen(true)}
              className="w-8 h-8 rounded-full bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center active:scale-95 transition-transform"
              aria-label="Buy coins"
              data-testid="ludo-landing-coin-add"
            >
              <Plus className="w-4 h-4 text-[var(--qk-accent-light)]" />
            </button>
          </div>

          {/* ── Play Now (§71) ───────────────────────────────────────────── */}
          <button
            onClick={() => void playNow()}
            disabled={joining || failed}
            className="w-full rounded-2xl bg-coral-gradient glow-coral py-4 font-black tracking-wide text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
            data-testid="ludo-play-now"
          >
            {joining ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Joining table…
              </>
            ) : (
              <>
                <Dice5 className="w-5 h-5" aria-hidden /> Play Now
              </>
            )}
          </button>
          {failed && (
            <p className="text-xs text-white/50 text-center -mt-3">
              Couldn&apos;t load your stats — you can still play.
            </p>
          )}

          {/* ── Your records (§74 — generic game statistics) ─────────────── */}
          <section>
            <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">Your records</p>
            <div className="grid grid-cols-2 gap-3">
              <RecordBox icon={<Gamepad2 className="w-4 h-4" />} value={stats?.ludoGames ?? 0} label="Ludo Games" tint="var(--qk-purple)" />
              <RecordBox icon={<Trophy className="w-4 h-4" />} value={stats?.ludoWins ?? 0} label="Ludo Wins" tint="var(--qk-gold)" />
              <RecordBox icon={<Target className="w-4 h-4" />} value={stats?.tokensFinished ?? 0} label="Tokens Finished" tint="#30D158" />
              <RecordBox icon={<Swords className="w-4 h-4" />} value={stats?.captures ?? 0} label="Captures" tint="#f472b6" />
            </div>
          </section>

          {/* ── Game information ─────────────────────────────────────────── */}
          <section>
            <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">Game information</p>
            <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5 text-sm text-white/70 leading-relaxed">
              The classic board game inside the Quicky game room. Up to 4 players per table,
              server-authoritative dice and moves, real-time tokens, chat, gifts and mentions.
              Roll a 6 to start a token, capture opponents on unsafe squares, and bring all
              four tokens home to win.
            </div>
          </section>

          {/* ── Quick rules (classic set, §12-§27) ───────────────────────── */}
          <section>
            <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">Quick rules</p>
            <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5 flex flex-col gap-3 text-sm text-white/70">
              <RuleRow icon="🎲" text="Roll a 6 to move a token out of your yard — a 6 always grants another roll." />
              <RuleRow icon="⚔️" text="Land on an opponent outside a safe ⭐ square to send them back to their yard." />
              <RuleRow icon="🏠" text="Lap the board, then climb your colored home path — the center needs the EXACT count." />
              <RuleRow icon="🏆" text="First player to bring all 4 tokens home wins the table." />
            </div>
          </section>

          {/* ── Room etiquette chip row ─────────────────────────────────── */}
          <div className="flex items-center justify-center gap-2 text-[11px] text-white/45 font-semibold">
            <Users className="w-3.5 h-3.5" aria-hidden /> 2–4 players · Server-authoritative · Live chat &amp; gifts
          </div>
        </div>
      </div>

      <CoinStoreSheet
        open={coinStoreOpen}
        onClose={() => setCoinStoreOpen(false)}
        coinBalance={stats?.coins ?? 0}
        onPurchased={(nb) => setStats((s) => (s ? { ...s, coins: nb } : s))}
      />
    </div>
  )
}

function RecordBox({
  icon,
  value,
  label,
  tint,
}: {
  icon: React.ReactNode
  value: number
  label: string
  tint: string
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[var(--qk-card)]/70 p-4 flex flex-col items-center text-center gap-1">
      <span style={{ color: tint }}>{icon}</span>
      <p className="text-xl font-black tabular-nums leading-none mt-1">{value.toLocaleString('en-US')}</p>
      <p className="text-[10px] text-white/50 uppercase tracking-wide">{label}</p>
    </div>
  )
}

function RuleRow({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-base leading-5" aria-hidden>{icon}</span>
      <p className="leading-relaxed">{text}</p>
    </div>
  )
}
