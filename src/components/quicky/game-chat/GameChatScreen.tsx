'use client'

// Quicky — GAME CHAT SCREEN (game-chat PRD §22-§33/§78-§84/§94-§97/§124)
//
// Private 1-to-1 chat with another PLAYER (never a dating match) — visually
// part of the Spin the Bottle section. Layout: compact header (§33), message
// list, composer. Everything realtime via the shared store stream:
//   · optimistic bubbles + retry, never silently lost (§22)
//   · reply-by-swipe on mobile (§25), hover ⋯ actions on web (§30), with a
//     non-gesture ⋯ control as the accessible equivalent (§124)
//   · long-press reaction picker ~500ms (§28/§29)
//   · read receipts ✓ / ✓✓ (§17), NO typing indicator (§18 — disabled)
//   · near-bottom autoscroll / "New messages" pill (§79)
//   · sticker tray backed by admin bundles + coin purchase (§62/§76/§78)
//
// Bug-fix PRD additions (this phase):
//   · §3/§5/§6/§156: NO black screen — error boundary ("Unable to load
//     chat" + Try again), a loading beat while the conversation resolves,
//     a "User unavailable" state for a deleted peer, never a blank page.
//   · §56-§67: image + voice messaging (upload → preview → send), with
//     MediaRecorder and a graceful "unavailable" fallback (§67).
//   · §68-§74: Quicky Image — a special ⚡ message that earns Quicky Points
//     server-side and renders with a "+N Quicky" badge.
//   · §81-§84: one typed message renderer with per-type bubbles; replies and
//     reactions work for every media type.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, Plus, Send, X, Mic, Image as ImageIcon, Zap, Play, Square, MoreVertical, UserPlus, UserMinus, Ban, Eraser, ShieldAlert } from 'lucide-react'
import { api, uploadFile } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { ComplaintModal } from '../ComplaintModal'
import { CosmeticAvatar, NameDecorators, chatBubbleStyle, ChatBubbleFrame, type EquippedCosmetic } from '../cosmetics/Cosmetics'
import { useQuickyStore } from '@/store/quicky'
import { useGameChatStore, type GameChatMessage } from '@/store/game-chat'
import { StickerPicker } from './StickerPicker'
import { Component, type ReactNode } from 'react'

const REACTIONS = ['❤️', '😂', '😮', '😢', '👍', '🔥'] // §28 picker set
const NEAR_BOTTOM_PX = 140
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

function isImageAsset(url: string) {
  // https (Supabase) OR root-relative /uploads/… (local-storage dev fallback)
  // OR data: URIs — anything else is an emoji glyph.
  return /^https?:\/\//i.test(url) || url.startsWith('/') || url.startsWith('data:image/')
}

function StickerAsset({ sticker }: { sticker: { name: string; assetUrl: string } }) {
  if (isImageAsset(sticker.assetUrl)) {
     
    return <img src={sticker.assetUrl} alt={sticker.name} className="w-20 h-20 object-contain" draggable={false} />
  }
  return <span className="text-5xl leading-none" role="img" aria-label={sticker.name}>{sticker.assetUrl}</span>
}

// ─── §5: ERROR BOUNDARY — a chat crash must NEVER paint a black screen ──────
class GameChatErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    // §5: the underlying error must be logged.
    console.error('[GameChat] render failure:', error)
  }
  render() {
    if (this.state.error) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[var(--qk-bg)] text-white px-8 text-center">
          <span className="text-4xl" aria-hidden>💬</span>
          <p className="font-bold">Unable to load chat.</p>
          <p className="text-white/50 text-xs max-w-[26ch]">{this.state.error.message || 'Something went wrong.'}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-1 bg-coral-gradient rounded-xl px-6 py-2.5 text-sm font-black active:scale-95 transition-transform"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export function GameChatScreen({
  onBack,
  embedded = false,
  visible = true,
}: {
  onBack?: () => void
  /** Inside the room chat panel: the host lifts the overlay via the room's
   * --sbr-kb var, so this screen must NOT run its own visualViewport
   * keyboard shim — a second shift pushes the composer out of the sheet. */
  embedded?: boolean
  /** READ-RECEIPT GATE — true ONLY while this screen is actually the panel
   * the user is looking at. The room keeps the embedded screen MOUNTED
   * (hidden) to preserve scroll; passing `roomChatPanel === 'personal'`
   * here keeps read receipts honest: messages arriving while false stay
   * "sent" for the sender and count into the receiver's unread badge. */
  visible?: boolean
}) {
  return (
    <GameChatErrorBoundary>
      <GameChatScreenInner onBack={onBack} embedded={embedded} visible={visible} />
    </GameChatErrorBoundary>
  )
}

