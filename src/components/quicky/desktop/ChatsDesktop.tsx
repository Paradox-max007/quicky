'use client'

// Quicky — DESKTOP CHATS PAGE (Web Premium PRD §8-§18/§55/§57/§66-§68)
//
// The web Game Chat behaves like WhatsApp Web: a persistent contact list on
// the left, the selected conversation filling the whole right pane. One
// shell hosts BOTH chat domains (§66 — no competing experiences):
//   · Game tab — private player chats from the Spin the Bottle section
//   · Dating tab — the matches conversations (ChatView embedded)
// The conversation pane is a strict three-row layout (§11): header / message
// viewport (flex-1) / composer — the pane NEVER scrolls as a page (§48/§68).

import { useEffect, useMemo, useState } from 'react'
import { Crown, BadgeCheck, Flame, MessageCircle, Search, Dices } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore, MatchPreview } from '@/store/quicky'
import { useGameChatStore } from '@/store/game-chat'
import { GameChatContactRow, buildPinnedRow } from '../game-chat/GameChatContactRows'
import { GameChatScreen } from '../game-chat/GameChatScreen'
import { ChatView } from '../ChatView'
import { cn } from '@/lib/utils'
import { timeAgo } from './useDashboard'
import { SkeletonBlock, ErrorState, EmptyState } from './web-ui'

