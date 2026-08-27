'use client'

// Quicky — Rolls viewer (Instagram-stories style playback).
// Auto-advances images after 5s, plays videos to their end; tap left/right to
// navigate, press & hold to pause. Liking/commenting someone else's roll is
// gated to premium members or mutual matches (enforced server-side too).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Heart, MessageCircle, Trash2, BadgeCheck, Crown, Pause } from 'lucide-react'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { filterCss, timeAgo } from '@/lib/quicky/filters'
import { CommentsSheet, CommentItem, Avatar } from './CommentsSheet'
import { cn } from '@/lib/utils'

export type RollItem = {
  id: string
  caption: string | null
  mediaUrl: string
  mediaType: 'image' | 'video' | string
  filter: string | null
  createdAt: string
  likeCount: number
  commentCount: number
  likedByMe: boolean
  canInteract: boolean
  author: { id: string; name: string | null; avatar: string | null; isPremium: boolean; isVerified: boolean }
}

export type RollGroup = { author: RollItem['author']; canInteract: boolean; rolls: RollItem[] }

const IMAGE_DURATION_MS = 5000

export function RollsViewer({
  groups,
  startGroup,
  onClose,
  onGroupsChange,
}: {
  groups: RollGroup[]
  startGroup: number
  onClose: () => void
  onGroupsChange: (groups: RollGroup[]) => void
}) {
  const openProfile = useQuickyStore((s) => s.openProfile)
  const showPaywall = useQuickyStore((s) => s.showPaywall)

  const [gi, setGi] = useState(startGroup)
  const [ri, setRi] = useState(0)
  const [progress, setProgress] = useState(0)
  const [paused, setPaused] = useState(false)
  const [commentsOpen, setCommentsOpen] = useState(false)
  // local per-roll overrides so likes/comments stay responsive between reloads
  const [likedOverrides, setLikedOverrides] = useState<Record<string, boolean>>({})
  const [countOverrides, setCountOverrides] = useState<Record<string, number>>({})

  const meId = useQuickyStore((s) => s.user?.id)

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const heldRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const group = groups[gi]
  const roll = group?.rolls[ri]
  const total = groups.length

  // Navigation must never run inside a state updater: React executes updater
  // functions during render, and onClose()/setGi() would update other
  // components mid-render. Compute the next position from current values.
  const goNextRoll = useCallback(() => {
    if (!group) return
    setProgress(0)
    setPaused(false)
    if (ri + 1 < group.rolls.length) {
      setRi(ri + 1)
      return
    }
    for (let n = gi + 1; n < total; n++) {
      if (groups[n].rolls.length > 0) {
        setGi(n)
        setRi(0)
        return
      }
    }
    onClose()
  }, [group, ri, gi, total, groups, onClose])

  const goPrevRoll = useCallback(() => {
    setProgress(0)
    setPaused(false)
    if (ri > 0) {
      setRi(ri - 1)
      return
    }
    for (let p = gi - 1; p >= 0; p--) {
      if (groups[p].rolls.length > 0) {
        setGi(p)
        setRi(groups[p].rolls.length - 1)
        return
      }
    }
  }, [ri, gi, groups])

  // Progress driver: interval for images, timeupdate for videos
  useEffect(() => {
    if (!roll) return
    const holding = paused || commentsOpen
    if (roll.mediaType === 'video') {
      const v = videoRef.current
      if (!v) return
      const onTime = () => {
        if (!holding && v.duration > 0) setProgress(v.currentTime / v.duration)
      }
      const onEnded = () => {
        if (!holding) goNextRoll()
      }
      v.addEventListener('timeupdate', onTime)
      v.addEventListener('ended', onEnded)
      if (holding) v.pause()
      else v.play().catch(() => {})
      return () => {
        v.removeEventListener('timeupdate', onTime)
        v.removeEventListener('ended', onEnded)
      }
    }
    if (holding) return
    const started = Date.now()
    const base = Math.min(progress, 0.999)
    const timer = setInterval(() => {
      const p = base + (Date.now() - started) / IMAGE_DURATION_MS
      if (p >= 1) {
        clearInterval(timer)
        goNextRoll()
      } else {
        setProgress(p)
      }
    }, 50)
    return () => clearInterval(timer)
  }, [roll?.id, paused, commentsOpen, gi, ri])

  // Reset pause state when moving between rolls

  const like = async () => {
    if (!roll) return
    if (!roll.canInteract) {
      showPaywall({ kind: 'generic' })
      return
    }
    const nextLiked = !(likedOverrides[roll.id] ?? roll.likedByMe)
    setLikedOverrides((o) => ({ ...o, [roll.id]: nextLiked }))
    try {
      const res = await api.rolls.like(roll.id)
      setLikedOverrides((o) => ({ ...o, [roll.id]: res.likedByMe }))
    } catch {
      toast.error('Failed to update like')
      setLikedOverrides((o) => ({ ...o, [roll.id]: !nextLiked }))
    }
  }

  const removeRoll = async () => {
    if (!roll) return
    try {
      await api.rolls.remove(roll.id)
      toast.success('Roll deleted')
      const nextGroups = groups
        .map((g, idx) =>
          idx === gi ? { ...g, rolls: g.rolls.filter((r) => r.id !== roll.id) } : g
        )
        .filter((g) => g.rolls.length > 0)
      onGroupsChange(nextGroups)
      setPaused(false)
      if (nextGroups.length === 0) onClose()
      else if (nextGroups[gi]?.rolls.length === 0 || !nextGroups[gi]) {
        setGi(Math.min(gi, nextGroups.length - 1))
        setRi(0)
        setProgress(0)
      } else {
        setRi(0)
        setProgress(0)
      }
    } catch {
      toast.error('Failed to delete roll')
    }
  }

  const openAuthorProfile = () => {
    if (!group) return
    onClose()
    openProfile(group.author.id, 'community')
  }

  // Pointer handlers: tap zones navigate, hold pauses
  const onPointerDown = () => {
    heldRef.current = false
    holdTimer.current = setTimeout(() => {
      heldRef.current = true
      setPaused(true)
    }, 250)
  }
  const onPointerUp = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current)
    holdTimer.current = null
    if (heldRef.current) setPaused(false)
  }

  const likedNow = roll ? (likedOverrides[roll.id] ?? roll.likedByMe) : false
  const commentCountNow = roll ? (countOverrides[roll.id] ?? roll.commentCount) : 0
  // Optimistic count: base ±1 depending on whether we flipped the like
  const likeCountNow = useMemo(() => {
    if (!roll) return 0
    const override = likedOverrides[roll.id]
    if (override === undefined || override === roll.likedByMe) return roll.likeCount
    return roll.likeCount + (override ? 1 : -1)
  }, [roll, likedOverrides])
  const isMine = !!group && group.author.id === meId

  const loadComments = async (): Promise<CommentItem[]> => {
    const res = await api.rolls.comments(roll!.id)
    return res.comments
  }
  const sendComment = async (text: string): Promise<CommentItem> => {
    const res = await api.rolls.comment(roll!.id, text)
    setCountOverrides((o) => ({ ...o, [roll!.id]: commentCountNow + 1 }))
    return res.comment
  }

  if (!group || !roll) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[125] bg-black select-none"
    >
      {/* Media */}
      <div className="absolute inset-0 flex items-center justify-center">
        {roll.mediaType === 'video' ? (
          <video
            ref={videoRef}
            key={roll.id}
            src={roll.mediaUrl}
            style={{ filter: filterCss(roll.filter) }}
            className="w-full h-full object-contain"
            autoPlay
            playsInline
          />
        ) : (
          <img
            key={roll.id}
            src={roll.mediaUrl}
            alt=""
            style={{ filter: filterCss(roll.filter) }}
            className="w-full h-full object-contain"
            draggable={false}
          />
        )}
      </div>

      {/* Top gradient + progress bars + header */}
      <div className="absolute top-0 inset-x-0 bg-gradient-to-b from-black/70 to-transparent pb-10 safe-area-top">
        {/* Progress segments */}
        <div className="flex gap-1 px-3 pt-3">
          {group.rolls.map((_, i) => (
            <div key={i} className="h-[2.5px] flex-1 rounded-full bg-white/25 overflow-hidden">
              <div
                className="h-full bg-white rounded-full"
                style={{ width: i < ri ? '100%' : i === ri ? `${Math.min(progress, 1) * 100}%` : '0%' }}
              />
            </div>
          ))}
        </div>

        {/* Author row */}
        <div className="flex items-center gap-2.5 px-3 pt-2.5">
          <Avatar src={group.author.avatar} name={group.author.name} size={34} onClick={openAuthorProfile} />
          <button onClick={openAuthorProfile} className="flex items-center gap-1 min-w-0">
            <span className="text-sm font-semibold truncate">{group.author.name ?? 'Someone'}</span>
            {group.author.isVerified && <BadgeCheck className="w-4 h-4 text-[var(--qk-accent)] shrink-0" fill="currentColor" stroke="black" />}
            <span className="text-xs text-white/60 shrink-0">{timeAgo(roll.createdAt)}</span>
          </button>
          <div className="flex-1" />
          {paused && !commentsOpen && (
            <Pause className="w-5 h-5 text-white/80" fill="currentColor" stroke="none" />
          )}
          {isMine && (
            <button onClick={removeRoll} className="p-2 rounded-full bg-black/40 hover:bg-black/60" aria-label="Delete roll">
              <Trash2 className="w-4 h-4 text-white" />
            </button>
          )}
          <button onClick={onClose} className="p-2 rounded-full bg-black/40 hover:bg-black/60" aria-label="Close">
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {roll.caption && (
          <p className="px-4 pt-2 text-sm text-white/90 drop-shadow max-w-[85%]">{roll.caption}</p>
        )}
      </div>

      {/* Bottom gradient + actions */}
      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent pt-14 pb-4 px-4 safe-area-bottom">
        {!group.canInteract && (
          <div className="mb-2 flex items-center justify-center gap-1.5 text-[11px] text-[var(--qk-gold)]">
            <Crown className="w-3.5 h-3.5" />
            <span>Premium or a mutual match unlocks reactions</span>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button
            onClick={like}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-full backdrop-blur active:scale-95 transition-transform',
              likedNow ? 'bg-white/15' : 'bg-white/10',
              !group.canInteract && 'opacity-70'
            )}
            aria-label={likedNow ? 'Unlike roll' : 'Like roll'}
          >
            <Heart className={cn('w-5 h-5', likedNow ? 'text-[var(--qk-accent)]' : 'text-white')} fill={likedNow ? 'currentColor' : 'none'} />
            <span className="text-sm font-semibold">{likeCountNow}</span>
          </button>
          <button
            onClick={() => (group.canInteract ? setCommentsOpen(true) : showPaywall({ kind: 'generic' }))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/10 backdrop-blur active:scale-95 transition-transform"
            aria-label="Comment on roll"
          >
            <MessageCircle className="w-5 h-5 text-white" />
            <span className="text-sm font-semibold">{commentCountNow}</span>
          </button>
        </div>
      </div>

      {/* Tap zones (below header/footer gradients) */}
      <div
        className="absolute inset-x-0 bottom-24 top-32 flex"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (holdTimer.current) clearTimeout(holdTimer.current)
          if (heldRef.current) setPaused(false)
        }}
      >
        <button className="flex-1 h-full" onClick={() => !heldRef.current && goPrevRoll()} aria-label="Previous roll" />
        <button className="flex-1 h-full" onClick={() => !heldRef.current && goNextRoll()} aria-label="Next roll" />
      </div>

      {commentsOpen && (
        <CommentsSheet
          title={`Comments · ${group.author.name ?? ''}`}
          load={loadComments}
          send={sendComment}
          onClose={() => setCommentsOpen(false)}
          lockedHint={
            group.canInteract
              ? null
              : 'Only Premium members and mutual matches can comment on this roll.'
          }
        />
      )}
    </motion.div>
  )
}
