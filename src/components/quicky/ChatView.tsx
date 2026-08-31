'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuickyStore, ChatMessage } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, Camera, Send, MoreVertical, BadgeCheck, Crown,
  ImagePlus, X, RotateCcw, Check, CheckCheck, Clock, AlertCircle,
  Reply, Copy, ChevronDown, Mic, Play, Pause, Trash2, Square, Sparkles, Wine,
  Grid3X3, Gamepad2, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { QUICKY } from '@/lib/quicky/constants'
import { joinMatchChannel, trackOnline, watchOnline, realtimeConfigured, MatchChannel } from '@/lib/quicky/realtime'
import { notifyGameInvite, watchGameInvites, GameInvitePayload } from '@/lib/quicky/game-invites'
import { requestMicPermission, requestCameraPermission } from '@/lib/quicky/media-permissions'
import { compressImage } from '@/lib/quicky/image'
import { QuickyViewer } from './QuickyViewer'
import { TruthOrDareGame } from './TruthOrDareGame'
import { NeverHaveIEver } from './NeverHaveIEver'
import { LudoGame } from './LudoGame'
import { ProfileSheet } from './ProfileSheet'

// Messages arrive from several sources (server list, optimistic sends,
// realtime broadcasts) — always dedupe by id so React keys stay unique.
function dedupeById(list: Msg[]): Msg[] {
  const seen = new Set<string>()
  return list.filter((m) => {
    if (seen.has(m.id)) return false
    seen.add(m.id)
    return true
  })
}

// An optimistic bubble must never survive next to its confirmed twin. A
// realtime echo (own broadcast or Postgres Changes INSERT) can arrive BEFORE
// the send request resolves — replacing only on identical ids would leave the
// "Sending" bubble visible alongside the real one for that gap. So a
// confirmed copy of my own text takes the place of its oldest pending twin;
// later identical pendings stay untouched.
function asConfirmed(message: any): Msg {
  return { ...message, deliveredAt: null, readAt: null, reactions: message.reactions ?? [] }
}

const isTwinOf = (confirmed: any) => (m: Msg) =>
  !!m.clientTmp && m.senderId === confirmed.senderId && m.type === 'text' && !!m.text && m.text === confirmed.text

function mergeOwnMessage(prev: Msg[], message: any): Msg[] {
  if (prev.some((m) => m.id === message.id)) {
    return prev.map((m) => (m.id === message.id ? asConfirmed(message) : m))
  }
  const twinIdx = prev.findIndex(isTwinOf(message))
  if (twinIdx === -1) return [...prev, asConfirmed(message)]
  const next = [...prev]
  next[twinIdx] = asConfirmed(message)
  return next
}

export type Reaction = { emoji: string; userId: string }
export type ReplyRef = { id: string; senderId: string; type: string; snippet: string; duration: number | null } | null

export type Msg = ChatMessage & {
  clientTmp?: boolean
  status?: 'sending' | 'failed'
  deliveredAt?: string | null
  quickyConsumedAt?: string | null
  replyTo?: ReplyRef
  reactions?: Reaction[]
  pendingText?: string
  mediaDuration?: number | null
  uploadPct?: number
}

const REACTION_SET = ['❤️', '😂', '😮', '😢', '🔥', '👍']

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const start = (x: Date) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime() }
  const today = start(new Date())
  const t = start(d)
  if (t === today) return 'Today'
  if (t === today - 86400000) return 'Yesterday'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function haptic() {
  import('@capacitor/haptics')
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
    .catch(() => {})
}

// Long-press (pointer based — works on web + Capacitor WebView)
function useLongPress(onLong: () => void, ms = 450) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }
  return {
    onPointerDown: () => {
      fired.current = false
      timer.current = setTimeout(() => {
        fired.current = true
        haptic()
        onLong()
      }, ms)
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    consumed: () => fired.current,
  }
}

