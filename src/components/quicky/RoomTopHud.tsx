'use client'

// RoomTopHud — casual-game status bar: heart/trophy/crown counters + coin
// wallet with a bright green "+". The chip group is exported separately so
// the WEB top bar can render the same economy chips inline (Club Royale
// header) while mobile keeps the classic stacked HUD row.

type ChipsProps = {
  hearts: number
  trophies: number
  crowns: number
  coins: number
  onAddCoins?: () => void
}

export function RoomHudChips({ hearts, trophies, crowns, coins, onAddCoins }: ChipsProps) {
  return (
    <>
      <div className="sbr-tile sbr-tile-heart" title="Hearts won">
        <span className="sbr-tile-icon">❤️</span>
        <span className="tabular-nums">{hearts}</span>
      </div>
      <div className="sbr-tile sbr-tile-trophy hidden min-[380px]:flex" title="Trophies">
        <span className="sbr-tile-icon">🏆</span>
        <span className="tabular-nums">{trophies}</span>
      </div>
      <div className="sbr-tile sbr-tile-crown hidden min-[430px]:flex" title="Crowns">
        <span className="sbr-tile-icon">👑</span>
        <span className="tabular-nums">{crowns}</span>
      </div>

      <button className="sbr-coin-btn" onClick={onAddCoins} aria-label="Coin balance">
        <span className="sbr-tile-icon">🪙</span>
        <span className="tabular-nums">{coins.toLocaleString('en-US')}</span>
        <span className="sbr-plus" aria-hidden>＋</span>
      </button>
    </>
  )
}

type Props = ChipsProps & {
  onBack: () => void
}

export function RoomTopHud({ hearts, trophies, crowns, coins, onBack, onAddCoins }: Props) {
  return (
    <div className="sbr-hud safe-area-top">
      <button className="sbr-round-btn" onClick={onBack} aria-label="Leave room">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>

      <div className="sbr-hud-chips">
        <RoomHudChips hearts={hearts} trophies={trophies} crowns={crowns} coins={coins} onAddCoins={onAddCoins} />
      </div>
    </div>
  )
}
