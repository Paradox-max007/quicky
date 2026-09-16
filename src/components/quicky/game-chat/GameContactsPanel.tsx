'use client'

// Quicky — GAME CONTACTS PANEL (layout PRD §3/§4/§23)
//
// The WEB room chat panel's middle state: Room Chat → Game Contacts →
// Personal Game Chat — all INSIDE the same right-side chat panel (§2.1),
// with Room Chat mounted underneath (§5) and the table untouched (§74).
// Shows only users with a real private Game Chat conversation (§23) plus
// the §2.1 pinned "Message" peer. Realtime reorder/unread through the
// shared game-chat stream (§36).
//
// Capacitor does NOT use this panel: there Message opens the dedicated
// GameChatContactsScreen (§8).

import { useEffect, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { useGameChatStore } from '@/store/game-chat'
import { useQuickyStore } from '@/store/quicky'
import { GameChatContactRow, buildPinnedRow } from './GameChatContactRows'
import { ChatTypeTabs, DatingContactRows, useDatingMatches } from '../game-hub/ChatTypeTabs'

export function GameContactsPanel() {
  const list = useGameChatStore((s) => s.list)
  const listLoaded = useGameChatStore((s) => s.listLoaded)
  const refreshList = useGameChatStore((s) => s.refreshList)
  const pinned = useQuickyStore((s) => s.gameChatPinnedPeer)
  const setPanel = useQuickyStore((s) => s.setRoomChatPanel)
  // Game Hub PRD §57: the room's chat surface hosts BOTH conversation types;
  // the game itself stays untouched in its game area (§39).
  const [section, setSection] = useState<'game' | 'dating'>('game')
  const [query, setQuery] = useState('')
  const dating = useDatingMatches()

  // Mount-time refresh; the SSE stream keeps it fresh afterwards.
  useEffect(() => {
    refreshList()
  }, [refreshList])

  const pinnedRow = buildPinnedRow(pinned, list)

  const pick = (row: { peer: { id: string; name: string | null; avatar: string | null } }) => {
    // §3 state 3: open the personal chat INSIDE the same panel. Back from
    // there returns to this contact list (§4) — never straight to Room Chat.
    useGameChatStore.getState().openConversation({
      peerUserId: row.peer.id,
      peerName: row.peer.name,
      peerAvatar: row.peer.avatar,
    })
    setPanel('personal')
  }

  // §57: a dating conversation renders inside the SAME designated chat
  // panel (embedded ChatView) — never a floating panel over the table (§39).
  const pickDating = (matchId: string) => {
    useQuickyStore.getState().clearUnreadForMatch(matchId)
    useQuickyStore.getState().setActiveMatchId(matchId)
    setPanel('dating')
  }

  return (
    <div className="h-full w-full flex flex-col bg-[#101016]" data-testid="web-contacts-panel">
      {/* header — back returns to the Room Chat state (§4) */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-3 border-b border-[#232330] bg-[rgba(24,24,32,0.55)]">
        <button
          onClick={() => setPanel('room')}
          className="p-1.5 rounded-full hover:bg-white/10"
          aria-label="Back to room chat"
        >
          <ArrowLeft className="h-4.5 w-4.5" size={18} />
        </button>
        <p className="font-black text-sm text-white">Contacts</p>
      </div>

      {/* §57: Game Chats | Dating Chats inside the room's chat panel */}
      <div className="shrink-0 px-3 pt-2.5 pb-2.5 flex flex-col gap-2.5 border-b border-[#232330]">
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