// Warm device cache per conversation (PRD §4.1): the last fetched messages +
// partner header are stored so reopening a chat paints instantly, then SWR-
// style revalidation patches anything new.
const chatCacheKey = (matchId: string) => `qk_chat_cache_${matchId}`
function loadChatCache(matchId: string): { partner: any; messages: Msg[] } | null {
  try {
    const raw = localStorage.getItem(chatCacheKey(matchId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed?.partner || !Array.isArray(parsed.messages)) return null
    return parsed
  } catch {
    return null
  }
}

export function ChatView() {
  const matchId = useQuickyStore((s) => s.activeMatchId)
  const setView = useQuickyStore((s) => s.setView)
  const meUser = useQuickyStore((s) => s.user)
  const clearUnreadForMatch = useQuickyStore((s) => s.clearUnreadForMatch)
  const [match, setMatch] = useState<{ id: string; partner: any; me: { id: string; isPremium: boolean } } | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [showActions, setShowActions] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [pendingQuickies, setPendingQuickies] = useState<any[]>([])
  const [toDOpen, setToDOpen] = useState(false)
  const [nhieOpen, setNhieOpen] = useState(false)
  const [ludoOpen, setLudoOpen] = useState(false)
  // Game invite flow: when I propose a game the partner gets an in-app popup;
  // I wait for their join/cancel before the game opens on my side.
  const [pendingInviteGame, setPendingInviteGame] = useState<GameInvitePayload['gameType'] | null>(null)
  const [durationPickerOpen, setDurationPickerOpen] = useState(false)
  const [pickedDuration, setPickedDuration] = useState<number | null>(null)
  const quickyFileRef = useRef<HTMLInputElement>(null)
  const galleryFileRef = useRef<HTMLInputElement>(null)
  const [pendingQuicky, setPendingQuicky] = useState<{ file: File; previewUrl: string } | null>(null)
  const [sendingQuicky, setSendingQuicky] = useState(false)

  // Voice messages (PRD §5): tap mic to record, tap stop, then preview + send
  // or discard. Max 60 s.
  const VOICE_MAX_MS = 60000
  const [recording, setRecording] = useState<{ recorder: MediaRecorder; stream: MediaStream; startedAt: number } | null>(null)
  const [recElapsedMs, setRecElapsedMs] = useState(0)
  const [voicePreview, setVoicePreview] = useState<{ url: string; blob: Blob; durationMs: number } | null>(null)
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)

  // Reply / quote
  const [replyTo, setReplyTo] = useState<ReplyRef>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // Long-press context menu (reactions / reply / copy)
  const [menuFor, setMenuFor] = useState<Msg | null>(null)

  // Realtime state (Supabase broadcast/presence, falls back to polling)
  const channelRef = useRef<MatchChannel | null>(null)
  const typingStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typingExpireTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTypingSent = useRef(0)
  const [partnerTyping, setPartnerTyping] = useState(false)
  const [partnerOnline, setPartnerOnline] = useState(false)
  const nearBottomRef = useRef(true)
  const receiptSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const myHideTyping = !!meUser?.settings?.privacyHideTyping
  const myHideReceipts = !!meUser?.settings?.privacyHideReadReceipts

  // Refresh current user (for score updates after opening quickies)
  const refreshUser = async () => {
    try {
      const res = await api.auth.me()
      if (res.user) {
        useQuickyStore.getState().setUser(res.user)
      }
    } catch {}
  }

  const refresh = useCallback(async () => {
    if (!matchId) return
    setLoading(true)
    try {
      const [chatRes, qRes] = await Promise.all([
        api.chat.messages(matchId),
        api.quicky.pending(matchId),
      ])
      setMatch({ id: chatRes.match.id, partner: chatRes.match.partner, me: chatRes.me })
      // Keep unsent optimistic messages (sending / failed) across refreshes
      setMessages((prev) => {
        // Keep unsent optimistic messages across refreshes, but drop any whose
        // confirmed copy already arrived via realtime (avoids Sending+Sent twins)
        const pending = prev.filter(
          (m) => m.clientTmp && chatRes.messages.some((s) => s.senderId === m.senderId && m.type === 'text' && !!m.text && s.text === m.text) === false
        )
        return dedupeById([...dedupeById(chatRes.messages), ...pending])
      })
      setPendingQuickies(qRes.quickies)
      // Chat is open → the server just marked everything read; drop this
      // chat's badge instantly so nav total + list stay correct without polls
      clearUnreadForMatch(matchId)
      // Warm-cache this conversation for instant reopen (PRD §4.1)
      try {
        localStorage.setItem(
          chatCacheKey(matchId),
          JSON.stringify({ partner: chatRes.match.partner, messages: chatRes.messages.slice(-100) })
        )
      } catch {}
      // Push delivery + read receipts back to the partner over realtime so
      // their ✓ / ✓✓ ticks update without waiting for their next refresh.
      const myReceipts = !myHideReceipts
      const deliveredIds = chatRes.messages
        .filter((m) => m.senderId !== chatRes.me.id && !m.deliveredAt)
        .map((m) => m.id)
      if (deliveredIds.length > 0) channelRef.current?.sendDelivered(deliveredIds)
      if (myReceipts && (chatRes.readMessageIds?.length ?? 0) > 0) {
        channelRef.current?.sendRead(chatRes.readMessageIds!)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load chat')
    } finally {
      setLoading(false)
    }
  }, [matchId, clearUnreadForMatch])

  useEffect(() => {
    if (!matchId) return
    // Paint from warm cache first (skeleton-free instant open), network
    // response then reconciles via the dedupe-merge in refresh()
    const cached = loadChatCache(matchId)
    if (cached) {
      setMatch({ id: matchId, partner: cached.partner, me: { id: meUser?.id ?? '', isPremium: !!meUser?.isPremium } })
      setMessages(dedupeById(cached.messages))
      setLoading(false)
    }
    // Opening the chat marks it read — drop the badge before first paint
    clearUnreadForMatch(matchId)
    refresh()

    // When Supabase Realtime is active it pushes new messages instantly via
    // broadcast — polling is only needed as a fallback (e.g. no env vars set).
    // We still add a visibility listener so backgrounded tabs catch up the
    // moment the user returns (fixes the 1–2 min delay on mobile).
    let interval: ReturnType<typeof setInterval> | null = null
    if (!realtimeConfigured()) {
      // No realtime — poll every 8 s as the only delivery mechanism
      interval = setInterval(refresh, 8000)
    }

    // Refresh on tab/app focus so messages sent while backgrounded appear instantly
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (interval) clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, matchId, meUser?.id, meUser?.isPremium, clearUnreadForMatch])

  const updateMsg = useCallback((id: string, fn: (m: Msg) => Msg) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? fn(m) : m)))
  }, [])

  // Apply a reaction payload (from API response or realtime broadcast)
  const applyReaction = useCallback(
    (messageId: string, userId: string, emoji: string | null) => {
      updateMsg(messageId, (m) => {
        const others = (m.reactions ?? []).filter((r) => r.userId !== userId)
        return { ...m, reactions: emoji ? [...others, { emoji, userId }] : others }
      })
    },
    [updateMsg]
  )

  // Join the Supabase realtime channel for this match
  useEffect(() => {
    if (!matchId) return
    const ch = joinMatchChannel(matchId, {
      onMessage: (message) => {
        if (!message?.id || !message?.type) return
        if (message.type === 'quicky') {
          // Postgres Changes delivers raw rows without consumed/expired masking
          // (and Quickies may already exist from a broadcast) — refresh instead
          // of appending so the viewer-state logic stays authoritative.
          if (receiptSyncTimer.current) clearTimeout(receiptSyncTimer.current)
          receiptSyncTimer.current = setTimeout(refresh, 400)
          return
        }
        setMessages((prev) => mergeOwnMessage(prev, message))
        // Our device just received the partner's message — sync receipts so
        // their ticks update live (debounced; covers messages missed by the
        // sender's broadcast).
        if (message.senderId !== meUser?.id) {
          if (receiptSyncTimer.current) clearTimeout(receiptSyncTimer.current)
          receiptSyncTimer.current = setTimeout(refresh, 400)
        }
      },
      onTyping: (isTyping) => {
        if (typingExpireTimer.current) clearTimeout(typingExpireTimer.current)
        if (isTyping) {
          setPartnerTyping(true)
          // Safety: partner may have closed the app without sending "stopped"
          typingExpireTimer.current = setTimeout(() => setPartnerTyping(false), 4000)
        } else {
          setPartnerTyping(false)
        }
      },
      onRead: (messageIds) => {
        setMessages((prev) =>
          prev.map((m) => (messageIds.includes(m.id) ? { ...m, readAt: m.readAt ?? new Date().toISOString() } : m))
        )
      },
      onDelivered: (messageIds) => {
        setMessages((prev) =>
          prev.map((m) =>
            messageIds.includes(m.id) ? { ...m, deliveredAt: m.deliveredAt ?? new Date().toISOString() } : m
          )
        )
      },
      onReaction: (payload) => {
        if (!payload?.messageId) return
        if (payload.userId === meUser?.id) return // optimistic update already applied
        applyReaction(payload.messageId, payload.userId, payload.emoji)
      },
    })
    channelRef.current = ch
    return () => {
      ch?.unsubscribe()
      channelRef.current = null
      if (receiptSyncTimer.current) clearTimeout(receiptSyncTimer.current)
    }
  }, [matchId, meUser?.id, applyReaction, refresh])

  // Announce my own online presence
  useEffect(() => {
    if (!meUser?.id) return
    return trackOnline(meUser.id)
  }, [meUser?.id])

  // Watch the partner's presence
  useEffect(() => {
    if (!match?.partner?.id) return
    return watchOnline((ids) => setPartnerOnline(ids.has(match.partner.id)))
  }, [match?.partner?.id])

  // Auto-scroll to latest when near the bottom
  useEffect(() => {
    if (nearBottomRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: messages.length > 1 ? 'smooth' : 'auto' })
    }
  }, [messages.length, partnerTyping])

  // Jump to a quoted message
  const jumpToMessage = (id: string) => {
    const el = document.getElementById(`msg-${id}`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setHighlightId(id)
    setTimeout(() => setHighlightId((h) => (h === id ? null : h)), 1500)
  }

  const openGame = (gameType: 'truth_or_dare' | 'never_have_i_ever' | 'ludo') => {
    setPendingInviteGame(null)
    if (gameType === 'truth_or_dare') setToDOpen(true)
    else if (gameType === 'never_have_i_ever') setNhieOpen(true)
    else setLudoOpen(true)
  }

  // Propose a game: both players must be online; the partner receives an
  // in-app popup and I wait for their Join / Cancel.
  const proposeGame = (gameType: 'truth_or_dare' | 'never_have_i_ever' | 'ludo') => {
    if (!match?.partner?.id) return
    if (!partnerOnline) {
      toast.error(`${partner?.name ?? 'They'} is offline — games need both players online`)
      return
    }
    setPendingInviteGame(gameType)
    notifyGameInvite(match.partner.id, {
      matchId: matchId ?? '',
      gameType,
      fromId: meUser?.id ?? '',
      fromName: meUser?.name ?? 'Someone',
    })
  }

  // Hear the partner's join/cancel for a game I proposed
  useEffect(() => {
    if (!meUser?.id) return
    return watchGameInvites(meUser.id, {
      onResponse: (res) => {
        if (!res || res.matchId !== matchId) return
        const game = res.gameType as GameInvitePayload['gameType']
        setPendingInviteGame(null)
        if (res.accepted) {
          openGame(game)
        } else {
          toast(`${res.fromName || 'They'} declined the ${game === 'ludo' ? 'Ludo' : game === 'never_have_i_ever' ? 'Never Have I Ever' : 'Truth or Dare'} invite`)
        }
      },
    })
  }, [meUser?.id, matchId])

  // Receiver side: if I joined from the invite popup, the pending game is
  // stashed in sessionStorage — auto-open it once this chat mounts.
  useEffect(() => {
    if (!matchId || !meUser?.id) return
    const key = `qk_pending_game_${matchId}`
    try {
      const game = sessionStorage.getItem(key)
      if (game === 'truth_or_dare' || game === 'never_have_i_ever' || game === 'ludo') {
        sessionStorage.removeItem(key)
        // Give the handshake a beat so the accept broadcast reaches the inviter
        setTimeout(() => openGame(game), 400)
      }
    } catch {}
  }, [matchId, meUser?.id])

  // Cleanup any live recording/preview timers on unmount
  const recordingRef = useRef<typeof recording>(null)
  recordingRef.current = recording
  useEffect(() => () => {
    stopVoiceTimer()
    try { recordingRef.current?.recorder.stop() } catch {}
    recordingRef.current?.stream.getTracks().forEach((t) => t.stop())
  }, [])

  if (!matchId) {
    setView('matches')
    return null
  }

  // ── Send: optimistic text with status ticks + retry ──────────────────────
  const sendText = async (retryOf?: Msg) => {
    const body = (retryOf ? retryOf.pendingText : text)?.trim()
    if (!body || !matchId) return
    if (!retryOf) setText('')
    if (textAreaRef.current) textAreaRef.current.style.height = 'auto'
    if (!myHideTyping) channelRef.current?.sendTyping(false)

    const reply = retryOf ? retryOf.replyTo : replyTo
    if (!retryOf) setReplyTo(null)

    const tmpId = retryOf?.id ?? `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    if (!retryOf) {
      setMessages((prev) => [
        ...prev,
        {
          id: tmpId,
          clientTmp: true,
          status: 'sending',
          senderId: meUser?.id ?? '',
          type: 'text',
          text: body,
          mediaUrl: null,
          quickyDuration: null,
          quickyOpenedAt: null,
          quickyExpiresAt: null,
          quickyConsumedAt: null,
          screenshotFlagged: false,
          readAt: null,
          deliveredAt: null,
          replyTo: reply ?? null,
          reactions: [],
          createdAt: new Date().toISOString(),
        },
      ])
      nearBottomRef.current = true
      haptic()
    } else {
      updateMsg(tmpId, (m) => ({ ...m, status: 'sending' }))
    }

    try {
      const res = await api.chat.send(matchId, { type: 'text', text: body, replyToId: reply?.id ?? undefined })
      if (!res.ok) throw new Error('send failed')
      setMessages((prev) =>
        dedupeById(prev.map((m) => (m.id === tmpId ? { ...res.message, status: undefined, clientTmp: false } : m)))
      )
      channelRef.current?.sendMessage(res.message)
    } catch (e: any) {
      updateMsg(tmpId, (m) => ({ ...m, status: 'failed', pendingText: body }))
      toast.error('Failed to send — tap to retry')
    }
  }

  // Broadcast typing while composing, throttled to one event per 2s
  const onTextChanged = (v: string) => {
    setText(v)
    if (textAreaRef.current) {
      textAreaRef.current.style.height = 'auto'
      textAreaRef.current.style.height = `${Math.min(textAreaRef.current.scrollHeight, 120)}px`
    }
    if (myHideTyping || !channelRef.current) return
    const now = Date.now()
    if (v.trim() && now - lastTypingSent.current > 2000) {
      lastTypingSent.current = now
      channelRef.current.sendTyping(true)
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
      typingStopTimer.current = setTimeout(() => channelRef.current?.sendTyping(false), 2500)
    } else if (!v.trim()) {
      if (typingStopTimer.current) clearTimeout(typingStopTimer.current)
      channelRef.current.sendTyping(false)
    }
  }

  // ── Voice messages (PRD §5) ─────────────────────────────────────────────
  const stopVoiceTimer = () => {
    if (voiceTimerRef.current) clearInterval(voiceTimerRef.current)
    voiceTimerRef.current = null
  }

  const startVoiceRecording = async () => {
    if (recording || !matchId) return
    // Ask for the microphone up front — on mobile this triggers the OS
    // permission dialog before any recording UI appears.
    const perm = await requestMicPermission()
    if (perm !== 'granted') {
      toast.error(perm === 'denied' ? 'Microphone access denied — enable it in your device settings' : 'Microphone unavailable on this device')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m))
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      const chunks: BlobPart[] = []
      const startedAt = Date.now()
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const durationMs = Math.min(VOICE_MAX_MS, Date.now() - startedAt)
        // Too short — discard rather than sending a useless 0.2 s clip
        if (durationMs < 400) {
          setVoicePreview(null)
          return
        }
        setVoicePreview({ url: URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })), blob: new Blob(chunks, { type: recorder.mimeType }), durationMs })
      }
      recorder.start()
      setRecording({ recorder, stream, startedAt })
      setRecElapsedMs(0)
      stopVoiceTimer()
      voiceTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - startedAt
        setRecElapsedMs(elapsed)
        if (elapsed >= VOICE_MAX_MS) {
          stopVoiceTimer()
          try { recorder.stop() } catch {}
          setRecording(null)
        }
      }, 200)
      haptic()
    } catch {
      toast.error('Microphone permission denied')
    }
  }

  const stopVoiceRecording = () => {
    stopVoiceTimer()
    setRecording(null)
    try { recording?.recorder.stop() } catch {}
  }

  const cancelVoicePreview = () => {
    if (voicePreview) URL.revokeObjectURL(voicePreview.url)
    setVoicePreview(null)
  }

  const sendVoice = async () => {
    if (!voicePreview || !matchId) return
    const { url, blob, durationMs } = voicePreview
    setVoicePreview(null)
    const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setMessages((prev) => [
      ...prev,
      {
        id: tmpId, clientTmp: true, status: 'sending', senderId: meUser?.id ?? '',
        type: 'voice', text: null, mediaUrl: url, mediaDuration: durationMs,
        quickyDuration: null, quickyOpenedAt: null, quickyExpiresAt: null, quickyConsumedAt: null,
        screenshotFlagged: false, readAt: null, deliveredAt: null, replyTo: null, reactions: [],
        createdAt: new Date().toISOString(),
      },
    ])
    nearBottomRef.current = true
    haptic()
    try {
      const ext = blob.type.includes('mp4') ? 'm4a' : 'webm'
      const up = await api.upload(new File([blob], `voice.${ext}`, { type: blob.type }), 'voice')
      const res = await api.chat.send(matchId, { type: 'voice', mediaUrl: up.url, durationMs })
      if (!res.ok) throw new Error('send failed')
      setMessages((prev) => dedupeById(prev.map((m) => (m.id === tmpId ? { ...res.message, status: undefined, clientTmp: false } : m))))
      channelRef.current?.sendMessage(res.message)
      URL.revokeObjectURL(url)
    } catch {
      updateMsg(tmpId, (m) => ({ ...m, status: 'failed' }))
      toast.error('Failed to send voice message')
    }
  }

  // Gallery image/video message
  const sendMediaMessage = async (file: File | null) => {
    if (!file || !matchId) return
    const type = file.type.startsWith('video/') ? 'video' : 'image'
    try {
      const up = await api.upload(file, 'photo')
      const res = await api.chat.send(matchId, { type, mediaUrl: up.url })
      if (res.ok) {
        setMessages((prev) =>
          prev.some((m) => m.id === res.message.id) ? prev : [...prev, { ...res.message, reactions: [] }]
        )
        channelRef.current?.sendMessage(res.message)
        haptic()
        refresh()
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send')
    }
  }

  const openQuickyCapture = async () => {
    setShowActions(false)
    // Camera permission prompt fires before the capture sheet opens
    const perm = await requestCameraPermission()
    if (perm !== 'granted') {
      toast.error(perm === 'denied' ? 'Camera access denied — enable it in your device settings' : 'Camera unavailable on this device')
      return
    }
    quickyFileRef.current?.click()
  }

  // Media picked → show the duration sheet before sending
  const onQuickyFile = (file: File | null) => {
    if (!file) return
    setPendingQuicky({ file, previewUrl: URL.createObjectURL(file) })
    setPickedDuration(QUICKY.quickyDefaultDuration)
    setDurationPickerOpen(true)
  }

  const cancelQuicky = () => {
    setDurationPickerOpen(false)
    setPickedDuration(null)
    setPendingQuicky((p) => {
      if (p) URL.revokeObjectURL(p.previewUrl)
      return null
    })
  }

  const sendQuicky = async () => {
    if (!matchId || !pendingQuicky || sendingQuicky) return
    const duration = (pickedDuration ?? QUICKY.quickyDefaultDuration) as 3 | 5 | 8 | 10
    // Close the sheet immediately — the upload continues in the chat bubble
    // so the user can keep chatting while the image is still sending.
    const file = pendingQuicky.file
    const previewUrl = pendingQuicky.previewUrl
    setDurationPickerOpen(false)
    setPendingQuicky(null)
    setSendingQuicky(false)

    const tmpId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    setMessages((prev) => [
      ...prev,
      {
        id: tmpId,
        clientTmp: true,
        status: 'sending',
        senderId: meUser?.id ?? '',
        type: 'quicky',
        text: null,
        mediaUrl: previewUrl,
        quickyDuration: duration,
        quickyOpenedAt: null,
        quickyExpiresAt: null,
        quickyConsumedAt: null,
        screenshotFlagged: false,
        readAt: null,
        deliveredAt: null,
        replyTo: null,
        reactions: [],
        createdAt: new Date().toISOString(),
        uploadPct: 0,
      },
    ])
    nearBottomRef.current = true
    haptic()

    const setPct = (pct: number) =>
      setMessages((prev) => prev.map((m) => (m.id === tmpId ? { ...m, uploadPct: pct } : m)))

    try {
      // Compress on-device first — camera JPEGs shrink 3–8 MB → a few hundred KB
      const { blob, filename } = await compressImage(file, 1440, 0.82)
      const uploadRes = await api.uploadWithProgress(blob, 'quicky', filename, setPct)
      if (!uploadRes.url) throw new Error('Upload failed')
      setPct(100)
      const sendRes = await api.quicky.send(matchId, { mediaUrl: uploadRes.url, duration })
      if (sendRes.ok) {
        URL.revokeObjectURL(previewUrl)
        setMessages((prev) =>
          dedupeById(prev.map((m) => (m.id === tmpId ? { ...sendRes.message, reactions: [] } : m)))
        )
        channelRef.current?.sendMessage(sendRes.message)
        toast.success('Quicky sent!')
      }
    } catch (e: any) {
      URL.revokeObjectURL(previewUrl)
      if (e.status === 402 && e.body?.paywall === 'quicky') {
        setMessages((prev) => prev.filter((m) => m.id !== tmpId))
        useQuickyStore.getState().showPaywall({ kind: 'quicky' })
      } else {
        setMessages((prev) => prev.filter((m) => (m.id === tmpId ? { ...m, status: 'failed' } : m)))
        toast.error(e.message ?? 'Failed to send Quicky')
      }
    }
  }

  // ── Reactions ─────────────────────────────────────────────────────────────
  const reactToMessage = async (m: Msg, emoji: string) => {
    if (!meUser || !matchId) return
    const mine = (m.reactions ?? []).find((r) => r.userId === meUser.id)
    const next = mine?.emoji === emoji ? null : emoji // tap own reaction again → remove
    applyReaction(m.id, meUser.id, next)
    haptic()
    setMenuFor(null)
    try {
      const res = await api.chat.react(matchId, m.id, next)
      channelRef.current?.sendReaction({ messageId: res.messageId, userId: res.userId, emoji: res.emoji })
    } catch {
      toast.error('Failed to react')
      applyReaction(m.id, meUser.id, mine?.emoji ?? null)
    }
  }

  // ── Quicky open / consume ─────────────────────────────────────────────────
  const openQuicky = async (q: Msg) => {
    try {
      const res = await api.quicky.open(matchId, q.id, 'open')
      if (res.opened) toast.success('+1 to your Quicky Score')
    } catch (e: any) {
      if (e.status !== 410) toast.error(e.message ?? 'Failed to open Quicky')
    } finally {
      refresh()
      refreshUser()
    }
  }

  // Permanently delete the media once the viewer closes (timer hit 0 or the
  // recipient closed early — remaining time is forfeited either way)
  const consumeQuicky = (q: Msg) => {
    if (q.senderId === meUser?.id) return // sender viewing own doesn't consume
    api.quicky
      .open(matchId, q.id, 'consume')
      .catch(() => {})
      .finally(() => refresh())
  }

  const me = match?.me
  const partner = match?.partner

  if (loading && !match) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[var(--qk-bg)]">
        <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!partner) return null

  // Group messages with day separators
  const rendered: React.ReactNode[] = []
  let lastDay = ''
  messages.forEach((m) => {
    const day = dayLabel(m.createdAt)
    if (day !== lastDay) {
      rendered.push(
        <div key={`day-${day}-${m.id}`} className="self-center px-3 py-1 my-1 rounded-full bg-white/5 text-[10px] font-semibold text-white/50 tracking-wide">
          {day}
        </div>
      )
      lastDay = day
    }
    rendered.push(
      <MessageBubble
        key={m.id}
        m={m}
        meId={me?.id ?? ''}
        highlighted={highlightId === m.id}
        onJumpTo={jumpToMessage}
        onLongPress={() => setMenuFor(m)}
        onReact={(emoji) => reactToMessage(m, emoji)}
        onReply={() => {
          setMenuFor(null)
          setReplyTo({
            id: m.id,
            senderId: m.senderId,
            type: m.type,
            snippet: m.text ?? (m.type === 'quicky' ? 'Quicky' : m.type === 'video' ? 'Video' : 'Photo'),
            duration: m.quickyDuration ?? null,
          })
          textAreaRef.current?.focus()
        }}
        onRetry={() => sendText(m)}
        onOpenQuicky={async (q) => {
          try {
            const res = await api.quicky.open(matchId, q.id, 'open')
            if (res.opened) toast.success('+1 to your Quicky Score')
          } catch (e: any) {
            if (e.status !== 410) toast.error(e.message ?? 'Failed to open Quicky')
          } finally {
            refresh()
            refreshUser()
          }
        }}
        onConsumeQuicky={() => consumeQuicky(m)}
      />
    )
  })

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative">
      {/* Header */}
      <header className="shrink-0 px-3 pt-2 pb-2.5 flex items-center gap-2 border-b border-white/5 bg-[var(--qk-bg)]/95 backdrop-blur z-10">
        <button onClick={() => setView('matches')} className="p-2 hover:bg-white/5 rounded-full" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <button onClick={() => setShowProfile(true)} className="flex items-center gap-2 flex-1 min-w-0">
          <div className="relative shrink-0">
            {partner.photo ? (
              <img src={partner.photo} alt={partner.name} className="w-9 h-9 rounded-full object-cover" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center font-bold">
                {partner.name?.[0] ?? '?'}
              </div>
            )}
            {partnerOnline && !partner.hideOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#30D158] border-2 border-[var(--qk-bg)]" />
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-1">
              <span className="font-semibold text-sm truncate">{partner.name}, {partner.age}</span>
              {partner.isVerified && <BadgeCheck className="w-3.5 h-3.5 text-[var(--qk-accent)]" fill="currentColor" stroke="white" />}
              {partner.isPremium && (
                <span className="text-gradient-gold">
                  <Crown className="w-3 h-3" fill="currentColor" stroke="none" />
                </span>
              )}
            </div>
            {partnerTyping && !partner.hideTyping ? (
              <span className="text-[11px] text-[var(--qk-accent-light)] font-medium flex items-center gap-1">
                typing
                <span className="flex gap-0.5">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="w-1 h-1 rounded-full bg-[var(--qk-accent-light)]"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </span>
              </span>
            ) : partnerOnline && !partner.hideOnline ? (
              <span className="text-[11px] text-[#30D158]/80">Online</span>
            ) : (
              <span className="text-[11px] text-white/30">Last seen recently</span>
            )}
          </div>
        </button>
        <button onClick={() => setShowActions((v) => !v)} className="p-2 hover:bg-white/5 rounded-full" aria-label="More">
          <MoreVertical className="w-5 h-5" />
        </button>
      </header>

      {/* Pending quickies notice */}
      {pendingQuickies.length > 0 && (
        <div className="shrink-0 px-4 py-2 bg-[var(--qk-accent)]/10 border-b border-[var(--qk-accent)]/30 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <Camera className="w-4 h-4 text-[var(--qk-accent)] animate-quicky-pulse" />
            <span className="text-[var(--qk-accent-light)] font-medium">
              {pendingQuickies.length} new Quicky waiting
            </span>
          </div>
        </div>
      )}

      {/* Game invite sent — waiting for the partner to join or cancel */}
      <AnimatePresence>
        {pendingInviteGame && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden"
          >
            <div className="px-4 py-2 bg-[var(--qk-purple)]/10 border-b border-[var(--qk-purple)]/30 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Gamepad2 className="w-4 h-4 text-[var(--qk-purple)] animate-quicky-pulse" />
                <span className="text-[var(--qk-purple)] font-medium">
                  Invite sent — waiting for {partner?.name ?? 'them'}…
                </span>
              </div>
              <button
                onClick={() => setPendingInviteGame(null)}
                className="text-xs text-white/50 hover:text-white px-2 py-1"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Messages */}
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 140
        }}
        className="flex-1 overflow-y-auto no-scrollbar px-3 py-3 flex flex-col gap-1.5"
      >
        {messages.length === 0 && !loading && (
          <div className="flex-1 flex flex-col items-center justify-center text-white/40">
            <p className="text-sm">Say hi, or send a Quicky 🔥</p>
          </div>
        )}
        {rendered}
        <div ref={messagesEndRef} />
      </div>

      {/* Reply preview bar */}
      <AnimatePresence>
        {replyTo && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="shrink-0 overflow-hidden"
          >
            <div className="mx-2 mb-1 px-3 py-2 rounded-2xl bg-white/5 border-l-2 border-[var(--qk-accent)] flex items-center gap-2">
              <Reply className="w-4 h-4 text-[var(--qk-accent)] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-semibold text-[var(--qk-accent-light)]">
                  {replyTo.senderId === me?.id ? 'You' : partner.name}
                </p>
                <p className="text-xs text-white/60 truncate">{replyTo.snippet}</p>
              </div>
              <button onClick={() => setReplyTo(null)} className="p-1 rounded-full hover:bg-white/10" aria-label="Cancel reply">
                <X className="w-4 h-4 text-white/50" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Composer */}
      <div className="shrink-0 px-2 pb-1 flex items-end gap-1.5">
        <button
          onClick={() => galleryFileRef.current?.click()}
          className="shrink-0 w-10 h-10 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center"
          aria-label="Send photo or video"
        >
          <ImagePlus className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={openQuickyCapture}
          className="shrink-0 w-10 h-10 rounded-full bg-[var(--qk-accent)]/15 border border-[var(--qk-accent)]/30 text-[var(--qk-accent-light)] hover:bg-[var(--qk-accent)]/25 active:scale-95 transition-all flex items-center justify-center"
          aria-label="Send Quicky"
        >
          <Camera className="w-[18px] h-[18px]" />
        </button>
        <button
          onClick={startVoiceRecording}
          disabled={!!recording || !!voicePreview || !!text.trim()}
          className="shrink-0 w-10 h-10 rounded-full bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 active:scale-95 transition-all flex items-center justify-center disabled:opacity-30"
          aria-label="Record voice message"
        >
          <Mic className="w-[18px] h-[18px]" />
        </button>
        <textarea
          ref={textAreaRef}
          rows={1}
          value={text}
          onChange={(e) => onTextChanged(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              sendText()
            }
          }}
          placeholder="Type a message..."
          autoComplete="off"
          className="flex-1 min-w-0 resize-none bg-white/5 border border-white/10 rounded-3xl px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50 max-h-[120px] leading-snug"
        />
        {recording ? (
          <button
            onClick={stopVoiceRecording}
            className="shrink-0 w-10 h-10 rounded-full bg-[#FF3B30] text-white animate-quicky-pulse active:scale-95 transition-all flex items-center justify-center"
            aria-label="Stop recording"
          >
            <Square className="w-[18px] h-[18px]" fill="currentColor" stroke="none" />
          </button>
        ) : (
          <button
            onClick={() => sendText()}
            disabled={!text.trim()}
            className="shrink-0 w-10 h-10 rounded-full bg-coral-gradient text-white disabled:opacity-30 active:scale-95 transition-all flex items-center justify-center"
            aria-label="Send"
          >
            <Send className="w-[18px] h-[18px]" />
          </button>
        )}
      </div>
      <div className="shrink-0 h-2 safe-area-bottom" />

      {/* Voice recording bar */}
      <AnimatePresence>
        {recording && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="absolute left-0 right-0 bottom-16 mx-3 px-4 py-3 rounded-2xl bg-[var(--qk-card)] border border-[#FF3B30]/40 flex items-center gap-3 z-30"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-[#FF3B30] animate-quicky-pulse shrink-0" />
            <span className="text-sm font-mono font-semibold text-white/90 tabular-nums">
              {Math.floor(recElapsedMs / 60000)}:{String(Math.floor((recElapsedMs % 60000) / 1000)).padStart(2, '0')}
            </span>
            <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-[#FF3B30] transition-all" style={{ width: `${Math.min(100, (recElapsedMs / VOICE_MAX_MS) * 100)}%` }} />
            </div>
            <span className="text-[10px] text-white/40 shrink-0">max {VOICE_MAX_MS / 1000}s</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Voice preview + send/discard */}
      <AnimatePresence>
        {voicePreview && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            className="absolute left-0 right-0 bottom-16 mx-3 px-4 py-3 rounded-2xl bg-[var(--qk-card)] border border-white/10 flex items-center gap-3 z-30"
          >
            <VoiceBubblePlayback url={voicePreview.url} durationMs={voicePreview.durationMs} compact />
            <span className="text-xs text-white/50 shrink-0">
              {Math.round(voicePreview.durationMs / 1000)}s
            </span>
            <div className="flex-1" />
            <button
              onClick={cancelVoicePreview}
              className="p-2 rounded-full hover:bg-white/10 text-white/60"
              aria-label="Discard voice message"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={sendVoice}
              className="w-9 h-9 rounded-full bg-coral-gradient text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform"
              aria-label="Send voice message"
            >
              <Send className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden file sources */}
      <input
        ref={quickyFileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          onQuickyFile(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
      <input
        ref={galleryFileRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(e) => {
          sendMediaMessage(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />

      {/* Quicky duration picker — shown after media is selected */}
      {durationPickerOpen && pendingQuicky && (
        <div className="absolute inset-0 z-50 flex items-end sm:items-center sm:justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-[var(--qk-bg)] rounded-t-3xl sm:rounded-3xl w-full sm:max-w-xs p-5 border-t border-white/10">
            <h3 className="text-lg font-bold text-center">Send Quicky</h3>
            <p className="text-white/50 text-sm mb-4 text-center">Pick how long it stays visible</p>

            <div className="mx-auto mb-4 w-32 h-44 rounded-2xl overflow-hidden bg-black border border-white/10 flex items-center justify-center">
              {pendingQuicky.file.type.startsWith('video/') ? (
                <video src={pendingQuicky.previewUrl} className="w-full h-full object-cover" muted autoPlay loop playsInline />
              ) : (
                <img src={pendingQuicky.previewUrl} alt="Quicky preview" className="w-full h-full object-cover" />
              )}
            </div>

            <div className="grid grid-cols-4 gap-2 mb-4">
              {QUICKY.quickyDurations.map((d) => (
                <button
                  key={d}
                  onClick={() => setPickedDuration(d)}
                  className={cn(
                    'aspect-square rounded-2xl border flex flex-col items-center justify-center gap-0.5 active:scale-95 transition-all',
                    pickedDuration === d
                      ? 'border-[var(--qk-accent)] bg-coral-gradient text-white'
                      : 'border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/10 text-white/80 hover:bg-[var(--qk-accent)]/20'
                  )}
                >
                  <span className="text-xl font-bold">{d}</span>
                  <span className={cn('text-[10px]', pickedDuration === d ? 'text-white/90' : 'text-white/50')}>sec</span>
                </button>
              ))}
            </div>

            <button
              onClick={sendQuicky}
              disabled={sendingQuicky}
              className="w-full bg-coral-gradient glow-coral text-white rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <Camera className="w-4 h-4" />
              {sendingQuicky ? 'Sending...' : `Send for ${pickedDuration ?? QUICKY.quickyDefaultDuration}s`}
            </button>
            <button
              onClick={cancelQuicky}
              disabled={sendingQuicky}
              className="w-full mt-2 text-white/50 text-sm hover:text-white text-center"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Long-press context menu: reactions / reply / copy */}
      <AnimatePresence>
        {menuFor && (
          <>
            <motion.div
              className="absolute inset-0 bg-black/60 z-[60]"
              onClick={() => setMenuFor(null)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              className="absolute left-0 right-0 bottom-0 bg-[var(--qk-card)] border-t border-white/10 rounded-t-3xl p-4 z-[61] safe-area-bottom"
            >
              <div className="flex justify-between gap-1.5 mb-4">
                {REACTION_SET.map((emoji) => {
                  const mine = (menuFor.reactions ?? []).find((r) => r.userId === me?.id)
                  return (
                    <motion.button
                      key={emoji}
                      whileHover={{ scale: 1.2 }}
                      whileTap={{ scale: 1.4 }}
                      transition={{ type: 'spring', stiffness: 600, damping: 18 }}
                      onClick={() => reactToMessage(menuFor, emoji)}
                      className={cn(
                        'flex-1 aspect-square rounded-2xl flex items-center justify-center text-2xl transition-all',
                        mine?.emoji === emoji ? 'bg-[var(--qk-accent)]/25 ring-2 ring-[var(--qk-accent)]' : 'bg-white/5 hover:bg-white/10'
                      )}
                      aria-label={`React ${emoji}`}
                    >
                      {emoji}
                    </motion.button>
                  )
                })}
              </div>
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => {
                    setReplyTo({
                      id: menuFor.id,
                      senderId: menuFor.senderId,
                      type: menuFor.type,
                      snippet: menuFor.text ?? (menuFor.type === 'quicky' ? 'Quicky' : menuFor.type === 'video' ? 'Video' : 'Photo'),
                      duration: menuFor.quickyDuration ?? null,
                    })
                    setMenuFor(null)
                    textAreaRef.current?.focus()
                  }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-white/5 text-sm"
                >
                  <Reply className="w-4 h-4 text-white/60" /> Reply
                </button>
                {menuFor.text && (
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(menuFor.text ?? '').catch(() => {})
                      toast.success('Copied')
                      setMenuFor(null)
                    }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-white/5 text-sm"
                  >
                    <Copy className="w-4 h-4 text-white/60" /> Copy text
                  </button>
                )}
                <button
                  onClick={() => setMenuFor(null)}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-white/5 text-sm text-white/60"
                >
                  <ChevronDown className="w-4 h-4" /> Cancel
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Action sheet */}
      <AnimatePresence>
        {showActions && (
          <>
            <motion.div
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
              className="absolute left-0 right-0 bottom-0 bg-[var(--qk-card)] border-t border-white/10 rounded-t-3xl p-4 z-50"
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
                  icon={<ImagePlus className="w-5 h-5" />}
                  label="Photo / Video"
                  onClick={() => {
                    setShowActions(false)
                    galleryFileRef.current?.click()
                  }}
                  color="white"
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
                  icon={<Sparkles className="w-5 h-5" />}
                  label="Truth or Dare"
                  color="lavender"
                  onClick={() => {
                    setShowActions(false)
                    proposeGame('truth_or_dare')
                  }}
                />
                <SheetAction
                  icon={<Wine className="w-5 h-5" />}
                  label="Never Have I Ever"
                  color="lavender"
                  onClick={() => {
                    setShowActions(false)
                    proposeGame('never_have_i_ever')
                  }}
                />
                <SheetAction
                  icon={<Grid3X3 className="w-5 h-5" />}
                  label="Ludo"
                  color="white"
                  onClick={() => {
                    setShowActions(false)
                    proposeGame('ludo')
                  }}
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

      {/* ToD game overlay */}
      {toDOpen && matchId && (
        <TruthOrDareGame matchId={matchId} meId={me?.id ?? ''} partnerName={partner.name} onClose={() => setToDOpen(false)} />
      )}

      {/* Never Have I Ever game overlay */}
      {nhieOpen && matchId && (
        <NeverHaveIEver matchId={matchId} meId={me?.id ?? ''} partnerName={partner.name} onClose={() => setNhieOpen(false)} />
      )}

      {/* Ludo game room overlay */}
      {ludoOpen && matchId && (
        <LudoGame matchId={matchId} meId={me?.id ?? ''} partnerName={partner.name} onClose={() => setLudoOpen(false)} />
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
    coral: 'text-[var(--qk-accent)]',
    lavender: 'text-[var(--qk-purple)]',
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

// ─── Status ticks (WhatsApp-style) ────────────────────────────────────────────
function StatusTicks({ m }: { m: Msg }) {
  if (m.clientTmp && m.status === 'failed') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-[#FF3B30] mt-0.5 px-1">
        <AlertCircle className="w-3.5 h-3.5" /> Not sent · tap to retry
      </span>
    )
  }
  if (m.clientTmp && m.status === 'sending') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-white/40 mt-0.5 px-1">
        <Clock className="w-3.5 h-3.5" /> Sending
      </span>
    )
  }
  if (m.readAt) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-[var(--qk-accent)] mt-0.5 px-1">
        <CheckCheck className="w-3.5 h-3.5" /> Read
      </span>
    )
  }
  if (m.deliveredAt) {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-white/40 mt-0.5 px-1">
        <CheckCheck className="w-3.5 h-3.5" /> Delivered
      </span>
    )
  }
  return (
    <span className="flex items-center gap-0.5 text-[10px] text-white/40 mt-0.5 px-1">
      <Check className="w-3.5 h-3.5" /> Sent
    </span>
  )
}

// ─── Reaction chips ───────────────────────────────────────────────────────────
function ReactionChips({
  reactions,
  meId,
  onTap,
}: {
  reactions: Reaction[]
  meId: string
  onTap: (emoji: string) => void
}) {
  if (reactions.length === 0) return null
  const counts = new Map<string, number>()
  for (const r of reactions) counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1)
  const mine = reactions.find((r) => r.userId === meId)
  return (
    <div className="flex items-center gap-1 -mt-1.5 z-10 px-1">
      {[...counts.entries()].map(([emoji, n]) => (
        <motion.button
          key={emoji}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 18 }}
          onClick={() => onTap(emoji)}
          className={cn(
            'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs border backdrop-blur',
            mine?.emoji === emoji
              ? 'bg-[var(--qk-accent)]/25 border-[var(--qk-accent)]'
              : 'bg-[var(--qk-card)] border-white/10'
          )}
          aria-label={`Reaction ${emoji}${n > 1 ? ` ×${n}` : ''}`}
        >
          <span>{emoji}</span>
          {n > 1 && <span className="text-[10px] text-white/70">{n}</span>}
        </motion.button>
      ))}
    </div>
  )
}

// ─── Voice message playback (PRD §5.1) ─────────────────────────────────────
// Audio element is created lazily per playback so React state stays simple;
// progress bar updates via timeupdate.
function VoiceBubblePlayback({ url, durationMs, compact }: { url: string; durationMs: number | null; compact?: boolean }) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [speed, setSpeed] = useState<1 | 1.5 | 2>(1)

  const toggle = () => {
    if (!audioRef.current) {
      const audio = new Audio(url)
      audio.playbackRate = speed
      audio.ontimeupdate = () => {
        const total = audio.duration && isFinite(audio.duration) ? audio.duration : (durationMs ?? 0) / 1000
        setProgress(total > 0 ? Math.min(1, audio.currentTime / total) : 0)
      }
      audio.onended = () => {
        setPlaying(false)
        setProgress(0)
      }
      audioRef.current = audio
    }
    if (playing) {
      audioRef.current.pause()
      setPlaying(false)
    } else {
      audioRef.current.playbackRate = speed
      void audioRef.current.play().catch(() => setPlaying(false))
      setPlaying(true)
    }
  }

  const cycleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1
    setSpeed(next)
    if (audioRef.current) audioRef.current.playbackRate = next
  }

  useEffect(() => () => audioRef.current?.pause(), [])

  const secs = Math.round((durationMs ?? 0) / 1000)
  return (
    <div className={cn('flex items-center gap-2', compact ? '' : 'w-52')}>
      <button
        onClick={toggle}
        className="w-9 h-9 rounded-full bg-black/25 flex items-center justify-center shrink-0 active:scale-95 transition-transform"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
      >
        {playing ? <Pause className="w-4 h-4" fill="currentColor" /> : <Play className="w-4 h-4 ml-0.5" fill="currentColor" />}
      </button>
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="h-1 rounded-full bg-white/25 overflow-hidden">
          <div className="h-full bg-current rounded-full" style={{ width: `${progress * 100}%` }} />
        </div>
        {!compact && (
          <div className="flex items-center justify-between">
            <span className="text-[10px] opacity-70">{secs}s</span>
            <button onClick={cycleSpeed} className="text-[10px] font-semibold opacity-70 hover:opacity-100" aria-label="Playback speed">
              {speed}x
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBubble({
  m,
  meId,
  highlighted,
  onLongPress,
  onReact,
  onReply,
  onRetry,
  onOpenQuicky,
  onConsumeQuicky,
  onJumpTo,
}: {
  m: Msg
  meId: string
  highlighted: boolean
  onLongPress: () => void
  onReact: (emoji: string) => void
  onReply: () => void
  onRetry: () => void
  onOpenQuicky: (q: Msg) => Promise<void> | void
  onConsumeQuicky: () => void
  onJumpTo: (id: string) => void
}) {
  const isMe = m.senderId === meId
  const [viewerOpen, setViewerOpen] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const hapticFired = useRef(false)
  const press = useLongPress(onLongPress)

  const wrap = (node: React.ReactNode) => (
    <motion.div
      id={`msg-${m.id}`}
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 450, damping: 28 }}
      className={cn(
        'relative flex flex-col gap-0.5 max-w-[85%] select-none',
        isMe ? 'self-end items-end' : 'self-start items-start',
        highlighted && 'rounded-2xl ring-2 ring-[var(--qk-accent)] ring-offset-2 ring-offset-[var(--qk-bg)]'
      )}
    >
      <div className="relative w-full overflow-visible">
        {/* Swipe-to-reply icon indicator that emerges as bubble slides right */}
        <motion.div
          className={cn(
            'absolute top-1/2 -translate-y-1/2 -left-9 w-7 h-7 rounded-full flex items-center justify-center pointer-events-none transition-all duration-150',
            dragOffset > 10 ? 'opacity-100' : 'opacity-0',
            dragOffset >= 42
              ? 'bg-[var(--qk-accent)] text-white scale-110 shadow-lg glow-coral'
              : 'bg-white/15 text-white/70 scale-90'
          )}
          style={{
            transform: `translateY(-50%) translateX(${Math.min(dragOffset * 0.4, 16)}px)`,
          }}
        >
          <Reply className="w-3.5 h-3.5" />
        </motion.div>

        {/* Draggable bubble container for swipe-to-reply sideways */}
        <motion.div
          drag="x"
          dragDirectionLock
          dragConstraints={{ left: 0, right: 65 }}
          dragElastic={0.25}
          onDrag={(_, info) => {
            if (info.offset.x > 0) {
              setDragOffset(info.offset.x)
              if (info.offset.x >= 42 && !hapticFired.current) {
                hapticFired.current = true
                haptic()
              } else if (info.offset.x < 42) {
                hapticFired.current = false
              }
            }
          }}
          onDragEnd={(_, info) => {
            if (info.offset.x >= 40 || info.velocity.x > 160) {
              haptic()
              onReply()
            }
            setDragOffset(0)
            hapticFired.current = false
          }}
          animate={{ x: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        >
          {node}
        </motion.div>
      </div>

      <div className={isMe ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
        <ReactionChips reactions={m.reactions ?? []} meId={meId} onTap={(emoji) => onReact(emoji)} />
      </div>
    </motion.div>
  )

  if (m.type === 'system') {
    return (
      <div className="self-center px-3 py-1.5 rounded-full bg-white/5 text-xs text-white/60 text-center max-w-[80%]">
        {m.text}
      </div>
    )
  }

  const bubbleShell = cn(
    'relative rounded-3xl px-3.5 py-2 text-sm select-none',
    isMe ? 'bg-[var(--qk-accent)] text-white rounded-br-md' : 'bg-white/8 text-white rounded-bl-md'
  )

  if (m.type === 'quicky') {
    const consumed = !!m.quickyConsumedAt || !m.mediaUrl
    const isUnopened = !isMe && !m.quickyOpenedAt && !consumed
    const sending = isMe && m.clientTmp && m.status === 'sending'
    return wrap(
      <>
        <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
          <button
            onPointerDown={press.onPointerDown}
            onPointerUp={press.onPointerUp}
            onPointerLeave={press.onPointerLeave}
            onPointerCancel={press.onPointerCancel}
            onClick={() => {
              if (press.consumed()) return // long-press already opened the menu
              if (isMe) return // the sender can't open their own Quicky
              if (consumed) return // expired — nothing to view
              if (isUnopened) onOpenQuicky(m)
              setViewerOpen(true)
            }}
            className={cn(
              'relative max-w-[80%] rounded-3xl p-2 border-2 flex items-center gap-2',
              consumed
                ? 'border-white/10 bg-white/5 opacity-70'
                : 'border-[var(--qk-accent)] bg-[var(--qk-accent)]/10',
              isMe ? 'rounded-br-md' : 'rounded-bl-md',
              isUnopened && 'animate-quicky-pulse glow-coral'
            )}
          >
            <div className="relative w-14 h-18 rounded-2xl bg-black/30 flex items-center justify-center overflow-hidden">
              {m.mediaUrl && (m.quickyOpenedAt || isMe) ? (
                <img src={m.mediaUrl} alt="" className="w-full h-full object-cover blur-[6px]" />
              ) : (
                <Camera className={cn('w-6 h-6', consumed ? 'text-white/30' : 'text-[var(--qk-accent)]')} />
              )}
              {sending && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                </div>
              )}
              {/* Duration as a small badge, bottom-left corner */}
              <span className="absolute bottom-1 left-1 text-[9px] font-bold bg-black/70 text-white rounded-full px-1.5 py-[1px] tabular-nums">
                {m.quickyDuration}s
              </span>
            </div>
            <div className="flex flex-col items-start gap-0.5 pr-2">
              <span className={cn('text-xs font-semibold', consumed ? 'text-white/40' : 'text-[var(--qk-accent-light)]')}>
                {sending
                  ? `Sending… ${m.uploadPct ?? 0}%`
                  : isMe
                    ? m.status === 'failed'
                      ? 'Failed to send'
                      : m.quickyOpenedAt
                        ? 'Opened'
                        : "Sent · they haven't seen it"
                    : consumed
                      ? 'Expired'
                      : m.quickyOpenedAt
                        ? 'Replay'
                        : 'Tap to view'}
              </span>
              {m.screenshotFlagged && (
                <span className="text-[10px] text-white/50">screenshot flagged</span>
              )}
            </div>
          </button>
        </div>
        {sending && (
          <div className="w-[80%] max-w-[240px] h-1 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-[var(--qk-accent)] transition-all duration-200"
              style={{ width: `${m.uploadPct ?? 0}%` }}
            />
          </div>
        )}
        {isMe && !m.clientTmp && (
          <span className="text-[10px] text-white/40 px-1">
            {m.quickyOpenedAt ? 'Opened by them' : 'Delivered'}
          </span>
        )}
        {viewerOpen && m.mediaUrl && !isMe && (
          <QuickyViewer
            mediaUrl={m.mediaUrl}
            duration={m.quickyDuration ?? 5}
            onClose={() => setViewerOpen(false)}
            onConsumed={isMe ? undefined : onConsumeQuicky}
            onScreenshot={() => {
              // best-effort screenshot flag
            }}
          />
        )}
      </>
    )
  }

  if (m.type === 'image' || m.type === 'video') {
    return wrap(
      <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
        <div
          onPointerDown={press.onPointerDown}
          onPointerUp={press.onPointerUp}
          onPointerLeave={press.onPointerLeave}
          onPointerCancel={press.onPointerCancel}
          className={cn('max-w-[80%] rounded-3xl overflow-hidden', isMe ? 'rounded-br-md' : 'rounded-bl-md')}
        >
          {m.mediaUrl && (
            <img src={m.mediaUrl} alt="" className="max-h-60 object-cover" />
          )}
        </div>
      </div>
    )
  }

  if (m.type === 'voice') {
    return wrap(
      <div className={cn('flex flex-col', isMe ? 'items-end' : 'items-start')}>
        <div
          onPointerDown={press.onPointerDown}
          onPointerUp={press.onPointerUp}
          onPointerLeave={press.onPointerLeave}
          onPointerCancel={press.onPointerCancel}
          className={cn(bubbleShell, 'min-w-[13rem]', m.clientTmp && m.status === 'failed' && 'border border-[#FF3B30]/60 bg-[#FF3B30]/10')}
        >
          {m.mediaUrl ? (
            <VoiceBubblePlayback url={m.mediaUrl} durationMs={m.mediaDuration ?? null} />
          ) : (
            <span className="text-xs opacity-60">Voice message unavailable</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-white/30 mt-0.5 px-1">{timeLabel(m.createdAt)}</span>
          {isMe && <StatusTicks m={m} />}
        </div>
      </div>
    )
  }

  // text
  const failed = m.clientTmp && m.status === 'failed'
  return wrap(
    <div
      className={cn('flex flex-col', isMe ? 'items-end' : 'items-start')}
      onPointerDown={press.onPointerDown}
      onPointerUp={press.onPointerUp}
      onPointerLeave={press.onPointerLeave}
      onPointerCancel={press.onPointerCancel}
    >
      <div
        onClick={() => {
          if (press.consumed()) return
          if (failed) onRetry()
        }}
        className={cn(bubbleShell, failed && 'border border-[#FF3B30]/60 bg-[#FF3B30]/10 text-white', 'cursor-pointer')}
      >
        {/* Reply quote */}
        {m.replyTo && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onJumpTo(m.replyTo!.id)
            }}
            className={cn(
              'mb-1 w-full text-left px-2 py-1 rounded-lg border-l-2 text-xs',
              isMe ? 'bg-black/20 border-white/70' : 'bg-black/20 border-[var(--qk-accent)]'
            )}
          >
            <p className="font-semibold text-[10px] opacity-80">
              {m.replyTo.senderId === meId ? 'You' : 'Them'}
            </p>
            <p className="truncate opacity-70">{m.replyTo.snippet}</p>
          </button>
        )}
        {m.text}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-white/30 mt-0.5 px-1">{timeLabel(m.createdAt)}</span>
        {isMe && <StatusTicks m={m} />}
      </div>
    </div>
  )
}
