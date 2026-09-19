'use client'

// Quicky — LUDO GAME AREA (Ludo PRD §8/§14/§18-§26/§29-§34/§38/§44/§53/§62/
// §65/§100-§104 — REVISED: server rolls the dice, floating die, 45s move
// window, yard-avatar players, bigger mobile table)
//
// Presentation + animation orchestrator over the shared runtime
// (store/ludo-room.ts). Architecture contract (§53/§113):
//   SERVER transition (snapshot) → THIS component animates it.
//   Animation NEVER determines state — every render snaps back to the
//   authoritative game state and the step-by-step movement is pure display.
//
// REVISED mechanics (Unified PRD + Ludo PRD + ROUND-4 multiplayer PRD):
//   · §14 REVISED — THE DICE ARE A SERVER ACTION: there is NO roll button.
//     The server throws the dice for every player; this area animates EVERY
//     fresh roll (mine included) identically for the whole table (§55).
//   · ROUND-4 — the dice plays ONE continuous client-side sequence driven
//     by useDiceSequencer (enter → rolling with decelerating faces → settle
//     on the server value → hold → exit), keyed by the authoritative
//     lastRoll.rollId. Every roll is visible — even the ones whose dice is
//     consumed instantly (no legal move / third six) — so a turn can NEVER
//     flip silently on any device (the "player 2 never sees their roll"
//     class of bugs is dead at the root).
//   · ROUND-4 — token movement is GATED behind the dice exit (§18/§22):
//     coins start hopping only after the die has left the table, and coins
//     become selectable only once the value has settled (§43).
//   · The 3D die FLOATS OVER the board while it rolls, settles on the
//     server's number, then FADES AWAY — never parked in a controls bar,
//     exactly like the bottle in Spin the Bottle. The rolled number stays
//     readable in the bottom round-bar hint ("Alex: rolled 6") until the
//     round moves on — mobile keeps the whole stage for the table.
//   · §44 REVISED — 45s visible move window (LudoRoundBar timer). If it
//     expires, the server skips the chance and a small center popup
//     "CHANCE MISSED" (no backdrop) acknowledges it on that player's device.
//   · §38 REVISED — no player chips above the table on mobile: every player
//     is their yard-corner avatar; tapping it opens the SHARED player
//     toolbox (mention / chat / gift / friend / profile). Desktop (lg+)
//     keeps the chip row.
//   · --ldo-cell is scaled from the measured board, so coins, pads, dice
//     and hit targets grow with the table on every device.
// Haptics on Capacitor only (§65) through the existing lib/capacitor helpers.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Gift } from 'lucide-react'
import { CHANCE_MISSED_MS, DICE_EXIT_MS, FINISH_STEP } from '@/lib/quicky/ludo/constants'
import { tokenPlacement } from '@/lib/quicky/ludo/board'
import { movementPath } from '@/lib/quicky/ludo/movement'
import { getLegalMoves } from '@/lib/quicky/ludo/rules'
import type { LudoGameState, LudoToken } from '@/lib/quicky/ludo/types'
import type { LudoRoomSnapshot } from '@/lib/quicky/ludo-snapshot'
import { hapticImpact, hapticNotification } from '@/lib/capacitor'
import { LudoBoard, withStackOffsets, type DisplayToken, type YardOwner } from './LudoBoard'
import { LudoPlayerHud } from './LudoPlayerHud'
import { LudoRoundBar, type TurnPhase } from './LudoRoundBar'
import { LudoCountdown } from './LudoCountdown'
import { LudoGameResult } from './LudoGameResult'
import { LudoDice } from './LudoDice'
import { useDiceSequencer } from './useDiceSequencer'

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

function statusLine(
  phase: TurnPhase,
  currentName: string | undefined,
  game: LudoGameState | null,
  meId: string
): string | undefined {
  if (phase === 'finished') return game?.winnerId === meId ? 'You won — GG!' : 'Game finished'
  return undefined
}

