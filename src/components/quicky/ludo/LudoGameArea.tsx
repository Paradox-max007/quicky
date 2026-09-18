'use client'

// Quicky — LUDO GAME AREA (Ludo PRD §8/§18-§26/§29-§34/§53/§62/§65/§100-§104)
//
// Presentation + animation orchestrator over the shared runtime
// (store/ludo-room.ts). Architecture contract (§53/§113):
//   SERVER transition (snapshot) → THIS component animates it.
//   Animation NEVER determines state — every render snaps back to the
//   authoritative game state and the step-by-step movement is pure display
//   (§18: tokens hop through every square, ~180ms each with ease-out).
//
// Animation source of truth = a diff between the previously displayed
// positions and the new authoritative tokens:
//   · forward-moving token → hop-by-hop path (movement.ts)
//   · tokens that went to the yard → capture FX on landing (§21)
//   · token reaching the center → finish bounce (§26)
//   · game finished → winner celebration overlay (§28)
// Haptics on Capacitor only (§65) through the existing lib/capacitor helpers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Gift } from 'lucide-react'
import { FINISH_STEP } from '@/lib/quicky/ludo/constants'
import { tokenPlacement } from '@/lib/quicky/ludo/board'
import { movementPath } from '@/lib/quicky/ludo/movement'
import { getLegalMoves } from '@/lib/quicky/ludo/rules'
import type { LudoGameState, LudoToken } from '@/lib/quicky/ludo/types'
import type { LudoRoomSnapshot } from '@/lib/quicky/ludo-snapshot'
import { hapticImpact, hapticNotification } from '@/lib/capacitor'
import { LudoBoard, withStackOffsets, type DisplayToken, type YardOwner } from './LudoBoard'
import { LudoPlayerHud } from './LudoPlayerHud'
import { LudoTurnIndicator, type TurnPhase } from './LudoTurnIndicator'
import { LudoCountdown } from './LudoCountdown'
import { LudoGameResult } from './LudoGameResult'

type DisplayEntry = { row: number; col: number; position: number; state: LudoToken['state'] }

function placementFor(t: LudoToken): DisplayEntry {
  const p = tokenPlacement(t.color, t.index, t.position)
  return { row: p.row, col: p.col, position: t.position, state: t.state }
}

function snapshotDisplay(game: LudoGameState): Record<string, DisplayEntry> {
  const map: Record<string, DisplayEntry> = {}
  for (const t of game.tokens) map[t.id] = placementFor(t)
  return map
}

function seatOfColor(c: string): number {
  return ({ red: 0, green: 1, yellow: 2, blue: 3 } as Record<string, number>)[c] ?? 0
}

function statusLine(
  phase: TurnPhase,
  currentName: string | undefined,
  game: LudoGameState | null,
  meId: string
): string | undefined {
  if (phase === 'waiting') return 'Open seat — the game starts with 2 players'
  if (phase === 'my_roll') return 'Your turn — roll the dice'
  if (phase === 'my_move') return 'Your turn — tap a glowing token to move'
  if (phase === 'their_turn') return `${currentName ?? 'Player'}'s turn`
  if (phase === 'finished') return game?.winnerId === meId ? 'You won — GG!' : 'Game finished'
  return undefined
}

