'use client'

import { useEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'

// RoomChatPanel — social-game style room chat (light feed below the stage).
// Message kinds: 'user' (avatar + colored name + text), 'system' (centered
// pill), 'gift' (pink gift card). Composer: input + emoji tray + gift +
// round orange send, matching the reference screenshot.

export type RoomMessage = {
  id: string
  userId: string
  text: string
  kind: string
  createdAt: string
}

export type ChatPlayer = { userId: string; displayName: string; avatar: string | null }

const NAME_COLORS = ['#f23d7f', '#2f7cf6', '#9b3df0', '#12945d', '#f2801f', '#e02c1c']

function nameColor(userId: string): string {
  let h = 0
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0
  return NAME_COLORS[h % NAME_COLORS.length]
}

const EMOJIS = ['😄', '😂', '🥰', '😍', '🤔', '😅', '🙌', '👏', '🔥', '💔', '💋', '🍾', '🎉', '👀', '😎', '🤩', '😇', '🤣']

export function RoomChatPanel({
  messages,
  players,
  meId,
  onSend,
  sending,
}: {
  messages: RoomMessage[]
  players: ChatPlayer[]
  meId: string
  onSend: (text: string) => Promise<void>
  sending: boolean
}) {
  const [text, setText] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll to newest message
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const playerFor = (userId: string) => players.find((p) => p.userId === userId)

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setText('')
    setEmojiOpen(false)
    await onSend(t)
  }

  return (
    <div className="sbr-chat">
      <div ref={scrollRef} className="sbr-chat-scroll no-scrollbar">
        {messages.length === 0 ? (
          <div className="sbr-chat-empty">
            <span style={{ fontSize: 26 }}>👋</span>
            <span>No messages yet — break the ice!</span>
          </div>
        ) : (
          messages.map((m) => {
            if (m.kind === 'system') {
              return (
                <div key={m.id} className="sbr-msg-system">
                  {m.text}
                </div>
              )
            }
            if (m.kind === 'gift') {
              return (
                <div key={m.id} className="sbr-msg">
                  <GiftAvatar player={playerFor(m.userId)} />
                  <div className="sbr-msg-body sbr-msg-gift">
                    <span className="sbr-msg-gift-emoji" aria-hidden>🎁</span>
                    <div>
                      <p className="sbr-msg-name" style={{ color: nameColor(m.userId) }}>
                        {m.userId === meId ? 'You' : playerFor(m.userId)?.displayName ?? 'Someone'}
                      </p>
                      <p className="sbr-msg-text">{m.text}</p>
                    </div>
                  </div>
                </div>
              )
            }
            const isMe = m.userId === meId
            const p = playerFor(m.userId)
            return (
              <div key={m.id} className={`sbr-msg ${isMe ? 'me' : ''}`}>
                <GiftAvatar player={p} me={isMe} />
                <div className="sbr-msg-body">
                  {!isMe && (
                    <p className="sbr-msg-name" style={{ color: nameColor(m.userId) }}>
                      {p?.displayName ?? 'Guest'}
                    </p>
                  )}
                  <p className="sbr-msg-text">{m.text}</p>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="sbr-composer">
        {emojiOpen && (
          <div className="sbr-emoji-tray">
            {EMOJIS.map((e) => (
              <button key={e} onClick={() => setText((t) => t + e)} aria-label={`Insert ${e}`}>
                {e}
              </button>
            ))}
          </div>
        )}
        <button
          className="sbr-comp-btn"
          onClick={() => setEmojiOpen((v) => !v)}
          aria-label="Emoji"
        >
          😊
        </button>
        <input
          className="sbr-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          maxLength={280}
          placeholder="Write a message"
          aria-label="Write a message"
        />
        <button className="sbr-comp-btn" aria-label="Send a gift" title="Gifts coming soon">
          🎁
        </button>
        <button className="sbr-send" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
          <Send size={17} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

function GiftAvatar({ player, me = false }: { player?: ChatPlayer; me?: boolean }) {
  const initial = me ? 'You' : (player?.displayName ?? '?').trim().slice(0, 1).toUpperCase()
  if (player?.avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="sbr-msg-avatar" src={player.avatar} alt="" draggable={false} />
    )
  }
  return <span className="sbr-msg-avatar">{initial}</span>
}
