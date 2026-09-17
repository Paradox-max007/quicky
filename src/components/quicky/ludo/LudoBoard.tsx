'use client'

// Quicky — LUDO BOARD (Ludo PRD §8/§9/§10/§22/§23)
//
// The classic four-home 15×15 board rendered from the shared geometry
// engine (ludo/board.ts). Responsive by construction: the container keeps
// aspect-ratio 1/1 and every cell is positioned in % of the grid — the
// board never overflows and scales from 320px phones to 2560px desktops
// (§68/§91/§92). Tokens are children of the board so their left/top
// percentages share the exact coordinate space.

import { memo, useMemo } from 'react'
import {
  RING,
  YARD_ORIGIN,
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
}

type Props = {
  tokens: DisplayToken[]
  turnColor: LudoColor | null
  onTokenTap: (tokenId: string) => void
}

function BoardCells() {
  const cells = useMemo(() => {
    const out: React.ReactNode[] = []
    // 1) yard blocks
    for (const color of Object.keys(YARD_ORIGIN) as LudoColor[]) {
      const o = YARD_ORIGIN[color]
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
          <div className="ldo-yard-inner" />
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
              ...(startColor ? { '--cell-color': COLOR_VARS[startColor].main } : {}),
            } as React.CSSProperties
          }
        />
      )
    })
    // 3) home paths
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
              } as React.CSSProperties
            }
          />
        )
      })
    }
    // 4) center finish diamond
    out.push(<div key="center" className="ldo-center" />)
    return out
  }, [])
  return <>{cells}</>
}

// Imported lazily to keep the memo above tidy
import { HOME_PATHS } from '@/lib/quicky/ludo/board'
const HOME_PATH_CELLS = HOME_PATHS

export const LudoBoard = memo(function LudoBoard({ tokens, turnColor, onTokenTap }: Props) {
  return (
    <div
      className={`ldo-board${turnColor ? ' ldo-turn-pulse' : ''}`}
      style={turnColor ? ({ '--ldo-turn-color': COLOR_VARS[turnColor].main } as React.CSSProperties) : undefined}
      role="grid"
      aria-label="Ludo board"
    >
      <BoardCells />
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
        return (
          <button
            key={t.id}
            className={`ldo-token${selectable ? ' ldo-token-selectable' : ''}${stackCls}${fxCls}`}
            style={{
              left: pct(t.col + 0.5),
              top: pct(t.row + 0.5),
              ...(selectable ? { zIndex: 9 } : {}),
            }}
            onClick={selectable ? () => onTokenTap(t.id) : undefined}
            disabled={!selectable}
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