export function LudoGameArea({
  snapshot,
  meId,
  onRoll,
  onMove,
  onLeave,
  onOpenGifts,
}: {
  snapshot: LudoRoomSnapshot
  meId: string
  onRoll: () => void
  onMove: (tokenId: string) => void
  onLeave: () => void
  onOpenGifts: () => void
}) {
  const game = snapshot.game
  const [display, setDisplay] = useState<Record<string, DisplayEntry>>({})
  const [fx, setFx] = useState<Record<string, 'none' | 'shake' | 'captured' | 'finished'>>({})
  const [captureChip, setCaptureChip] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [diceRolling, setDiceRolling] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const prevVersionRef = useRef<number>(0)
  const prevDiceRef = useRef<{ value: number | null; rolledBy: string | null }>({ value: null, rolledBy: null })

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])
  useEffect(() => clearTimers, [clearTimers])

  // ── Board sizing (Ludo PRD §9 — measured, never hardcoded): the square
  // board FILLS the measured stage box on every device (§68/§91/§92 — the
  // whole table is the board, edge to edge with a thin breathing margin). ─
  const wrapRef = useRef<HTMLDivElement>(null)
  const [boardPx, setBoardPx] = useState(0)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const size = Math.max(160, Math.floor(Math.min(r.width, r.height)) - 8)
      if (size > 0) setBoardPx(size)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('orientationchange', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('orientationchange', measure)
    }
  }, [])

  // ── Dice animation: MY roll shakes optimistically via onRoll; here we
  // animate OTHER players' fresh rolls (§55 — everyone sees the same anim).
  useEffect(() => {
    if (!game) return
    const prev = prevDiceRef.current
    const changed = game.dice.value !== prev.value || game.dice.rolledBy !== prev.rolledBy
    prevDiceRef.current = { value: game.dice.value, rolledBy: game.dice.rolledBy }
    if (!changed || game.dice.value == null) return
    if (game.dice.rolledBy === meId) return // my roll already animated
    // Deferred (react-hooks v6: no synchronous setState in effect bodies).
    const start = setTimeout(() => setDiceRolling(true), 0)
    const stop = setTimeout(() => setDiceRolling(false), 700)
    timersRef.current.push(start, stop)
    void hapticImpact('light')
    
  }, [game?.dice?.value, game?.dice?.rolledBy])

  // ── Token animation (server transition → client animation, §53) ──────────
  useEffect(() => {
    if (!game) return
    if (prevVersionRef.current === 0 || Object.keys(display).length === 0) {
      // First snapshot for this session — snap, never animate (§93: late
      // joiners see a ready board, never a fake replay).
      prevVersionRef.current = game.version
      const snap = snapshotDisplay(game)
      const t = setTimeout(() => setDisplay(snap), 0)
      timersRef.current.push(t)
      return
    }
    if (prevVersionRef.current === game.version) return
    prevVersionRef.current = game.version
    clearTimers()

    const prevDisplay = display
    const next = snapshotDisplay(game)

    // Mover: the token that advanced along the track/home path.
    let mover: LudoToken | null = null
    let moverFrom = -1
    for (const t of game.tokens) {
      const before = prevDisplay[t.id]
      if (!before) continue
      if (t.position > before.position && t.position <= FINISH_STEP) {
        mover = t
        moverFrom = before.position
        break
      }
    }
    if (!mover) {
      // Deferred snap (react-hooks v6 rule) — state already IS the
      // authority; this only repaints the display layer.
      const t = setTimeout(() => {
        setDisplay(next)
        setFx({})
        setMovingId(null)
        if (game.status === 'playing' && game.currentPlayerId === meId) void hapticImpact('light')
      }, 0)
      timersRef.current.push(t)
      return
    }

    // Captured victims: authoritative yard state vs still-displayed on board.
    const victims = game.tokens.filter((t) => {
      const before = prevDisplay[t.id]
      return t.playerId !== mover!.playerId && t.state === 'yard' && before && before.state !== 'yard'
    })

    const path = movementPath(mover.color, mover.index, moverFrom, mover.position)
    // The coin LIFTS and hops square by square (real board-game feel):
    // the moving flag drives the continuous hop cycle on the token dot.
    const startHop = setTimeout(() => setMovingId(mover!.id), 0)
    timersRef.current.push(startHop)
    path.forEach((placement, i) => {
      const timer = setTimeout(() => {
        setDisplay((d) => ({
          ...d,
          [mover!.id]: {
            row: placement.row,
            col: placement.col,
            position: moverFrom + 1 + i,
            state: i === path.length - 1 ? mover!.state : 'track',
          },
        }))
        if (i < path.length - 1) return
        // Landing — the hop cycle ends with a settle, then impact effects
        setMovingId(null)
        if (victims.length > 0) {
          setFx(Object.fromEntries(victims.map((v) => [v.id, 'captured' as const])))
          setCaptureChip(`⚡ Captured${victims.length > 1 ? ` ×${victims.length}` : ''}!`)
          void hapticImpact('medium')
          const t2 = setTimeout(() => {
            setDisplay((d) => {
              const nd = { ...d }
              for (const v of victims) nd[v.id] = placementFor(v)
              return nd
            })
            setFx({})
            setCaptureChip(null)
          }, 900)
          timersRef.current.push(t2)
        }
        if (mover!.position === FINISH_STEP) {
          setFx((f) => ({ ...f, [mover!.id]: 'finished' }))
          void hapticNotification('success')
          const t3 = setTimeout(() => setFx((f) => ({ ...f, [mover!.id]: 'none' })), 850)
          timersRef.current.push(t3)
        }
      }, i * 180) // TOKEN_STEP_MS (§19: 150-220ms per square)
      timersRef.current.push(timer)
    })
  }, [game?.version])

  // ── Legal moves via the SHARED engine (§85) — token highlighting (§20) ───
  const legal = useMemo(() => {
    if (!game || game.status !== 'playing' || game.currentPlayerId !== meId || game.dice.value == null) return []
    return getLegalMoves(game, meId, game.dice.value)
  }, [game, meId])
  const legalIds = useMemo(() => new Set(legal.map((m) => m.tokenId)), [legal])

  // ── Turn phase (§30/§32) ──────────────────────────────────────────────────
  const roomStatus = snapshot.status
  const phase: TurnPhase = (() => {
    if (!game || game.status === 'finished' || roomStatus === 'CLOSING') return 'finished'
    if (roomStatus === 'STARTING') return 'starting'
    if (game.status !== 'playing') return 'waiting'
    if (game.currentPlayerId === meId) return game.dice.value != null ? 'my_move' : 'my_roll'
    return 'their_turn'
  })()

  const currentPlayer = game?.players.find((p) => p.userId === game.currentPlayerId) ?? null
  const currentColor = currentPlayer?.color ?? null
  const turnColorVar = currentColor ? `var(--ldo-${currentColor})` : null

  // Board display tokens (with stacking, §23)
  const displayTokens: DisplayToken[] = useMemo(() => {
    if (!game) return []
    const raw: DisplayToken[] = game.tokens.map((t) => {
      const d = display[t.id] ?? placementFor(t)
      return {
        id: t.id,
        color: t.color,
        index: t.index,
        row: d.row,
        col: d.col,
        state: d.state,
        selectable: legalIds.has(t.id),
        fx: (fx[t.id] ?? 'none') as DisplayToken['fx'],
        stackIndex: 0,
        stackCount: 1,
        moving: t.id === movingId,
      }
    })
    return withStackOffsets(raw)
  }, [game, display, fx, legalIds, movingId])

  // Corner home-base owner chips (real-board feel: every yard names its
  // player; unclaimed corners honestly say Open Seat).
  const yardOwners: YardOwner[] = useMemo(
    () =>
      snapshot.players.map((p) => ({
        color: p.color as YardOwner['color'],
        name: p.displayName,
        isMe: p.userId === meId,
      })),
    [snapshot.players, meId]
  )

  const onTokenTap = useCallback(
    (tokenId: string) => {
      if (!legalIds.has(tokenId)) {
        // §20 — illegal tap: small shake, no generic error toast.
        setFx((f) => ({ ...f, [tokenId]: 'shake' }))
        const t = setTimeout(() => setFx((f) => ({ ...f, [tokenId]: 'none' })), 340)
        timersRef.current.push(t)
        return
      }
      onMove(tokenId)
    },
    [legalIds, onMove]
  )

  const handleRoll = useCallback(() => {
    if (phase !== 'my_roll') return
    setDiceRolling(true)
    const t = setTimeout(() => setDiceRolling(false), 700)
    timersRef.current.push(t)
    onRoll()
  }, [phase, onRoll])

  const winner =
    game?.status === 'finished' ? game.players.find((p) => p.userId === game.winnerId) ?? null : null

  const startCountdownAt = roomStatus === 'STARTING' && game ? game.startedAt : null

  return (
    <div className="ldo-area">
      <LudoPlayerHud
        players={snapshot.players}
        currentPlayerId={game?.currentPlayerId ?? null}
        meId={meId}
      />

      <div className="sbr-stage" style={{ '--ldo-turn-color': turnColorVar } as React.CSSProperties}>
        <div className="ldo-board-wrap" ref={wrapRef}>
          <div style={{ width: boardPx > 0 ? boardPx : 'min(97%, 560px)' }}>
            <LudoBoard tokens={displayTokens} turnColor={currentColor} onTokenTap={onTokenTap} yardOwners={yardOwners} />
          </div>
        </div>

        {game && game.status === 'playing' && game.players.length < 2 && (
          <div className="ldo-waiting" data-testid="ludo-waiting-pill">
            <b>🎲 Waiting for more players</b>
            <span>The game starts when another player joins</span>
          </div>
        )}
        {!game && (
          <div className="ldo-waiting" data-testid="ludo-preparing">
            <b>🎲 Preparing board…</b>
            <span>Joining the table</span>
          </div>
        )}

        {captureChip && <span className="ldo-capture-chip">{captureChip}</span>}

        {roomStatus === 'STARTING' && (
          <LudoCountdown startCountdownAt={startCountdownAt} serverNow={snapshot.serverNow} />
        )}

        {winner && (
          <LudoGameResult
            winnerName={winner.displayName}
            winnerAvatar={winner.avatar}
            players={
              game?.players.map((p) => ({
                userId: p.userId,
                displayName: p.displayName,
                color: p.color,
                tokensFinished: p.tokensFinished,
                captures: p.captures,
              })) ?? []
            }
            onLeave={onLeave}
          />
        )}
      </div>

      <LudoTurnIndicator
        phase={phase}
        dice={game?.dice.value ?? null}
        rolling={diceRolling}
        currentPlayerName={currentPlayer?.displayName ?? '…'}
        onRoll={handleRoll}
        statusText={statusLine(phase, currentPlayer?.displayName, game, meId)}
      />

      {/* Gift entry (§100 — gifting never pauses the Ludo engine) */}
      <div className="ldo-giftbar">
        <button className="ldo-gift-btn" onClick={onOpenGifts} aria-label="Send a gift">
          <Gift className="h-4 w-4" aria-hidden /> <span>Send a Gift</span>
        </button>
      </div>
    </div>
  )
}
