'use client'

// RoomTopHud — casual-game status bar (v3 PRD §19/§20/§31/§78 + realm PRD §71):
//   ❤️ kisses · 🏆 games (tap → realm LEADERBOARD, same surface as the
//   Games hub trophy) · 👑 REALM (tap → shared Realm view) · 🎁 gifts
//   received · 🪙 coins + · 🚪
// The chip group is exported separately so the WEB top bar can render the
// same economy chips inline (Club Royale header) while mobile keeps the
// stacked HUD row.
//
// v3 changes: the LEFT BACK ARROW IS GONE from the room (§31) — the only
// room control is the 🚪 RoomExitControl ("leave / change room", NOT an
// account logout, §32/§33), placed after the coin chip. The coin chip's "+"
// opens the mock coin store (§26-§28).
//
// REALM (realm PRD §71): the 👑 chip shows the viewer's persistent realm
// level + live cycle points; tapping opens the shared Realm/progression
// sheet (never a game-specific page). When no realm data is provided the
// chip falls back to the legacy premium-crowns counter.

import { DoorOpen } from 'lucide-react'

export type RealmHudData = {
  level: number
  name: string
  points: number
  threshold: number
}

type ChipsProps = {
  /** My Kiss Points — updates instantly when a qualifying kiss lands (§21-§25). */
  hearts: number
  trophies: number
  crowns: number
  /** Gifts RECEIVED total (§19/§60). */
  gifts: number
  coins: number
  onAddCoins?: () => void
  /** Realm PRD §71 — live realm status; tap opens the shared Realm view. */
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
      <div className="sbr-tile sbr-tile-heart" title="Game Points">
        <span className="sbr-tile-icon">❤️</span>
        <span className="tabular-nums">{hearts}</span>
      </div>
      {onTrophy ? (
        <button
          className="sbr-tile sbr-tile-trophy hidden min-[380px]:flex"
          onClick={onTrophy}
          title="Games played — tap for the realm leaderboard"
          aria-label={`Games played: ${trophies} — open realm leaderboard`}
          data-testid="room-trophy-chip"
        >
          <span className="sbr-tile-icon">🏆</span>
          <span className="tabular-nums">{trophies}</span>
        </button>
      ) : (
        <div className="sbr-tile sbr-tile-trophy hidden min-[380px]:flex" title="Games played">
          <span className="sbr-tile-icon">🏆</span>
          <span className="tabular-nums">{trophies}</span>
        </div>
      )}
      {realm ? (
        <button
          className="sbr-tile sbr-tile-crown"
          onClick={onRealm}
          title={`${realm.name} · ${realm.points.toLocaleString()} / ${realm.threshold.toLocaleString()} points`}
          aria-label={`Realm ${realm.name} — open realm details`}
          data-testid="realm-hud-chip"
        >
          <span className="sbr-tile-icon">👑</span>
          <span className="tabular-nums">{realm.points.toLocaleString('en-US')}</span>
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
