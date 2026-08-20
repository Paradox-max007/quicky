'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuickyStore, ChatMessage } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Camera, Send, MoreVertical, BadgeCheck, Crown,
  Camera as CamIcon, Sparkles, Flame, Play, X, RotateCcw
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { QUICKY } from '@/lib/quicky/constants'
import { QuickyViewer } from './QuickyViewer'
import { TruthOrDareGame } from './TruthOrDareGame'
import { ProfileSheet } from './ProfileSheet'

export function ChatView() {
  const matchId = useQuickyStore((s) => s.activeMatchId)
  const setView = useQuickyStore((s) => s.setView)
  const [match, setMatch] = useState<{ id: string; partner: any; me: { id: string; isPremium: boolean } } | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [showActions, setShowActions] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [pendingQuickies, setPendingQuickies] = useState<any[]>([])
  const [toDOpen, setToDOpen] = useState(false)
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)
  const [pickedDuration, setPickedDuration] = useState<number | null>(null)
  const [viewerQuicky, setViewerQuicky] = useState<{ mediaUrl: string; duration: number } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Refresh current user (for score updates after opening quickies)
  const refreshUser = async () => {
    try {
      const res = await api.auth.me()
      if (res.user) {
        // Update store
        useQuickyStore.getState().setUser(res.user)
      }
    } catch {}
  }

  const refresh = async () => {
    if (!matchId) return
    setLoading(true)
    try {
      const [chatRes, qRes] = await Promise.all([
        api.chat.messages(matchId),
        api.quicky.pending(matchId),
      ])
      setMatch({ id: chatRes.match.id, partner: chatRes.match.partner, me: chatRes.me })
      setMessages(chatRes.messages)
      setPendingQuickies(qRes.quickies)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load chat')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // Poll every 4s for new messages & pending quickies
    const interval = setInterval(refresh, 4000)
    return () => clearInterval(interval)
  }, [matchId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  if (!matchId) {
    setView('matches')
    return null
  }

  const sendText = async () => {
    if (!text.trim() || !matchId) return
    const textCopy = text
    setText('')
    try {
      const res = await api.chat.send(matchId, { type: 'text', text: textCopy })
      if (res.ok) {
        setMessages((prev) => [...prev, res.message])
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send')
      setText(textCopy)
    }
  }

  const openQuickyCapture = () => {
    setShowActions(false)
    // Trigger file picker for image/video
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*,video/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      // Pick duration via prompt (simple synchronous flow for demo)
      const durationStr = prompt('Quicky duration (3, 5, 8, or 10 seconds):', '5')
      const duration = Number(durationStr ?? '5')
      if (![3, 5, 8, 10].includes(duration)) {
        toast.error('Invalid duration, using 5s')
      }
      const finalDuration = ([3, 5, 8, 10].includes(duration) ? duration : 5) as 3 | 5 | 8 | 10
      try {
        const uploadRes = await api.upload(file, 'quicky')
        if (!uploadRes.url) {
          toast.error('Upload failed')
          return
        }
        const sendRes = await api.quicky.send(matchId, {
          mediaUrl: uploadRes.url,
          duration: finalDuration,
        })
        if (sendRes.ok) {
          setMessages((prev) => [...prev, sendRes.message])
          toast.success('Quicky sent!')
          refresh()
        }
      } catch (e: any) {
        if (e.status === 402 && e.body?.paywall === 'quicky') {
          useQuickyStore.getState().showPaywall({ kind: 'quicky' })
        } else {
          toast.error(e.message ?? 'Failed to send Quicky')
        }
      }
    }
    input.click()
  }

  // (durationPickerOpen state is currently unused; using prompt() instead for simplicity)

  const me = match?.me
  const partner = match?.partner

  if (loading && !match) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0F0F14]">
        <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!partner) return null

  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white">
      {/* Header */}
      <header className="shrink-0 px-3 pt-2 pb-3 flex items-center gap-2 border-b border-white/5 bg-[#0F0F14]/95 backdrop-blur">
        <button onClick={() => setView('matches')} className="p-2 hover:bg-white/5 rounded-full" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button onClick={() => setShowProfile(true)} className="flex items-center gap-2 flex-1 min-w-0">
          {partner.photo ? (
            <img src={partner.photo} alt={partner.name} className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center font-bold">
              {partner.name?.[0] ?? '?'}
            </div>
          )}
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-sm truncate">{partner.name}, {partner.age}</span>
              {partner.isVerified && <BadgeCheck className="w-3.5 h-3.5 text-[#FF2D55]" fill="currentColor" stroke="white" />}
              {partner.isPremium && (
                <span className="text-gradient-gold">
                  <Crown className="w-3 h-3" fill="currentColor" stroke="none" />
                </span>
              )}
            </div>
          </div>
        </button>
        <button onClick={() => setShowActions((v) => !v)} className="p-2 hover:bg-white/5 rounded-full" aria-label="More">
          <MoreVertical className="w-5 h-5" />
        </button>
      </header>

      {/* Pending quickies notice */}
      {pendingQuickies.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-[#FF2D55]/10 border-b border-[#FF2D55]/30 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <CamIcon className="w-4 h-4 text-[#FF2D55] animate-quicky-pulse" />
            <span className="text-[#FF5E7E] font-medium">
              {pendingQuickies.length} new Quicky {pendingQuickies.length === 1 ? 'waiting' : 'waiting'}
            </span>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-4 flex flex-col gap-2">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/40">
            <p className="text-sm">Say hi, or send a Quicky 🔥</p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} meId={me?.id ?? ''} onOpenQuicky={(q) => {
            // Mark as opened via PATCH
            api.quicky.open(matchId, m.id, 'open').then((res) => {
              refresh()
              refreshUser()
              if (res.opened) {
                toast.success('+1 to your Quicky Score')
              }
            }).catch((e) => {
              toast.error(e.message ?? 'Failed to open Quicky')
            })
          }} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Game / action buttons row */}
      <div className="shrink-0 px-3 pb-1 flex items-center gap-2">
        <button
          onClick={openQuickyCapture}
          className="p-3 rounded-full bg-[#FF2D55]/15 border border-[#FF2D55]/30 text-[#FF5E7E] hover:bg-[#FF2D55]/25 active:scale-95 transition-all"
          aria-label="Send Quicky"
        >
          <Camera className="w-5 h-5" />
        </button>
        <button
          onClick={async () => {
            if (!me?.isPremium) {
              useQuickyStore.getState().showPaywall({ kind: 'games' })
              return
            }
            // Start or resume a ToD session
            try {
              const res = await api.game.get(matchId)
              if (!res.session) {
                await api.game.start(matchId, 'truth_or_dare')
              }
              // open the game UI via showing actions sheet -> TruthOrDareGame
              setShowActions(false)
              setToDOpen(true)
            } catch (e: any) {
              toast.error(e.message ?? 'Failed to start game')
            }
          }}
          className="p-3 rounded-full bg-[#B8A4FF]/15 border border-[#B8A4FF]/30 text-[#B8A4FF] hover:bg-[#B8A4FF]/25 active:scale-95 transition-all"
          aria-label="Truth or Dare"
        >
          <Sparkles className="w-5 h-5" />
        </button>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendText()}
          placeholder="Type a message..."
          className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55]/50"
        />
        <button
          onClick={sendText}
          disabled={!text.trim()}
          className="p-3 rounded-full bg-coral-gradient text-white disabled:opacity-30 active:scale-95 transition-all"
          aria-label="Send"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
      <div className="shrink-0 h-2 safe-area-bottom" />

      {/* Action sheet */}
      <AnimatePresence>
        {showActions && (
          <>
            <div
              className="absolute inset-0 bg-black/60 z-40"
              onClick={() => setShowActions(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="absolute left-0 right-0 bottom-0 bg-[#1A1A2E] border-t border-white/10 rounded-t-3xl p-4 z-50"
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Chat actions</h3>
                <button onClick={() => setShowActions(false)} className="text-white/40 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <SheetAction icon={<Camera className="w-5 h-5" />} label="Quicky" onClick={openQuickyCapture} color="coral" />
                <SheetAction
                  icon={<Sparkles className="w-5 h-5" />}
                  label="Truth or Dare"
                  onClick={async () => {
                    if (!me?.isPremium) {
                      useQuickyStore.getState().showPaywall({ kind: 'games' })
                      return
                    }
                    try {
                      const res = await api.game.get(matchId)
                      if (!res.session) await api.game.start(matchId, 'truth_or_dare')
                      setShowActions(false)
                      setToDOpen(true)
                    } catch (e: any) {
                      toast.error(e.message ?? 'Failed')
                    }
                  }}
                  color="lavender"
                />
                <SheetAction
                  icon={<MoreVertical className="w-5 h-5" />}
                  label="View profile"
                  onClick={() => {
                    setShowActions(false)
                    setShowProfile(true)
                  }}
                  color="white"
                />
                <SheetAction
                  icon={<X className="w-5 h-5" />}
                  label="Unmatch"
                  color="red"
                  onClick={async () => {
                    if (!confirm('Unmatch? This cannot be undone.')) return
                    try {
                      await api.unmatch(matchId)
                      toast.success('Unmatched')
                      setView('matches')
                    } catch (e: any) {
                      toast.error(e.message ?? 'Failed')
                    }
                  }}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Duration picker modal */}
      {durationPickerOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setPickedDuration((p) => p ?? 0)}>
          <div className="bg-[#1A1A2E] rounded-3xl p-6 max-w-xs w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-1 text-center">Quicky duration</h3>
            <p className="text-white/50 text-sm mb-4 text-center">How long should it last?</p>
            <div className="grid grid-cols-4 gap-2">
              {QUICKY.quickyDurations.map((d) => (
                <button
                  key={d}
                  onClick={() => setPickedDuration(d)}
                  className="aspect-square rounded-2xl border border-[#FF2D55]/30 bg-[#FF2D55]/10 hover:bg-[#FF2D55]/20 flex flex-col items-center justify-center gap-1 active:scale-95"
                >
                  <span className="text-xl font-bold">{d}</span>
                  <span className="text-[10px] text-white/60">sec</span>
                </button>
              ))}
            </div>
            <button onClick={() => setPickedDuration(0)} className="mt-4 text-white/50 text-sm hover:text-white w-full text-center">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ToD game overlay */}
      {toDOpen && matchId && (
        <TruthOrDareGame matchId={matchId} meId={me?.id ?? ''} partnerName={partner.name} onClose={() => setToDOpen(false)} />
      )}

      {/* Profile sheet */}
      {showProfile && partner && (
        <ProfileSheet userId={partner.id} onClose={() => setShowProfile(false)} />
      )}
    </div>
  )
}

