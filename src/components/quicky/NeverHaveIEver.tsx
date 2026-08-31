'use client'

import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, DoorOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { joinMatchChannel, MatchChannel } from '@/lib/quicky/realtime'
import { GameShareCard, GamePostInfo } from './GameShareCard'

// Never Have I Ever (PRD §8): Premium×2 game — both players secretly answer
// Yes/No each round, answers reveal simultaneously once both have locked in.
type Session = {
  id: string
  gameType: string
  currentTurn: number
  roundStatement?: string
  iAnswered?: boolean
  partnerAnswered?: boolean
  turns: any[]
}

export function NeverHaveIEver({
  matchId,
  meId,
  partnerName,
  onClose,
}: {
  matchId: string
  meId: string
  partnerName: string | null
  onClose: () => void
}) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [gamePost, setGamePost] = useState<GamePostInfo | null>(null)
  const channelRef = useRef<MatchChannel | null>(null)
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session
  // Local optimistic pick so my choice shows instantly while it syncs
  const [myPick, setMyPick] = useState<'yes' | 'no' | null>(null)
  const [reveal, setReveal] = useState<{ mine: 'yes' | 'no'; theirs: 'yes' | 'no' } | null>(null)

  const load = async () => {
    try {
      let res = await api.game.get(matchId)
      if (!res.session && !sessionRef.current) {
        const started = await api.game.start(matchId, 'never_have_i_ever')
        if (started?.session) {
          applyState({ ...started.session, gameType: 'never_have_i_ever', turns: [] })
          return
        }
        res = await api.game.get(matchId)
      }
      if (res.session) {
        applyState(res.session)
      }
    } catch (e: any) {
      if (e.status === 402) {
        // Premium missing on either side — surface and close
        toast.error(e.body?.message ?? e.message ?? 'Premium required')
        onClose()
      } else {
        toast.error(e.message ?? 'Failed to load game')
      }
    } finally {
      setLoading(false)
    }
  }

  const applyState = (s: Session) => {
    setSession(s)
    // Simultaneous reveal once both players have locked in this round
    const roundKey = `round:${s.currentTurn}`
    const mine = s.turns.find((t) => t.promptDeck === roundKey && t.playerId === meId)
    const theirs = s.turns.find((t) => t.promptDeck === roundKey && t.playerId !== meId)
    if (mine && theirs) {
      setReveal({ mine: mine.choice as any, theirs: theirs.choice as any })
    } else {
      setReveal(null)
    }
  }

  useEffect(() => {
    load()
    // Safety-net poll only — live updates arrive via the 'game' broadcast
    const interval = setInterval(load, 10000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId])

  // Opponent locked in / advanced a round → refresh instantly
  useEffect(() => {
    const ch = joinMatchChannel(matchId, {
      onGame: (payload) => {
        if (payload?.ping) load()
      },
    })
    channelRef.current = ch
    return () => {
      ch?.unsubscribe()
      channelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId])

  const pick = async (choice: 'yes' | 'no') => {
    if (!session || busy || session.iAnswered) return
    setMyPick(choice)
    setBusy(true)
    haptic()
    try {
      const res = await api.game.action(matchId, session.id, 'answer', { choice })
      if (res.ok) {
        // The answer PATCH already tells us whether the partner revealed —
        // no follow-up GET needed.
        setSession((s) =>
          s
            ? {
                ...s,
                iAnswered: true,
                turns: [
                  ...s.turns,
                  { id: `local_${Date.now()}`, playerId: meId, promptDeck: `round:${s.currentTurn}`, promptText: s.roundStatement ?? '', choice },
                ],
              }
            : s
        )
        if (res.reveal) {
          setReveal({ mine: choice, theirs: res.partnerChoice })
        }
        channelRef.current?.sendGame({ ping: 'never_have_i_ever' })
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
      setMyPick(null)
    } finally {
      setBusy(false)
    }
  }

  const nextRound = async () => {
    if (!session || busy) return
    setBusy(true)
    setMyPick(null)
    setReveal(null)
    try {
      const res = await api.game.action(matchId, session.id, 'next_round')
      if (res.ok) {
        // next_round response already carries the new round's statement
        setSession((s) =>
          s
            ? {
                ...s,
                currentTurn: res.round ?? s.currentTurn + 1,
                roundStatement: res.roundStatement ?? s.roundStatement,
                iAnswered: false,
                partnerAnswered: false,
              }
            : s
        )
        channelRef.current?.sendGame({ ping: 'never_have_i_ever' })
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const endGame = async () => {
    if (!session) return
    try {
      const res = await api.game.action(matchId, session.id, 'end')
      if (res.gamePost) setGamePost(res.gamePost)
    } catch {}
  }

  function haptic() {
    import('@capacitor/haptics')
      .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
      .catch(() => {})
  }

  const showStatement = session?.roundStatement
  const iLockedIn = session?.iAnswered || !!myPick

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="absolute inset-0 z-[150] bg-[var(--qk-bg)] text-white flex flex-col"
    >
      <header className="shrink-0 px-4 pt-3 pb-3 flex items-center justify-between border-b border-white/8">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-[var(--qk-purple)]/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[var(--qk-purple)]" />
          </div>
          <div>
            <h2 className="font-bold text-base">Never Have I Ever</h2>
            <p className="text-xs text-white/50">Round {session?.currentTurn ?? 1} · with {partnerName ?? 'them'}</p>
          </div>
        </div>
        <button onClick={endGame} className="p-2 hover:bg-white/5 rounded-full text-white/50" aria-label="End game">
          <DoorOpen className="w-5 h-5" />
        </button>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full -ml-4" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </header>

      {/* Post-game share card overlay */}
      <AnimatePresence>
        {gamePost && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 z-[160] bg-[var(--qk-bg)]/95 backdrop-blur flex items-center justify-center p-5 overflow-y-auto"
          >
            <GameShareCard
              matchId={matchId}
              sessionId={session?.id ?? ''}
              post={gamePost}
              partnerName={partnerName}
              onClose={onClose}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 flex flex-col gap-6">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-purple)] border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {/* Statement card */}
            <div className="mt-4 bg-gradient-to-b from-[var(--qk-purple)]/20 to-transparent border border-[var(--qk-purple)]/30 rounded-3xl p-6 text-center">
              <p className="text-xs uppercase tracking-widest text-white/40 mb-2">Round {session?.currentTurn}</p>
              <h3 className="text-xl font-bold text-balance">{showStatement ?? '...'}</h3>
            </div>

            {/* Reveal */}
            {reveal ? (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <ResultCard
                    label="You"
                    choice={reveal.mine}
                    highlight={reveal.mine === 'yes'}
                  />
                  <ResultCard
                    label={partnerName ?? 'Them'}
                    choice={reveal.theirs}
                    highlight={reveal.theirs === 'yes'}
                  />
                </div>
                {(reveal.mine === 'yes' || reveal.theirs === 'yes') && (
                  <p className="text-center text-sm text-[var(--qk-purple)] font-medium animate-quicky-pulse">
                    👀 Someone has!
                  </p>
                )}
                <button
                  onClick={nextRound}
                  disabled={busy}
                  className="bg-coral-gradient glow-coral rounded-2xl py-3.5 font-bold text-sm active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  Next round →
                </button>
              </div>
            ) : (
              /* Secret Yes / No */
              <div className="flex flex-col gap-3 mt-auto mb-8">
                <p className="text-center text-xs text-white/50">
                  Answer secretly — both reveal together{session?.partnerAnswered ? ' · they already locked in!' : ''}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => pick('no')}
                    disabled={busy || iLockedIn}
                    className={cn(
                      'py-5 rounded-3xl border font-bold text-lg transition-all active:scale-95 disabled:opacity-60',
                      myPick === 'no'
                        ? 'bg-white text-black border-white scale-[1.03]'
                        : 'bg-white/5 border-white/15 hover:bg-white/10'
                    )}
                  >
                    No 😇
                  </button>
                  <button
                    onClick={() => pick('yes')}
                    disabled={busy || iLockedIn}
                    className={cn(
                      'py-5 rounded-3xl border font-bold text-lg transition-all active:scale-95 disabled:opacity-60',
                      myPick === 'yes'
                        ? 'bg-[var(--qk-purple)] text-white border-[var(--qk-purple)] scale-[1.03]'
                        : 'bg-[var(--qk-purple)]/10 border-[var(--qk-purple)]/30 text-[var(--qk-purple)] hover:bg-[var(--qk-purple)]/20'
                    )}
                  >
                    Yes 👀
                  </button>
                </div>
                {iLockedIn && !session?.partnerAnswered && (
                  <p className="text-center text-sm text-white/40">Locked in — waiting for {partnerName ?? 'them'}…</p>
                )}
              </div>
            )}

            {/* Round history */}
            {session && session.currentTurn > 1 && (
              <details className="text-sm text-white/60">
                <summary className="cursor-pointer select-none">Previous rounds ({session.currentTurn - 1})</summary>
                <ul className="mt-2 space-y-2">
                  {Array.from({ length: session.currentTurn - 1 }, (_, i) => i + 1).map((r) => {
                    const roundKey = `round:${r}`
                    const mine = session.turns.find((t) => t.promptDeck === roundKey && t.playerId === meId)
                    const theirs = session.turns.find((t) => t.promptDeck === roundKey && t.playerId !== meId)
                    return (
                      <li key={r} className="bg-white/5 rounded-xl p-2.5 border border-white/5">
                        <p className="text-xs text-white/70">{mine?.promptText ?? `Round ${r}`}</p>
                        <p className="text-[11px] mt-1">
                          You: {mine?.choice ?? '?'} · {partnerName ?? 'They'}: {theirs?.choice ?? '?'}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}

function ResultCard({ label, choice, highlight }: { label: string; choice: 'yes' | 'no'; highlight: boolean }) {
  return (
    <motion.div
      initial={{ rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20 }}
      className={cn(
        'rounded-3xl p-4 border text-center',
        highlight
          ? 'bg-[var(--qk-purple)]/20 border-[var(--qk-purple)]/40'
          : 'bg-white/5 border-white/10'
      )}
    >
      <p className="text-xs text-white/50 truncate">{label}</p>
      <p className="text-2xl font-extrabold mt-1">{choice === 'yes' ? 'I have 👀' : "I haven't 😇"}</p>
    </motion.div>
  )
}
