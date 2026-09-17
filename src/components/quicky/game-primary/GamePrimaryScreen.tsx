'use client'

// Quicky — GAME PRIMARY SCREEN (Unified Game Primary Screen PRD §1/§3/§8-§11)
//
// ONE reusable primary screen for EVERY Quicky game (§3):
//
//   Games → Game Card → GamePrimaryScreen(config) → (Play Now) → Game Room
//
// Spin the Bottle, Quicky Ludo and every future game render THIS component —
// only the GamePrimaryConfig data changes (§4/§42: no hardcoded game-specific
// UI logic here).
//
// ── The major UI change (§8/§9/§10/§11) ──────────────────────────────────────
// · The bottom Game Chats section is REMOVED — no permanent chat list
//   consumes vertical space.
// · Two compact icons visually belong to the profile/stat card:
//     💬 Chat  — top-left   (§9, with the existing unread badge, §47)
//     👥 Friends — top-right  (§10)
// · WEB: the icons open the GameInteractionPanel IN this screen (§19-§30) —
//   no page navigation, the Game Primary Screen stays mounted (§33).
// · CAPACITOR: the icons open the dedicated Game Chat Contacts screen
//   (existing) / Friends screen — real navigation with back stacks (§12-§18).
//
// Everything else (matchmaking, join, rooms, chat backends) is REUSED, never
// duplicated (§2/§34/§35).

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Loader2, Lock, Plus } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore } from '@/store/game-chat'
import { isNative } from '@/lib/capacitor'
import { GameInteractionPanel, type GameInteractionPanelHandle } from './GameInteractionPanel'
import { configGradient, type GamePrimaryConfig } from './game-configs'

const TAGLINE_VISIBLE_MS = 3200 // refactor PRD §20 cadence — slow, subtle
const RULE_VISIBLE_MS = 4200 // lifecycle PRD §41 — readable pause
const RULE_TRANSITION_S = 0.45

