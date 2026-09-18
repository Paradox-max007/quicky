'use client'

// Quicky — GAME PRIMARY SCREEN (Unified Game Primary Screen PRD §1/§3/§8-§11,
// revised §v2 desktop architecture: 3-column layout)
//
// ONE reusable primary screen for EVERY Quicky game (§3):
//
//   Games → Game Card → GamePrimaryScreen(config) → (Play Now) → Game Room
//
// Spin the Bottle, Quicky Ludo and every future game render THIS component —
// only the GamePrimaryConfig data changes (§4/§42: no hardcoded game-specific
// UI logic here).
//
// ── Desktop architecture (v2: 3 columns, NOT 4 equal columns) ────────────────
//
//   ┌──────────────────────────────┬──────────────────┬──────────────────┐
//   │        MAIN PROFILE          │    GAME CHATS    │    MY FRIENDS    │
//   │      (substantially wider)   │  (social column) │  (social column) │
//   │                              │                  │                  │
//   │       Profile Image          │   contact list   │   friends list   │
//   │       You / Level            │        ↓         │        ↓         │
//   │       Statistics             │  personal chat   │  friend profile  │
//   │       Play Now               │   (in-column)    │   (in-column)    │
//   │   Group / Meet someone new   │                  │                  │
//   │       Your Progress          │                  │                  │
//   │       How It Works           │                  │                  │
//   └──────────────────────────────┴──────────────────┴──────────────────┘
//
// · The main profile column is ONE vertical content flow (v2 §4):
//     Profile Image → You/Level → Statistics → Play Now →
//     Group/Meet someone new → Your Progress → How It Works
//   Play Now, Progress and How It Works are NOT separate desktop columns.
// · The GAME CHATS and MY FRIENDS social columns are PERSISTENT on desktop
//   (v2 §3): their root list never closes — a personal chat opens inside the
//   Game Chats column, a friend profile inside the My Friends column, and
//   Back always restores the list (v2 GameInteractionPanel column variant).
// · The grid ratio is 1.6fr : 1fr : 1fr and all THREE cards occupy the
//   maximum width of the screen (no max-width cap) — the chats/friends
//   columns are wider than the earlier 2fr version (v2 §3 revised).
//
// ── Profile card social icons (v2 §4a — revised twice) ──
// · The 💬 Chat and 👥 Friends icons live INSIDE the profile card, flanking
//   the profile image circle at BOTH ENDS of the row (standard spacing from
//   the card border = the card's own padding).
// · On DESKTOP WEB (lg+) they are HIDDEN — the persistent GAME CHATS and
//   MY FRIENDS columns are already on screen, so duplicating the entry
//   points inside the card would be redundant. The profile image stays
//   centered via lg:justify-center.
// · On NARROW WEB and CAPACITOR they remain visible and open the dedicated
//   screens as a fresh page. Native keeps them at EVERY viewport (wide
//   tablets included) because the columns are a web-only surface.
//
// ── Mobile / Capacitor (v2 §6) ───────────────────────────────────────────────
// · No social columns below lg. The 💬/👥 icons are INSIDE the profile card
//   (flanking the profile image circle).
// · REVISED v2 — small-screen WEB follows the Capacitor flow: the icons open
//   the DEDICATED screens (Game Chat Contacts / Friends) as a FRESH PAGE via
//   the existing store navigation — NOT an in-page overlay. Back returns to
//   this Game Primary Screen (§13-§18/§40). The in-page overlay panel is
//   GONE. (On desktop web the icons are hidden entirely — the pulse-
//   highlight path below remains only as a defensive fallback.)
//
// Everything else (matchmaking, join, rooms, chat backends) is REUSED, never
// duplicated (§2/§34/§35).

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Loader2, Lock, MessageCircle, Plus, Users } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore } from '@/store/game-chat'
import { isNative } from '@/lib/capacitor'
import { GameInteractionPanel } from './GameInteractionPanel'
import { formatCoinCount, type GamePrimaryConfig } from './game-configs'

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

  // The desktop social columns are self-contained — no panel ref needed.
  // Native detection is deferred (async callback, never sync-in-effect) so
  // SSR HTML and the first client paint agree — no hydration mismatch on
  // Capacitor.
  const [native, setNative] = useState(false)
  // v2 §6: "desktop" = lg+ (1024px — matches the Tailwind lg breakpoint) on
  // WEB only. Deferred for the same hydration reason; it gates ONLY click
  // behaviour, never the rendered markup, so there is no mismatch risk.
  const [desktop, setDesktop] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => {
      const n = isNative()
      setNative(n)
      setDesktop(!n && window.matchMedia('(min-width: 1024px)').matches)
    }, 0)
    return () => clearTimeout(t)
  }, [])
  // Keep desktop in sync across viewport resizes (web only).
  useEffect(() => {
    if (native) return
    const mq = window.matchMedia('(min-width: 1024px)')
    const update = () => setDesktop(mq.matches)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [native])

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
  // v2 §6 — one navigation model: dedicated screens everywhere except
  // desktop web (where the columns are already on screen → pulse-highlight).
  const [columnHighlight, setColumnHighlight] = useState<'chat' | 'friends' | null>(null)
  const pulseColumn = (col: 'chat' | 'friends') => {
    setColumnHighlight(col)
    window.setTimeout(() => setColumnHighlight((cur) => (cur === col ? null : cur)), 1400)
  }
  const openChats = () => {
    if (desktop) {
      // lg+ web: GAME CHATS column is already visible — draw the eye to it.
      pulseColumn('chat')
    } else {
      // Narrow web + Capacitor: FRESH PAGE — the dedicated Game Chat
      // Contacts screen (§12/§13). Back: Contacts → Personal Chat →
      // Contacts → HERE (§14).
      useQuickyStore.getState().openGameChatContacts(view)
    }
  }
  const openFriends = () => {
    if (desktop) {
      // lg+ web: MY FRIENDS column is already visible — draw the eye to it.
      pulseColumn('friends')
    } else {
      // Narrow web + Capacitor: FRESH PAGE — the dedicated Friends screen
      // (§15). Back: Profile/Chat → Friends → HERE (§17/§18/§40).
      useQuickyStore.getState().openGameFriends(view)
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

      {/* Header (§5: game identity — icon, name, honest LIVE/COMING SOON) */}
      <header className="shrink-0 safe-area-top px-3 pt-2.5 pb-2 flex items-center gap-2 relative z-20">
        <button onClick={onBack} className="p-2 rounded-full hover:bg-white/10" aria-label={backLabel}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xl leading-none" aria-hidden>{config.icon}</span>
        <h1 className="text-lg font-bold truncate">{config.name}</h1>
        {config.playable ? (
          <span className="ml-auto shrink-0 rounded-full bg-black/40 border border-emerald-400/30 px-2.5 py-1 text-[10px] font-black tracking-wider text-emerald-300">
            ● LIVE
          </span>
        ) : (
          <span className="ml-auto shrink-0 rounded-full bg-black/40 border border-white/20 px-2.5 py-1 text-[10px] font-black tracking-wider text-white/80">
            COMING SOON
          </span>
        )}
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar relative z-10 px-4 sm:px-5 pb-10">
        {/* v2 §3 revised: NO max-width cap — all three cards occupy the
            maximum width of the screen. */}
        <div className="w-full flex flex-col gap-5">
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
              {/* ── v2 §3 DESKTOP 3-COLUMN ARCHITECTURE ─────────────────────
                  lg+: [ MAIN PROFILE 1.6fr | GAME CHATS 1fr | MY FRIENDS 1fr ]
                  below lg: plain block — the main column IS the page. ────── */}
              <div className="lg:grid lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] lg:gap-4 lg:items-start">
                {/* ═══ MAIN PROFILE COLUMN — one vertical content flow (v2 §4):
                        Profile Image → You/Level → Statistics → Play Now →
                        Group/Meet someone new → Your Progress → How It Works ═══ */}
                <div className="min-w-0 flex flex-col gap-5" data-testid="game-primary-main-column">
                  {/* PROFILE — image, You/Level, statistics, coins (§8/§6/§7) */}
                  <div
                    className="bg-[var(--qk-card)] border border-white/10 rounded-3xl p-5"
                    data-testid="game-primary-profile-card"
                  >
                    {/* §9/§10 + v2 §4a (revised): Chat / Friends icons INSIDE
                            the card, flanking the profile image circle at BOTH
                            ENDS of the row — but only BELOW lg on web. On
                            desktop web the persistent columns take over, so
                            the flanking icons are hidden and the profile
                            image stays centered. NATIVE keeps the icons at
                            every viewport (the columns are web-only). The
                            hiding is pure CSS (lg:hidden, dropped when native
                            is detected), so the first web-desktop paint is
                            already correct — no flash, no hydration risk. */}
                    <div className={`flex items-center justify-between ${native ? '' : 'lg:justify-center'}`}>
                      {/* Chat icon — left end (accent), shared unread badge */}
                      <button
                        onClick={openChats}
                        className={`relative w-12 h-12 shrink-0 rounded-2xl bg-white/5 border-2 border-[var(--qk-accent)]/50 shadow-lg flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all ${native ? '' : 'lg:hidden'}`}
                        aria-label="Open game chats"
                        data-testid="game-primary-chat-icon"
                      >
                        <MessageCircle className="w-5 h-5 text-[var(--qk-accent-light)]" aria-hidden />
                        {totalUnread > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-coral-gradient text-[10px] font-black text-white flex items-center justify-center border border-[var(--qk-card)]">
                            {totalUnread > 9 ? '9+' : totalUnread}
                          </span>
                        )}
                      </button>

                      {/* Profile image — centered between the two icons */}
                      <span className="w-20 h-20 rounded-full overflow-hidden border-2 border-[var(--qk-accent)]/50 bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center">
                        {avatar ? (
                          <img src={avatar} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-2xl font-black text-white">
                            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
                          </span>
                        )}
                      </span>

                      {/* Friends icon — right end (purple) */}
                      <button
                        onClick={openFriends}
                        className={`w-12 h-12 shrink-0 rounded-2xl bg-white/5 border-2 border-[var(--qk-purple)]/60 shadow-lg flex items-center justify-center hover:bg-white/10 active:scale-95 transition-all ${native ? '' : 'lg:hidden'}`}
                        aria-label="Open friends"
                        data-testid="game-primary-friends-icon"
                      >
                        <Users className="w-5 h-5 text-[var(--qk-purple)]" aria-hidden />
                      </button>
                    </div>

                    {/* You / Level */}
                    <div className="min-w-0 text-center mt-2.5">
                      <p className="text-lg font-bold truncate">{user?.name ?? 'You'}</p>
                      <p className="text-xs text-white/50">Level {level}</p>
                    </div>

                    {/* Statistics — SELECTED game (§6, dynamic per game).
                        §8 REVISED — the COIN CHIP is the FIRST coin display:
                        the Total Coins tile ITSELF carries the + that opens
                        the Coin Store (CoinStoreSheet on BOTH web and
                        Capacitor). It shows the LIVE balance in the compact
                        chip format (1000 → 1K, 1500 → 1.5K) and updates
                        instantly after a purchase. The separate balance
                        strip with its own + that used to sit under this
                        grid is REMOVED — one coin chip, one entry point. */}
                    {config.gameStats.length > 0 && (
                      <div className="grid grid-cols-4 gap-2.5 mt-5">
                        {config.gameStats.map((st) => {
                          const isCoin = st.key === 'total-coins'
                          const coins = isCoin && coinBalance != null ? coinBalance : st.value
                          const display = isCoin
                            ? formatCoinCount(typeof coins === 'number' ? coins : Number(coins) || 0)
                            : typeof st.value === 'number'
                              ? st.value.toLocaleString('en-US')
                              : st.value
                          const TileTag = (isCoin && onBuyCoins ? 'button' : 'div') as 'button' | 'div'
                          return (
                            <TileTag
                              key={st.key}
                              {...(isCoin && onBuyCoins
                                ? {
                                    type: 'button' as const,
                                    onClick: onBuyCoins,
                                    'aria-label': 'Buy coins — open the coin store',
                                    'data-testid': 'landing-coin-add',
                                  }
                                : {})}
                              className={`relative bg-white/5 border border-white/10 rounded-2xl p-2.5 flex flex-col items-center text-center gap-1 ${
                                isCoin && onBuyCoins ? 'hover:bg-white/10 active:scale-95 transition-all' : ''
                              }`}
                            >
                              {isCoin && onBuyCoins && (
                                <span
                                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-coral-gradient border border-[var(--qk-card)] shadow-md flex items-center justify-center"
                                  aria-hidden
                                >
                                  <Plus className="w-3 h-3 text-white" strokeWidth={3.5} />
                                </span>
                              )}
                              <span className="text-base leading-none" style={{ color: st.tint }} aria-hidden>{st.icon}</span>
                              <p className="text-base font-black mt-0.5 tabular-nums leading-none">{display}</p>
                              <p className="text-[9px] text-white/50 uppercase tracking-wide leading-tight">{st.label}</p>
                            </TileTag>
                          )
                        })}
                      </div>
                    )}

                    {/* Statistics — COMBINED Quicky totals (§7, same step) */}
                    {config.overallStats.length > 0 && (
                      <div className="mt-4">
                        <p className="text-[10px] font-black tracking-[0.18em] text-white/40 uppercase mb-2 text-center">
                          All Quicky
                        </p>
                        <div className="grid grid-cols-4 gap-2.5">
                          {config.overallStats.map((st) => (
                            <div
                              key={st.key}
                              className="rounded-2xl border border-white/8 bg-white/5 p-2.5 flex flex-col items-center text-center gap-1"
                            >
                              <span className="text-base leading-none" style={{ color: st.tint }} aria-hidden>{st.icon}</span>
                              <p className="text-base font-black mt-0.5 tabular-nums leading-none">
                                {typeof st.value === 'number' ? st.value.toLocaleString('en-US') : st.value}
                              </p>
                              <p className="text-[9px] text-white/50 uppercase tracking-wide leading-tight">{st.label}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  </div>

                  {/* Play Now (§54: Play Now → Game Room, unchanged).
                      WEB: a BIT shorter than the column width, CENTERED —
                      icon + label stay dead-center. NATIVE (Capacitor):
                      keeps the full-width CTA. */}
                  {config.playable && onPlay && (
                    <button
                      onClick={onPlay}
                      disabled={playBusy || playDisabled}
                      className={`${native ? 'w-full' : 'w-full max-w-[320px] mx-auto'} rounded-2xl bg-coral-gradient glow-coral py-4 font-black tracking-wide text-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60`}
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
                  )}

                  {/* Group / Meet someone new — mode + rotating texts (§42) */}
                  {(config.modeLabel || taglines.length > 0) && (
                    <div className="flex flex-col items-center gap-1 -mt-1">
                      {config.modeLabel && (
                        <p className="text-[11px] font-semibold text-white/45">{config.modeLabel}</p>
                      )}
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
                    </div>
                  )}

                  {/* Your Progress (league / chemistry / streak — §60 data) */}
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

                  {/* How It Works (§42, config-driven, ONE step at a time) */}
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

                  {/* Game information (§13: honest description per game) */}
                  {(config.description || config.shortDescription) && (
                    <section>
                      <p className="text-[11px] font-black tracking-[0.18em] text-white/40 uppercase mb-2.5">Game information</p>
                      <div className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-5 text-sm text-white/70 leading-relaxed">
                        {config.description || config.shortDescription}
                      </div>
                    </section>
                  )}

                  {/* Honest coming-soon state for future games (§54) */}
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
                </div>

                {/* ═══ SOCIAL COLUMNS — desktop (lg+), WEB only (v2 §3) ═══
                    Both columns are PERSISTENT: their root list never closes,
                    personal chats / friend profiles open INSIDE the column
                    and Back always restores the list. */}
                {!native && (
                  <>
                    <div
                      className={`hidden lg:block lg:sticky lg:top-2 lg:h-[720px] lg:max-h-[calc(100vh-140px)] rounded-3xl transition-shadow duration-500 ${
                        columnHighlight === 'chat' ? 'ring-2 ring-[var(--qk-accent)]/80 shadow-[0_0_28px_rgba(255,90,71,0.35)]' : ''
                      }`}
                      data-testid="game-primary-chats-column"
                    >
                      <GameInteractionPanel variant="column" rootView="chat" />
                    </div>
                    <div
                      className={`hidden lg:block lg:sticky lg:top-2 lg:h-[720px] lg:max-h-[calc(100vh-140px)] rounded-3xl transition-shadow duration-500 ${
                        columnHighlight === 'friends' ? 'ring-2 ring-[var(--qk-purple)]/80 shadow-[0_0_28px_rgba(149,102,246,0.35)]' : ''
                      }`}
                      data-testid="game-primary-friends-column"
                    >
                      <GameInteractionPanel variant="column" rootView="friends" />
                    </div>
                  </>
                )}
              </div>

            </>
          )}
        </div>
      </div>
    </div>
  )
}
