'use client'

// RoomQuickActions — data-driven row of small game icons under the HUD
// (missions, gifts, VIP, tickets, sale…). Purely presentational for now;
// each item can carry a badge or a SALE flag and is extensible later.

export type QuickAction = {
  id: string
  icon: string
  label: string
  badge?: number | string
  sale?: boolean
}

const ROOM_ACTIONS: QuickAction[] = [
  { id: 'missions', icon: '✅', label: 'Missions', badge: 6 },
  { id: 'gifts', icon: '🎁', label: 'Gifts' },
  { id: 'vip', icon: '💎', label: 'VIP' },
  { id: 'tickets', icon: '🎟️', label: 'Tickets' },
  { id: 'sale', icon: '🛍️', label: 'Sale', sale: true },
  { id: 'rewards', icon: '💗', label: 'Rewards' },
  { id: 'inventory', icon: '📦', label: 'Inventory' },
]

export function RoomQuickActions({ roomLabel }: { roomLabel: string }) {
  return (
    <div className="sbr-quick no-scrollbar">
      {ROOM_ACTIONS.map((a) => (
        <button
          key={a.id}
          className="sbr-qa"
          aria-label={a.label}
          title={a.label}
          onClick={(e) => e.preventDefault()}
        >
          <span aria-hidden>{a.icon}</span>
          {a.sale ? (
            <span className="sbr-qa-badge sbr-qa-sale">SALE</span>
          ) : a.badge !== undefined ? (
            <span className="sbr-qa-badge">{a.badge}</span>
          ) : null}
        </button>
      ))}
      <div className="sbr-table-pill">
        <span>🍺</span>
        <span>{roomLabel}</span>
      </div>
    </div>
  )
}
