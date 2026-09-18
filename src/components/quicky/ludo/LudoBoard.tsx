'use client'

// Quicky — LUDO BOARD (Ludo PRD §8/§9/§10/§22/§23 — REVISED: full-table
// real-world board)
//
// The classic four-home 15×15 board rendered from the shared geometry
// engine (ludo/board.ts). The board FILLS the wooden table (aspect-ratio
// 1/1, sized from the measured stage — never a hardcoded px):
//   · each player's HOME BASE sits in its own CORNER of the table
//     (colored base, inner plate, 4 circular token pads, owner chip)
//   · the shared PATH is laid through the table as the classic cross:
//     52 ring cells + 4 colored home columns + the center finish triangle
//   · start cells carry a direction chevron, safe cells a star, the center
//     is four colored triangles pointing at the middle
// Tokens are children of the board so their left/top percentages share the
// exact coordinate space; a `moving` token plays a continuous hop so coins
// physically lift off the board while they travel square by square.

import { memo, useMemo } from 'react'
import {
  RING,
  YARD_ORIGIN,
  YARD_SLOTS,
  cellStartColor,
} from '@/lib/quicky/ludo/board'
import {
  BOARD_SIZE,
  SAFE_RING_CELLS,
  START_OFFSET,
  isSafeRingCell,
} from '@/lib/quicky/ludo/constants'
import type { LudoColor, LudoToken } from '@/lib/quicky/ludo/types'

const pct = (n: number) => `${(n / BOARD_SIZE) * 100}%`

const COLOR_VARS: Record<LudoColor, { main: string; light: string; dark: string }> = {
  red: { main: 'var(--ldo-red)', light: '#fda4af', dark: 'var(--ldo-red-dark)' },
  green: { main: 'var(--ldo-green)', light: '#6ee7b7', dark: 'var(--ldo-green-dark)' },
  yellow: { main: 'var(--ldo-yellow)', light: '#fcd34d', dark: 'var(--ldo-yellow-dark)' },
  blue: { main: 'var(--ldo-blue)', light: '#7dd3fc', dark: 'var(--ldo-blue-dark)' },
}

// Travel direction of each color's path (start-cell chevron rotation):
// red moves right, green moves down, yellow moves left, blue moves up.
const ARROW_DEG: Record<LudoColor, string> = {
  red: '0deg',
  green: '90deg',
  yellow: '180deg',
  blue: '270deg',
}

// Center finish triangles (top/bottom/left/right edge → middle).
const CENTER_TRIS: { tri: string; color: LudoColor }[] = [
  { tri: 'polygon(0 0, 100% 0, 50% 50%)', color: 'green' },
  { tri: 'polygon(100% 0, 100% 100%, 50% 50%)', color: 'yellow' },
  { tri: 'polygon(0 100%, 100% 100%, 50% 50%)', color: 'blue' },
  { tri: 'polygon(0 0, 0 100%, 50% 50%)', color: 'red' },
]

/** Which OUTER corner of the yard block the avatar sits in. */
function yardCorner(o: { row: number; col: number }): 'tl' | 'tr' | 'bl' | 'br' {
  const v = o.row === 0 ? 't' : 'b'
  const h = o.col === 0 ? 'l' : 'r'
  return `${v}${h}` as 'tl' | 'tr' | 'bl' | 'br'
}

export type DisplayToken = {
  id: string
  color: LudoColor
  index: number
  /** Fractional {row,col} display position (yard slots / ring / home / center). */
  row: number
  col: number
  selectable: boolean
  state: LudoToken['state']
  fx: 'none' | 'shake' | 'captured' | 'finished'
  stackIndex: number
  stackCount: number
  /** True while the token is mid path-animation — plays the hop cycle. */
  moving?: boolean
}

export type YardOwner = {
  color: LudoColor
  name: string
  isMe: boolean
  /** Toolbox wiring — a user id on ANY surface opens the shared toolbox. */
  userId?: string | null
  avatar?: string | null
}

