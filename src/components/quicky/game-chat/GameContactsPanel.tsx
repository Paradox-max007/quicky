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

import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useGameChatStore } from '@/store/game-chat'
import { useQuickyStore } from '@/store/quicky'
import { GameChatContactRow, buildPinnedRow } from './GameChatContactRows'

export function GameContactsPanel() {
  const list = useGameChatStore((s) => s.list)
  const listLoaded = useGameChatStore((s) => s.listLoaded)
  const refreshList = useGameChatStore((s) => s.refreshList)
  const pinned = useQuickyStore((s) => s.gameChatPinnedPeer)
  const setPanel = useQuickyStore((s) => s.setRoomChatPanel)

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
        <p className="font-black text-sm text-white">Game Contacts</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {listLoaded && list.length === 0 && !pinnedRow ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <span className="text-3xl" aria-hidden>💬</span>
            <p className="text-white/55 text-xs leading-relaxed">
              No game chats yet — tap a player at the table and hit Message.
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {pinnedRow && <GameChatContactRow row={pinnedRow} onPick={pick} />}
            {list.map((c) => (
              <GameChatContactRow key={c.conversationId} row={c} onPick={pick} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
