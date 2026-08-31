'use client'

// Quicky — Community tab: Instagram-style posts feed + Rolls (stories) tray.
// Tapping any avatar/name opens that member's dating profile (ProfileView),
// where you can like them and (premium) message directly.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart,
  MessageCircle,
  Plus,
  Trash2,
  BadgeCheck,
  Crown,
  ImagePlus,
  Film,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { filterCss, timeAgo } from '@/lib/quicky/filters'
import { Avatar, CommentsSheet, CommentItem } from './CommentsSheet'
import { MediaComposer } from './MediaComposer'
import { RollsViewer, RollGroup } from './RollsViewer'
import { cn } from '@/lib/utils'

type Author = { id: string; name: string | null; avatar: string | null; isPremium: boolean; isVerified: boolean }

type Post = {
  id: string
  caption: string | null
  mediaUrl: string | null
  mediaType: 'image' | 'video' | string
  filter: string | null
  createdAt: string
  author: Author
  coOwner: Author | null
  gameType?: string | null
  gameTitle?: string | null
  gameBody?: string | null
  emoji?: string | null
  likeCount: number
  commentCount: number
  likedByMe: boolean
}

// Catchy template gradients per game type for game-result posts
const GAME_GRADIENTS: Record<string, string> = {
  ludo: 'from-[#7C3AED] via-[#A855F7] to-[#EC4899]',
  truth_or_dare: 'from-[#FF5A79] via-[#F43F5E] to-[#F97316]',
  never_have_i_ever: 'from-[#0EA5E9] via-[#6366F1] to-[#8B5CF6]',
}

