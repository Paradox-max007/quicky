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

import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore } from '@/store/game-chat'
import { GameChatContactRow, buildPinnedRow } from './GameChatContactRows'

export function GameChatContactsScreen() {
  const list = useGameChatStore((s) => s.list)
  const listLoaded = useGameChatStore((s) => s.listLoaded)
  const refreshList = useGameChatStore((s) => s.refreshList)
  const pinned = useQuickyStore((s) => s.gameChatPinnedPeer)
  const gameChatReturnView = useQuickyStore((s) => s.gameChatReturnView)

  // Mount-time refresh; the shared SSE stream keeps it fresh afterwards.
  useEffect(() => {
    refreshList()
  }, [refreshList])

  const pinnedRow = buildPinnedRow(pinned, list)

  const back = () => {
    // §9: back to the game — the runtime re-presents the exact live state.
    const qk = useQuickyStore.getState()
    qk.pinGameChatPeer(null)
    qk.setView(qk.gameChatReturnView || 'spin-bottle-room')
  }

  const pick = (row: { peer: { id: string; name: string | null; avatar: string | null } }) => {
    // §8: contact → Personal Game Chat (dedicated full-screen page). Back
    // from there returns HERE (openGameChat stores the return view).
    useQuickyStore.getState().openGameChat(
      { peerUserId: row.peer.id, peerName: row.peer.name, peerAvatar: row.peer.avatar },
      'game-chat-contacts'
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white" data-testid="cap-contacts-screen">
      {/* header (§54): back → the live Game Room */}
      <header className="shrink-0 safe-area-top px-2 pt-2.5 pb-2 flex items-center gap-2 border-b border-white/10 bg-[var(--qk-bg)]/80 backdrop-blur">
        <button onClick={back} className="p-2 rounded-full hover:bg-white/10" aria-label="Back to game">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <p className="font-black text-sm text-white">Game Contacts</p>
      </header>

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
