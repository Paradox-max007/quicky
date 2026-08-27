'use client'

// Quicky — shared comment sheet for community posts & rolls

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, SendHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { timeAgo } from '@/lib/quicky/filters'

export type CommentItem = {
  id: string
  text: string
  createdAt: string | Date
  author: { id: string; name: string | null; avatar: string | null }
}

export function Avatar({
  src,
  name,
  size = 36,
  onClick,
}: {
  src?: string | null
  name?: string | null
  size?: number
  onClick?: () => void
}) {
  const initials = (name ?? '?').slice(0, 1).toUpperCase()
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className="shrink-0 rounded-full bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center overflow-hidden disabled:cursor-default"
      style={{ width: size, height: size }}
      aria-label={name ? `${name}'s profile` : 'Avatar'}
    >
      {src ? (
        <img src={src} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-white font-semibold" style={{ fontSize: size * 0.4 }}>
          {initials}
        </span>
      )}
    </button>
  )
}

export function CommentsSheet({
  title,
  load,
  send,
  onClose,
  onCountChange,
  lockedHint,
}: {
  title: string
  load: () => Promise<CommentItem[]>
  send: (text: string) => Promise<CommentItem>
  onClose: () => void
  onCountChange?: (n: number) => void
  lockedHint?: string | null
}) {
  const [comments, setComments] = useState<CommentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ;(async () => {
      try {
        setComments(await load())
      } catch {
        toast.error('Could not load comments')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const submit = async () => {
    const t = text.trim()
    if (!t || sending || lockedHint) return
    setSending(true)
    try {
      const c = await send(t)
      setComments((prev) => {
        const next = [...prev, c]
        onCountChange?.(next.length)
        return next
      })
      setText('')
      requestAnimationFrame(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }))
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to comment')
    } finally {
      setSending(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[120] flex items-end bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 34 }}
        className="w-full h-[72%] bg-[var(--qk-bg)] rounded-t-3xl border-t border-white/10 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle */}
        <div className="pt-2 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>
        <div className="px-4 pb-2 flex items-center justify-between">
          <h3 className="font-bold">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-full bg-white/5 hover:bg-white/10" aria-label="Close comments">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto no-scrollbar px-4 py-2 flex flex-col gap-3">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="w-8 h-8 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
            </div>
          ) : comments.length === 0 ? (
            <p className="text-center text-sm text-white/40 py-8">No comments yet. Be the first!</p>
          ) : (
            comments.map((c) => (
              <div key={c.id} className="flex items-start gap-2.5">
                <Avatar src={c.author.avatar} name={c.author.name} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="bg-white/5 rounded-2xl rounded-tl-md px-3 py-2">
                    <p className="text-xs font-semibold text-white/90">{c.author.name ?? 'Someone'}</p>
                    <p className="text-sm text-white/80 break-words">{c.text}</p>
                  </div>
                  <p className="text-[10px] text-white/30 mt-0.5 ml-1">{timeAgo(c.createdAt)}</p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Composer */}
        <div className="safe-area-bottom shrink-0 p-3 border-t border-white/10">
          {lockedHint ? (
            <p className="text-center text-xs text-[var(--qk-gold)] py-2">{lockedHint}</p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="Add a comment..."
                maxLength={500}
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50"
              />
              <button
                onClick={submit}
                disabled={!text.trim() || sending}
                className="shrink-0 w-10 h-10 rounded-full bg-coral-gradient text-white disabled:opacity-30 active:scale-95 transition-all flex items-center justify-center"
                aria-label="Send comment"
              >
                <SendHorizontal className="w-[18px] h-[18px]" />
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
