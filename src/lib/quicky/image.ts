// Quicky — client-side image compression
// Quickies and community media upload way faster when resized + re-encoded
// on-device before hitting the wire (phone cameras produce 3–8 MB JPEGs).

export async function compressImage(
  file: File | Blob,
  maxDim = 1440,
  quality = 0.82
): Promise<{ blob: Blob; filename: string; previewUrl?: string }> {
  const filename = file instanceof File ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : `quicky_${Date.now()}.jpg`
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('no canvas')
    ctx.drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return { blob: file as Blob, filename }
    return { blob, filename }
  } catch {
    // Unsupported format / no canvas — upload the original
    return { blob: file as Blob, filename }
  }
}
