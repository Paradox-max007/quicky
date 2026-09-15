'use client'

// Quicky — GAME CONTACT ROW (layout PRD §23)
//
// One contact-list row shared by the web panel (GameContactsPanel) and the
// Capacitor screen (GameChatContactsScreen): avatar, name, last-message
// preview (typed per §24), relative time, unread badge. Ordering and
// realtime freshness come from the shared game-chat list (§23/§36).
//
// buildPinnedRow() synthesizes the §2.1 "Message" row: Message on a player
// opens the contact list with that player pinned on top even when no
// conversation exists yet (the list itself only shows real conversations).

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export type GameContactRowData = {
  conversationId: string
  peer: { id: string; name: string | null; avatar: string | null }
  lastMessage: { fromMe: boolean; messageType: string; preview: string } | null
  lastMessageAt: string | null
  unread: number
}

/** §2.1: the player just "Message"d — pin them on top of the contact list
 * even when their conversation does not exist server-side yet. */
export function buildPinnedRow(
  pinned: { peerUserId: string; peerName: string | null; peerAvatar: string | null } | null,
  list: GameContactRowData[]
): GameContactRowData | null {
  if (!pinned) return null
  if (list.some((c) => c.peer.id === pinned.peerUserId)) return null
  return {
    conversationId: `pinned_${pinned.peerUserId}`,
    peer: { id: pinned.peerUserId, name: pinned.peerName, avatar: pinned.peerAvatar },
    lastMessage: null,
    lastMessageAt: null,
    unread: 0,
  }
}

function previewLabel(m: NonNullable<GameContactRowData['lastMessage']>): string {
  switch (m.messageType) {
    case 'sticker':
      return '🎁 Sticker'
    case 'image':
      return '🖼 Image'
    case 'voice':
      return '🎙 Voice message'
    case 'quicky_image':
      return '⚡ Quicky Image'
    default:
      return m.preview
  }
}

export function GameChatContactRow({
  row,
  onPick,
  testId,
}: {
  row: GameContactRowData
  onPick: (row: GameContactRowData) => void
  testId?: string
}) {
  return (
    <button
      data-testid={testId ?? `game-chat-row-${row.peer.id}`}
      onClick={() => onPick(row)}
      className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors text-left"
    >
      <span className="relative shrink-0">
        {row.peer.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.peer.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <span className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm" aria-hidden>
            🎲
          </span>
        )}
        {row.unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-coral-gradient text-[10px] font-black text-white flex items-center justify-center">
            {row.unread > 9 ? '9+' : row.unread}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-white text-sm font-semibold truncate">{row.peer.name ?? 'Player'}</span>
          <span className="text-white/40 text-[11px] shrink-0">
            {row.lastMessageAt ? timeAgo(row.lastMessageAt) : ''}
          </span>
        </span>
        <span className={`block text-xs truncate ${row.unread > 0 ? 'text-white/80 font-medium' : 'text-white/45'}`}>
          {row.lastMessage
            ? `${row.lastMessage.fromMe ? 'You: ' : ''}${previewLabel(row.lastMessage)}`
            : 'Say hello 👋'}
        </span>
      </span>
    </button>
  )
}
