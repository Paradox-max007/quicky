'use client'

// Quicky — GAME CONTACTS PANEL (bug-fix PRD §9/§10/§86/§87)
//
// The WEB room sidebar's middle state: Room Chat → Game Contacts → Personal
// Game Chat. Shows only users with a real private Game Chat conversation
// (§86): avatar, name, last-message preview, timestamp, unread badge —
// realtime reorder/unread through the shared game-chat stream (§87).
//
// Capacitor does NOT use this panel: there the contact list lives on the
// game landing and Message opens the dedicated chat screen (§17).

import { useEffect } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useGameChatStore } from '@/store/game-chat'
import { useQuickyStore } from '@/store/quicky'

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function GameContactsPanel() {
  const list = useGameChatStore((s) => s.list)
  const listLoaded = useGameChatStore((s) => s.listLoaded)
  const refreshList = useGameChatStore((s) => s.refreshList)
  const setPanel = useQuickyStore((s) => s.setRoomChatPanel)

  // Mount-time refresh; the SSE stream keeps it fresh afterwards (§87).
  useEffect(() => {
    refreshList()
  }, [refreshList])

  return (
    <div className="absolute inset-0 z-[5] flex flex-col bg-[#101016]" data-testid="web-contacts-panel">
      {/* header — back returns to the Room Chat state (§11) */}
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
        {listLoaded && list.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-center px-6">
            <span className="text-3xl" aria-hidden>💬</span>
            <p className="text-white/55 text-xs leading-relaxed">
              No game chats yet — tap a player at the table and hit Message.
            </p>
          </div>
        ) : (
          list.map((c) => (
            <button
              key={c.conversationId}
              onClick={() => {
                // §10 state 3: open the personal chat INSIDE the sidebar
                useGameChatStore.getState().openConversation({
                  peerUserId: c.peer.id,
                  peerName: c.peer.name,
                  peerAvatar: c.peer.avatar,
                })
                setPanel('personal')
              }}
              className="w-full flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors text-left"
            >
              <span className="relative shrink-0">
                {c.peer.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.peer.avatar} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <span className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm" aria-hidden>
                    🎲
                  </span>
                )}
                {c.unread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-coral-gradient text-[10px] font-black text-white flex items-center justify-center">
                    {c.unread > 9 ? '9+' : c.unread}
                  </span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-white text-sm font-semibold truncate">{c.peer.name ?? 'Player'}</span>
                  <span className="text-white/40 text-[11px] shrink-0">
                    {c.lastMessageAt ? timeAgo(c.lastMessageAt) : ''}
                  </span>
                </span>
                <span className={`block text-xs truncate ${c.unread > 0 ? 'text-white/80 font-medium' : 'text-white/45'}`}>
                  {c.lastMessage
                    ? `${c.lastMessage.fromMe ? 'You: ' : ''}${
                        c.lastMessage.messageType === 'sticker'
                          ? '🎁 Sticker'
                          : c.lastMessage.messageType === 'image'
                            ? '🖼 Image'
                            : c.lastMessage.messageType === 'voice'
                              ? '🎙 Voice message'
                              : c.lastMessage.messageType === 'quicky_image'
                                ? '⚡ Quicky Image'
                                : c.lastMessage.preview
                      }`
                    : 'Say hello 👋'}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
