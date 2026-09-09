'use client'

// RoomTopHud — casual-game status bar: heart/trophy/crown counters on the
// left, coin wallet + bright green "+" on the right. Wins/crowns are
// placeholders for the future meta-game economy; coins is cosmetic for now.

type Props = {
  hearts: number
  trophies: number
  crowns: number
  coins: number
  onBack: () => void
  onAddCoins?: () => void
}

export function RoomTopHud({ hearts, trophies, crowns, coins, onBack, onAddCoins }: Props) {
  return (
    <div className="sbr-hud safe-area-top">
      <button className="sbr-round-btn" onClick={onBack} aria-label="Leave room">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <div className="sbr-tile" title="Hearts won">
        <span className="sbr-tile-icon">❤️</span>
        <span className="tabular-nums">{hearts}</span>
      </div>
      <div className="sbr-tile" title="Trophies">
        <span className="sbr-tile-icon">🏆</span>
        <span className="tabular-nums">{trophies}</span>
      </div>
      <div className="sbr-tile hidden min-[380px]:flex" title="Crowns">
        <span className="sbr-tile-icon">👑</span>
        <span className="tabular-nums">{crowns}</span>
      </div>

      <div className="ml-auto flex items-center">
        <button className="sbr-coin-btn" onClick={onAddCoins} aria-label="Coin balance">
          <span className="sbr-tile-icon">🪙</span>
          <span className="tabular-nums">{coins.toLocaleString('en-US')}</span>
          <span className="sbr-plus" aria-hidden>＋</span>
        </button>
      </div>
    </div>
  )
}