export function CommunityScreen() {
  const openProfile = useQuickyStore((s) => s.openProfile)
  const meId = useQuickyStore((s) => s.user?.id)
  const focusPostId = useQuickyStore((s) => s.communityFocusPostId)
  const clearCommunityFocus = useQuickyStore((s) => s.clearCommunityFocus)
  const [highlightedPostId, setHighlightedPostId] = useState<string | null>(null)

  const [posts, setPosts] = useState<Post[]>(() => {
    // Paint the last-known feed instantly, revalidate below (SWR)
    try {
      const raw = localStorage.getItem('qk_community_cache_v1')
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [groups, setGroups] = useState<RollGroup[]>([])
  const [loading, setLoading] = useState(() => {
    try {
      return !localStorage.getItem('qk_community_cache_v1')
    } catch {
      return true
    }
  })

  // overlays
  const [composerMode, setComposerMode] = useState<'post' | 'roll' | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [commentsTarget, setCommentsTarget] = useState<{ kind: 'post' | 'roll'; id: string } | null>(null)
  // delete confirmation
  const [confirmDeletePostId, setConfirmDeletePostId] = useState<string | null>(null)
  const [deletingPost, setDeletingPost] = useState(false)
  // groups already watched this session → gray out their rings
  const [seenGroups, setSeenGroups] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const [feed, rolls] = await Promise.all([api.community.feed(), api.rolls.list()])
      setPosts(feed.posts)
      setGroups(groupRolls(rolls.rolls))
      try {
        localStorage.setItem('qk_community_cache_v1', JSON.stringify(feed.posts.slice(0, 30)))
      } catch {}
    } catch (e: any) {
      if (e?.status !== 401) toast.error(e?.message ?? 'Failed to load community')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Scroll to focused post from profile
  useEffect(() => {
    if (!focusPostId || posts.length === 0) return
    const targetId = focusPostId
    const t = setTimeout(() => {
      const el = document.getElementById(`community-post-${targetId}`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setHighlightedPostId(targetId)
        clearCommunityFocus()
        setTimeout(() => setHighlightedPostId((curr) => (curr === targetId ? null : curr)), 2500)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [focusPostId, posts, clearCommunityFocus])

  // Light background refresh while the tab is idle
  useEffect(() => {
    if (composerMode !== null || viewerIndex !== null || commentsTarget) return
    const t = setInterval(load, 45000)
    return () => clearInterval(t)
  }, [load, composerMode, viewerIndex, commentsTarget])

  const togglePostLike = async (post: Post) => {
    const flip = (p: Post): Post => ({
      ...p,
      likedByMe: !p.likedByMe,
      likeCount: p.likeCount + (p.likedByMe ? -1 : 1),
    })
    setPosts((prev) => prev.map((p) => (p.id === post.id ? flip(p) : p)))
    try {
      await api.community.like(post.id)
    } catch {
      toast.error('Failed to update like')
      setPosts((prev) => prev.map((p) => (p.id === post.id ? flip(p) : p)))
    }
  }

  const deletePost = (postId: string) => {
    setConfirmDeletePostId(postId)
  }

  const executeDeletePost = async () => {
    if (!confirmDeletePostId || deletingPost) return
    setDeletingPost(true)
    try {
      await api.community.remove(confirmDeletePostId)
      setPosts((prev) => prev.filter((p) => p.id !== confirmDeletePostId))
      toast.success('Post deleted')
      setConfirmDeletePostId(null)
    } catch {
      toast.error('Failed to delete post')
    } finally {
      setDeletingPost(false)
    }
  }

  const openViewer = (idx: number) => {
    const g = groups[idx]
    if (g) setSeenGroups((s) => new Set(s).add(g.author.id))
    setViewerIndex(idx)
  }

  const myGroupIdx = useMemo(() => groups.findIndex((g) => g.author.id === meId), [groups, meId])
  const others = useMemo(() => groups.filter((g) => g.author.id !== meId), [groups, meId])

  return (
    <div className="w-full h-full relative flex flex-col bg-[var(--qk-bg)] text-white overflow-hidden">
      {/* Header */}
      <header className="shrink-0 safe-area-top px-5 pt-3 pb-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Community</h1>
        <button
          onClick={() => setComposerMode('post')}
          className="flex items-center gap-1.5 bg-coral-gradient glow-coral rounded-full px-4 py-2 text-sm font-semibold active:scale-95 transition-transform"
        >
          <ImagePlus className="w-4 h-4" /> New Post
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-4">
        {/* ── Rolls tray ─────────────────────────────────────────────── */}
        <div className="px-4 pt-2 pb-3 border-b border-white/5">
          <div className="flex gap-3.5 overflow-x-auto no-scrollbar py-1">
            {/* My roll / create */}
            <button
              onClick={() => setComposerMode('roll')}
              className="shrink-0 flex flex-col items-center gap-1 w-[68px]"
            >
              <div className="relative w-[60px] h-[60px] rounded-full p-[2.5px] bg-gradient-to-tr from-[var(--qk-accent)] to-[var(--qk-purple)]">
                <div className="w-full h-full rounded-full bg-[var(--qk-bg)] border-2 border-[var(--qk-bg)] flex items-center justify-center overflow-hidden">
                  <Plus className="w-6 h-6 text-[var(--qk-accent)]" strokeWidth={2.5} />
                </div>
              </div>
              <span className="text-[10px] text-white/70 truncate w-full text-center">Your Roll</span>
            </button>

            {others.length === 0 && loading ? (
              <div className="flex items-center px-4 text-xs text-white/30">Loading rolls…</div>
            ) : (
              others.map((g) => {
                const seen = seenGroups.has(g.author.id)
                return (
                  <button
                    key={g.author.id}
                    onClick={() => {
                      const idx = groups.findIndex((x) => x.author.id === g.author.id)
                      openViewer(idx)
                    }}
                    className="shrink-0 flex flex-col items-center gap-1 w-[68px]"
                  >
                    <div
                      className={cn(
                        'w-[60px] h-[60px] rounded-full p-[2.5px]',
                        seen ? 'bg-white/15' : 'bg-gradient-to-tr from-[var(--qk-accent)] via-fuchsia-500 to-[var(--qk-gold)]'
                      )}
                    >
                      <div className="w-full h-full rounded-full border-2 border-[var(--qk-bg)] overflow-hidden">
                        <AuthorAvatar author={g.author} />
                      </div>
                    </div>
                    <span className={cn('text-[10px] truncate w-full text-center', seen ? 'text-white/40' : 'text-white/80')}>
                      {(g.author.name ?? 'Someone').split(' ')[0]}
                    </span>
                  </button>
                )
              })
            )}
          </div>
          {myGroupIdx >= 0 && (
            <button
              onClick={() => openViewer(myGroupIdx)}
              className="mt-1.5 text-[11px] text-[var(--qk-accent)] font-medium"
            >
              View your roll
            </button>
          )}
        </div>

        {/* ── Feed ───────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-10 h-10 rounded-full border-2 border-[var(--qk-accent)] border-t-transparent animate-spin" />
          </div>
        ) : posts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-8 text-center">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center mb-4">
              <ImagePlus className="w-8 h-8 text-white" strokeWidth={1.75} />
            </div>
            <h3 className="font-bold">No posts yet</h3>
            <p className="text-sm text-white/50 mt-1">Be the first to share something with the community!</p>
            <button
              onClick={() => setComposerMode('post')}
              className="mt-5 bg-coral-gradient rounded-full px-5 py-2.5 text-sm font-semibold"
            >
              Create a post
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-6 pt-3">
            {posts.map((post) => {
              const isHighlighted = highlightedPostId === post.id
              return (
                <article
                  key={post.id}
                  id={`community-post-${post.id}`}
                  className={cn(
                    'transition-all duration-500 rounded-3xl pb-2',
                    isHighlighted && 'ring-2 ring-[var(--qk-accent)] bg-white/[0.04] shadow-2xl scale-[1.01]'
                  )}
                >
                  {/* Card header — game posts show both owners */}
                  <div className="flex items-center gap-2.5 px-4 pb-2">
                  <div className="flex -space-x-2">
                    <Avatar
                      src={post.author.avatar}
                      name={post.author.name}
                      size={38}
                      onClick={() => openProfile(post.author.id, 'community')}
                    />
                    {post.coOwner && (
                      <Avatar
                        src={post.coOwner.avatar}
                        name={post.coOwner.name}
                        size={38}
                        onClick={() => openProfile(post.coOwner!.id, 'community')}
                      />
                    )}
                  </div>
                  <button
                    onClick={() => openProfile(post.author.id, 'community')}
                    className="flex items-center gap-1 min-w-0"
                  >
                    <span className="text-sm font-semibold truncate">
                      {post.coOwner
                        ? `${post.author.name ?? 'Someone'} & ${post.coOwner.name ?? 'Someone'}`
                        : post.author.name ?? 'Someone'}
                    </span>
                    {post.author.isVerified && (
                      <BadgeCheck className="w-4 h-4 text-[var(--qk-accent)] shrink-0" fill="currentColor" stroke="black" />
                    )}
                  </button>
                  {(post.author.isPremium || post.coOwner?.isPremium) && (
                    <Crown className="w-3.5 h-3.5 text-[var(--qk-gold)] shrink-0" fill="currentColor" stroke="none" />
                  )}
                  <span className="text-xs text-white/40 shrink-0">{timeAgo(post.createdAt)}</span>
                  <div className="flex-1" />
                  {(post.author.id === meId || post.coOwner?.id === meId) && (
                    <button
                      onClick={() => deletePost(post.id)}
                      className="p-1.5 rounded-full hover:bg-white/10 text-white/40"
                      aria-label="Delete post"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Media — or a catchy game-result template card */}
                {post.gameType ? (
                  <div
                    className={cn(
                      'relative w-full aspect-square bg-gradient-to-br p-6 flex flex-col justify-center text-white',
                      GAME_GRADIENTS[post.gameType] ?? 'from-[var(--qk-purple)] to-[var(--qk-accent)]'
                    )}
                  >
                    <p className="text-6xl">{post.emoji ?? '🎮'}</p>
                    <h3 className="text-3xl font-black mt-4">{post.gameTitle}</h3>
                    <p className="text-base text-white/90 mt-3 leading-relaxed">{post.gameBody}</p>
                    <p className="text-xs uppercase tracking-[0.2em] text-white/60 mt-6">Quicky Games</p>
                  </div>
                ) : (
                  <div className="relative w-full aspect-square bg-black">
                    {post.mediaType === 'video' ? (
                      <video
                        src={post.mediaUrl ?? ''}
                        style={{ filter: filterCss(post.filter) }}
                        className="w-full h-full object-cover"
                        controls
                        playsInline
                        loop
                        preload="metadata"
                      />
                    ) : (
                      <img
                        src={post.mediaUrl ?? ''}
                        alt={post.caption ?? 'Community post'}
                        style={{ filter: filterCss(post.filter) }}
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-4 px-4 pt-2.5">
                  <button
                    onClick={() => togglePostLike(post)}
                    className="active:scale-90 transition-transform"
                    aria-label={post.likedByMe ? 'Unlike post' : 'Like post'}
                  >
                    <Heart
                      className={cn('w-7 h-7', post.likedByMe ? 'text-[var(--qk-accent)]' : 'text-white')}
                      fill={post.likedByMe ? 'currentColor' : 'none'}
                    />
                  </button>
                  <button
                    onClick={() => setCommentsTarget({ kind: 'post', id: post.id })}
                    className="active:scale-90 transition-transform"
                    aria-label="Comment on post"
                  >
                    <MessageCircle className="w-7 h-7" />
                  </button>
                </div>

                {/* Meta */}
                <div className="px-4 pt-1.5 flex flex-col gap-0.5">
                  <p className="text-sm font-semibold">{post.likeCount} {post.likeCount === 1 ? 'like' : 'likes'}</p>
                  {post.caption && (
                    <p className="text-sm text-white/85 break-words">
                      <span className="font-semibold text-white">{post.author.name ?? 'Someone'}</span> {post.caption}
                    </p>
                  )}
                  <button
                    onClick={() => setCommentsTarget({ kind: 'post', id: post.id })}
                    className="text-left text-xs text-white/40 hover:text-white/60"
                  >
                    View all {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
                  </button>
                </div>
              </article>
            )
          })}
          </div>
        )}

        {/* Footer nudge for rolls */}
        {!loading && (
          <div className="flex justify-center mt-8">
            <button
              onClick={() => setComposerMode('roll')}
              className="flex items-center gap-2 text-xs text-white/50 bg-white/5 border border-white/10 rounded-full px-4 py-2"
            >
              <Film className="w-3.5 h-3.5" /> Share a roll — visible for 24 hours
            </button>
          </div>
        )}
      </div>

      {/* ── Overlays ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {composerMode && (
          <MediaComposer mode={composerMode} onClose={() => setComposerMode(null)} onPosted={load} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {viewerIndex !== null && groups.length > 0 && (
          <RollsViewer groups={groups} startGroup={viewerIndex} onClose={() => setViewerIndex(null)} onGroupsChange={setGroups} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {commentsTarget?.kind === 'post' && (
          <PostComments
            postId={commentsTarget.id}
            posts={posts}
            setPosts={setPosts}
            onClose={() => setCommentsTarget(null)}
          />
        )}
      </AnimatePresence>

      {/* Delete confirmation popup */}
      <AnimatePresence>
        {confirmDeletePostId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] bg-black/75 backdrop-blur-sm"
              onClick={() => {
                if (!deletingPost) setConfirmDeletePostId(null)
              }}
            />
            <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 10 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 10 }}
                transition={{ type: 'spring', stiffness: 420, damping: 28 }}
                className="w-full max-w-sm bg-[var(--qk-card)] border border-white/10 rounded-3xl p-6 shadow-2xl pointer-events-auto flex flex-col items-center text-center"
              >
                <div className="w-14 h-14 rounded-full bg-[#FF3B30]/15 flex items-center justify-center text-[#FF3B30] mb-4">
                  <Trash2 className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1.5">Delete Post?</h3>
                <p className="text-sm text-white/60 mb-6 leading-relaxed">
                  This post will be permanently removed from the community feed. This action cannot be undone.
                </p>

                <div className="flex w-full gap-3">
                  <button
                    type="button"
                    onClick={() => setConfirmDeletePostId(null)}
                    disabled={deletingPost}
                    className="flex-1 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-sm font-semibold text-white/80 transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={executeDeletePost}
                    disabled={deletingPost}
                    className="flex-1 py-3 rounded-2xl bg-[#FF3B30] hover:bg-[#FF3B30]/90 text-sm font-semibold text-white flex items-center justify-center gap-2 active:scale-95 transition-all shadow-lg shadow-[#FF3B30]/20 disabled:opacity-50"
                  >
                    {deletingPost ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Deleting...
                      </>
                    ) : (
                      'Delete'
                    )}
                  </button>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function PostComments({
  postId,
  posts,
  setPosts,
  onClose,
}: {
  postId: string
  posts: Post[]
  setPosts: (fn: (prev: Post[]) => Post[]) => void
  onClose: () => void
}) {
  const load = async (): Promise<CommentItem[]> => (await api.community.comments(postId)).comments
  const send = async (text: string): Promise<CommentItem> => {
    const res = await api.community.comment(postId, text)
    setPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, commentCount: p.commentCount + 1 } : p)))
    return res.comment
  }
  const post = posts.find((p) => p.id === postId)
  return (
    <CommentsSheet
      title={`Comments · ${post?.author.name ?? ''}`}
      load={load}
      send={send}
      onClose={onClose}
    />
  )
}

// Plain (non-button) avatar for use inside the tray tile, which is itself a
// button — nested <button>s are invalid HTML and break hydration.
function AuthorAvatar({ author }: { author: Author }) {
  return (
    <div className="w-full h-full bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center overflow-hidden">
      {author.avatar ? (
        <img src={author.avatar} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-xl font-semibold text-white">{(author.name ?? '?').slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  )
}

function groupRolls(rolls: any[]): RollGroup[] {
  const byUser = new Map<string, RollGroup>()
  // newest group first, but keep chronological order inside each group
  for (const r of [...rolls].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) {
    let g = byUser.get(r.author.id)
    if (!g) {
      g = { author: r.author, canInteract: r.canInteract, rolls: [] }
      byUser.set(r.author.id, g)
    }
    g.rolls.push(r)
  }
  return [...byUser.values()].sort(
    (a, b) =>
      Math.max(...b.rolls.map((r) => +new Date(r.createdAt))) -
      Math.max(...a.rolls.map((r) => +new Date(r.createdAt)))
  )
}