function GameChatScreenInner({
  onBack,
  embedded,
  visible = true,
}: {
  onBack?: () => void
  embedded?: boolean
  visible?: boolean
}) {
  const me = useQuickyStore((s) => s.user)
  const peer = useGameChatStore((s) => s.activePeer)
  // Admin-console PRD §9 — equipped cosmetics for both participants
  // (peer: avatar + name decorators + bubble; mine: bubble).
  const peerCosmetics = useGameChatStore((s) => s.peerCosmetics)
  const myCosmetics = useGameChatStore((s) => s.myCosmetics)
  const myBubbleStyle = useMemo(() => chatBubbleStyle(myCosmetics), [myCosmetics])
  const peerBubbleStyle = useMemo(() => chatBubbleStyle(peerCosmetics), [peerCosmetics])
  const conversationId = useGameChatStore((s) => s.activeConversationId)
  // Refactor PRD §53 — personal chat ••• actions: Friend / Block / Clear
  // Chat / Complaint, generated from the real relationship state.
  const [relMenu, setRelMenu] = useState(false)
  const [rel, setRel] = useState<{ isFriend: boolean; iBlockedThem: boolean; theyBlockedMe: boolean } | null>(null)
  const [relBusy, setRelBusy] = useState(false)
  const [complaintOpen, setComplaintOpen] = useState(false)
  const messages = useGameChatStore((s) => s.messages)
  const hasMore = useGameChatStore((s) => s.hasMore)
  const loadingOlder = useGameChatStore((s) => s.loadingOlder)
  const peerLastReadAt = useGameChatStore((s) => s.peerLastReadAt)
  const replyTo = useGameChatStore((s) => s.replyTo)
  const opening = useGameChatStore((s) => s.opening)
  const openError = useGameChatStore((s) => s.openError)
  const closeGameChat = useQuickyStore((s) => s.closeGameChat)

  const meId = me?.id ?? ''
  const [draft, setDraft] = useState('')
  const [showTray, setShowTray] = useState(false)
  const [pickerFor, setPickerFor] = useState<string | null>(null) // messageId with open reaction picker
  const [unreadBelow, setUnreadBelow] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const longPress = useRef<{ timer: ReturnType<typeof setTimeout> | null; x: number; y: number }>({ timer: null, x: 0, y: 0 })
  const lastMsgId = messages.length ? messages[messages.length - 1].id : null
  const prevLastIdRef = useRef<string | null>(null)
  // READ-RECEIPT (dating-chat parity): set when a PEER message arrives while
  // this screen is hidden (room tab active) or the message is OUT of the
  // view area (scrolled up) — it flips the moment the message is actually
  // seen: screen visible again, or the user scrolls it into view.
  const unseenPeerMsgRef = useRef(false)

  // ── document visibility — a backgrounded app is NOT "viewing the chat" ──
  const [docVisible, setDocVisible] = useState(true)
  useEffect(() => {
    const onVis = () => setDocVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  const screenVisible = (visible ?? true) && docVisible

  // ── RULES OF HOOKS (layout PRD §93): every hook below must run on EVERY
  // render. The old `if (!peer) return null` HERE sat above the effects, so
  // the first render (peer still resolving) skipped them and the next render
  // ran them → "Rendered more hooks than during the previous render" at the
  // markActiveRead effect (hook #54). The null-peer guard now lives directly
  // above the JSX return, where it renders a loading beat — never a black
  // screen — and every render executes the exact same hook sequence.
  const peerName = peer?.peerName ?? 'Player'

  // ── mark read — DATING-CHAT FLOW (§16/§17, read-receipt fix) ──────────
  // A message is READ only when the RECEIVER is on the chat screen AND the
  // message is in the view area. Three (and only three) triggers:
  //   1. the conversation opens (scroll-to-bottom puts history in view),
  //   2. a peer message ARRIVES while visible + near bottom (in view),
  //   3. the user scrolls an unseen message INTO view (or returns to the
  //      tab/screen while at bottom).
  const markReadNow = useCallback(() => {
    const cid = useGameChatStore.getState().activeConversationId
    if (!cid) return
    unseenPeerMsgRef.current = false
    useGameChatStore.getState().markActiveRead()
  }, [])

  useEffect(() => {
    // Returning to a VISIBLE chat at the bottom = the newest messages are
    // in the view area → they are read. Returning while scrolled up keeps
    // them unread until the user scrolls them into sight (onScroll).
    if (screenVisible && nearBottomRef.current) markReadNow()
  }, [conversationId, screenVisible, markReadNow])

  // ── scroll behavior (§79): near-bottom → autoscroll; scrolled up → pill ──
  const scrollToBottom = useCallback((smooth = false) => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    nearBottomRef.current = true
    setUnreadBelow(0)
  }, [])

  useEffect(() => {
    scrollToBottom(false)
  }, [conversationId, scrollToBottom])

  useEffect(() => {
    if (!lastMsgId) return
    if (prevLastIdRef.current === null) {
      prevLastIdRef.current = lastMsgId
      return
    }
    const isNew = prevLastIdRef.current !== lastMsgId
    prevLastIdRef.current = lastMsgId
    if (!isNew) return
    const fromPeer = messages.length > 0 && messages[messages.length - 1].senderId !== meId
    if (fromPeer) {
      if (screenVisible && nearBottomRef.current) {
        // On screen + in the view area → the sender's ✓ flips to ✓✓ NOW.
        scrollToBottom(true)
        markReadNow()
      } else {
        // Hidden or scrolled away → stays "sent" for the sender; the
        // receiver's unread badge counts it until it is actually seen.
        unseenPeerMsgRef.current = true
        if (!nearBottomRef.current) setUnreadBelow((n) => n + 1)
      }
    } else if (nearBottomRef.current) {
      scrollToBottom(true)
    } else {
      setUnreadBelow((n) => n + 1)
    }
  }, [lastMsgId, screenVisible, scrollToBottom, markReadNow, messages, meId])

  const onScroll = () => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX
    nearBottomRef.current = nearBottom
    if (nearBottom && unreadBelow > 0) setUnreadBelow(0)
    // Scrolled the unseen messages INTO the view area → they are read now.
    if (nearBottom && unseenPeerMsgRef.current) markReadNow()
    // §24: scrolled to the top → load older messages (cursor pagination)
    if (el.scrollTop <= 4 && hasMore && !loadingOlder) {
      const beforeH = el.scrollHeight
      void useGameChatStore.getState().loadOlder().then(() => {
        requestAnimationFrame(() => {
          if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight - beforeH
        })
      })
    }
  }

  // ── keyboard overlay (§80): composer rides above the keyboard ────────────
  // `embedded` (inside the room chat panel) skips this shim: the room lifts
  // the whole overlay with its own --sbr-kb var — a second shift here would
  // push the composer out of the sheet.
  const [kb, setKb] = useState(0)
  useEffect(() => {
    if (embedded) return
    const vv = window.visualViewport
    if (!vv) return
    const onVV = () => {
      const h = window.innerHeight - vv.height - vv.offsetTop
      setKb(Math.max(0, Math.min(h, window.innerHeight * 0.6)))
    }
    vv.addEventListener('resize', onVV)
    vv.addEventListener('scroll', onVV)
    return () => {
      vv.removeEventListener('resize', onVV)
      vv.removeEventListener('scroll', onVV)
    }
  }, [embedded])

  // ── sticker tray (§78) — the tabbed StickerPicker owns its catalog load
  // (owned stickers + shop) so this screen stays lean.
  const sendPickedSticker = (s: { id: string; name: string; assetUrl: string }) => {
    useGameChatStore.getState().sendSticker({ id: s.id, name: s.name, assetUrl: s.assetUrl })
    setShowTray(false)
  }

  const send = () => {
    if (!draft.trim()) return
    useGameChatStore.getState().sendMessage(draft)
    setDraft('')
    inputRef.current?.focus()
  }

  const startLongPress = (messageId: string) => (e: React.PointerEvent) => {
    // §29: ~500ms threshold, cancelled when the finger moves significantly
    longPress.current = { x: e.clientX, y: e.clientY, timer: null }
    longPress.current.timer = setTimeout(() => {
      setPickerFor(messageId)
      if (navigator.vibrate) navigator.vibrate(12)
    }, 500)
  }
  const moveLongPress = (e: React.PointerEvent) => {
    const lp = longPress.current
    if (lp.timer && (Math.abs(e.clientX - lp.x) > 10 || Math.abs(e.clientY - lp.y) > 10)) {
      clearTimeout(lp.timer)
      lp.timer = null
    }
  }
  const endLongPress = () => {
    if (longPress.current.timer) {
      clearTimeout(longPress.current.timer)
      longPress.current.timer = null
    }
  }

  const react = (messageId: string, reaction: string) => {
    useGameChatStore.getState().toggleReaction(messageId, reaction)
    setPickerFor(null)
  }

  const peerReadDate = peerLastReadAt ? new Date(peerLastReadAt).getTime() : 0
  const lastMine = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].senderId === meId && !messages[i].failed) return messages[i]
    }
    return null
  }, [messages, meId])

  // ─── Media composer state (§56-§67) ───────────────────────────────────────
  // Preview gate (§62): selecting NEVER sends — the user confirms with Send
  // or discards with Cancel. Upload failures keep the preview open (§116).
  type Preview = { blob: Blob; objectUrl: string; kind: 'image' | 'voice' | 'quicky_image'; duration?: number }
  const [preview, setPreview] = useState<Preview | null>(null)
  const [uploading, setUploading] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const quickyInputRef = useRef<HTMLInputElement>(null)
  const previewKindRef = useRef<'image' | 'quicky_image'>('image')

  // §61: downscale oversized images before upload (fast chat, low storage).
  const compressImage = async (file: File): Promise<Blob> => {
    if (file.type === 'image/gif' || file.size <= 1024 * 1024) return file
    try {
      const bmp = await createImageBitmap(file)
      const max = 1600
      const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
      if (scale >= 1) return file
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bmp.width * scale)
      canvas.height = Math.round(bmp.height * scale)
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85))
      return blob ?? file
    } catch {
      return file
    }
  }

  const onPickImage = async (file: File | null | undefined, kind: 'image' | 'quicky_image') => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('That file is not an image')
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error('Image is too large (max 12MB)')
      return
    }
    previewKindRef.current = kind
    const blob = await compressImage(file)
    setPreview({ blob, objectUrl: URL.createObjectURL(blob), kind })
  }

  // ── Voice (§63-§67): tap mic → record → stop → preview → send/cancel.
  // Browsers without MediaRecorder get a friendly notice, never a crash.
  const canRecord = typeof window !== 'undefined' && typeof (window as any).MediaRecorder !== 'undefined'
  const [recording, setRecording] = useState(false)
  const [recSecs, setRecSecs] = useState(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stopRecorder = useCallback(() => {
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    recTimerRef.current = null
    try {
      recorderRef.current?.stop()
    } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setRecording(false)
  }, [])

  const startRecording = async () => {
    if (recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const rec = new MediaRecorder(stream)
      chunksRef.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        setRecSecs((secs) => {
          if (secs > 0) setPreview({ blob, objectUrl: URL.createObjectURL(blob), kind: 'voice', duration: secs * 1000 })
          return secs
        })
      }
      recorderRef.current = rec
      rec.start()
      setRecSecs(0)
      setRecording(true)
      recTimerRef.current = setInterval(() => {
        setRecSecs((s) => {
          if (s >= 60) {
            stopRecorder() // §64: hard 60s cap
            return s
          }
          return s + 1
        })
      }, 1000)
    } catch {
      toast.error('Microphone unavailable — check permissions')
    }
  }

  const cancelPreview = () => {
    if (preview) URL.revokeObjectURL(preview.objectUrl)
    setPreview(null)
  }

  const sendPreview = async () => {
    if (!preview || uploading) return
    setUploading(true)
    try {
      // §57: upload to storage → create message → realtime
      const kindParam = preview.kind === 'voice' ? 'voice' : 'quicky'
      const res = await uploadFile(preview.blob, kindParam)
      if (!res?.url) throw new Error('upload failed')
      useGameChatStore.getState().sendMedia(previewKindRef.current === 'quicky_image' ? 'quicky_image' : preview.kind, res.url, preview.duration)
      cancelPreview()
    } catch {
      // §116: keep the preview so the user can retry — no broken row.
      toast.error(preview.kind === 'voice' ? 'Voice upload failed' : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // §6/§156: no peer yet → loading beat. ALL hooks already ran above, so
  // this render is hook-consistent with every other render (see the note at
  // the top of the component). Peer resolution failure lands in openError
  // (rendered below) — a missing peer is never a blank screen.
  if (!peer) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-3 bg-[var(--qk-bg)] text-white"
        data-testid="game-chat-loading"
      >
        <div className="w-9 h-9 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
        <p className="text-white/60 text-sm">Loading conversation…</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white relative overflow-hidden">
      {/* ambient glow — decorative only, never swallows taps */}
      <div className="pointer-events-none absolute -top-24 -right-16 w-72 h-72 rounded-full bg-[var(--qk-purple)]/15 blur-3xl" aria-hidden />

      {/* ─── Header (§33): compact — back, avatar, name, ⋯ actions. ── */}
      <header className="shrink-0 safe-area-top px-2 pt-2.5 pb-2 flex items-center gap-2 border-b border-white/10 bg-[var(--qk-bg)]/80 backdrop-blur relative z-20">
        <button
          onClick={() => {
            if (onBack) {
              onBack()
              return
            }
            // §97: back returns to the context that opened the chat
            useGameChatStore.getState().closeConversation()
            closeGameChat()
          }}
          className="p-2 rounded-full hover:bg-white/10"
          aria-label="Back"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        {peer.peerAvatar || (peerCosmetics && peerCosmetics.length > 0) ? (
          <CosmeticAvatar src={peer.peerAvatar} name={peerName ?? 'Player'} cosmetics={peerCosmetics} size="sm" />
        ) : (
          <span className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-sm" aria-hidden>🎲</span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-white font-bold text-sm leading-tight truncate">
            <NameDecorators name={peerName} cosmetics={peerCosmetics} />
          </p>
          <p className="text-white/40 text-[11px] leading-tight">Game chat</p>
        </div>
        {peer.peerUserId && (
          <div className="relative" data-testid="game-chat-actions">
            <button
              onClick={async () => {
                const next = !relMenu
                setRelMenu(next)
                if (next && !rel) {
                  try {
                    setRel(await api.relationship(peer.peerUserId))
                  } catch {
                    setRel(null)
                  }
                }
              }}
              className="p-2 rounded-full hover:bg-white/10"
              aria-label="Conversation actions"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
            {relMenu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setRelMenu(false)} />
                <div className="absolute right-0 top-11 z-40 w-52 rounded-2xl border border-white/10 bg-[var(--qk-card)] shadow-2xl p-1.5 flex flex-col">
                  <button
                    onClick={async () => {
                      if (relBusy) return
                      setRelBusy(true)
                      try {
                        if (rel?.isFriend) {
                          await api.friends.remove(peer.peerUserId)
                          toast.success('Friend removed')
                        } else {
                          await api.friends.add(peer.peerUserId)
                          toast.success('Friend added')
                        }
                        setRel(await api.relationship(peer.peerUserId))
                      } catch (e: any) {
                        toast.error(e?.status === 409 ? 'Already friends' : (e?.message ?? 'Failed'))
                      } finally {
                        setRelBusy(false)
                      }
                    }}
                    disabled={relBusy || rel?.theyBlockedMe}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/5 text-sm text-white/85 disabled:opacity-40 text-left"
                  >
                    {rel?.isFriend ? <UserMinus className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                    {rel?.isFriend ? 'Remove Friend' : 'Add Friend'}
                  </button>
                  <button
                    onClick={async () => {
                      if (relBusy) return
                      setRelBusy(true)
                      try {
                        if (rel?.iBlockedThem) {
                          await api.blocks.remove(peer.peerUserId)
                          toast.success('Unblocked')
                        } else {
                          await api.blocks.add(peer.peerUserId)
                          toast.success('Blocked')
                        }
                        setRel(await api.relationship(peer.peerUserId))
                        setRelMenu(false)
                      } catch (e: any) {
                        toast.error(e?.message ?? 'Failed')
                      } finally {
                        setRelBusy(false)
                      }
                    }}
                    disabled={relBusy}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/5 text-sm text-white/85 text-left"
                  >
                    <Ban className="w-4 h-4" />
                    {rel?.iBlockedThem ? 'Unblock' : 'Block'}
                  </button>
                  <button
                    onClick={async () => {
                      if (!conversationId || !confirm('Clear this conversation?')) return
                      try {
                        await api.gameChat.clear(conversationId)
                        setRelMenu(false)
                        toast.success('Conversation cleared')
                        // reload the (now-cleared) view for me only (§56)
                        useGameChatStore.getState().openConversation(peer)
                      } catch (e: any) {
                        toast.error(e?.message ?? 'Failed')
                      }
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/5 text-sm text-white/85 text-left"
                  >
                    <Eraser className="w-4 h-4" />
                    Clear Chat
                  </button>
                  <button
                    onClick={() => {
                      setRelMenu(false)
                      setComplaintOpen(true)
                    }}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl hover:bg-white/5 text-sm text-[var(--qk-accent)] text-left"
                  >
                    <ShieldAlert className="w-4 h-4" />
                    Complaint
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </header>

      {/* ─── §6/§7/§156: loading / error / user-gone — NEVER a black screen ── */}
      {opening ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3" data-testid="game-chat-loading">
          <div className="w-9 h-9 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
          <p className="text-white/60 text-sm">Loading conversation…</p>
        </div>
      ) : openError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center" data-testid="game-chat-error">
          <span className="text-4xl" aria-hidden>{openError === 'user_gone' ? '🚪' : '⚠️'}</span>
          <p className="font-bold text-sm">{openError === 'user_gone' ? 'User unavailable' : 'Unable to load chat.'}</p>
          <p className="text-white/50 text-xs">
            {openError === 'user_gone' ? 'This player is no longer available.' : 'Check your connection and try again.'}
          </p>
          <button
            onClick={() => useGameChatStore.getState().openConversation(peer)}
            className="mt-1 bg-coral-gradient rounded-xl px-6 py-2.5 text-sm font-black active:scale-95 transition-transform"
          >
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* ─── Messages ──────────────────────────────────────────────────────── */}
          <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2 relative">
            {hasMore && (
              <div className="flex justify-center py-1">
                {loadingOlder ? (
                  <span className="text-white/40 text-xs">Loading…</span>
                ) : (
                  <button onClick={() => void useGameChatStore.getState().loadOlder()} className="text-[11px] font-semibold text-white/50 hover:text-white/80 px-3 py-1 rounded-full bg-white/5">
                    Load earlier messages
                  </button>
                )}
              </div>
            )}

            {/* §13: with only a few messages they anchor naturally toward the
                composer instead of sticking to the top — the viewport still
                fills the pane; once content overflows the spacer is 0. */}
            <div aria-hidden className="mt-auto shrink-0" />

            {messages.length === 0 && (
              // §95: no existing conversation — invite to say hello
              <div className="flex-1 flex flex-col items-center justify-center gap-1.5 py-16 text-center" data-testid="game-chat-empty">
                <span className="text-3xl" aria-hidden>👋</span>
                <p className="text-white font-semibold text-sm">No messages yet.</p>
                <p className="text-white/45 text-xs">Say hello to {peerName}</p>
              </div>
            )}

            {messages.map((m) => (
              <GameBubble
                key={m.id}
                m={m}
                mine={m.senderId === meId}
                isLastMine={lastMine?.id === m.id}
                read={peerReadDate >= new Date(m.createdAt).getTime()}
                bubbleStyle={m.senderId === meId ? myBubbleStyle : peerBubbleStyle}
                bubbleCosmetics={m.senderId === meId ? myCosmetics : peerCosmetics}
                onReply={() => useGameChatStore.getState().setReplyTo(m)}
                onReact={() => setPickerFor(m.id)}
                onRetry={() => m.clientMessageId && useGameChatStore.getState().retryMessage(m.clientMessageId)}
                onLongPressStart={startLongPress(m.id)}
                onLongPressMove={moveLongPress}
                onLongPressEnd={endLongPress}
              />
            ))}
          </div>

          {/* "New messages" pill (§79) */}
          <AnimatePresence>
            {unreadBelow > 0 && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                onClick={() => scrollToBottom(true)}
                className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 px-4 py-1.5 rounded-full bg-coral-gradient text-xs font-bold shadow-lg"
              >
                {unreadBelow === 1 ? 'New message' : `${unreadBelow} new messages`} ↓
              </motion.button>
            )}
          </AnimatePresence>

          {/* ─── Reaction picker (§28) — same for web hover ⋯ → React (§30) ─────── */}
          <AnimatePresence>
            {pickerFor && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setPickerFor(null)} />
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 16, scale: 0.95 }}
                  transition={{ duration: 0.18 }}
                  className="absolute inset-x-0 bottom-28 z-[61] mx-auto w-fit flex items-center gap-1 bg-[var(--qk-card)] border border-white/15 rounded-full px-3 py-2 shadow-2xl"
                  role="menu"
                  aria-label="React"
                >
                  {REACTIONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => react(pickerFor, r)}
                      className="text-2xl p-1 rounded-full hover:bg-white/10 active:scale-90 transition-transform"
                      aria-label={`React ${r}`}
                    >
                      {r}
                    </button>
                  ))}
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* ─── Reply preview + cancel (§25/§26) ────────────────────────────────── */}
          {/* ─── EMBED DOCK — reply banner + sticker tray + composer. Inside
              the room chat shell this whole stack pops out of the panel and
              floats above the keyboard (.sbr-chat.sbr-kb-open .qk-embed-dock
              in spin-bottle-room.css); standalone (full screen) it is a
              plain passthrough column. ───────────────────────────── */}
          <div className="qk-embed-dock shrink-0 flex flex-col">
          <AnimatePresence>
            {replyTo && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="shrink-0 overflow-hidden border-t border-white/10 bg-white/5"
              >
                <div className="px-3 py-2 flex items-start gap-2">
                  <div className="min-w-0 flex-1 border-l-2 border-[var(--qk-accent)] pl-2">
                    <p className="text-[11px] font-bold text-[var(--qk-accent)]">
                      Replying to {replyTo.senderId === meId ? 'yourself' : peerName}
                    </p>
                    <p className="text-xs text-white/60 truncate">
                      {replyTo.messageType === 'sticker'
                        ? '🎁 Sticker'
                        : replyTo.messageType === 'image'
                          ? '🖼 Image'
                          : replyTo.messageType === 'voice'
                            ? '🎙 Voice message'
                            : replyTo.messageType === 'quicky_image'
                              ? '⚡ Quicky Image'
                              : replyTo.text}
                    </p>
                  </div>
                  <button onClick={() => useGameChatStore.getState().setReplyTo(null)} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Cancel reply">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ─── Media preview gate (§62): Cancel / Send — never auto-send ─────── */}
          <AnimatePresence>
            {preview && (
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                className="absolute inset-x-0 bottom-16 z-40 mx-3 rounded-2xl border border-white/15 bg-[var(--qk-card)]/95 backdrop-blur p-3 flex flex-col gap-2"
                data-testid="game-chat-media-preview"
              >
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-white/80">
                    {preview.kind === 'voice' ? '🎙 Voice message' : preview.kind === 'quicky_image' ? '⚡ Quicky Image' : '🖼 Image'}
                    {preview.kind !== 'voice' && preview.kind !== 'quicky_image' ? null : preview.kind === 'quicky_image' ? ' · earns Quicky Points' : ''}
                  </p>
                  <button onClick={cancelPreview} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Cancel">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex items-center justify-center min-h-[120px] rounded-xl bg-black/30 overflow-hidden">
                  {preview.kind === 'voice' ? (
                    <audio src={preview.objectUrl} controls className="w-full m-3" data-testid="voice-preview" />
                  ) : (
                     
                    <img src={preview.objectUrl} alt="Preview" className="max-h-56 w-auto object-contain" />
                  )}
                </div>
                <button
                  onClick={sendPreview}
                  disabled={uploading}
                  className="bg-coral-gradient rounded-xl py-2.5 text-sm font-black active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  {uploading ? 'Uploading…' : 'Send'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ─── Sticker tray (§62/§76/§78) ──────────────────────────────────────── */}
          <AnimatePresence>
            {showTray && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="shrink-0 overflow-hidden border-t border-white/10 bg-[var(--qk-card)]/95"
              >
                <div className="px-3 py-2.5 flex flex-col gap-2.5">
                  {/* §68: Quicky Image — the special points-earning send */}
                  <button
                    onClick={() => quickyInputRef.current?.click()}
                    className="flex items-center gap-2.5 rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 hover:bg-white/10 active:scale-[0.99] transition text-left"
                    data-testid="quicky-image-option"
                  >
                    <span className="w-9 h-9 rounded-xl bg-coral-gradient flex items-center justify-center" aria-hidden>
                      <Zap className="h-4.5 w-4.5" size={18} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-white">Send a Quicky Image</span>
                      <span className="block text-[11px] text-white/50">A special ⚡ photo that earns Quicky Points &amp; keeps your streak</span>
                    </span>
                  </button>
                  {/* Two-tab sticker picker — My Stickers | Sticker Shop (coin
                      purchase / claim unlocks) — owns its catalog loading. */}
                  <StickerPicker
                    onPick={sendPickedSticker}
                    className="max-h-60"
                    pickLabel="Tap a sticker to send it in this chat"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ─── Composer (§18/§56): [ + ] [ 🖼 | 🎙 ] [ Message… ] [ ➤ ] ───────── */}
          <div
            className="shrink-0 border-t border-white/10 bg-[var(--qk-bg)]/95 backdrop-blur px-2.5 py-2 flex items-center gap-2"
            style={{ marginBottom: kb > 0 ? kb : 0 }}
          >
            <button
              onClick={() => setShowTray((v) => !v)}
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 border ${showTray ? 'bg-white/15 border-white/20' : 'bg-white/5 border-white/10'} hover:bg-white/10`}
              aria-label="Stickers and more"
            >
              <Plus className={`h-4 w-4 transition-transform ${showTray ? 'rotate-45' : ''}`} />
            </button>
            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={recording}
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 hover:bg-white/10 disabled:opacity-40"
              aria-label="Send image"
            >
              <ImageIcon className="h-4 w-4" />
            </button>
            {recording ? (
              <div className="flex-1 min-w-0 flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2.5" data-testid="voice-recording-bar">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" aria-hidden />
                <span className="text-xs font-bold text-white/80 tabular-nums">Recording {recSecs}s</span>
                <button
                  onClick={stopRecorder}
                  className="ml-auto w-8 h-8 rounded-full bg-coral-gradient flex items-center justify-center shrink-0 active:scale-95 transition"
                  aria-label="Stop recording"
                >
                  <Square className="h-3.5 w-3.5" fill="currentColor" />
                </button>
                <button
                  onClick={() => {
                    // discard: stop without keeping chunks
                    chunksRef.current = []
                    stopRecorder()
                    setRecSecs(0)
                  }}
                  className="text-xs font-bold text-white/50 hover:text-white px-1"
                  aria-label="Cancel recording"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={canRecord ? startRecording : () => toast('Voice messages unavailable on this browser.')}
                disabled={showTray}
                className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center shrink-0 hover:bg-white/10 disabled:opacity-40"
                aria-label={canRecord ? 'Record voice message' : 'Voice messages unavailable on this browser'}
                data-testid="voice-mic"
              >
                <Mic className="h-4 w-4" />
              </button>
            )}
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              placeholder="Message…"
              maxLength={2000}
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm text-white placeholder:text-white/35 outline-none focus:border-white/25"
              aria-label="Message"
            />
            <button
              onClick={send}
              disabled={!draft.trim()}
              className="w-9 h-9 rounded-full bg-coral-gradient flex items-center justify-center shrink-0 disabled:opacity-40 active:scale-95 transition"
              aria-label="Send"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
          </div>
        </>
      )}

      {/* hidden file inputs (§56) */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onPickImage(e.target.files?.[0], 'image')
          e.target.value = ''
        }}
      />
      <input
        ref={quickyInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void onPickImage(e.target.files?.[0], 'quicky_image')
          e.target.value = ''
        }}
      />

      {/* Refactor PRD §57 — complaint modal (§58/§59 server records) */}
      <ComplaintModal
        open={complaintOpen}
        onClose={() => setComplaintOpen(false)}
        reportedUserId={peer.peerUserId}
        reportedName={peer.peerName}
        conversationId={conversationId}
      />
    </div>
  )
}

/* ─── §82: ONE message renderer — per-type bubble components ─────────────── */
function GameBubble({
  m,
  mine,
  isLastMine,
  read,
  bubbleStyle,
  bubbleCosmetics,
  onReply,
  onReact,
  onRetry,
  onLongPressStart,
  onLongPressMove,
  onLongPressEnd,
}: {
  m: GameChatMessage
  mine: boolean
  isLastMine: boolean
  read: boolean
  /** Admin-console PRD §9 — equipped CHAT_BUBBLE styling for this sender. */
  bubbleStyle?: React.CSSProperties
  bubbleCosmetics?: EquippedCosmetic[] | null
  onReply: () => void
  onReact: () => void
  onRetry: () => void
  onLongPressStart: (e: React.PointerEvent) => void
  onLongPressMove: (e: React.PointerEvent) => void
  onLongPressEnd: () => void
}) {
  const reactionRow = m.reactions.filter((r) => r.userIds.length > 0)
  const pressHandlers = {
    onPointerDown: onLongPressStart,
    onPointerMove: onLongPressMove,
    onPointerUp: onLongPressEnd,
    onPointerLeave: onLongPressEnd,
  }

  let body: ReactNode
  if (m.messageType === 'sticker' && !m.text) {
    body = (
      <div {...pressHandlers} className={`px-1.5 py-1 ${m.pending ? 'opacity-60' : ''} ${m.failed ? 'opacity-80' : ''}`}>
        {m.sticker ? <StickerAsset sticker={m.sticker} /> : <span className="text-5xl">🎁</span>}
      </div>
    )
  } else if (m.messageType === 'image' || m.messageType === 'quicky_image') {
    body = (
      <ImageMessageBody m={m} mine={mine} pressHandlers={pressHandlers} />
    )
  } else if (m.messageType === 'voice') {
    body = <VoiceMessageBody m={m} mine={mine} pressHandlers={pressHandlers} />
  } else {
    // Admin-console PRD §9 — the equipped CHAT_BUBBLE cosmetic paints the
    // bubble (color/border/text tone); an optional frame image wraps it.
    body = bubbleStyle ? (
      <ChatBubbleFrame cosmetics={bubbleCosmetics}>
        <div
          {...pressHandlers}
          className={`relative px-3.5 py-2.5 text-sm leading-relaxed ${m.pending ? 'opacity-60' : ''} ${
            mine ? 'rounded-2xl rounded-br-md' : 'rounded-2xl rounded-bl-md'
          }`}
          style={bubbleStyle}
        >
          {m.replyTo && <ReplyRef m={m} mine={mine} />}
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
        </div>
      </ChatBubbleFrame>
    ) : (
      <div
        {...pressHandlers}
        className={`relative rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          mine ? 'bg-coral-gradient text-white rounded-br-md' : 'bg-white/8 border border-white/10 text-white/90 rounded-bl-md'
        } ${m.pending ? 'opacity-60' : ''}`}
      >
        {m.replyTo && <ReplyRef m={m} mine={mine} />}
        <p className="whitespace-pre-wrap break-words">{m.text}</p>
      </div>
    )
  }

  return (
    <motion.div
      drag="x"
      dragConstraints={{ left: 0, right: 72 }}
      dragElastic={0.14}
      dragSnapToOrigin
      onDragEnd={(_, info) => {
        // §25: swipe right past the threshold → reply mode
        if (info.offset.x > 56) onReply()
      }}
      className={`flex flex-col ${mine ? 'items-end' : 'items-start'} touch-pan-y`}
    >
      <div className={`flex items-end gap-1.5 max-w-[85%] group ${mine ? 'flex-row-reverse' : ''}`}>
        {body}

        {/* ⋯ actions — hover on web (§30); always reachable as the
            non-gesture equivalent of swipe/long-press (§124) */}
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-60 transition-opacity">
          <button onClick={onReply} className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[11px]" aria-label="Reply">
            ↩
          </button>
          <button onClick={onReact} className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-[11px]" aria-label="React">
            ☺
          </button>
        </div>
      </div>

      {/* reactions row (§31/§32) */}
      {reactionRow.length > 0 && (
        <div className={`flex gap-1 -mt-1 ${mine ? 'mr-2' : 'ml-2'}`}>
          {reactionRow.map((r) => (
            <button
              key={r.reaction}
              onClick={() => useGameChatStore.getState().toggleReaction(m.id, r.reaction)}
              className="px-1.5 py-0.5 rounded-full bg-white/10 border border-white/10 text-[11px] flex items-center gap-0.5"
              aria-label={`Reaction ${r.reaction} (${r.userIds.length})`}
            >
              {r.reaction}
              {r.userIds.length > 1 && <span className="text-[9px] text-white/60">{r.userIds.length}</span>}
            </button>
          ))}
        </div>
      )}

      {/* receipt / failure state (§17/§22/§116) */}
      {mine && (
        <div className="text-[10px] mt-0.5 mr-1 flex items-center gap-1">
          {m.failed ? (
            <button onClick={onRetry} className="text-rose-300 font-bold underline underline-offset-2" aria-label="Retry send">
              {m.messageType === 'voice' ? 'Voice failed — tap to retry' : m.messageType === 'image' || m.messageType === 'quicky_image' ? 'Upload failed — tap to retry' : 'Failed — tap to retry'}
            </button>
          ) : m.pending ? (
            <span className="text-white/35">Sending…</span>
          ) : isLastMine ? (
            <span className="text-white/40">{read ? '✓✓ Read' : '✓ Sent'}</span>
          ) : null}
        </div>
      )}
    </motion.div>
  )
}

function ReplyRef({ m, mine }: { m: GameChatMessage; mine: boolean }) {
  const label =
    m.replyTo?.messageType === 'sticker'
      ? '🎁 Sticker'
      : m.replyTo?.messageType === 'image'
        ? '🖼 Image'
        : m.replyTo?.messageType === 'voice'
          ? '🎙 Voice message'
          : m.replyTo?.messageType === 'quicky_image'
            ? '⚡ Quicky Image'
            : m.replyTo?.text
  return (
    <div className={`mb-1.5 border-l-2 pl-2 py-0.5 ${mine ? 'border-white/60' : 'border-[var(--qk-accent)]'}`}>
      <p className="text-[10px] font-bold opacity-80">{m.replyTo?.senderName ?? 'Message'}</p>
      <p className="text-[11px] opacity-70 line-clamp-2">{label}</p>
    </div>
  )
}

/* §59/§74: image + Quicky Image bubbles — the media is a storage reference. */
function ImageMessageBody({
  m,
  mine,
  pressHandlers,
}: {
  m: GameChatMessage
  mine: boolean
  pressHandlers: Record<string, unknown>
}) {
  return (
    <div
      {...pressHandlers}
      className={`relative rounded-2xl overflow-hidden border ${mine ? 'border-white/20' : 'border-white/10'} ${m.pending ? 'opacity-60' : ''} ${m.failed ? 'opacity-80' : ''}`}
    >
      {m.replyTo && (
        <div className="px-3 pt-2">
          <ReplyRef m={m} mine={mine} />
        </div>
      )}
      {m.mediaUrl ? (
         
        <img src={m.mediaUrl} alt={m.messageType === 'quicky_image' ? 'Quicky image' : 'Photo'} className="max-w-[220px] max-h-[260px] w-auto object-cover" draggable={false} />
      ) : (
        <span className="flex items-center justify-center w-[180px] h-[120px] text-3xl" aria-hidden>🖼</span>
      )}
      {m.messageType === 'quicky_image' && (
        // §74: the recipient sees the Quicky badge — "+N Quicky"
        <span
          className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-full bg-black/75 border border-white/20 text-[10px] font-black text-white flex items-center gap-1"
          data-testid="quicky-badge"
        >
          ⚡ +10 Quicky
        </span>
      )}
    </div>
  )
}

/* §63-§65: voice bubble — playback + duration, one active player at a time. */
function VoiceMessageBody({
  m,
  mine,
  pressHandlers,
}: {
  m: GameChatMessage
  mine: boolean
  pressHandlers: Record<string, unknown>
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const secs = m.mediaDuration ? Math.max(1, Math.round(m.mediaDuration / 1000)) : null
  return (
    <div
      {...pressHandlers}
      className={`rounded-2xl px-3 py-2.5 flex items-center gap-2.5 min-w-[150px] ${
        mine ? 'bg-coral-gradient text-white rounded-br-md' : 'bg-white/8 border border-white/10 text-white/90 rounded-bl-md'
      } ${m.pending ? 'opacity-60' : ''}`}
    >
      {m.replyTo && <ReplyRef m={m} mine={mine} />}
      <button
        onClick={(e) => {
          e.stopPropagation()
          const el = audioRef.current
          if (!el) return
          if (playing) {
            el.pause()
            setPlaying(false)
          } else {
            void el.play().then(() => setPlaying(true)).catch(() => {})
          }
        }}
        className="w-8 h-8 rounded-full bg-black/30 flex items-center justify-center shrink-0 active:scale-95 transition"
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        data-testid="voice-play"
      >
        {playing ? <Square className="h-3 w-3" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="h-4 flex items-end gap-[2px]" aria-hidden>
          {[6, 10, 14, 9, 12, 7, 11, 8, 13, 6, 10, 8].map((h, i) => (
            <span key={i} className="w-[2.5px] rounded-full bg-white/50" style={{ height: h }} />
          ))}
        </div>
        {secs != null && <p className="text-[10px] opacity-75 mt-0.5 tabular-nums">{secs}s</p>}
      </div>
      {m.mediaUrl && (
        <audio
          ref={audioRef}
          src={m.mediaUrl}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
          className="hidden"
        />
      )}
    </div>
  )
}