function GameContactsPane({ query }: { query: string }) {
  const list = useGameChatStore((s) => s.list)
  const listLoaded = useGameChatStore((s) => s.listLoaded)
  const listLoading = useGameChatStore((s) => s.listLoading)
  const refreshList = useGameChatStore((s) => s.refreshList)
  const activePeer = useGameChatStore((s) => s.activePeer)
  const openConversation = useGameChatStore((s) => s.openConversation)
  const pinned = useQuickyStore((s) => s.gameChatPinnedPeer)

  useEffect(() => {
    refreshList()
  }, [refreshList])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? list.filter((c) => (c.peer.name ?? 'player').toLowerCase().includes(q))
    : list

  // §67: selectedContactId — the pinned "Message" peer counts as selected too
  const pinnedRow = buildPinnedRow(pinned, filtered)

  const pick = (row: { peer: { id: string; name: string | null; avatar: string | null } }) => {
    openConversation({
      peerUserId: row.peer.id,
      peerName: row.peer.name,
      peerAvatar: row.peer.avatar,
    })
  }

  if (!listLoaded && listLoading) {
    return (
      <div className="flex flex-col gap-3 px-2 pt-2" data-testid="chats-game-skeleton">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonBlock className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <SkeletonBlock className="h-3.5 w-1/2" />
              <SkeletonBlock className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!listLoaded && !listLoading) {
    // §55: chat-specific error handling — the rest of the app stays usable
    return (
      <ErrorState
        title="Unable to load conversations."
        body="Check your connection and try again."
        onRetry={() => refreshList()}
        testId="chats-game-error"
      />
    )
  }

  if (filtered.length === 0 && !pinnedRow) {
    return (
      <EmptyState
        icon={<span className="text-3xl" aria-hidden>💬</span>}
        title={q ? 'No matches' : 'No game chats yet'}
        body={
          q
            ? 'Nobody in your game chats matches that search.'
            : 'Join a Spin the Bottle table and hit Message on a player to start one.'
        }
      />
    )
  }

  return (
    <div className="flex flex-col">
      {pinnedRow && <GameChatContactRow row={pinnedRow} onPick={pick} />}
      {filtered.map((c) => (
        <div key={c.conversationId} data-active={activePeer?.peerUserId === c.peer.id}>
          <GameChatContactRow row={c} onPick={pick} />
        </div>
      ))}
    </div>
  )
}

function DatingPane() {
  const setActiveMatchId = useQuickyStore((s) => s.setActiveMatchId)
  const clearUnreadForMatch = useQuickyStore((s) => s.clearUnreadForMatch)
  const unreadByMatch = useQuickyStore((s) => s.unreadByMatch)
  const activeMatchId = useQuickyStore((s) => s.activeMatchId)
  const [matches, setMatches] = useState<MatchPreview[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const refresh = async () => {
    try {
      const res = await api.matches()
      setMatches(res.matches ?? [])
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const iv = setInterval(() => void refresh(), 8000)
    return () => clearInterval(iv)
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col gap-3 px-2 pt-2" data-testid="chats-dating-skeleton">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <SkeletonBlock className="w-10 h-10 rounded-full shrink-0" />
            <div className="flex-1 flex flex-col gap-1.5">
              <SkeletonBlock className="h-3.5 w-1/2" />
              <SkeletonBlock className="h-3 w-4/5" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (failed && matches.length === 0) {
    return (
      <ErrorState
        title="Unable to load conversations."
        onRetry={() => {
          setLoading(true)
          void refresh()
        }}
        testId="chats-dating-error"
      />
    )
  }

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={<span className="text-3xl" aria-hidden>💌</span>}
        title="No matches yet"
        body="Start swiping in Discover to make a match."
      />
    )
  }

  return (
    <div className="flex flex-col" data-testid="chats-dating-list">
      {matches.map((m) => {
        const badge = unreadByMatch[m.id] ?? m.unreadCount ?? 0
        const active = activeMatchId === m.id
        const online =
          !m.partner.hideOnline &&
          m.partner.lastActiveAt &&
          Date.now() - new Date(m.partner.lastActiveAt).getTime() < 5 * 60 * 1000
        return (
          <button
            key={m.id}
            data-testid={`chats-dating-row-${m.id}`}
            onClick={() => {
              clearUnreadForMatch(m.id)
              setMatches((prev) => prev.map((r) => (r.id === m.id ? { ...r, unreadCount: 0, unread: false } : r)))
              setActiveMatchId(m.id)
            }}
            className={cn(
              'w-full flex items-center gap-3 px-2 py-2.5 rounded-xl text-left transition-colors',
              active ? 'bg-white/8' : 'hover:bg-white/5'
            )}
          >
            <span className="relative shrink-0">
              {m.partner.photo ? (
                <img src={m.partner.photo} alt="" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <span className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-bold">
                  {m.partner.name?.[0] ?? '?'}
                </span>
              )}
              {online && <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[#30D158] border-2 border-[var(--qk-bg)]" />}
              {badge > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-coral-gradient text-[10px] font-black text-white flex items-center justify-center">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="flex items-center gap-1 min-w-0">
                  <span className="text-white text-sm font-semibold truncate">
                    {m.partner.name}, {m.partner.age}
                  </span>
                  {m.partner.isVerified && (
                    <BadgeCheck className="w-3.5 h-3.5 text-[var(--qk-accent)] shrink-0" fill="currentColor" stroke="white" />
                  )}
                  {m.partner.isPremium && (
                    <Crown className="w-3 h-3 text-[var(--qk-gold)] shrink-0" fill="currentColor" stroke="none" />
                  )}
                </span>
                {m.streak > 0 && (
                  <span className="flex items-center gap-0.5 shrink-0 text-[11px] font-semibold text-[#FF9120]">
                    <Flame className="w-3 h-3" fill="currentColor" stroke="none" />
                    {m.streak}
                  </span>
                )}
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className={cn('text-xs truncate', badge > 0 ? 'text-white/85 font-medium' : 'text-white/45')}>
                  {m.preview || 'Say hi 👋'}
                </span>
                <span className="text-white/35 text-[10px] shrink-0">{m.lastMessageAt ? timeAgo(m.lastMessageAt) : ''}</span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ConversationPlaceholder({ kind }: { kind: 'game' | 'dating' }) {
  return (
    <div
      className="flex-1 flex flex-col items-center justify-center text-center px-10 gap-3"
      data-testid={`chats-empty-${kind}`}
    >
      <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/8 flex items-center justify-center">
        <MessageCircle className="w-7 h-7 text-white/25" />
      </div>
      <p className="font-bold text-white/85">Your messages</p>
      <p className="text-sm text-white/45 max-w-[44ch] leading-relaxed">
        {kind === 'game'
          ? 'Pick a contact on the left — or hit Message on a player at the table — and their chat opens right here.'
          : 'Pick a match on the left and the conversation opens right here.'}
      </p>
    </div>
  )
}

export function ChatsDesktop() {
  const section = useQuickyStore((s) => s.chatsSection)
  const setSection = useQuickyStore((s) => s.setChatsSection)
  const activePeer = useGameChatStore((s) => s.activePeer)
  const closeConversation = useGameChatStore((s) => s.closeConversation)
  const activeMatchId = useQuickyStore((s) => s.activeMatchId)
  const setActiveMatchId = useQuickyStore((s) => s.setActiveMatchId)
  const roomId = useQuickyStore((s) => s.spinBottleRoomId)
  const setView = useQuickyStore((s) => s.setView)
  const [query, setQuery] = useState('')

  return (
    <div className="w-full h-full flex bg-[var(--qk-bg)]" data-testid="desktop-chats-page">
      {/* ── Contacts pane (§10) ─────────────────────────────────────────── */}
      <aside className="w-[330px] min-[1440px]:w-[360px] shrink-0 h-full border-r border-white/8 bg-black/15 flex flex-col">
        <div className="shrink-0 px-4 pt-4 pb-3">
          <h1 className="text-xl font-bold tracking-tight">Chats</h1>

          {/* §66/§67: one Chats experience — Game + Dating live here */}
          <div className="mt-3 flex gap-1 bg-white/5 rounded-full p-1" role="tablist" aria-label="Chat lists">
            <button
              role="tab"
              aria-selected={section === 'game'}
              onClick={() => setSection('game')}
              className={cn(
                'flex-1 rounded-full py-1.5 text-xs font-semibold transition-all',
                section === 'game' ? 'bg-coral-gradient text-white' : 'text-white/55 hover:text-white/80'
              )}
              data-testid="chats-tab-game"
            >
              Game Chats
            </button>
            <button
              role="tab"
              aria-selected={section === 'dating'}
              onClick={() => setSection('dating')}
              className={cn(
                'flex-1 rounded-full py-1.5 text-xs font-semibold transition-all',
                section === 'dating' ? 'bg-coral-gradient text-white' : 'text-white/55 hover:text-white/80'
              )}
              data-testid="chats-tab-dating"
            >
              Dating Chats
            </button>
          </div>

          {section === 'game' && (
            <div className="mt-3 relative">
              <Search className="w-3.5 h-3.5 text-white/35 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search game chats"
                className="w-full bg-white/5 border border-white/10 rounded-full pl-8 pr-3 py-2 text-xs text-white placeholder:text-white/35 outline-none focus:border-white/25"
              />
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto qk-desk-scroll px-2 pb-3">
          {section === 'game' ? <GameContactsPane query={query} /> : <DatingPane />}
        </div>
      </aside>

      {/* ── Conversation pane (§11: header / viewport / composer) ────────── */}
      <section className="flex-1 min-w-0 h-full flex flex-col relative overflow-hidden">
        {/* §17/§84: back into the live room in one click — the runtime was
            never destroyed (§18) */}
        {roomId && (
          <button
            onClick={() => setView('spin-bottle-room')}
            className="shrink-0 flex items-center gap-2 px-4 py-2 border-b border-white/8 bg-[var(--qk-accent)]/8 hover:bg-[var(--qk-accent)]/14 transition-colors text-left"
            data-testid="chats-return-to-table"
          >
            <Dices className="w-4 h-4 text-[var(--qk-accent)]" />
            <span className="text-[11px] font-semibold text-white/80">
              Your Spin the Bottle table is still live — return to the room
            </span>
          </button>
        )}

        {section === 'game' ? (
          activePeer ? (
            <GameChatScreen key={activePeer.peerUserId} embedded onBack={() => closeConversation()} />
          ) : (
            <ConversationPlaceholder kind="game" />
          )
        ) : activeMatchId ? (
          <ChatView key={activeMatchId} embedded />
        ) : (
          <ConversationPlaceholder kind="dating" />
        )}
      </section>
    </div>
  )
}