type Props = {
  tokens: DisplayToken[]
  turnColor: LudoColor | null
  onTokenTap: (tokenId: string) => void
  /** Corner-base owner chips (player names / Open Seat). */
  yardOwners?: YardOwner[]
  /** §38 REVISED — tap a player's yard avatar → the SHARED player toolbox
   * (mention / chat / gift / add friend / profile). Game-agnostic: the
   * board only reports the userId, the room opens the toolbox. */
  onPlayerTap?: (owner: YardOwner, el: HTMLElement | null) => void
}

function BoardCells({
  yardOwners,
  onPlayerTap,
  turnColor,
}: {
  yardOwners: YardOwner[]
  onPlayerTap?: (owner: YardOwner, el: HTMLElement | null) => void
  turnColor: LudoColor | null
}) {
  const cells = useMemo(() => {
    const out: React.ReactNode[] = []
    const ownerByColor = new Map(yardOwners.map((o) => [o.color, o]))
    // 1) yard corner HOME BASES
    for (const color of Object.keys(YARD_ORIGIN) as LudoColor[]) {
      const o = YARD_ORIGIN[color]
      const owner = ownerByColor.get(color)
      out.push(
        <div
          key={`yard-${color}`}
          className="ldo-yard"
          style={
            {
              left: pct(o.col),
              top: pct(o.row),
              width: pct(6),
              height: pct(6),
              '--yard-color': COLOR_VARS[color].main,
            } as React.CSSProperties
          }
        >
          <div className="ldo-yard-inner">
            {YARD_SLOTS.map((slot, i) => (
              <span
                key={i}
                className="ldo-yard-pad"
                style={{ left: `${(slot.col / 6) * 100}%`, top: `${(slot.row / 6) * 100}%` }}
                aria-hidden
              />
            ))}
          </div>
          {/* §38 REVISED — the player's PROFILE PICTURE lives IN their yard
              corner (mobile drops the chip row above the board to give the
              table the full stage). Tapping it opens the SHARED toolbox. */}
          {owner?.userId && (
            <button
              className={`ldo-yard-avatar ldo-ya-${yardCorner(o)}${turnColor === color ? ' ldo-ya-active' : ''}${owner.isMe ? ' ldo-ya-me' : ''}`}
              style={{ '--yard-color': COLOR_VARS[color].main } as React.CSSProperties}
              onClick={(e) => onPlayerTap?.(owner, e.currentTarget)}
              aria-label={`${owner.name} — open player menu`}
              data-testid={`ludo-yard-avatar-${color}`}
            >
              {owner.avatar ? (
                <img src={owner.avatar} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span>{(owner.name || '?').slice(0, 1).toUpperCase()}</span>
              )}
              {turnColor === color && <i className="ldo-ya-clock" aria-hidden />}
            </button>
          )}
          <span className={`ldo-yard-owner${owner?.isMe ? ' ldo-owner-me' : ''}`}>
            {owner?.name ?? 'Open Seat'}
          </span>
        </div>
      )
    }
    // 2) ring cells
    RING.forEach((cell, idx) => {
      const startColor = cellStartColor(cell.row, cell.col)
      const safe = SAFE_RING_CELLS.includes(idx)
      out.push(
        <div
          key={`ring-${idx}`}
          className={`ldo-cell ldo-cell-track${startColor ? ' ldo-cell-start' : ''}${safe && !startColor ? ' ldo-cell-safe' : ''}`}
          style={
            {
              left: pct(cell.col),
              top: pct(cell.row),
              width: pct(1),
              height: pct(1),
              ...(startColor ? { '--cell-color': COLOR_VARS[startColor].main, '--ldo-arr': ARROW_DEG[startColor] } : {}),
            } as React.CSSProperties
          }
        />
      )
    })
    // 3) home paths — colored columns leading to the center
    for (const color of Object.keys(START_OFFSET) as LudoColor[]) {
      const path = HOME_PATH_CELLS[color]
      path.forEach((cell, i) => {
        out.push(
          <div
            key={`home-${color}-${i}`}
            className="ldo-cell ldo-cell-home"
            style={
              {
                left: pct(cell.col),
                top: pct(cell.row),
                width: pct(1),
                height: pct(1),
                '--cell-color': COLOR_VARS[color].main,
                '--ldo-arr': ARROW_DEG[color],
              } as React.CSSProperties
            }
          />
        )
      })
    }
    // 4) center finish — four colored triangles pointing at the middle
    out.push(
      <div key="center" className="ldo-center">
        {CENTER_TRIS.map(({ tri, color }) => (
          <span
            key={tri}
            className="ldo-center-tri"
            style={{ '--tri': tri, '--tri-color': COLOR_VARS[color].main } as React.CSSProperties}
          />
        ))}
      </div>
    )
    return out
  }, [yardOwners, onPlayerTap, turnColor])
  return <>{cells}</>
}

