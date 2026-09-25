'use client'

// RoomTopHud — casual-game status bar (v3 PRD §19/§20/§31/§78 + realm PRD
// §71 + crate-pass PRD):
//   ❤️ season points (monthly) · 🏆 current REALM cycle points (tap → realm
//   LEADERBOARD) · 👑 realm LEVEL (tap → the REALM PASS: realm details +
//   crates store) · 🎁 gifts received · 🪙 coins + · 🚪
// The chip group is exported separately so the WEB top bar can render the
// same economy chips inline (Club Royale header) while mobile keeps the
// stacked HUD row.
//
// v3 changes: the LEFT BACK ARROW IS GONE from the room (§31) — the only
// room control is the 🚪 RoomExitControl ("leave / change room", NOT an
// account logout, §32/§33), placed after the coin chip. The coin chip's "+"
// opens the mock coin store (§26-§28).
//
// REALM (realm PRD §71 + crate-pass PRD): the 👑 chip shows the viewer's
// realm LEVEL; tapping opens the REALM PASS (realm details + crates store —
// a screen on mobile web/Capacitor, a centered modal on desktop web). When
// no realm data is provided the chip falls back to the legacy
// premium-crowns counter.
//
// ❤️ = MONTHLY season points (crate-pass PRD) — resets when the season
// rolls over; 🏆 = current realm-cycle points — resets at settlement.

import { DoorOpen } from 'lucide-react'

export type RealmHudData = {
  level: number
  name: string
  points: number
  threshold: number
}

type ChipsProps = {
  /** ❤ MONTHLY season points (crate-pass PRD) — resets when the month rolls. */
  hearts: number
  /** 🏆 current REALM cycle points — resets when the realm cycle settles. */
  trophies: number
  crowns: number
  /** Gifts RECEIVED total (§19/§60). */
  gifts: number
  coins: number
  onAddCoins?: () => void
  /** Realm PRD §71 + crate-pass PRD — live realm status; tap opens the REALM
   *  PASS (realm details + crates store). */
  realm?: RealmHudData | null
  onRealm?: () => void
  /** 🏆 tap → the shared realm LEADERBOARD (the exact same surface the
   *  Games hub trophy opens: full screen on mobile web/Capacitor, left
   *  drawer on desktop web) — works on the game-room screen without
   *  leaving the room. */
  onTrophy?: () => void
}

export function RoomHudChips({ hearts, trophies, crowns, gifts, coins, onAddCoins, realm, onRealm, onTrophy }: ChipsProps) {
  return (
    <>
      <div className="sbr-tile sbr-tile-heart" title="Season points — resets when the monthly season rolls over">
        <span className="sbr-tile-icon">❤️</span>
        <span className="tabular-nums">{hearts}</span>
      </div>
      {onTrophy ? (
        <button
          className="sbr-tile sbr-tile-trophy hidden min-[380px]:flex"
          onClick={onTrophy}
          title="Realm points — tap for the realm leaderboard"
          aria-label={`Realm points: ${trophies} — open realm leaderboard`}
          data-testid="room-trophy-chip"
        >
          <span className="sbr-tile-icon">🏆</span>
          <span className="tabular-nums">{trophies}</span>
        </button>
      ) : (
        <div className="sbr-tile sbr-tile-trophy hidden min-[380px]:flex" title="Realm points">
          <span className="sbr-tile-icon">🏆</span>
          <span className="tabular-nums">{trophies}</span>
        </div>
      )}
      {realm ? (
        <button
          className="sbr-tile sbr-tile-crown"
          onClick={onRealm}
          title={`${realm.name} — tap for the Realm Pass (crates)`}
          aria-label={`Realm ${realm.name} level ${realm.level} — open realm pass`}
          data-testid="realm-hud-chip"
        >
          <span className="sbr-tile-icon">👑</span>
          <span className="tabular-nums">{realm.level}</span>
        </button>
      ) : (
        <div className="sbr-tile sbr-tile-crown hidden min-[430px]:flex" title="Crowns">
          <span className="sbr-tile-icon">👑</span>
          <span className="tabular-nums">{crowns}</span>
        </div>
      )}
      {/* 🎁 Gifts Received — live counter, updates the moment a gift lands (§60) */}
      <div className="sbr-tile sbr-tile-gift hidden min-[400px]:flex" title="Gifts received">
        <span className="sbr-tile-icon">🎁</span>
        <span className="tabular-nums">{gifts}</span>
      </div>

      <button className="sbr-coin-btn" onClick={onAddCoins} aria-label="Coin balance — buy coins">
        <span className="sbr-tile-icon">🪙</span>
        <span className="tabular-nums">{coins.toLocaleString('en-US')}</span>
        <span className="sbr-plus" aria-hidden>＋</span>
      </button>
    </>
  )
}

/** v3 §31-§34 — the room's ONLY control: leave / change room (never logout). */
export function RoomExitControl({ onClick }: { onClick: () => void }) {
  return (
    <button className="sbr-round-btn sbr-exit-btn" onClick={onClick} aria-label="Room options — leave or change room" title="Room options">
      <DoorOpen className="w-4 h-4" />
    </button>
  )
}

type Props = ChipsProps & {
  onRoomOptions: () => void
}

export function RoomTopHud({ hearts, trophies, crowns, gifts, coins, onRoomOptions, onAddCoins, realm, onRealm, onTrophy }: Props) {
  return (
    <div className="sbr-hud safe-area-top">
      {/* §78: no left-side back arrow — chips breathe, controls live on the right */}
      <div className="sbr-hud-chips">
        <RoomHudChips hearts={hearts} trophies={trophies} crowns={crowns} gifts={gifts} coins={coins} onAddCoins={onAddCoins} realm={realm} onRealm={onRealm} onTrophy={onTrophy} />
      </div>
      <RoomExitControl onClick={onRoomOptions} />
    </div>
  )
}
