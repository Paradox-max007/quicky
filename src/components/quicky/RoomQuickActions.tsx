'use client'

// RoomQuickActions — data-driven row of small game icons (missions, gifts,
// VIP, tickets, sale…). Each tile gets a colored "tone" (emerald / amber /
// cyan / rose / purple / pink / orange) exactly like the approved mockups.
// Purely presentational for now; extensible later.

export type QuickAction = {
  id: string
  icon: string
  label: string
  tone: 'emerald' | 'amber' | 'cyan' | 'rose' | 'purple' | 'pink' | 'orange'
  badge?: number | string
  sale?: boolean
}

const ROOM_ACTIONS: QuickAction[] = [
  { id: 'missions', icon: '✅', label: 'Missions', tone: 'emerald', badge: 6 },
  { id: 'gifts', icon: '🎁', label: 'Gifts', tone: 'amber' },
  { id: 'vip', icon: '💎', label: 'VIP', tone: 'cyan' },
  { id: 'tickets', icon: '🎟️', label: 'Tickets', tone: 'rose' },
  { id: 'sale', icon: '🛍️', label: 'Sale', tone: 'purple', sale: true },
  { id: 'rewards', icon: '💖', label: 'Rewards', tone: 'pink' },
  { id: 'inventory', icon: '📦', label: 'Inventory', tone: 'orange' },
]

export function RoomQuickActions({ roomLabel }: { roomLabel: string }) {
  return (
    <div className="sbr-quick no-scrollbar">
      {ROOM_ACTIONS.map((a) => (
        <button
          key={a.id}
          className={`sbr-qa sbr-qa-${a.tone}`}
          aria-label={a.label}
          title={a.label}
          onClick={(e) => e.preventDefault()}
        >
          <span aria-hidden>{a.icon}</span>
          {a.sale ? (
            <span className="sbr-qa-badge sbr-qa-sale">Sale</span>
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
