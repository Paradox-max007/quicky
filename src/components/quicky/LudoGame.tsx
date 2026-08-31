'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Dices, Trophy, DoorOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  LudoState, LudoColor, trackCell, START_OFFSET, TURN_TIMEOUT_MS,
} from '@/lib/quicky/ludo'
import { joinMatchChannel, MatchChannel } from '@/lib/quicky/realtime'
import { GameShareCard, GamePostInfo } from './GameShareCard'

type Move = { tokenId: number; captures: number[] }
type Session = {
  id: string
  myColor: 'A' | 'B'
  turnColor: 'A' | 'B' | null
  isMyTurn: boolean
  status: string
  ludoState: LudoState | null
  moves: Move[]
}

const COLORS = {
  A: { main: '#FF5A79', light: '#FFD3DB', name: 'Coral' },
  B: { main: '#30D158', light: '#D2F7DC', name: 'Green' },
}

// ─── Board geometry (circular layout) ────────────────────────────────────────
// A clean presentation of the shared 52-cell track: cells sit on a circle,
// each player's home column runs radially toward the center, yards anchor at
// each player's start. All positions are derived, so state stays server-truth.

const BOARD_SIZE = 320
const RING_R = BOARD_SIZE * 0.38
const CENTER_R = BOARD_SIZE / 2

function ringPos(cellIndex: number): { x: number; y: number } {
  // Player A's start cell sits at the bottom of the board and play runs clockwise
  const angle = ((cellIndex - 39) / 52) * Math.PI * 2 + Math.PI / 2
  return { x: CENTER_R + RING_R * Math.cos(angle), y: CENTER_R + RING_R * Math.sin(angle) }
}
function homeColPos(color: 'A' | 'B', idx: number): { x: number; y: number } {
  const entryCell = color === 'A' ? START_OFFSET.A + 50 : START_OFFSET.B + 50
  const entryAngle = ((entryCell - 39) / 52) * Math.PI * 2 + Math.PI / 2
  const r = RING_R * (1 - (idx + 1) * 0.155)
  return { x: CENTER_R + r * Math.cos(entryAngle), y: CENTER_R + r * Math.sin(entryAngle) }
}
function yardPos(color: 'A' | 'B', i: number): { x: number; y: number } {
  const base = ringPos(START_OFFSET[color])
  const dx = color === 'A' ? [-26, 22, -22, 26] : [-24, 20, -20, 24]
  const dy = color === 'A' ? [20, 24, -24, -20] : [-24, -20, 20, 24]
  return { x: base.x + dx[i], y: base.y + dy[i] }
}

