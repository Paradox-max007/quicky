'use client'

// Quicky — GAME CHAT CONTACTS SCREEN (layout PRD §8/§54)
//
// The DEDICATED Capacitor/mobile contact-list screen:
//
//   Game Room → (Message on a player) → GameChatContactsScreen (HERE)
//             → tap a contact → Personal Game Chat ('game-chat' view)
//             → back → this screen → back → the live Game Room
//
// The room RUNTIME is never touched (§9): state, SSE stream, presence ping
// and heartbeat live in the shared module controller and keep running while
// this screen is up — returning to the table restores it instantly. Shows
// ONLY real Game Chat conversations (§23) plus the §2.1 pinned "Message"
// peer on top.

import { useEffect, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore } from '@/store/game-chat'
import { GameChatContactRow, buildPinnedRow } from './GameChatContactRows'
import { ChatTypeTabs, DatingContactRows, useDatingMatches } from '../game-hub/ChatTypeTabs'

export function GameChatContactsScreen() {
  const list = useGameChatStore((s) => s.list)
  const listLoaded = useGameChatStore((s) => s.listLoaded)
  const refreshList = useGameChatStore((s) => s.refreshList)
  const pinned = useQuickyStore((s) => s.gameChatPinnedPeer)
  const gameChatReturnView = useQuickyStore((s) => s.gameChatReturnView)
  // Game Hub PRD §37/§38: the contacts page hosts BOTH conversation types.
  const [section, setSection] = useState<'game' | 'dating'>('game')
  const [query, setQuery] = useState('')
  const dating = useDatingMatches()

  // Mount-time refresh; the shared SSE stream keeps it fresh afterwards.
  useEffect(() => {
    refreshList()
  }, [refreshList])

  const pinnedRow = buildPinnedRow(pinned, list)

  const back = () => {
    // Mentions PRD §82: back to the game — the runtime re-presents the exact
    // live state. Uses the CONTACTS screen's OWN return view: when the
    // personal chat was opened straight from "Message", gameChatReturnView
    // points back HERE (personal → contacts), so returning further to the
    // room must read gameChatContactsReturnView instead.
    const qk = useQuickyStore.getState()
    qk.pinGameChatPeer(null)
    qk.setView(qk.gameChatContactsReturnView || 'spin-bottle-room')
  }

  const pick = (row: { peer: { id: string; name: string | null; avatar: string | null } }) => {
    // §8: contact → Personal Game Chat (dedicated full-screen page). Back
    // from there returns HERE (openGameChat stores the return view).
    useQuickyStore.getState().openGameChat(
      { peerUserId: row.peer.id, peerName: row.peer.name, peerAvatar: row.peer.avatar },
      'game-chat-contacts'
    )
  }

  // §54: a dating conversation opened from here returns to THIS screen, then
  // its back arrow returns to the live room (§81 back stack).
  const pickDating = (matchId: string) => {
    useQuickyStore.getState().clearUnreadForMatch(matchId)
    useQuickyStore.getState().setActiveMatchId(matchId)
    useQuickyStore.getState().openChat(matchId, 'game-chat-contacts')
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white" data-testid="cap-contacts-screen">
      {/* header (§54): back → the live Game Room. Unified Game Primary PRD
          §13: the screen is presented as "Game Chat" in the game flow. */}
      <header className="shrink-0 safe-area-top px-2 pt-2.5 pb-2 flex items-center gap-2 border-b border-white/10 bg-[var(--qk-bg)]/80 backdrop-blur">
        <button onClick={back} className="p-2 rounded-full hover:bg-white/10" aria-label="Back to game">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <p className="font-black text-sm text-white">Game Chat</p>
      </header>

      {/* §38: Game Chats | Dating Chats tabs on the in-game contacts screen */}
      <div className="shrink-0 px-3 pt-2.5 pb-2 flex flex-col gap-2.5 border-b border-white/10">
        <ChatTypeTabs
          section={section}
          onChange={setSection}
          gameUnread={list.reduce((s2, c) => s2 + (c.unread || 0), 0)}
          datingUnread={dating.matches.reduce((s2, m) => s2 + (m.unreadCount ?? 0), 0)}
        />
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-white/35 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={section === 'game' ? 'Search game chats' : 'Search dating chats'}
            aria-label="Search contacts"
            className="w-full bg-white/5 border border-white/10 rounded-full pl-8 pr-3 py-2 text-xs text-white placeholder:text-white/35 outline-none focus:border-white/25"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {section === 'game' ? (
          listLoaded && list.length === 0 && !pinnedRow ? (
            <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
              <span className="text-3xl" aria-hidden>💬</span>
              <p className="text-white/55 text-xs leading-relaxed">
                No game chats yet — tap a player at the table and hit Message.
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {pinnedRow && <GameChatContactRow row={pinnedRow} onPick={pick} />}
              {(query.trim()
                ? list.filter((c) => (c.peer.name ?? 'player').toLowerCase().includes(query.trim().toLowerCase()))
                : list
              ).map((c) => (
                <GameChatContactRow key={c.conversationId} row={c} onPick={pick} />
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
            searchQuery={query}
          />
        )}
      </div>
    </div>
  )
}