// Imported lazily to keep the memo above tidy
import { HOME_PATHS } from '@/lib/quicky/ludo/board'
const HOME_PATH_CELLS = HOME_PATHS

export const LudoBoard = memo(function LudoBoard({ tokens, turnColor, onTokenTap, yardOwners = [], onPlayerTap }: Props) {
  return (
    <div
      className={`ldo-board${turnColor ? ' ldo-turn-pulse' : ''}`}
      style={turnColor ? ({ '--ldo-turn-color': COLOR_VARS[turnColor].main } as React.CSSProperties) : undefined}
      role="grid"
      aria-label="Ludo board"
    >
      <BoardCells yardOwners={yardOwners} onPlayerTap={onPlayerTap} turnColor={turnColor} />
      {tokens.map((t) => {
        const selectable = t.selectable
        const stackCls = t.stackCount > 1 ? ` ldo-stack-${Math.min(t.stackIndex, 3)}` : ''
        const fxCls =
          t.fx === 'shake'
            ? ' ldo-token-shake'
            : t.fx === 'captured'
              ? ' ldo-token-captured'
              : t.fx === 'finished'
                ? ' ldo-token-finished'
                : ''
        const movingCls = t.moving ? ' ldo-token-moving' : ''
        return (
          <button
            key={t.id}
            className={`ldo-token${selectable ? ' ldo-token-selectable' : ''}${stackCls}${fxCls}${movingCls}`}
            style={{
              left: pct(t.col + 0.5),
              top: pct(t.row + 0.5),
              ...(selectable || t.moving ? { zIndex: 9 } : {}),
            }}
            onClick={() => onTokenTap(t.id)}
            aria-label={tokenAria(t)}
            data-testid={`ludo-token-${t.id}`}
          >
            <span
              className="ldo-token-dot"
              style={
                {
                  '--tk-color': COLOR_VARS[t.color].main,
                  '--tk-light': COLOR_VARS[t.color].light,
                  '--tk-dark': COLOR_VARS[t.color].dark,
                } as React.CSSProperties
              }
            />
          </button>
        )
      })}
    </div>
  )
})

function tokenAria(t: DisplayToken): string {
  const colorName = t.color.charAt(0).toUpperCase() + t.color.slice(1)
  if (t.state === 'yard') return `${colorName} token ${t.index + 1}, in yard`
  if (t.state === 'finished') return `${colorName} token ${t.index + 1}, home`
  return `${colorName} token ${t.index + 1}, position ${Math.round(t.row * BOARD_SIZE + t.col)}`
}

/** Utility used by the game area to stack tokens sharing a cell (§23). */
export function withStackOffsets(tokens: DisplayToken[]): DisplayToken[] {
  const byCell = new Map<string, DisplayToken[]>()
  for (const t of tokens) {
    if (t.state === 'yard' || t.state === 'finished') continue
    const key = `${Math.round(t.row * 4)}:${Math.round(t.col * 4)}`
    const list = byCell.get(key) ?? []
    list.push(t)
    byCell.set(key, list)
  }
  for (const list of byCell.values()) {
    if (list.length <= 1) continue
    list.forEach((t, i) => {
      t.stackCount = list.length
      t.stackIndex = i
    })
  }
  return tokens
}

export { COLOR_VARS }
