// Quicky — admin sticker image staging (client-side).
//
// Powers the batch pack uploader in AdminStickersScreen: select up to
// STICKER_BATCH_MAX sticker files, preview them, and normalize every
// raster image to the SAME square size (contain-fit onto a transparent
// canvas — 128 / 256 / 512 px) before anything touches the network. The
// resized blob is what gets uploaded to Supabase Storage, so a whole pack
// lands in storage already uniform.
//
// Animated formats (GIF / APNG) and SVG can't be canvas-normalized without
// losing frames/vector data — they pass through untouched (still size-
// validated against the 4 MB upload cap by the caller).

export const STICKER_BATCH_MAX = 20
export const STICKER_SIZE_OPTIONS = [128, 256, 512] as const
export type StickerTargetSize = (typeof STICKER_SIZE_OPTIONS)[number]

/** One staged sticker file — blob held client-side until the batch is saved. */
export type StagedStickerFile = {
  uid: string
  name: string
  /** The (possibly resized) binary that will be uploaded. */
  blob: Blob
  /** object URL for the preview grid — revoke via disposeStagedFiles. */
  previewUrl: string
  /** false for GIF/APNG/SVG passthroughs. */
  resized: boolean
  width: number
  height: number
}

const RAW_MAX_BYTES = 8 * 1024 * 1024 // generous input cap; output must stay ≤ 4 MB for the upload route
const OUTPUT_MAX_BYTES = 4 * 1024 * 1024

/** Formats we can safely re-draw on a canvas (static rasters). */
function isResizable(file: File): boolean {
  return (
    file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/webp'
  )
}

function fallbackUid(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `s-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  }
}

/** Filename minus extension, trimmed to a sane sticker name length. */
export function stickerNameFromFile(file: File): string {
  const base = file.name.replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim()
  return (base || 'Sticker').slice(0, 40)
}

async function loadImage(file: File): Promise<{ w: number; h: number; draw: CanvasImageSource }> {
  if (typeof createImageBitmap === 'function') {
    const bmp = await createImageBitmap(file)
    return { w: bmp.width, h: bmp.height, draw: bmp }
  }
  // WebView fallback — decode via an object URL
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('decode_failed'))
      el.src = url
    })
    return { w: img.naturalWidth, h: img.naturalHeight, draw: img }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Stages ONE file: raster images are resized onto a square transparent
 * canvas of `target` px (contain-fit); GIF/APNG/SVG pass through as-is.
 * Throws on oversized input or decode failure — callers surface a toast.
 */
export async function stageStickerFile(file: File, target: StickerTargetSize): Promise<StagedStickerFile> {
  if (file.size > RAW_MAX_BYTES) throw new Error(`${file.name} is larger than 8 MB`)
  const name = stickerNameFromFile(file)

  if (!isResizable(file)) {
    return {
      uid: fallbackUid(),
      name,
      blob: file,
      previewUrl: URL.createObjectURL(file),
      resized: false,
      width: 0,
      height: 0,
    }
  }

  const { w, h, draw } = await loadImage(file)
  const canvas = document.createElement('canvas')
  canvas.width = target
  canvas.height = target
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable in this browser')
  // contain-fit, centered — aspect ratio preserved, padded with transparency
  const scale = Math.min(target / w, target / h)
  const dw = Math.max(1, Math.round(w * scale))
  const dh = Math.max(1, Math.round(h * scale))
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(draw, (target - dw) / 2, (target - dh) / 2, dw, dh)
  if ('close' in draw && typeof (draw as ImageBitmap).close === 'function') (draw as ImageBitmap).close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob || blob.size === 0) throw new Error(`${file.name} could not be resized`)
  if (blob.size > OUTPUT_MAX_BYTES) throw new Error(`${file.name} still exceeds 4 MB after resizing`)

  return {
    uid: fallbackUid(),
    name,
    blob,
    previewUrl: URL.createObjectURL(blob),
    resized: true,
    width: target,
    height: target,
  }
}

export type StageResult = {
  staged: StagedStickerFile[]
  /** Files that were rejected, with reasons, for a toast summary. */
  skipped: { name: string; reason: string }[]
}

/**
 * Stages many files against the batch cap: `alreadyStaged + files.length`
 * may not exceed STICKER_BATCH_MAX; overflow is skipped, not silently cut.
 */
export async function stageStickerFiles(
  files: File[],
  target: StickerTargetSize,
  alreadyStaged = 0
): Promise<StageResult> {
  const staged: StagedStickerFile[] = []
  const skipped: { name: string; reason: string }[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    if (alreadyStaged + staged.length >= STICKER_BATCH_MAX) {
      skipped.push({ name: file.name, reason: `batch limit is ${STICKER_BATCH_MAX} files` })
      continue
    }
    if (!file.type.startsWith('image/')) {
      skipped.push({ name: file.name, reason: 'not an image' })
      continue
    }
    try {
      staged.push(await stageStickerFile(file, target))
    } catch (e) {
      skipped.push({ name: file.name, reason: e instanceof Error ? e.message : 'could not stage' })
    }
  }
  return { staged, skipped }
}

/** Frees the object URLs of a staged list (call when replacing/discarding). */
export function disposeStagedFiles(list: StagedStickerFile[]): void {
  for (const s of list) {
    try {
      URL.revokeObjectURL(s.previewUrl)
    } catch {
      /* ignore */
    }
  }
}

/** Wraps a staged blob as a File so the upload keeps a real filename. */
export function stagedToFile(s: StagedStickerFile, index: number): File {
  const ext = s.blob.type === 'image/gif' ? 'gif' : s.blob.type === 'image/svg+xml' ? 'svg' : s.blob.type === 'image/webp' ? 'webp' : 'png'
  const safe = s.name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-').toLowerCase() || 'sticker'
  try {
    return new File([s.blob], `${safe}-${index + 1}.${ext}`, { type: s.blob.type || 'image/png' })
  } catch {
    // very old WebViews without the File(BlobParts) ctor
    return s.blob as unknown as File
  }
}