export function LudoGame({
  matchId,
  meId,
  partnerName,
  onClose,
}: {
  matchId: string
  meId: string
  partnerName: string | null
  onClose?: () => void
}) {
  const onCloseSafe = onClose ?? (() => {})
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [dice, setDice] = useState<number | null>(null)
  const [eventFlash, setEventFlash] = useState<string | null>(null)
  const [gamePost, setGamePost] = useState<GamePostInfo | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const channelRef = useRef<MatchChannel | null>(null)

  const load = useCallback(async () => {
    try {
      let res = await api.game.get(matchId)
      // After a finished game the session is gone — don't start a rematch
      // underneath the winner banner unless the user actually left.
      if (!res.session && session?.status !== 'ended' && !session?.ludoState?.winner) {
        const started = await api.game.start(matchId, 'ludo')
        if (started?.session) {
          setSession({ ...started.session, status: 'active' })
          return
        }
        res = await api.game.get(matchId)
      }
      if (res.session) {
        setSession(res.session)
        setDice(res.session.ludoState?.pendingDice ?? null)
        if (res.session.ludoState?.winner) setSession((s) => ({ ...s!, status: 'ended' }))
      }
    } catch (e: any) {
      if (e.status === 402) {
        toast.error(e.body?.message ?? e.message ?? 'Premium required for both players to play Ludo')
        onCloseSafe()
      } else {
        toast.error(e.message ?? 'Failed to load Ludo')
      }
    } finally {
      setLoading(false)
    }
  }, [matchId, session?.status, session?.ludoState?.winner])

  useEffect(() => {
    load()
    // Realtime pushes the board after every action; this interval is only a
    // safety net for missed broadcasts / auto-skips.
    pollRef.current = setInterval(load, 6000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId])

  // Live board sync from the opponent's broadcasts
  useEffect(() => {
    const ch = joinMatchChannel(matchId, {
      onGame: (payload) => {
        const sync = payload?.ludoSync
        if (sync?.ludoState) {
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  ludoState: sync.ludoState,
                  moves: sync.moves ?? [],
                  turnColor: sync.turnColor ?? prev.turnColor,
                  isMyTurn: !!sync.isMyTurn,
                  status: sync.winner ? 'ended' : prev.status,
                }
              : prev
          )
          setDice(sync.ludoState.pendingDice ?? null)
          if (sync.winner) toast(`${partnerName ?? 'They'} finished the game!`, {})
        } else if (payload?.ping) {
          load()
        }
      },
    })
    channelRef.current = ch
    return () => {
      ch?.unsubscribe()
      channelRef.current = null
    }
  }, [matchId, load, partnerName])

  // Merge a PATCH response straight into local state — no follow-up GET.
  const applyActionResult = (res: any) => {
    if (res.ludoState) {
      setSession((prev) =>
        prev
          ? {
              ...prev,
              ludoState: res.ludoState,
              moves: res.moves ?? [],
              turnColor: res.turnColor ?? prev.turnColor,
              isMyTurn: !!res.isMyTurn,
              status: res.winner ? 'ended' : prev.status,
            }
          : prev
      )
      channelRef.current?.sendGame({
        ludoSync: {
          ludoState: res.ludoState,
          moves: res.moves ?? [],
          turnColor: res.turnColor,
          isMyTurn: res.isMyTurn,
          winner: res.winner ?? null,
        },
      })
    }
    if (res.winner) setGamePost(res.gamePost ?? null)
  }

  const flash = (msg: string) => {
    setEventFlash(msg)
    setTimeout(() => setEventFlash((f) => (f === msg ? null : f)), 1800)
  }

  const roll = async () => {
    if (!session || busy || !session.isMyTurn || session.ludoState?.pendingDice) return
    setBusy(true)
    try {
      const res = await api.game.action(matchId, session.id, 'roll')
      setDice(res.dice ?? null)
      if (res.cancelledSix) flash('Three sixes — turn forfeited!')
      else if (res.passed) flash(`No legal move with ${res.dice}`)
      applyActionResult(res)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const moveToken = async (tokenId: number) => {
    if (!session || busy || !session.ludoState?.pendingDice) return
    setBusy(true)
    try {
      const res = await api.game.action(matchId, session.id, 'move', { tokenId })
      if (res.ok && res.winner) {
        flash(`${res.winner === session.myColor ? 'You win! 🎉' : `${partnerName} wins`}`)
      }
      if (res.ok) {
        for (const ev of res.events ?? []) {
          if (ev.kind === 'capture') flash('Captured! 🔥 Token sent home')
          if (ev.kind === 'finish') flash('Token reached the center!')
        }
        if (res.nextTurn !== session.myColor) setDice(null)
      }
      applyActionResult(res)
    } catch (e: any) {
      toast.error(e.message ?? 'Illegal move')
      await load()
    } finally {
      setBusy(false)
    }
  }

  const endGame = async () => {
    if (!session) return
    try {
      const res = await api.game.action(matchId, session.id, 'end')
      if (res.gamePost) setGamePost(res.gamePost)
      else onCloseSafe()
    } catch {}
  }

  const ludo = session?.ludoState
  const moves = session?.moves ?? []
  const myTurn = !!session?.isMyTurn && !ludo?.winner
  const rolled = !!ludo?.pendingDice

  // Turn countdown
  const lastActedAt = ludo?.lastActedAt ?? 0
  const [, forceTick] = useState(0)
  useEffect(() => {
    if (!myTurn) return
    const t = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [myTurn])
  const secsLeft = Math.max(0, Math.ceil((TURN_TIMEOUT_MS - (Date.now() - lastActedAt)) / 1000))

  return (
    <motion.div
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      className="absolute inset-0 z-[150] bg-[var(--qk-bg)] text-white flex flex-col"
    >
      <header className="shrink-0 px-4 pt-3 pb-2 flex items-center justify-between border-b border-white/8">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-[var(--qk-purple)]/20 flex items-center justify-center">
            <Dices className="w-5 h-5 text-[var(--qk-purple)]" />
          </div>
          <div>
            <h2 className="font-bold text-base">Ludo</h2>
            <p className="text-xs text-white/50">vs {partnerName ?? 'them'} · room audio coming soon</p>
          </div>
        </div>
        <button onClick={endGame} className="p-2 hover:bg-white/5 rounded-full text-white/50" aria-label="Leave game">
          <DoorOpen className="w-5 h-5" />
        </button>
        <button onClick={onCloseSafe} className="p-2 hover:bg-white/5 rounded-full -ml-4" aria-label="Close">
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
              onClose={onCloseSafe}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 flex flex-col items-center gap-4">
        {/* Scoreboard */}
        <div className="w-full flex items-center justify-around py-2">
          <PlayerChip
            label="You"
            color={session?.myColor ?? 'A'}
            finished={ludo ? ludo.tokens[(session?.myColor ?? 'A') as LudoColor].filter((t) => t === 56).length : 0}
            active={myTurn || ludo?.winner === session?.myColor}
            winner={!!ludo && ludo.winner === (session?.myColor ?? 'A')}
          />
          <span className="text-xs text-white/30 font-semibold">VS</span>
          <PlayerChip
            label={partnerName ?? 'Them'}
            color={(session?.myColor === 'A' ? 'B' : 'A') as LudoColor}
            finished={ludo ? ludo.tokens[(session?.myColor === 'A' ? 'B' : 'A') as LudoColor].filter((t) => t === 56).length : 0}
            active={!session?.isMyTurn && !!(session?.turnColor)}
            winner={!!ludo && ludo.winner === (session?.myColor === 'A' ? 'B' : 'A')}
          />
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
          </div>
        ) : (
          <>
            {/* Board */}
            <div className="relative select-none" style={{ width: BOARD_SIZE, height: BOARD_SIZE }}>
              {/* Ring background */}
              <div className="absolute inset-0 rounded-full bg-white/[0.03] border border-white/10" />
              {/* Safe squares markers */}
              {[0, 8, 26, 34].map((c) => {
                const p = ringPos(c)
                return (
                  <div
                    key={`safe-${c}`}
                    className="absolute w-6 h-6 rounded-lg border border-yellow-400/40 bg-yellow-400/10"
                    style={{ left: p.x - 12, top: p.y - 12 }}
                    title="Safe square"
                  />
                )
              })}
              {/* Track cells */}
              {Array.from({ length: 52 }, (_, c) => {
                const p = ringPos(c)
                const isStart = c === START_OFFSET.A || c === START_OFFSET.B
                const tokensHere: any[] = []
                ;(['A', 'B'] as LudoColor[]).forEach((color) =>
                  (ludo?.tokens[color] ?? []).forEach((t, ti) => {
                    if (t >= 0 && t < 51 && trackCell(color, t) === c) {
                      tokensHere.push(
                        <button
                          key={`${color}-${ti}`}
                          onClick={() => moveToken(ti)}
                          disabled={
                            busy || !rolled || !myTurn ||
                            !(session?.turnColor === color &&
                              moves.some((m) => m.tokenId === ti))
                          }
                          className={cn(
                            'absolute w-5 h-5 rounded-full border-2 shadow-md z-20 transition-transform',
                            myTurn && rolled && session?.turnColor === color && moves.some((m) => m.tokenId === ti)
                              ? 'animate-bounce scale-110 ring-2 ring-white cursor-pointer'
                              : ''
                          )}
                          style={{
                            left: p.x - 10 + (tokensHere.length * 3),
                            top: p.y - 10,
                            backgroundColor: COLORS[color].main,
                            borderColor: '#00000055',
                          }}
                          aria-label={`Move ${COLORS[color].name} token`}
                        />
                      )
                    }
                  })
                )
                return (
                  <div key={`cell-${c}`}>
                    <div
                      className={cn(
                        'absolute w-6 h-6 rounded-lg border',
                        isStart ? 'border-white/60' : 'border-white/15',
                        'bg-white/5'
                      )}
                      style={{ left: p.x - 12, top: p.y - 12 }}
                    />
                    {tokensHere}
                  </div>
                )
              })}
              {/* Home columns + center */}
              {(['A', 'B'] as LudoColor[]).map((color) =>
                Array.from({ length: 5 }, (_, i) => {
                  const p = homeColPos(color, i)
                  return (
                    <div
                      key={`hc-${color}-${i}`}
                      className="absolute w-5 h-5 rounded-md"
                      style={{
                        left: p.x - 10,
                        top: p.y - 10,
                        backgroundColor: `${COLORS[color].main}${i === 4 ? '' : '33'}`,
                        opacity: 0.85,
                      }}
                    />
                  )
                })
              )}
              {/* Finished tokens in center */}
              {(['A', 'B'] as LudoColor[]).map((color) =>
                (ludo?.tokens[color] ?? []).map((t, ti) =>
                  t === 56 ? (
                    <Trophy
                      key={`fin-${color}-${ti}`}
                      className="absolute w-4 h-4 z-10"
                      style={{
                        left:
                          CENTER_R - 14 + ((color === 'A' ? 0 : 1) % 2) * 16 + (ti % 2) * 12,
                        top: CENTER_R - 8 + Math.floor(ti / 2) * 12,
                        color: COLORS[color].main,
                      }}
                    />
                  ) : null
                )
              )}
              {/* Yards */}
              {(['A', 'B'] as LudoColor[]).map((color) =>
                Array.from({ length: 4 }, (_, i) => {
                  const step = ludo?.tokens[color]?.[i] ?? -1
                  if (step !== -1) return null
                  const p = yardPos(color, i)
                  return (
                    <div
                      key={`yard-${color}-${i}`}
                      className="absolute w-5 h-5 rounded-full border-2 z-10"
                      style={{ left: p.x - 10, top: p.y - 10, backgroundColor: COLORS[color].main, borderColor: '#00000044' }}
                    />
                  )
                })
              )}

              {/* Event flash overlay */}
              <AnimatePresence>
                {eventFlash && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className="absolute inset-x-4 top-1/2 -translate-y-1/2 mx-auto text-center py-2.5 px-4 rounded-2xl bg-black/80 backdrop-blur text-sm font-semibold z-30 border border-white/15"
                  >
                    {eventFlash}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Winner banner */}
            {ludo?.winner && (
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="bg-coral-gradient glow-coral rounded-3xl py-4 px-8 text-center font-bold text-lg flex items-center gap-2"
              >
                <Trophy className="w-6 h-6" fill="currentColor" stroke="none" />
                {ludo.winner === session?.myColor ? 'You won!' : `${partnerName ?? 'They'} wins!`}
              </motion.div>
            )}

            {/* Dice + roll controls */}
            {!ludo?.winner && (
              <div className="w-full flex flex-col items-center gap-2 pb-6">
                <button
                  onClick={roll}
                  disabled={!myTurn || rolled || busy}
                  className={cn(
                    'w-16 h-16 rounded-2xl border flex items-center justify-center text-2xl font-black transition-all active:scale-95 disabled:opacity-40',
                    myTurn && !rolled ? 'bg-coral-gradient glow-coral border-transparent' : 'bg-white/5 border-white/15'
                  )}
                  aria-label="Roll dice"
                >
                  {dice ? <DieFace value={dice} /> : <Dices className="w-6 h-6" />}
                </button>
                <p className="text-xs text-white/50">
                  {!session?.isMyTurn
                    ? `Waiting for ${partnerName ?? 'them'}…`
                    : rolled
                      ? `Pick a highlighted token${secsLeft > 0 ? ` · ${secsLeft}s` : ''}`
                      : myTurn
                        ? 'Your turn — roll!'
                        : ''}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  )
}

function DieFace({ value }: { value: number }) {
  const dots: Record<number, [number, number][]> = {
    1: [[1, 1]],
    2: [[0, 0], [2, 2]],
    3: [[0, 0], [1, 1], [2, 2]],
    4: [[0, 0], [0, 2], [2, 0], [2, 2]],
    5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]],
    6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]],
  }
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-0.5 w-10 h-10 p-1.5 bg-white rounded-xl">
      {Array.from({ length: 9 }, (_, i) => {
        const r = Math.floor(i / 3), c = i % 3
        const on = (dots[value] ?? []).some(([dr, dc]) => dr === r && dc === c)
        return <div key={i} className={cn('rounded-full', on ? 'bg-black' : '')} />
      })}
    </div>
  )
}

function PlayerChip({
  label, color, finished, active, winner,
}: {
  label: string; color: 'A' | 'B'; finished: number; active: boolean; winner: boolean
}) {
  return (
    <div
      className={cn(
        'rounded-2xl px-3 py-1.5 flex items-center gap-2 border transition-all',
        active ? 'border-white/40 bg-white/10' : 'border-white/10 bg-white/5'
      )}
    >
      <span className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: COLORS[color].main }} />
      <div className="text-left">
        <p className="text-xs font-semibold truncate max-w-[100px]">{label}{winner ? ' 🏆' : ''}</p>
        <p className="text-[10px] text-white/40">{finished}/4 home</p>
      </div>
    </div>
  )
}