export function GamePrimaryScreen({
  config,
  backLabel,
  onBack,
  onPlay,
  playLabel = 'Play Now',
  playIcon,
  playBusy = false,
  playDisabled = false,
  playTestId = 'game-primary-play-now',
  coinBalance,
  onBuyCoins,
  failed = false,
  failHint,
}: {
  config: GamePrimaryConfig
  backLabel: string
  onBack: () => void
  /** §54: Play Now → Game Room — wired per game by the wrapper. */
  onPlay?: () => void
  playLabel?: string
  playIcon?: React.ReactNode
  playBusy?: boolean
  playDisabled?: boolean
  playTestId?: string
  coinBalance?: number
  onBuyCoins?: () => void
  failed?: boolean
  failHint?: string
}) {
  const user = useQuickyStore((s) => s.user)
  const view = useQuickyStore((s) => s.view)
  const chatList = useGameChatStore((s) => s.list)
  const refreshChatList = useGameChatStore((s) => s.refreshList)

  // Web interaction panel handle (§20/§22/§25)
  const panelRef = useRef<GameInteractionPanelHandle>(null)
  // Native detection is deferred (async callback, never sync-in-effect) so
  // SSR HTML and the first client paint agree — no hydration mismatch on
  // Capacitor; the closed panel renders nothing either way.
  const [native, setNative] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setNative(isNative()), 0)
    return () => clearTimeout(t)
  }, [])

  // §47: unread badge uses the EXISTING unread state from the shared
  // game-chat store (single source of truth — never a second counter).
  const totalUnread = useMemo(() => chatList.reduce((s, c) => s + (c.unread || 0), 0), [chatList])
  useEffect(() => {
    refreshChatList()
  }, [refreshChatList])

  // §42 — rotating taglines (slow, AnimatePresence fade; paused never —
  // they are the idle heartbeat of the screen, as today on Spin the Bottle).
  const taglines = config.rotatingTexts
  const [taglineIdx, setTaglineIdx] = useState(0)
  useEffect(() => {
    if (taglines.length <= 1) return
    const t = setInterval(() => setTaglineIdx((i) => (i + 1) % taglines.length), TAGLINE_VISIBLE_MS)
    return () => clearInterval(t)
  }, [taglines.length])

  // §42 — How It Works: ONE step at a time, slow rotation (lifecycle §38-§53)
  const steps = config.howItWorks
  const [ruleIdx, setRuleIdx] = useState(0)
  useEffect(() => {
    if (steps.length <= 1) return
    const t = setInterval(() => setRuleIdx((i) => (i + 1) % steps.length), RULE_VISIBLE_MS)
    return () => clearInterval(t)
  }, [steps.length])
  const currentStep = steps.length > 0 ? steps[Math.min(ruleIdx, steps.length - 1)] : null

  // ── §9/§12/§19: icon behaviour differs per platform ─────────────────────
  const openChats = () => {
    if (native) {
      // §12: Game Primary → Chat icon → dedicated Game Chat Contacts screen.
      // Back: Contacts → Personal Chat → Contacts → HERE (§14).
      useQuickyStore.getState().openGameChatContacts(view)
    } else {
      // §22: open the interaction area INSIDE this screen — no navigation.
      panelRef.current?.open('chat')
    }
  }
  const openFriends = () => {
    if (native) {
      // §15: Game Primary → Friends icon → dedicated Friends screen.
      useQuickyStore.getState().openGameFriends(view)
    } else {
      // §25: open Friends inside the interaction area.
      panelRef.current?.open('friends')
    }
  }

  const avatar = user?.photos?.find((p: any) => p.isPrimary)?.url ?? user?.photos?.[0]?.url
  const level = Math.max(1, Math.floor((config.quickyPoints ?? user?.quickyScore ?? 0) / 50) + 1)

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* Ambient glow — decorative only, never swallows taps */}
      <motion.div
        className="pointer-events-none absolute -top-24 -left-20 w-72 h-72 rounded-full bg-[var(--qk-accent)]/15 blur-3xl"
        animate={{ x: [0, 24, 0], y: [0, 16, 0] }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      />
      <motion.div
        className="pointer-events-none absolute -bottom-24 -right-20 w-80 h-80 rounded-full bg-[var(--qk-purple)]/15 blur-3xl"
        animate={{ x: [0, -24, 0], y: [0, -16, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        aria-hidden
      />

      {/* Header (§5: selected game name, same typography/positioning) */}
      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2 relative z-20">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-white/10" aria-label={backLabel}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold truncate">{config.name}</h1>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 px-5 pb-10">
        <div className="w-full max-w-2xl mx-auto flex flex-col gap-5">
          {failed ? (
            /* §49: load failure → error + retry path, never a blank screen */
            <div className="flex-1 flex flex-col items-center justify-center gap-3 py-24 text-center">
              <span className="text-4xl" aria-hidden>🎮</span>
              <p className="text-white/60 text-sm">{failHint ?? "We couldn't load this game."}</p>
              <button
                onClick={onBack}
                className="text-sm font-bold text-[var(--qk-accent)] px-5 py-2.5 rounded-full border border-[var(--qk-accent)]/30"
              >
                {backLabel}
              </button>
            </div>
          ) : (
            <>
              {/* ── Hero (game name/artwork — content changes per game) ── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="relative rounded-3xl overflow-hidden border border-white/10"
              >
                <div className={`relative aspect-[16/9] ${configGradient(config)} flex items-center justify-center`}>
                  <div
                    className="absolute inset-0 bg-[radial-gradient(circle_at_28%_20%,rgba(255,255,255,0.25),transparent_55%)]"
                    aria-hidden
                  />
                  <span className="text-7xl drop-shadow-xl" aria-hidden>{config.icon}</span>
                  {config.playable ? (
                    <span className="absolute top-3 right-3 rounded-full bg-black/50 backdrop-blur px-3 py-1 text-[10px] font-black tracking-wider text-emerald-300">
                      ● LIVE
                    </span>
                  ) : (
                    <span className="absolute top-3 left-3 rounded-full bg-black/50 backdrop-blur px-3 py-1 text-[10px] font-black tracking-wider text-white/80">
                      COMING SOON
                    </span>
                  )}
                </div>
                <div className="bg-[var(--qk-card)]/80 border-t border-white/8 px-5 py-4">
                  <h2 className="text-2xl font-black tracking-tight">{config.name}</h2>
                  <p className="text-sm text-white/60 mt-1">{config.shortDescription}</p>
                  {config.modeLabel && (
                    <p className="text-[11px] font-semibold text-white/45 mt-2">{config.modeLabel}</p>
                  )}
                </div>
              </motion.div>

              {/* ── Coin chip (existing pattern — §24 refactor PRD) ─────── */}
              <div className="flex items-center justify-between rounded-2xl border border-white/8 bg-[var(--qk-card)]/70 px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-bold tabular-nums">
                  🪙 {(coinBalance ?? 0).toLocaleString('en-US')}
                </span>
                <button
                  onClick={onBuyCoins}
                  className="w-8 h-8 rounded-full bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 flex items-center justify-center active:scale-95 transition-transform"
                  aria-label="Buy coins"
                  data-testid="landing-coin-add"
                >
                  <Plus className="w-4 h-4 text-[var(--qk-accent-light)]" />
                </button>
              </div>

              {/* ── §8 PROFILE / STAT CARD with 💬 (top-left) + 👥 (top-right)
                      The icons visually belong to the card. ─────────────── */}
              <div className="relative" data-testid="game-primary-profile-card">
                <div className="flex items-end justify-between px-2 relative z-10 -mb-5">
                  {/* §9 Chat icon — top-left of the profile/stat card */}
                  <button
                    onClick={openChats}
                    className="relative w-12 h-12 rounded-2xl bg-[var(--qk-card)] border-2 border-[var(--qk-accent)]/50 shadow-lg flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all"
                    aria-label="Open game chats"
                    data-testid="game-primary-chat-icon"
                  >
                    <span className="text-xl leading-none" aria-hidden>💬</span>
                    {totalUnread > 0 && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-coral-gradient text-[10px] font-black text-white flex items-center justify-center border border-[var(--qk-bg)]">
                        {totalUnread > 9 ? '9+' : totalUnread}
                      </span>
                    )}
                  </button>
                  {/* §10 Friends icon — top-right, same visual weight */}
                  <button
                    onClick={openFriends}
                    className="w-12 h-12 rounded-2xl bg-[var(--qk-card)] border-2 border-[var(--qk-purple)]/60 shadow-lg flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all"
                    aria-label="Open friends"
                    data-testid="game-primary-friends-icon"
                  >
                    <span className="text-xl leading-none" aria-hidden>👥</span>
                  </button>
                </div>

                <div className="bg-[var(--qk-card)] border border-white/10 rounded-3xl p-5 pt-8">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 shrink-0 rounded-full overflow-hidden border-2 border-[var(--qk-accent)]/50 bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center">
                      {avatar ? (
                        <img src={avatar} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xl font-black text-white">
                          {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-lg font-bold truncate">{user?.name ?? 'You'}</p>
                      <p className="text-xs text-white/50">Level {level}</p>
                    </div>
                  </div>

                  {/* §6 — SELECTED game statistics (dynamic per game) */}
                  {config.gameStats.length > 0 && (
                    <div className="grid grid-cols-4 gap-2.5 mt-5">
                      {config.gameStats.map((st) => (
                        <div
                          key={st.key}
                          className="bg-white/5 border border-white/10 rounded-2xl p-2.5 flex flex-col items-center text-center gap-1"
                        >
                          <span className="text-base leading-none" style={{ color: st.tint }} aria-hidden>{st.icon}</span>
                          <p className="text-base font-black mt-0.5 tabular-nums leading-none">
                            {typeof st.value === 'number' ? st.value.toLocaleString('en-US') : st.value}
                          </p>
                          <p className="text-[9px] text-white/50 uppercase tracking-wide leading-tight">{st.label}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ── §7 COMBINED Quicky statistics (across games) ─────────── */}
              <section data-testid="game-primary-overall-stats">
                <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">
                  All Quicky
                </p>
                <div className="grid grid-cols-4 gap-2.5">
                  {config.overallStats.map((st) => (
                    <div
                      key={st.key}
                      className="rounded-2xl border border-white/8 bg-[var(--qk-card)]/70 p-2.5 flex flex-col items-center text-center gap-1"
                    >
                      <span className="text-base leading-none" style={{ color: st.tint }} aria-hidden>{st.icon}</span>
                      <p className="text-base font-black mt-0.5 tabular-nums leading-none">
                        {typeof st.value === 'number' ? st.value.toLocaleString('en-US') : st.value}
                      </p>
                      <p className="text-[9px] text-white/50 uppercase tracking-wide leading-tight">{st.label}</p>
                    </div>
                  ))}
                </div>
              </section>

              {/* ── Play Now (§54: Play Now → Game Room, unchanged) ──────── */}
              {config.playable && onPlay && (
                <>
                  <button
                    onClick={onPlay}
                    disabled={playBusy || playDisabled}
                    className="w-full rounded-2xl bg-coral-gradient glow-coral py-4 font-black tracking-wide text-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
                    data-testid={playTestId}
                  >
                    {playBusy ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> Joining…
                      </>
                    ) : (
                      <>
                        {playIcon}
                        {playLabel}
                      </>
                    )}
                  </button>
                  {config.modeLabel && (
                    <p className="text-[11px] font-semibold text-white/50 -mt-2 text-center">{config.modeLabel}</p>
                  )}
                </>
              )}

              {/* ── §42 rotating instructional texts ─────────────────────── */}
              {taglines.length > 0 && (
                <div className="h-6 flex items-center justify-center" data-testid="game-primary-tagline">
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={taglineIdx}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.45, ease: 'easeInOut' }}
                      className="text-sm text-white/70 font-medium"
                    >
                      {taglines[taglineIdx % taglines.length]}
                    </motion.p>
                  </AnimatePresence>
                </div>
              )}

              {/* ── Your Progress (league / chemistry / streak — §60 data) ─ */}
              {(config.league || config.chemistry || config.streak) && (
                <div
                  className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5 flex flex-col gap-3.5"
                  data-testid="game-primary-progress"
                >
                  <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase">Your progress</p>
                  {config.league && (
                    <div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-bold">🏆 {config.league.name} League</span>
                        {config.league.nextName && config.league.nextMinimumPoints != null && (
                          <span className="text-[11px] text-white/40">
                            {Math.max(0, config.league.nextMinimumPoints - config.league.points).toLocaleString('en-US')} to {config.league.nextName}
                          </span>
                        )}
                      </div>
                      {config.league.nextName && config.league.nextMinimumPoints != null && (
                        <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mt-2">
                          <div
                            className="h-full rounded-full bg-gold-gradient"
                            style={{
                              width: `${Math.max(
                                4,
                                Math.min(
                                  100,
                                  Math.round(
                                    ((config.league.points - config.league.minimumPoints) /
                                      Math.max(1, config.league.nextMinimumPoints - config.league.minimumPoints)) *
                                      100
                                  )
                                )
                              )}%`,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                  {config.chemistry && (
                    <div>
                      <div className="flex items-center justify-between text-sm mb-1.5">
                        <span className="font-bold">💜 Chemistry</span>
                        <span className="text-[11px] text-white/40 tabular-nums">{config.chemistry.value}%</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-coral-gradient"
                          style={{ width: `${Math.max(3, Math.min(100, config.chemistry.value))}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-4 text-xs text-white/55 flex-wrap">
                    {config.streak && <span>🔥 {config.streak.current}-day streak</span>}
                    {config.quickyPoints != null && (
                      <span>✨ {config.quickyPoints.toLocaleString('en-US')} points</span>
                    )}
                    {config.datingLikes != null && <span>💗 {config.datingLikes.toLocaleString('en-US')} likes</span>}
                  </div>
                </div>
              )}

              {/* ── §42 How It Works (config-driven, ONE step at a time) ── */}
              {currentStep && (
                <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-4" data-testid="game-primary-how-it-works">
                  <div className="flex items-center justify-between mb-2.5">
                    <p className="font-semibold text-sm">How it works</p>
                    {steps.length > 1 && (
                      <div className="flex items-center gap-1.5" aria-label={`Step ${ruleIdx + 1} of ${steps.length}`}>
                        {steps.map((s, i) => (
                          <span
                            key={s.id}
                            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                              i === ruleIdx ? 'bg-[var(--qk-accent)]' : 'bg-white/20'
                            }`}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="h-[72px] relative">
                    <AnimatePresence mode="wait">
                      <motion.div
                        key={currentStep.id}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: RULE_TRANSITION_S, ease: 'easeInOut' }}
                        className="absolute inset-0 flex items-start gap-3"
                      >
                        <span className="text-2xl leading-none mt-0.5" aria-hidden>{currentStep.icon}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold leading-snug">{currentStep.title}</p>
                          <p className="text-white/60 text-xs leading-relaxed line-clamp-2 mt-0.5">
                            {currentStep.description}
                          </p>
                        </div>
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              )}

              {/* ── Game information (§13: honest description per game) ──── */}
              {(config.description || config.shortDescription) && (
                <section>
                  <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">Game information</p>
                  <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5 text-sm text-white/70 leading-relaxed">
                    {config.description || config.shortDescription}
                  </div>
                </section>
              )}

              {/* ── Honest coming-soon state for future games (§54) ──────── */}
              {!config.playable && (
                <div className="rounded-3xl border border-white/10 bg-white/5 p-6 flex flex-col items-center text-center gap-2">
                  <span className="text-3xl" aria-hidden>🎮</span>
                  <p className="font-black">This one is still in the works</p>
                  <p className="text-xs text-white/55 leading-relaxed max-w-[36ch]">
                    More games are coming soon. Check back for new ways to play — Spin the Bottle is live right now.
                  </p>
                  <button
                    onClick={onBack}
                    className="mt-1 flex items-center gap-2 rounded-full bg-white/8 border border-white/12 px-5 py-2.5 text-xs font-bold text-white/75 hover:bg-white/12 transition-colors"
                  >
                    <Lock className="w-3.5 h-3.5" aria-hidden /> Playable games
                  </button>
                </div>
              )}

              {/* ── §20/§29: WEB interaction area — replaces the old bottom
                      Game Chats section. Closed by default (§21). ──────── */}
              {!native && <GameInteractionPanel ref={panelRef} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
