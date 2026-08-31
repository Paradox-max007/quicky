'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Sparkles, Send, DoorOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { joinMatchChannel, MatchChannel } from '@/lib/quicky/realtime'
import { GameShareCard, GamePostInfo } from './GameShareCard'

type Step = 'pick_truth_or_dare' | 'prompt' | 'answer'
type Session = {
  id: string
  currentTurn: number
  currentPlayerId: string
  isMyTurn: boolean
  partnerId: string
  turns: any[]
}

export function TruthOrDareGame({
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
  const [currentTurn, setCurrentTurn] = useState<any | null>(null)
  const [answerText, setAnswerText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [gamePost, setGamePost] = useState<GamePostInfo | null>(null)
  const channelRef = useRef<MatchChannel | null>(null)
  const sessionRef = useRef<Session | null>(null)
  sessionRef.current = session

  const refresh = async () => {
    try {
      const res = await api.game.get(matchId)
      if (!res.session && !sessionRef.current) {
        const started = await api.game.start(matchId, 'truth_or_dare')
        if (started?.session) {
          setSession(started.session)
          setCurrentTurn(null)
          return
        }
      } else if (res.session) {
        setSession(res.session)
        // Find current unresolved turn
        const last = res.session.turns[res.session.turns.length - 1]
        if (last && !last.answerText && !last.skipped && last.playerId === meId) {
          setCurrentTurn(last)
        } else {
          setCurrentTurn(null)
        }
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load game')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // Safety-net poll only — live updates arrive via the 'game' broadcast
    const interval = setInterval(refresh, 10000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId])

  // Opponent actions ping this side to refresh instantly
  useEffect(() => {
    const ch = joinMatchChannel(matchId, {
      onGame: (payload) => {
        if (payload?.ping) refresh()
      },
    })
    channelRef.current = ch
    return () => {
      ch?.unsubscribe()
      channelRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId])

  const pingPartner = () => channelRef.current?.sendGame({ ping: 'truth_or_dare' })

  const pick = async (choice: 'truth' | 'dare') => {
    if (!session) return
    setBusy(true)
    try {
      const res = await api.game.action(matchId, session.id, choice)
      if (res.ok && res.turn) {
        setCurrentTurn(res.turn)
        setSession((s) => (s ? { ...s, turns: [...s.turns, res.turn] } : s))
        pingPartner()
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const submitAnswer = async () => {
    if (!session || !currentTurn) return
    setBusy(true)
    try {
      const res = await api.game.action(matchId, session.id, 'answer', { answerText })
      if (res.ok) {
        setAnswerText('')
        setCurrentTurn(null)
        // PATCH response already carries the fresh session state — apply it
        if (res.session) {
          setSession((s) =>
            s
              ? {
                  ...s,
                  currentTurn: res.session.currentTurn,
                  currentPlayerId: res.session.currentPlayerId,
                  isMyTurn: false,
                  turns: s.turns.map((t: any) =>
                    t.id === currentTurn.id ? { ...t, answerText } : t
                  ),
                }
              : s
          )
        }
        pingPartner()
        toast.success('Answer sent! It’s their turn now.')
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const skip = async () => {
    if (!session || !currentTurn) return
    setBusy(true)
    try {
      const res = await api.game.action(matchId, session.id, 'skip')
      if (res.ok) {
        setCurrentTurn(null)
        if (res.session) {
          setSession((s) =>
            s
              ? {
                  ...s,
                  currentTurn: res.session.currentTurn,
                  currentPlayerId: res.session.currentPlayerId,
                  isMyTurn: false,
                  turns: s.turns.map((t: any) => (t.id === currentTurn.id ? { ...t, skipped: true } : t)),
                }
              : s
          )
        }
        pingPartner()
        toast.success('Skipped. Their turn now.')
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

  const isMyTurn = session?.currentPlayerId === meId
  const lastTurn = session?.turns[session.turns.length - 1]
  const awaitingMyAnswer = lastTurn && lastTurn.playerId === meId && !lastTurn.answerText && !lastTurn.skipped

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="absolute inset-0 z-[150] bg-[var(--qk-bg)] text-white flex flex-col"
    >
      {/* Header */}
      <header className="shrink-0 px-4 pt-3 pb-3 flex items-center justify-between border-b border-white/8">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-[var(--qk-purple)]/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[var(--qk-purple)]" />
          </div>
          <div>
            <h2 className="font-bold text-base">Truth or Dare</h2>
            <p className="text-xs text-white/50">Turn {session?.currentTurn ?? 1}</p>
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

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 flex flex-col gap-4">
        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-purple)] border-t-transparent animate-spin" />
          </div>
        ) : !session ? (
          <div className="flex-1 flex flex-col items-center justify-center text-white/50">
            <Sparkles className="w-12 h-12 text-[var(--qk-purple)]/30 mb-3" />
            <p>No active session</p>
          </div>
        ) : (
          <>
            {/* Turn history */}
            <div className="flex flex-col gap-2">
              {session.turns.map((t, idx) => (
                <div key={t.id} className="bg-white/5 rounded-2xl p-3 border border-white/5">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium capitalize text-[var(--qk-purple)]">
                      Turn {idx + 1} · {t.choice}
                    </span>
                    <span className="text-[10px] text-white/40 uppercase tracking-wide">
                      {t.promptDeck}
                    </span>
                  </div>
                  <p className="text-sm font-medium">{t.promptText}</p>
                  {t.answerText && (
                    <p className="text-sm text-white/70 mt-2 pl-2 border-l-2 border-[var(--qk-accent)]/40">
                      {t.answerText}
                    </p>
                  )}
                  {t.skipped && (
                    <p className="text-xs text-white/40 italic mt-2">Skipped</p>
                  )}
                </div>
              ))}
            </div>

            {/* Current action */}
            <div className="mt-auto">
              {isMyTurn && !awaitingMyAnswer && !currentTurn && (
                <div className="bg-[var(--qk-card)] border border-[var(--qk-purple)]/30 rounded-3xl p-5">
                  <p className="text-sm text-white/60 text-center mb-1">Your turn — pick one for yourself</p>
                  <h3 className="text-xl font-bold text-center mb-4">Truth or Dare?</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => pick('truth')}
                      disabled={busy}
                      className="py-4 rounded-2xl bg-[var(--qk-purple)]/15 border border-[var(--qk-purple)]/30 text-[var(--qk-purple)] font-bold text-lg hover:bg-[var(--qk-purple)]/25 active:scale-95 transition-all disabled:opacity-50"
                    >
                      Truth
                    </button>
                    <button
                      onClick={() => pick('dare')}
                      disabled={busy}
                      className="py-4 rounded-2xl bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 text-[var(--qk-accent)] font-bold text-lg hover:bg-[var(--qk-accent)]/25 active:scale-95 transition-all disabled:opacity-50"
                    >
                      Dare
                    </button>
                  </div>
                </div>
              )}

              {currentTurn && (
                <div className="bg-[var(--qk-card)] border border-[var(--qk-accent)]/30 rounded-3xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium capitalize text-[var(--qk-accent-light)]">
                      {currentTurn.choice} · {currentTurn.promptDeck}
                    </span>
                  </div>
                  <h3 className="text-lg font-bold mb-4 text-balance">{currentTurn.promptText}</h3>
                  <textarea
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="Type your answer..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50 resize-none mb-3"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={submitAnswer}
                      disabled={busy || !answerText.trim()}
                      className="flex-1 bg-coral-gradient rounded-xl py-2.5 text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-95 transition-all"
                    >
                      <Send className="w-4 h-4" /> Answer
                    </button>
                    <button
                      onClick={skip}
                      disabled={busy}
                      className="px-4 rounded-xl bg-white/5 border border-white/10 text-sm text-white/60 hover:bg-white/10 active:scale-95 transition-all disabled:opacity-50"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )}

              {!isMyTurn && !awaitingMyAnswer && (
                <div className="bg-[var(--qk-card)] border border-white/10 rounded-3xl p-5 text-center">
                  <Sparkles className="w-8 h-8 mx-auto mb-2 text-[var(--qk-purple)]/40" />
                  <p className="text-sm text-white/60">
                    Waiting for {partnerName ?? 'them'} to pick truth or dare...
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </motion.div>
  )
}
