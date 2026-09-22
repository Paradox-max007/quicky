'use client'

// Quicky — ADMIN ImageUploader (admin-console PRD §6.1/§18.1)
//
// Shared asset control used by the Gifts / Stickers / Rewards / Seasons
// screens. Two input modes (PRD §6.1):
//   · Upload from the admin's machine → /api/quicky/admin/assets/upload
//     (validated server-side, stored in Supabase Storage, real progress bar)
//   · Paste an external image URL (https://… or /uploads/…)
//
// Preview handles STATIC and ANIMATED assets (§18.1): GIF/APNG/WebP animate
// naturally; frame sequences are out of scope for this control (the reward
// editor manages those explicitly). Replace + remove + validation errors +
// storage mode chip included.
import { useRef, useState } from 'react'
import { Image as ImageIcon, Link2, Trash2, UploadCloud } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'

export function isProbablyImageUrl(v: string): boolean {
  return /^https?:\/\//i.test(v) || v.startsWith('/uploads/') || v.startsWith('data:image/')
}

/** Render an asset that may be a URL or a short emoji glyph. */
export function AssetPreview({ value, className, alt }: { value: string | null | undefined; className?: string; alt?: string }) {
  if (!value) return <span className={`flex items-center justify-center text-white/25 ${className ?? ''}`}><ImageIcon className="w-4 h-4" aria-hidden /></span>
  if (isProbablyImageUrl(value)) {
     
    return <img src={value} alt={alt ?? 'asset'} className={`object-contain ${className ?? ''}`} />
  }
  return <span className={`flex items-center justify-center ${className ?? ''}`}>{value}</span>
}

export function ImageUploader({
  value,
  onChange,
  folder,
  label,
  hint,
  compact,
}: {
  value: string | null | undefined
  onChange: (next: string | null) => void
  folder: 'gifts' | 'stickers' | 'cosmetics' | 'animations' | 'generic'
  label: string
  hint?: string
  compact?: boolean
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [mode, setMode] = useState<'upload' | 'url'>('upload')
  const [urlDraft, setUrlDraft] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [storageMode, setStorageMode] = useState<string | null>(null)

  const pick = () => fileRef.current?.click()

  const upload = async (file: File) => {
    setError(null)
    if (file.size > 4 * 1024 * 1024) {
      setError('Images must be 4 MB or smaller.')
      return
    }
    setProgress(0)
    try {
      const res = await api.admin.assets.upload(file, folder, setProgress)
      setStorageMode(res?.storage?.mode ?? null)
      onChange(res.url)
      toast.success('Asset uploaded', { description: `${res.storage.mode === 'supabase' ? 'Supabase Storage' : 'local uploads'} · ${folder}/${res.path.split('/').pop()}` })
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Upload failed'
      setError(message)
      toast.error('Upload failed', { description: message })
    } finally {
      setProgress(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const applyUrl = () => {
    const v = urlDraft.trim()
    if (!v) return
    if (!isProbablyImageUrl(v)) {
      setError('Enter an image URL (https://… or /uploads/…).')
      return
    }
    setError(null)
    onChange(v)
    setUrlDraft('')
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] font-bold text-white/50 uppercase tracking-wider">{label}</label>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setMode('upload')}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${mode === 'upload' ? 'bg-[var(--qk-accent)]/20 text-[var(--qk-accent)]' : 'bg-white/5 text-white/40'}`}
          >
            <UploadCloud className="w-3 h-3" aria-hidden /> Upload
          </button>
          <button
            type="button"
            onClick={() => setMode('url')}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-colors ${mode === 'url' ? 'bg-[var(--qk-accent)]/20 text-[var(--qk-accent)]' : 'bg-white/5 text-white/40'}`}
          >
            <Link2 className="w-3 h-3" aria-hidden /> URL
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div
          className={`shrink-0 rounded-xl border border-white/10 bg-black/30 overflow-hidden flex items-center justify-center ${compact ? 'w-12 h-12' : 'w-16 h-16'}`}
        >
          <AssetPreview value={value} className={compact ? 'w-10 h-10' : 'w-14 h-14'} />
        </div>

        {mode === 'upload' ? (
          <div className="flex-1 min-w-0">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/apng,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void upload(file)
              }}
            />
            <button
              type="button"
              onClick={pick}
              disabled={progress !== null}
              className="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-3 py-2.5 text-xs font-semibold text-white/60 hover:text-white hover:border-white/30 transition-colors disabled:opacity-50"
            >
              <UploadCloud className="w-3.5 h-3.5" aria-hidden />
              {progress !== null ? `Uploading… ${progress}%` : 'Choose image (PNG / JPG / WebP / GIF / SVG)'}
            </button>
          </div>
        ) : (
          <div className="flex-1 min-w-0 flex gap-2">
            <input
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyUrl()}
              placeholder="https://cdn.example.com/gift.png"
              className="flex-1 min-w-0 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-[var(--qk-accent)]/50"
            />
            <button
              type="button"
              onClick={applyUrl}
              className="rounded-xl bg-[var(--qk-accent)]/20 border border-[var(--qk-accent)]/40 px-3 text-xs font-bold text-[var(--qk-accent)]"
            >
              Use
            </button>
          </div>
        )}

        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="shrink-0 rounded-full bg-white/5 hover:bg-rose-500/20 text-white/40 hover:text-rose-300 p-2 transition-colors"
            title="Remove asset"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
          </button>
        )}
      </div>

      {progress !== null && (
        <div className="h-1 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full bg-[var(--qk-accent)] transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      {hint && !error && <p className="text-[10px] text-white/30">{hint}{storageMode ? ` · stored: ${storageMode}` : ''}</p>}
    </div>
  )
}
