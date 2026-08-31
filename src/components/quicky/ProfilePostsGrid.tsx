'use client'

// Instagram/Snap-style posts grid for profiles. Shows photo posts as tiles
// and game-result posts as mini gradient template cards. On the owner's own
// profile every tile is interactive: tap to view it in the Community feed,
// long-press for Edit caption / Delete (photo posts only — game templates
// are generated server-side).
import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Grid3X3, Pencil, Trash2, Eye } from 'lucide-react'
import { cn } from '@/lib/utils'

function haptic() {
  import('@capacitor/haptics')
    .then(({ Haptics, ImpactStyle }) => Haptics.impact({ style: ImpactStyle.Light }))
    .catch(() => {})
}

export type ProfilePost = {
  id: string
  mediaUrl: string | null
  mediaType?: string
  caption?: string | null
  gameType?: string | null
  gameTitle?: string | null
  emoji?: string | null
}

const GAME_GRADIENTS: Record<string, string> = {
  ludo: 'from-[#7C3AED] to-[#EC4899]',
  truth_or_dare: 'from-[#FF5A79] to-[#F97316]',
  never_have_i_ever: 'from-[#0EA5E9] to-[#8B5CF6]',
}

export function ProfilePostsGrid({
  posts,
  own = false,
  onOpen,
  onEdit,
  onDelete,
}: {
  posts: ProfilePost[] | undefined
  own?: boolean
  onOpen?: (post: ProfilePost) => void
  onEdit?: (post: ProfilePost) => void
  onDelete?: (post: ProfilePost) => void
}) {
  const [menuFor, setMenuFor] = useState<ProfilePost | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)

  if (!posts || posts.length === 0) return null

  const stop = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  return (
    <div className="relative">
      <h3 className="text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
        <Grid3X3 className="w-3.5 h-3.5" /> Posts · {posts.length}
      </h3>
      <div className="grid grid-cols-3 gap-1 rounded-2xl overflow-hidden">
        {posts.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              if (fired.current) {
                fired.current = false
                return
              }
              onOpen?.(p)
            }}
            onPointerDown={() => {
              if (!own) return
              fired.current = false
              stop()
              timer.current = setTimeout(() => {
                fired.current = true
                haptic()
                setMenuFor(p)
              }, 450)
            }}
            onPointerUp={stop}
            onPointerLeave={stop}
            onPointerCancel={stop}
            className="relative aspect-square overflow-hidden active:scale-[0.97] transition-transform"
          >
            {p.gameType ? (
              <div
                className={cn(
                  'w-full h-full bg-gradient-to-br p-2 flex flex-col justify-between text-white text-left',
                  GAME_GRADIENTS[p.gameType] ?? 'from-[var(--qk-purple)] to-[var(--qk-accent)]'
                )}
              >
                <span className="text-xl leading-none">{p.emoji ?? '🎮'}</span>
                <p className="text-[9px] font-bold leading-tight line-clamp-2">{p.gameTitle}</p>
              </div>
            ) : p.mediaUrl && p.mediaType === 'video' ? (
              <video src={p.mediaUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
            ) : p.mediaUrl ? (
              <img src={p.mediaUrl} alt={p.caption ?? ''} className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full bg-black/40" />
            )}
          </button>
        ))}
      </div>
      {own && (
        <p className="text-[10px] text-white/30 mt-1.5">Tap to view in Community · hold to edit or delete</p>
      )}

      {/* Long-press action sheet */}
      <AnimatePresence>
        {menuFor && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[180] bg-black/60"
              onClick={() => setMenuFor(null)}
            />
            <motion.div
              initial={{ y: 60, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 60, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className="fixed bottom-0 inset-x-0 z-[181] bg-[var(--qk-card)] border-t border-white/10 rounded-t-3xl p-4 pb-6 flex flex-col gap-1 safe-area-bottom"
            >
              <div className="w-10 h-1 rounded-full bg-white/15 mx-auto mb-2" />
              <button
                onClick={() => {
                  onOpen?.(menuFor)
                  setMenuFor(null)
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-white/5 text-left"
              >
                <Eye className="w-5 h-5 text-white/80" />
                <span className="text-sm font-medium">View in Community</span>
              </button>
              <button
                onClick={() => {
                  onEdit?.(menuFor)
                  setMenuFor(null)
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-white/5 text-left"
              >
                <Pencil className="w-5 h-5 text-[var(--qk-accent)]" />
                <span className="text-sm font-medium">Edit caption</span>
              </button>
              <button
                onClick={() => {
                  onDelete?.(menuFor)
                  setMenuFor(null)
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-white/5 text-left"
              >
                <Trash2 className="w-5 h-5 text-[#FF3B30]" />
                <span className="text-sm font-medium text-[#FF3B30]">Delete post</span>
              </button>
              <button
                onClick={() => setMenuFor(null)}
                className="px-3 py-3 rounded-2xl hover:bg-white/5 text-sm text-white/60 text-center"
              >
                Cancel
              </button>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
