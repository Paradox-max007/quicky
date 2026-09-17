'use client'

// Quicky — GAME CHAT CONTACTS (Web interaction area) — PRD §22/§23/§52
//
// The contact-list content INSIDE the GameInteractionPanel on web. This is a
// composition of the EXISTING game-chat system (§34/§52): the shared
// game-chat store list (realtime-fresh via the SSE stream), the shared
// GameChatContactRow, and the shared openConversation path. No new chat
// backend, no duplicated unread logic (§47).
//
// Capacitor does NOT use this panel: there the Chat icon opens the dedicated
// GameChatContactsScreen (§12).

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useGameChatStore } from '@/store/game-chat'
import { useQuickyStore } from '@/store/quicky'
import { GameChatContactRow, buildPinnedRow } from '../game-chat/GameChatContactRows'

export function GameChatContacts({ onPick }: { onPick: (row: { peer: { id: string; name: string | null; avatar: string | null } }) => void }) {
  const list = useGameChatStore((s) => s.list)
  const listLoaded = useGameChatStore((s) => s.listLoaded)
  const refreshList = useGameChatStore((s) => s.refreshList)
  const pinned = useQuickyStore((s) => s.gameChatPinnedPeer)
  const [query, setQuery] = useState('')

  // Mount-time refresh; the shared SSE stream keeps it fresh afterwards (§52).
  useEffect(() => {
    refreshList()
  }, [refreshList])

  const pinnedRow = buildPinnedRow(pinned, list)
  const q = query.trim().toLowerCase()
  const filtered = q ? list.filter((c) => (c.peer.name ?? 'player').toLowerCase().includes(q)) : list

  return (
    <div className="h-full w-full flex flex-col min-h-0" data-testid="panel-game-chats">
      {/* Search (§23) */}
      <div className="shrink-0 px-3 pt-2.5 pb-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-white/35 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search game chats"
            aria-label="Search game chats"
            className="w-full bg-white/5 border border-white/10 rounded-full pl-8 pr-3 py-2 text-xs text-white placeholder:text-white/35 outline-none focus:border-white/25"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
        {listLoaded && list.length === 0 && !pinnedRow ? (
          /* §51 empty state */
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <span className="text-3xl" aria-hidden>💬</span>
            <p className="text-white/80 text-sm font-bold">No conversations yet</p>
            <p className="text-white/50 text-xs leading-relaxed">Start chatting with someone from the game.</p>
          </div>
        ) : !listLoaded && list.length === 0 ? (
          /* §50 loading skeleton */
          <div className="flex flex-col gap-2 px-1 pt-1">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 rounded-2xl bg-white/5 px-3 py-3 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-white/10" />
                <div className="flex-1 flex flex-col gap-1.5">
                  <div className="h-3 w-24 rounded bg-white/10" />
                  <div className="h-2.5 w-20 rounded bg-white/5" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col">
            {pinnedRow && <GameChatContactRow row={pinnedRow} onPick={onPick} />}
            {filtered.map((c) => (
              <GameChatContactRow key={c.conversationId} row={c} onPick={onPick} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