export function LudoGameArea({
  snapshot,
  meId,
  onMove,
  onLeave,
  onOpenGifts,
  onPlayerTap,
}: {
  snapshot: LudoRoomSnapshot
  meId: string
  /** §14 REVISED — no roll action exists; moves only. */
  onMove: (tokenId: string) => void
  onLeave: () => void
  onOpenGifts: () => void
  /** §38 REVISED — yard avatar tapped → the shared player toolbox. */
  onPlayerTap?: (player: { userId: string; displayName: string; avatar?: string | null }, el: HTMLElement | null) => void
}) {
  const game = snapshot.game
  const [display, setDisplay] = useState<Record<string, DisplayEntry>>({})
  const [fx, setFx] = useState<Record<string, 'none' | 'shake' | 'captured' | 'finished'>>({})
  const [captureChip, setCaptureChip] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [chanceMissed, setChanceMissed] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  // ROUND-4 — THE DICE PHASE MACHINE. One sequencer owns the whole visual
  // lifecycle (hidden→entering→rolling→settling→revealed→exiting), deduped
  // by the authoritative lastRoll.rollId — replacing the old booleans
  // (diceRolling/diceVisible) whose independent timers produced the
  // appear/vanish flicker. `freeAtRef` is the moment the die has left the
  // table; the token animation waits for it (§18: no coin moves under a
  // rolling die).
  const dice = useDiceSequencer(game?.lastRoll ?? null, game?.dice?.value != null)
  const prevVersionRef = useRef<number>(0)

  // A light haptic the moment the die ENTERS — every device feels every
  // roll (the sequencer guarantees it fires once per rollId, never twice).
  const hapticPhaseRef = useRef<string>('hidden')
  useEffect(() => {
    if (dice.phase === 'entering' && hapticPhaseRef.current !== 'entering') {
      void hapticImpact('light')
    }
    hapticPhaseRef.current = dice.phase
  }, [dice.phase])

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }, [])
  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout)
    },
    []
  )

  // ── Board sizing (Ludo PRD §9 — measured, never hardcoded): the square
  // board FILLS the measured stage box on every device, and --ldo-cell is
  // DERIVED from the measured size so coins/pads/avatars/dice/hit targets
  // all scale with the table (bigger board on mobile = bigger touch UI). ─
  const wrapRef = useRef<HTMLDivElement>(null)
  const [boardPx, setBoardPx] = useState(0)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const size = Math.max(160, Math.floor(Math.min(r.width, r.height)) - 4)
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

  // ── Token animation (server transition → client animation, §53) ──────────
  // ROUND-4 — EVERY timer below is offset by the dice-exit gate: while the
  // die is still on the table (rolling/settling/holding/leaving) the board
  // holds its breath; coins hop square-by-square only AFTER the sequencer
  // reports the die gone (freeAtRef). Game state itself is never delayed —
  // this is pure presentation sequencing (§25/§41).
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

    // How long until the die has fully left the table (0 when idle).
    const wait = Math.max(0, dice.freeAtRef.current - Date.now())

    // §44 REVISED — a skipped chance: small center popup, NO backdrop, on
    // the missed player's device only. The game has already moved forward.
    if (game.lastEvent?.type === 'turn_skipped' && game.lastEvent.playerId === meId) {
      setChanceMissed(true)
      void hapticNotification('warning')
      const t = setTimeout(() => setChanceMissed(false), CHANCE_MISSED_MS)
      timersRef.current.push(t)
    }

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
      // authority; this only repaints the display layer. Gated behind the
      // dice exit too (a yard-return / reconcile diff must not repaint
      // under a rolling die).
      const t = setTimeout(() => {
        setDisplay(next)
        setFx({})
        setMovingId(null)
        if (game.status === 'playing' && game.currentPlayerId === meId) void hapticImpact('light')
      }, wait)
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
    const startHop = setTimeout(() => setMovingId(mover!.id), wait)
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
      }, wait + i * 180) // TOKEN_STEP_MS (§19/§23: 150-220ms per square)
      timersRef.current.push(timer)
    })
  }, [game?.version])

  // ── Legal moves via the SHARED engine (§85) — token highlighting (§20) ───
  const legal = useMemo(() => {
    if (!game || game.status !== 'playing' || game.currentPlayerId !== meId || game.dice.value == null) return []
    return getLegalMoves(game, meId, game.dice.value)
  }, [game, meId])
  const legalIds = useMemo(() => new Set(legal.map((m) => m.tokenId)), [legal])

  // ROUND-4 (§43) — coins become selectable only once the dice has SETTLED
  // on the server value (or after the die has left the table). The player
  // can SEE what they are moving with — no blind picks under a rolling die.
  const diceSettled = dice.revealed || dice.phase === 'hidden'

  // ROUND-4 — the persistent round-bar hint ("Alex: rolled 6"): derived
  // from the sequencer's settled roll, it survives the die's exit and stays
  // readable until the NEXT roll replaces it (§31 revised).
  const lastRoll = useMemo(() => {
    const h = dice.hint
    if (!h) return null
    const p = game?.players.find((pl) => pl.userId === h.playerId)
    return { name: p?.displayName ?? 'Player', value: h.value, isMe: h.playerId === meId }
  }, [dice.hint, game?.players, meId])

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
        selectable: diceSettled && legalIds.has(t.id),
        fx: (fx[t.id] ?? 'none') as DisplayToken['fx'],
        stackIndex: 0,
        stackCount: 1,
        moving: t.id === movingId,
      }
    })
    return withStackOffsets(raw)
  }, [game, display, fx, legalIds, movingId, diceSettled])

  // Corner home-base owners: the yard carries the player's NAME + PROFILE
  // PICTURE (mobile has no chip row above the table — §38 revised).
  const yardOwners: YardOwner[] = useMemo(
    () =>
      snapshot.players.map((p) => ({
        color: p.color as YardOwner['color'],
        name: p.displayName,
        isMe: p.userId === meId,
        userId: p.userId,
        avatar: p.avatar,
      })),
    [snapshot.players, meId]
  )

  const onTokenTap = useCallback(
    (tokenId: string) => {
      if (!diceSettled || !legalIds.has(tokenId)) {
        // §20 — illegal / too-early tap: the coin shakes (no dead taps, no
        // error toast). The value must be visible before a coin can move.
        setFx((f) => ({ ...f, [tokenId]: 'shake' }))
        const t = setTimeout(() => setFx((f) => ({ ...f, [tokenId]: 'none' })), 340)
        timersRef.current.push(t)
        return
      }
      // §44 REVISED — the moment the coin is tapped it moves: no cooldown,
      // the move resolves to the dice-chosen number immediately (the token
      // ANIMATION itself still waits for the die to leave — above).
      onMove(tokenId)
    },
    [diceSettled, legalIds, onMove]
  )

  const winner =
    game?.status === 'finished' ? game.players.find((p) => p.userId === game.winnerId) ?? null : null

  const startCountdownAt = roomStatus === 'STARTING' && game ? game.startedAt : null

  return (
    <div className="ldo-area">
      {/* Desktop keeps the player chip row; mobile uses the yard avatars */}
      <div className="ldo-hud-slot">
        <LudoPlayerHud
          players={snapshot.players}
          currentPlayerId={game?.currentPlayerId ?? null}
          meId={meId}
          onPlayerTap={onPlayerTap}
        />
      </div>

      <div className="sbr-stage" style={{ '--ldo-turn-color': turnColorVar } as React.CSSProperties}>
        <div className="ldo-board-wrap" ref={wrapRef}>
          <div
            style={
              {
                width: boardPx > 0 ? boardPx : 'min(97%, 560px)',
                '--ldo-cell': boardPx > 0 ? `${boardPx / 15}px` : undefined,
              } as React.CSSProperties
            }
          >
            <LudoBoard
              tokens={displayTokens}
              turnColor={currentColor}
              onTokenTap={onTokenTap}
              yardOwners={yardOwners}
              onPlayerTap={(owner, el) => onPlayerTap?.({ userId: owner.userId ?? '', displayName: owner.name, avatar: owner.avatar }, el)}
            />
          </div>
        </div>

        {/* §14/§31 REVISED + ROUND-4 — the die FLOATS over the board through
            ONE continuous sequence (enter → roll → settle on the server's
            number → hold → exit), driven by the phase machine — never
            display:none jumps (pointer-events none — it can never block a
            coin tap). The rolled number lives on in the round-bar hint.
            The OUTER div is static CSS positioning; the INNER motion.div
            owns the enter/exit tween so the two transforms never fight. */}
        {dice.phase !== 'hidden' && game && (
          <div className="ldo-dice-float" data-testid="ludo-dice-float">
            <motion.div
              initial={{ opacity: 0, scale: 0.78, y: -22 }}
              animate={
                dice.phase === 'exiting'
                  ? { opacity: 0, scale: 0.85, y: 16 }
                  : { opacity: 1, scale: 1, y: 0 }
              }
              transition={
                dice.phase === 'exiting'
                  ? { duration: DICE_EXIT_MS / 1000, ease: 'easeOut' }
                  : { type: 'spring', stiffness: 320, damping: 24 }
              }
            >
              <LudoDice
                phase={dice.phase}
                displayFace={dice.displayFace}
                value={dice.finalValue}
                color={turnColorVar ?? 'var(--qk-accent)'}
              />
            </motion.div>
          </div>
        )}

        {roomStatus === 'WAITING' && (
          <div className="ldo-waiting" data-testid="ludo-waiting-pill">
            <b>
              🎲 Waiting for players — {snapshot.players.length}/{snapshot.maxPlayers} joined
            </b>
            <span>
              {snapshot.maxPlayers === 2
                ? 'The duel starts the moment player 2 joins'
                : 'The table starts when all 4 players are in — chat stays open'}
            </span>
          </div>
        )}
        {!game && (
          <div className="ldo-waiting" data-testid="ludo-preparing">
            <b>🎲 Preparing board…</b>
            <span>Joining the table</span>
          </div>
        )}

        {captureChip && <span className="ldo-capture-chip">{captureChip}</span>}

        {/* §44 REVISED — "CHANCE MISSED": small center popup WITHOUT a
            backdrop; the game keeps moving behind it. */}
        <AnimatePresence>
          {chanceMissed && (
            <motion.div
              className="ldo-missed"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
              data-testid="ludo-chance-missed"
            >
              ⌛ CHANCE MISSED
            </motion.div>
          )}
        </AnimatePresence>

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

      {/* The slim bottom hint: "{name}: rolled 6" + the visible 45s timer.
          On MOBILE this strip is ALSO the room-state surface (waiting text
          lives here instead of over the board). */}
      <LudoRoundBar
        phase={phase}
        lastRoll={lastRoll}
        moveDeadlineAt={game?.moveDeadlineAt ?? null}
        serverSkewMs={snapshot.serverNow ? snapshot.serverNow - Date.now() : 0}
        currentPlayerName={currentPlayer?.displayName ?? '…'}
        statusText={statusLine(phase, currentPlayer?.displayName, game, meId)}
        playersJoined={snapshot.players.length}
        maxPlayers={snapshot.maxPlayers}
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
