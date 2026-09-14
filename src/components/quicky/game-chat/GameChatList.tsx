'use client'

// Quicky — GAME CHATS list on the game landing (game-chat PRD §8/§9/§87/§88/§89)
//
// Lives INSIDE the Spin the Bottle section (§8) and is completely separate
// from Dating → Chats (§7). Shows ONLY conversations where a real message
// exists (§9): avatar, name, last-message preview, timestamp, unread badge
// (§87), most-recently-active first (§88). Realtime reorders + unread
// bumps arrive through the shared game-chat stream (§90) — no polling, no
// page refresh.

import { useEffect } from 'react'
import { MessageCircle } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore } from '@/store/game-chat'

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export function GameChatList() {
  const user = useQuickyStore((s) => s.user)
  const setView = useQuickyStore((s) => s.setView)
  const list = useGameChatStore((s) => s.list)
  const listLoaded = useGameChatStore((s) => s.listLoaded)
  const refreshList = useGameChatStore((s) => s.refreshList)

  useEffect(() => {
    refreshList()
  }, [refreshList])

  return (
    <div className="w-full max-w-sm bg-white/5 border border-white/10 rounded-2xl p-4" data-testid="game-chats">
      <div className="flex items-center gap-2 mb-2.5">
        <MessageCircle className="h-4 w-4 text-[var(--qk-accent)]" aria-hidden />
        <p className="text-white font-semibold text-sm">Game Chats</p>
        {list.some((c) => c.unread > 0) && (
          <span className="ml-auto text-[11px] font-bold text-white/70">
            {list.reduce((s, c) => s + c.unread, 0)} new
          </span>
        )}
      </div>

      {listLoaded && list.length === 0 ? (
        <p className="text-white/50 text-xs leading-relaxed">
          No game chats yet — tap a player at the table and say hi 👋
        </p>
      ) : (
        <div className="flex flex-col -mx-1">
          {list.map((c) => (
            <button
              key={c.conversationId}
              data-testid={`game-chat-row-${c.peer.id}`}
              onClick={() => {
                // §97: back from this chat returns to the game landing
                useQuickyStore.getState().openGameChat(
                  { peerUserId: c.peer.id, peerName: c.peer.name, peerAvatar: c.peer.avatar },
                  'spin-bottle'
                )
                setView('game-chat')
              }}
              className="flex items-center gap-3 px-1 py-2 rounded-xl hover:bg-white/5 active:bg-white/10 transition-colors text-left"
            >
              <span className="relative shrink-0">
                {c.peer.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.peer.avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm" aria-hidden>
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
                        c.lastMessage.messageType === 'sticker' ? '🎁 Sticker' : c.lastMessage.preview
                      }`
                    : 'Say hello 👋'}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {user ? null : null}
    </div>
  )
}
