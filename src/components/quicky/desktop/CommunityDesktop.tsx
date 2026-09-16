'use client'

// Quicky — DESKTOP COMMUNITY PAGE (Web Premium PRD §19-§25/§56/§69)
// An editorial feed, not a stretched mobile column: each post alternates
// MEDIA | DETAILS then DETAILS | MEDIA (§20-§22/§69), details carry the
// engagement controls (§23), and comments open a premium side panel (§24).
// Data layer mirrors the mobile CommunityScreen exactly — same endpoints,
// same optimistic likes, same rolls/composer overlays (§56: the alternating
// layout is a desktop treatment only; mobile keeps its feed).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart,
  MessageCircle,
  Trash2,
  BadgeCheck,
  Crown,
  ImagePlus,
  Film,
  Loader2,
  Plus,
  Gamepad2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { filterCss, timeAgo } from '@/lib/quicky/filters'
import { useDoubleTap } from '@/lib/quicky/useDoubleTap'
import { Avatar, CommentsSheet, CommentItem } from '../CommentsSheet'
import { MediaComposer } from '../MediaComposer'
import { RollsViewer, RollGroup } from '../RollsViewer'
import { cn } from '@/lib/utils'
import { SkeletonBlock, EmptyState, ErrorState } from './web-ui'

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
  commentsEnabled: boolean
  likeCount: number
  commentCount: number
  likedByMe: boolean
}

const GAME_GRADIENTS: Record<string, string> = {
  ludo: 'from-[#7C3AED] via-[#A855F7] to-[#EC4899]',
  truth_or_dare: 'from-[#FF5A79] via-[#F43F5E] to-[#F97316]',
  never_have_i_ever: 'from-[#0EA5E9] via-[#6366F1] to-[#8B5CF6]',
}

