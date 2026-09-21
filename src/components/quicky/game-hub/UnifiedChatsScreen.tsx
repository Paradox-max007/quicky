'use client'

// Quicky — UNIFIED CHATS SCREEN (Game Hub PRD §28-§33/§38/§50/§51)
//
// The MOBILE Chat Center — one screen, two tabs:
//   ┌─────────────────────────────┐
//   │ ← Chats                     │
//   │ 💬 Game Chats | 💗 Dating   │
//   │ ─────────────────────────── │
//   │ contact rows (per tab)      │
//   └─────────────────────────────┘
// Tap a contact → the conversation opens full-screen (§38) using the SHARED
// conversation components (GameChatScreen / ChatView) — only the data source
// changes between tabs (§34). Back from a conversation returns HERE (§54),
// then the tab bar / hardware back continue navigation.

import { useEffect, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore } from '@/store/game-chat'
import { GameChatContactRow, buildPinnedRow } from '../game-chat/GameChatContactRows'
import { ChatTypeTabs, DatingContactRows, useDatingMatches } from './ChatTypeTabs'

export function UnifiedChatsScreen() {
  const section = useQuickyStore((s) => s.chatsSection)
  const setSection = useQuickyStore((s) => s.setChatsSection)
  const setView = useQuickyStore((s) => s.setView)
  const openChat = useQuickyStore((s) => s.openChat)
  const clearUnreadForMatch = useQuickyStore((s) => s.clearUnreadForMatch)
  const setActiveMatchId = useQuickyStore((s) => s.setActiveMatchId)
  const activeMatchId = useQuickyStore((s) => s.activeMatchId)

  const gameList = useGameChatStore((s) => s.list)
  const gameListLoaded = useGameChatStore((s) => s.listLoaded)
  const gameRefresh = useGameChatStore((s) => s.refreshList)
  const gameUnreadTotal = useGameChatStore((s) =>
    s.list.reduce((sum, c) => sum + (c.unread || 0), 0)
  )
  const pinned = useQuickyStore((s) => s.gameChatPinnedPeer)

  const dating = useDatingMatches()
  const [query, setQuery] = useState('')

  // Mount-time refresh; the shared SSE stream keeps game rows fresh (§36).
  useEffect(() => {
    gameRefresh()
  }, [gameRefresh])

  const pickGame = (row: { peer: { id: string; name: string | null; avatar: string | null } }) => {
    // Conversation opens directly; back returns HERE (§54 main-chats stack).
    useQuickyStore.getState().openGameChat(
      { peerUserId: row.peer.id, peerName: row.peer.name, peerAvatar: row.peer.avatar },
      'chats'
    )
  }

  const pickDating = (matchId: string) => {
    clearUnreadForMatch(matchId)
    setActiveMatchId(matchId)
    // Back from the conversation returns to THIS unified center (§54).
    openChat(matchId, 'chats')
  }

  const pinnedRow = buildPinnedRow(pinned, gameList)
  const q = query.trim().toLowerCase()
  const gameFiltered = q ? gameList.filter((c) => (c.peer.name ?? 'player').toLowerCase().includes(q)) : gameList

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white" data-testid="unified-chats-screen">
      {/* app-safe-top: native shell already sits below the status bar — raw
          env() double-counts it (see globals.css). */}
      <header className="shrink-0 app-safe-top px-3 pt-2.5 pb-2.5 flex flex-col gap-3 border-b border-white/10 bg-[var(--qk-bg)]/80 backdrop-blur">
        <div className="flex items-center gap-2 px-0.5">
          <button onClick={() => setView('discovery')} className="p-2 -ml-2 rounded-full hover:bg-white/10" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <p className="font-black text-lg">Chats</p>
        </div>
        <ChatTypeTabs
          section={section}
          onChange={setSection}
          gameUnread={gameUnreadTotal}
          datingUnread={dating.matches.reduce((s, m) => s + (m.unreadCount ?? 0), 0)}
        />
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-white/35 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={section === 'game' ? 'Search game chats' : 'Search dating chats'}
            aria-label={section === 'game' ? 'Search game chats' : 'Search dating chats'}
            className="w-full bg-white/5 border border-white/10 rounded-full pl-8 pr-3 py-2 text-xs text-white placeholder:text-white/35 outline-none focus:border-white/25"
          />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {section === 'game' ? (
          gameListLoaded && gameList.length === 0 && !pinnedRow ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
              <span className="text-3xl" aria-hidden>💬</span>
              <p className="text-white/55 text-xs leading-relaxed">
                No game chats yet — join a Spin the Bottle table and hit Message on a player.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {pinnedRow && <GameChatContactRow row={pinnedRow} onPick={pickGame} />}
              {gameFiltered.map((c) => (
                <GameChatContactRow key={c.conversationId} row={c} onPick={pickGame} />
              ))}
            </div>
          )
        ) : (
          <DatingContactRows
            matches={dating.matches}
            loading={dating.loading}
            failed={dating.failed}
            onRetry={() => void dating.refresh()}
            onPick={pickDating}
            activeMatchId={activeMatchId}
            searchQuery={query}
          />
        )}
      </div>
    </div>
  )
}
