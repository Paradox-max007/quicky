'use client'

// Quicky — media composer for community posts & rolls.
// Pick/capture photo or video, apply an Instagram-style filter, add a caption,
// then upload. Works identically on web and inside the Capacitor WebView
// (file inputs + `capture` attribute open the native camera on Android/iOS).

import { useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { X, Camera, ImagePlus, Loader2, Film } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/quicky/api-client'
import { MEDIA_FILTERS, filterCss } from '@/lib/quicky/filters'
import { cn } from '@/lib/utils'

type Mode = 'post' | 'roll'

export function MediaComposer({
  mode,
  onClose,
  onPosted,
}: {
  mode: Mode
  onClose: () => void
  onPosted: () => void
}) {
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isVideo, setIsVideo] = useState(false)
  const [filterId, setFilterId] = useState('none')
  const [caption, setCaption] = useState('')
  const [sharing, setSharing] = useState(false)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

  const pickFile = (f: File | null | undefined) => {
    if (!f) return
    const video = f.type.startsWith('video/')
    // Server caps uploads at 20MB
    if (f.size > 20 * 1024 * 1024) {
      toast.error('Media must be under 20MB')
      return
    }
    setFile(f)
    setIsVideo(video)
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return URL.createObjectURL(f)
    })
  }

  const share = async () => {
    if (!file || sharing) return
    setSharing(true)
    try {
      const kind = mode === 'roll' ? 'roll' : 'post'
      const up = await api.upload(file, kind as any)
      const payload = {
        mediaUrl: up.url,
        mediaType: isVideo ? ('video' as const) : ('image' as const),
        caption: caption.trim(),
        filter: filterId,
      }
      if (mode === 'roll') {
        await api.rolls.create(payload)
        toast.success('Roll shared ✨')
      } else {
        await api.community.create(payload)
        toast.success('Post shared 🎉')
      }
      onPosted()
      onClose()
    } catch (e: any) {
      toast.error(e?.message ?? 'Failed to share')
    } finally {
      setSharing(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-[130] bg-[var(--qk-bg)] flex flex-col"
    >
      {/* Header */}
      <div className="shrink-0 safe-area-top px-3 py-2.5 flex items-center justify-between border-b border-white/10">
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10" aria-label="Close composer">
          <X className="w-5 h-5" />
        </button>
        <h2 className="font-bold">{mode === 'roll' ? 'New Roll' : 'New Post'}</h2>
        <button
          onClick={share}
          disabled={!file || sharing}
          className={cn(
            'px-4 py-1.5 rounded-full text-sm font-semibold flex items-center gap-1.5',
            file && !sharing ? 'bg-coral-gradient glow-coral text-white active:scale-95 transition-transform' : 'bg-white/5 text-white/30'
          )}
        >
          {sharing && <Loader2 className="w-4 h-4 animate-spin" />}
          Share
        </button>
      </div>

      {!previewUrl ? (
        /* ── Step 1: choose source ─────────────────────────────────────── */
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-8">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[var(--qk-accent)] to-[var(--qk-purple)] flex items-center justify-center mb-8 glow-coral">
            {mode === 'roll' ? <Film className="w-10 h-10 text-white" strokeWidth={1.75} /> : <ImagePlus className="w-10 h-10 text-white" strokeWidth={1.75} />}
          </div>
          <div className="w-full max-w-xs flex flex-col gap-3">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="flex items-center justify-center gap-2 bg-white/10 border border-white/15 rounded-2xl py-3.5 font-semibold text-sm active:scale-[0.98] transition-transform"
            >
              <Camera className="w-5 h-5" /> Open Camera
            </button>
            <button
              onClick={() => galleryInputRef.current?.click()}
              className="flex items-center justify-center gap-2 bg-white/10 border border-white/15 rounded-2xl py-3.5 font-semibold text-sm active:scale-[0.98] transition-transform"
            >
              <ImagePlus className="w-5 h-5" /> Choose from Gallery
            </button>
          </div>
          <p className="text-xs text-white/40 mt-6 text-center">Photos & videos up to 20MB</p>
        </div>
      ) : (
        /* ── Step 2: preview + filters ──────────────────────────────────── */
        <>
          <div className="flex-1 min-h-0 relative bg-black flex items-center justify-center overflow-hidden">
            {isVideo ? (
              <video
                key={previewUrl}
                src={previewUrl}
                style={{ filter: filterCss(filterId) }}
                className="max-w-full max-h-full object-contain"
                autoPlay
                loop
                muted
                playsInline
              />
            ) : (
              <img
                src={previewUrl}
                alt="Preview"
                style={{ filter: filterCss(filterId) }}
                className="max-w-full max-h-full object-contain"
              />
            )}
            {sharing && (
              <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--qk-accent)]" />
              </div>
            )}
          </div>

          {/* Caption */}
          <div className="shrink-0 px-4 pt-3">
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder={mode === 'roll' ? 'Add a caption to your roll...' : 'Write a caption...'}
              maxLength={mode === 'roll' ? 300 : 500}
              className="w-full bg-white/5 border border-white/10 rounded-full px-4 py-2.5 text-sm placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50"
            />
          </div>

          {/* Filter strip */}
          <div className="shrink-0 px-4 pt-3 pb-3">
            <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-2">Filters</p>
            <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
              {MEDIA_FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilterId(f.id)}
                  className="shrink-0 flex flex-col items-center gap-1"
                  aria-label={`Filter ${f.label}`}
                >
                  <div
                    className={cn(
                      'w-14 h-14 rounded-xl overflow-hidden border-2 relative bg-gradient-to-br from-[var(--qk-accent)]/60 to-[var(--qk-purple)]/60',
                      filterId === f.id ? 'border-[var(--qk-accent)]' : 'border-transparent'
                    )}
                  >
                    {isVideo ? (
                      <video src={previewUrl} muted playsInline preload="metadata" style={{ filter: f.css }} className="w-full h-full object-cover" />
                    ) : (
                      <img src={previewUrl} alt="" style={{ filter: f.css }} className="w-full h-full object-cover" />
                    )}
                  </div>
                  <span className={cn('text-[9px]', filterId === f.id ? 'text-[var(--qk-accent)] font-semibold' : 'text-white/50')}>
                    {f.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Hidden sources */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          pickFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*,video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => {
          pickFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </motion.div>
  )
}