function SheetAction({
  icon,
  label,
  onClick,
  color,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  color: 'coral' | 'lavender' | 'white' | 'red'
}) {
  const colors = {
    coral: 'text-[#FF2D55]',
    lavender: 'text-[#B8A4FF]',
    white: 'text-white',
    red: 'text-[#FF3B30]',
  }
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 p-3 rounded-2xl bg-white/5 hover:bg-white/10 active:scale-95 transition-all"
    >
      <div className={cn('w-12 h-12 rounded-full bg-white/5 flex items-center justify-center', colors[color])}>
        {icon}
      </div>
      <span className="text-xs font-medium text-white/80">{label}</span>
    </button>
  )
}

function MessageBubble({
  m,
  meId,
  onOpenQuicky,
}: {
  m: ChatMessage
  meId: string
  onOpenQuicky: (q: ChatMessage) => void
}) {
  const isMe = m.senderId === meId
  const [viewerOpen, setViewerOpen] = useState(false)

  if (m.type === 'system') {
    return (
      <div className="self-center px-3 py-1.5 rounded-full bg-white/5 text-xs text-white/60 text-center max-w-[80%]">
        {m.text}
      </div>
    )
  }

  if (m.type === 'quicky') {
    const isUnopened = !m.quickyOpenedAt && !isMe
    return (
      <>
        <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
          <button
            onClick={() => (isMe ? null : isUnopened ? onOpenQuicky(m) : setViewerOpen(true))}
            className={cn(
              'max-w-[80%] rounded-3xl p-2 border-2 border-[#FF2D55] bg-[#FF2D55]/10 flex items-center gap-2',
              isMe ? 'rounded-br-md' : 'rounded-bl-md',
              isUnopened && 'animate-quicky-pulse'
            )}
          >
            <div className="w-16 h-20 rounded-2xl bg-[#FF2D55]/20 flex items-center justify-center overflow-hidden">
              {m.mediaUrl && m.quickyOpenedAt ? (
                <img src={m.mediaUrl} alt="" className="w-full h-full object-cover blur-sm" />
              ) : (
                <Camera className="w-6 h-6 text-[#FF2D55]" />
              )}
            </div>
            <div className="flex flex-col items-start gap-0.5 pr-2">
              <span className="text-xs font-semibold text-[#FF5E7E]">
                {isMe ? (m.quickyOpenedAt ? 'Opened' : 'Sent') : (m.quickyOpenedAt ? 'Replay' : 'Open Quicky')}
              </span>
              <span className="text-[10px] text-white/60">
                {m.quickyDuration}s{m.screenshotFlagged && ' · screenshot flagged'}
              </span>
            </div>
          </button>
        </div>
        {viewerOpen && m.mediaUrl && (
          <QuickyViewer
            mediaUrl={m.mediaUrl}
            duration={m.quickyDuration ?? 5}
            onClose={() => setViewerOpen(false)}
            onScreenshot={() => {
              // Best-effort: flag the quicky as screenshot
              // The /api/quicky/matches/[matchId]/quicky PATCH handles this
            }}
          />
        )}
      </>
    )
  }

  if (m.type === 'image' || m.type === 'video') {
    return (
      <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
        <div className={cn('max-w-[80%] rounded-3xl overflow-hidden', isMe ? 'rounded-br-md' : 'rounded-bl-md')}>
          {m.mediaUrl && (
            <img src={m.mediaUrl} alt="" className="max-h-60 object-cover" />
          )}
        </div>
      </div>
    )
  }

  // text
  return (
    <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[80%] rounded-3xl px-3.5 py-2 text-sm',
          isMe ? 'bg-[#FF2D55] text-white rounded-br-md' : 'bg-white/8 text-white rounded-bl-md'
        )}
      >
        {m.text}
      </div>
    </div>
  )
}
