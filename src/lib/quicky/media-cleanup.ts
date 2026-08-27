// Quicky — permanent media deletion (Quickies are unrecoverable after consumption)
import path from 'path'
import fs from 'fs/promises'

// Delete an uploaded file by its public URL ('/uploads/<name>').
// Best-effort: missing files are ignored; path traversal is impossible
// because only the basename is used.
export function deleteUploadedMedia(mediaUrl: string | null | undefined): void {
  if (!mediaUrl || !mediaUrl.startsWith('/uploads/')) return
  const safe = path.basename(mediaUrl)
  fs.unlink(path.join(process.cwd(), 'public', 'uploads', safe)).catch(() => {})
}