export function CommunityDesktop() {
  const openProfile = useQuickyStore((s) => s.openProfile)
  const meId = useQuickyStore((s) => s.user?.id)

  const [posts, setPosts] = useState<Post[]>([])
  const [groups, setGroups] = useState<RollGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const [composerMode, setComposerMode] = useState<'post' | 'roll' | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [commentsTarget, setCommentsTarget] = useState<string | null>(null)
  const [burstFor, setBurstFor] = useState<{ id: string; n: number } | null>(null)
  const [confirmDeletePostId, setConfirmDeletePostId] = useState<string | null>(null)
  const [deletingPost, setDeletingPost] = useState(false)

  const load = useCallback(async () => {
    try {
      const [feed, rolls] = await Promise.all([api.community.feed(), api.rolls.list()])
      setPosts(feed.posts ?? [])
      setGroups(groupRolls(rolls.rolls ?? []))
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Light refresh while visible (same cadence as the mobile feed)
  useEffect(() => {
    if (composerMode !== null || viewerIndex !== null || commentsTarget) return
    const iv = setInterval(() => void load(), 30000)
    return () => clearInterval(iv)
  }, [load, composerMode, viewerIndex, commentsTarget])

  const togglePostLike = async (post: Post) => {
    // Optimistic flip — like count never rerenders the whole feed (§62)
    setPosts((prev) =>
      prev.map((p) =>
        p.id === post.id
          ? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? -1 : 1) }
          : p
      )
    )
    try {
      await api.community.like(post.id)
    } catch {
      toast.error('Failed to update like')
      setPosts((prev) =>
        prev.map((p) =>
          p.id === post.id
            ? { ...p, likedByMe: !p.likedByMe, likeCount: p.likeCount + (p.likedByMe ? 1 : -1) }
            : p
        )
      )
    }
  }

  const doubleTapLike = (post: Post) => {
    if (!post.likedByMe) void togglePostLike(post)
    setBurstFor((b) => ({ id: post.id, n: (b?.id === post.id ? b.n : 0) + 1 }))
  }

  const executeDeletePost = async () => {
    if (!confirmDeletePostId) return
    setDeletingPost(true)
    try {
      await api.community.remove(confirmDeletePostId)
      setPosts((prev) => prev.filter((p) => p.id !== confirmDeletePostId))
      setConfirmDeletePostId(null)
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to delete post')
    } finally {
      setDeletingPost(false)
    }
  }

  const others = useMemo(() => groups.filter((g) => g.author.id !== meId), [groups, meId])

  if (loading) {
    return (
      <div className="flex flex-col gap-5 mx-auto w-full max-w-[500px]" data-testid="community-skeleton">
        <div className="flex items-center justify-between">
          <SkeletonBlock className="h-9 w-56" />
          <SkeletonBlock className="h-10 w-32 rounded-full" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="rounded-3xl border border-white/8 bg-[var(--qk-card)]/50 overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-3">
              <SkeletonBlock className="h-9 w-9 rounded-full" />
              <SkeletonBlock className="h-4 w-1/3" />
            </div>
            <SkeletonBlock className="w-full h-56" />
            <div className="px-4 py-3 flex flex-col gap-2">
              <SkeletonBlock className="h-5 w-24" />
              <SkeletonBlock className="h-4 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (failed && posts.length === 0) {
    return (
      <ErrorState
        title="We couldn't load the community."
        body="Check your connection and try again."
        onRetry={() => {
          setLoading(true)
          void load()
        }}
      />
    )
  }

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Community</h1>
          <p className="text-sm text-white/50 mt-1">What everyone is playing, sharing and celebrating.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setComposerMode('roll')}
            className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors"
          >
            <Film className="w-4 h-4" /> Share a Roll
          </button>
          {/* Game Hub PRD §5/§6/§91: Post + animated Games entry */}
          <button
            onClick={() => setComposerMode('post')}
            className="flex items-center gap-1.5 bg-coral-gradient glow-coral rounded-full px-5 py-2.5 text-sm font-bold active:scale-95 transition-transform"
            data-testid="community-post"
          >
            <ImagePlus className="w-4 h-4" /> Post
          </button>
          <button
            onClick={() => {
              const st = useQuickyStore.getState()
              st.setGamesReturnView('community')
              st.setView('games')
            }}
            className="flex items-center gap-1.5 rounded-full border border-white/12 bg-white/5 px-4 py-2 text-sm font-semibold text-white/80 hover:bg-white/10 transition-colors"
            data-testid="community-games"
          >
            <Gamepad2 className="w-4 h-4 text-[var(--qk-accent)] qk-icon-float" aria-hidden /> Games
          </button>
        </div>
      </header>

      {/* Rolls tray (desktop treatment of the same stories rail) */}
      <div className="flex items-center gap-4 overflow-x-auto qk-desk-scroll pb-1">
        <button onClick={() => setComposerMode('roll')} className="shrink-0 flex flex-col items-center gap-1.5 w-[72px]">
          <div className="relative w-[60px] h-[60px] rounded-full p-[2.5px] bg-gradient-to-tr from-[var(--qk-accent)] to-[var(--qk-purple)]">
            <div className="w-full h-full rounded-full bg-[var(--qk-bg)] border-2 border-[var(--qk-bg)] flex items-center justify-center overflow-hidden">
              <Plus className="w-6 h-6 text-[var(--qk-accent)]" strokeWidth={2.5} />
            </div>
          </div>
          <span className="text-[10px] text-white/70 truncate w-full text-center">Your Roll</span>
        </button>
        {others.map((g) => {
          const idx = groups.findIndex((x) => x.author.id === g.author.id)
          return (
            <button
              key={g.author.id}
              onClick={() => setViewerIndex(idx >= 0 ? idx : 0)}
              className="shrink-0 flex flex-col items-center gap-1.5 w-[72px]"
            >
              <div className="w-[60px] h-[60px] rounded-full p-[2.5px] bg-gradient-to-tr from-[var(--qk-accent)] via-fuchsia-500 to-[var(--qk-gold)]">
                <div className="w-full h-full rounded-full border-2 border-[var(--qk-bg)] overflow-hidden">
                  {g.author.avatar ? (
                    <img src={g.author.avatar} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center text-white text-xl font-semibold">
                      {(g.author.name ?? '?').slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
              </div>
              <span className="text-[10px] text-white/70 truncate w-full text-center">
                {(g.author.name ?? 'Someone').split(' ')[0]}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── Compact feed — Instagram-web style: small centered cards with the
          engagement row under each post (Task 8). Media keeps its NATURAL
          dimensions — the Task-5 no-crop rule still applies verbatim. ──── */}
      {posts.length === 0 ? (
        <EmptyState
          icon={<ImagePlus className="w-10 h-10 text-white/20" />}
          title="No posts yet"
          body="Be the first to share something with the community!"
          action={
            <button onClick={() => setComposerMode('post')} className="bg-coral-gradient rounded-full px-5 py-2.5 text-sm font-semibold">
              Create a post
            </button>
          }
        />
      ) : (
        <div className="flex flex-col gap-5 mx-auto w-full max-w-[500px]" data-testid="community-compact-feed">
          {posts.map((post) => (
            <article
              key={post.id}
              className="qk-card-hover rounded-3xl border border-white/8 bg-[var(--qk-card)]/50 overflow-hidden"
              data-testid={`community-post-${post.id}`}
            >
              {/* Card header */}
              <div className="flex items-center gap-2.5 px-4 py-3">
                <Avatar src={post.author.avatar} name={post.author.name} size={36} onClick={() => openProfile(post.author.id, 'community')} />
                {post.coOwner && (
                  <Avatar src={post.coOwner.avatar} name={post.coOwner.name} size={36} onClick={() => openProfile(post.coOwner!.id, 'community')} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button
                      onClick={() => openProfile(post.author.id, 'community')}
                      className="text-sm font-semibold truncate hover:underline underline-offset-2"
                    >
                      {post.coOwner
                        ? `${post.author.name ?? 'Someone'} & ${post.coOwner.name ?? 'Someone'}`
                        : post.author.name ?? 'Someone'}
                    </button>
                    {post.author.isVerified && (
                      <BadgeCheck className="w-3.5 h-3.5 text-[var(--qk-accent)] shrink-0" fill="currentColor" stroke="black" />
                    )}
                    {(post.author.isPremium || post.coOwner?.isPremium) && (
                      <Crown className="w-3 h-3 text-[var(--qk-gold)] shrink-0" fill="currentColor" stroke="none" />
                    )}
                  </div>
                  <p className="text-[11px] text-white/40">{timeAgo(post.createdAt)}</p>
                </div>
                {(post.author.id === meId || post.coOwner?.id === meId) && (
                  <button
                    onClick={() => setConfirmDeletePostId(post.id)}
                    className="p-1.5 rounded-full hover:bg-white/10 text-white/40"
                    aria-label="Delete post"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Media — natural dimensions, NEVER cropped */}
              <div className="relative flex items-center justify-center bg-black">
                {post.gameType ? (
                  <div
                    className={cn(
                      'w-full bg-gradient-to-br px-8 py-10 flex flex-col justify-center text-white',
                      GAME_GRADIENTS[post.gameType] ?? 'from-[var(--qk-purple)] to-[var(--qk-accent)]'
                    )}
                  >
                    <p className="text-4xl">{post.emoji ?? '🎮'}</p>
                    <h3 className="text-2xl font-black mt-2">{post.gameTitle}</h3>
                    <p className="text-sm text-white/90 mt-1.5 leading-relaxed">{post.gameBody}</p>
                    <p className="text-[10px] uppercase tracking-[0.2em] text-white/60 mt-4">Quicky Games</p>
                  </div>
                ) : (
                  <PostMedia post={post} onDoubleTapLike={() => doubleTapLike(post)} burst={burstFor?.id === post.id ? burstFor.n : 0} />
                )}
              </div>

              {/* Engagement + caption (§23, compact) */}
              <div className="px-4 py-3 flex flex-col gap-2">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => togglePostLike(post)}
                    className="flex items-center gap-1.5 text-sm font-semibold text-white/85 hover:text-white transition-colors"
                    aria-label={post.likedByMe ? 'Unlike post' : 'Like post'}
                  >
                    <Heart
                      className={cn('w-[22px] h-[22px] transition-transform', post.likedByMe ? 'text-[var(--qk-accent)] scale-110' : 'text-white/85')}
                      fill={post.likedByMe ? 'currentColor' : 'none'}
                    />
                    {post.likeCount}
                  </button>
                  {post.commentsEnabled && (
                    <button
                      onClick={() => setCommentsTarget(post.id)}
                      className="flex items-center gap-1.5 text-sm font-semibold text-white/85 hover:text-white transition-colors"
                      aria-label="Open comments"
                      data-testid={`community-comments-${post.id}`}
                    >
                      <MessageCircle className="w-[22px] h-[22px]" />
                      {post.commentCount}
                    </button>
                  )}
                </div>
                {post.caption && (
                  <p className="text-[13px] text-white/80 leading-relaxed line-clamp-3">
                    <span className="font-semibold text-white">{post.author.name ?? 'Someone'}</span> {post.caption}
                  </p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* ── Overlays (same components as mobile — one system, §45) ──────── */}
      <AnimatePresence>
        {composerMode && <MediaComposer mode={composerMode} onClose={() => setComposerMode(null)} onPosted={load} />}
      </AnimatePresence>

      <AnimatePresence>
        {viewerIndex !== null && groups.length > 0 && (
          <RollsViewer groups={groups} startGroup={viewerIndex} onClose={() => setViewerIndex(null)} onGroupsChange={setGroups} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {commentsTarget && (
          <PostComments
            postId={commentsTarget}
            posts={posts}
            setPosts={setPosts}
            onClose={() => setCommentsTarget(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDeletePostId && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-md"
              onClick={() => !deletingPost && setConfirmDeletePostId(null)}
            />
            <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 pointer-events-none">
              <motion.div
                initial={{ scale: 0.92, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.92, opacity: 0 }}
                transition={{ duration: 0.18 }}
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
  // §24: desktop gets a premium side panel, not a browser-default modal
  return (
    <CommentsSheet
      variant="panel"
      title={`Comments · ${post?.author.name ?? ''}`}
      load={load}
      send={send}
      onClose={onClose}
    />
  )
}

function groupRolls(rolls: any[]): RollGroup[] {
  const byUser = new Map<string, RollGroup>()
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

function PostMedia({ post, onDoubleTapLike, burst }: { post: Post; onDoubleTapLike: () => void; burst: number }) {
  const dbl = useDoubleTap(onDoubleTapLike)
  // Natural media dimensions: the image/video keeps its intrinsic aspect ratio
  // (w-full, height follows) and is NEVER cropped to the editorial cell — the
  // whole picture is always visible, exactly as uploaded.
  return (
    <div className="relative w-full select-none bg-black" onPointerUp={dbl.onPointerUp}>
      {post.mediaType === 'video' ? (
        <video
          src={post.mediaUrl ?? ''}
          style={{ filter: filterCss(post.filter) }}
          className="w-full h-auto object-contain"
          controls
          playsInline
          loop
          preload="metadata"
        />
      ) : (
        <img
          src={post.mediaUrl ?? ''}
          alt={post.caption ?? 'Community post'}
          loading="lazy"
          style={{ filter: filterCss(post.filter) }}
          className="w-full h-auto object-contain"
          draggable={false}
        />
      )}
      {burst > 0 && (
        <motion.span
          key={burst}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: [0, 1, 0], scale: [0.5, 1.4, 1.8], y: [0, -20, -40] }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="absolute inset-0 m-auto w-24 h-24 flex items-center justify-center text-6xl pointer-events-none"
          aria-hidden
        >
          ❤️
        </motion.span>
      )}
    </div>
  )
}
