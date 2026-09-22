// Quicky — ASSET STORAGE (admin-console PRD §6.1/§6.2 + §4)
//
// Admin-console asset uploads (gift artwork, sticker icons, cosmetic levels,
// animation frames) go through THIS adapter:
//   · Supabase Storage bucket "quicky-assets" when SUPABASE_URL +
//     SUPABASE_SERVICE_ROLE_KEY are configured (server-side service client —
//     the anon key NEVER gets storage write access).
//   · Local filesystem fallback (public/uploads/assets/<folder>/...) when the
//     Supabase env is absent — same null-safe pattern as realtime.ts, so the
//     app keeps working in plain dev environments.
//
// Uploaded binaries are NEVER stored on the application server as the PRIMARY
// mechanism when Supabase is configured (PRD §6.1). File names are
// deterministic-unique (folder + timestamp + random hex + sanitized ext).

import { randomBytes } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const ASSET_BUCKET = 'quicky-assets'

/** Folders mirror the PRD §6.2 storage structure. */
export const ASSET_FOLDERS = ['gifts', 'stickers', 'cosmetics', 'animations', 'generic'] as const
export type AssetFolder = (typeof ASSET_FOLDERS)[number]

/** Validation limits (PRD §6.1 — validate BEFORE any upload). */
export const ASSET_MAX_BYTES = 4 * 1024 * 1024 // 4 MB
export const ASSET_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/apng',
  'image/svg+xml',
] as const
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/apng': 'apng',
  'image/svg+xml': 'svg',
}

export type AssetValidation =
  | { ok: true; contentType: string; ext: string; animated: boolean }
  | { ok: false; message: string }

/** Validate type + size (PRD §6.1 step 1). Animated = GIF/APNG/WebP. */
export function validateAsset(buffer: Buffer, contentType: string): AssetValidation {
  const mime = (contentType || '').split(';')[0].trim().toLowerCase()
  if (!(ASSET_MIME_TYPES as readonly string[]).includes(mime)) {
    return { ok: false, message: 'Only PNG, JPG, WebP, GIF, APNG and SVG images are allowed.' }
  }
  if (buffer.length === 0) return { ok: false, message: 'The file is empty.' }
  if (buffer.length > ASSET_MAX_BYTES) return { ok: false, message: 'Images must be 4 MB or smaller.' }
  return {
    ok: true,
    contentType: mime,
    ext: EXT_BY_MIME[mime] ?? 'png',
    animated: mime === 'image/gif' || mime === 'image/apng' || mime === 'image/webp',
  }
}

// ─── Supabase service client (lazy singleton) ───────────────────────────────

let serviceClient: SupabaseClient | null | undefined

function getServiceClient(): SupabaseClient | null {
  if (serviceClient !== undefined) return serviceClient
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  serviceClient = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null
  return serviceClient
}

async function ensureBucket(client: SupabaseClient): Promise<boolean> {
  const { data } = await client.storage.getBucket(ASSET_BUCKET).catch(() => ({ data: null as never }))
  if (data) return true
  const { error } = await client.storage
    .createBucket(ASSET_BUCKET, { public: true })
    .catch(() => ({ error: new Error('bucket create failed') }))
  return !error
}

// ─── Upload ─────────────────────────────────────────────────────────────────

export type UploadResult =
  | { ok: true; url: string; storage: 'supabase' | 'local'; path: string }
  | { ok: false; message: string }

/** Deterministic-unique object key inside the bucket (PRD §6.2). */
function objectKey(folder: string, filename: string): string {
  const stamp = Date.now().toString(36)
  const rand = randomBytes(6).toString('hex')
  return `${folder}/${stamp}${rand}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}`
}

/**
 * Upload a validated asset buffer. Supabase Storage first; local filesystem
 * fallback second (dev / un-configured environments).
 */
export async function uploadAsset(
  buffer: Buffer,
  opts: { folder: string; contentType: string; ext: string; filename?: string }
): Promise<UploadResult> {
  const folder = (ASSET_FOLDERS as readonly string[]).includes(opts.folder) ? opts.folder : 'generic'
  const key = objectKey(folder, opts.filename ?? `asset.${opts.ext}`)

  const client = getServiceClient()
  if (client) {
    try {
      await ensureBucket(client)
      const { error } = await client.storage
        .from(ASSET_BUCKET)
        .upload(key, buffer, { contentType: opts.contentType, upsert: false })
      if (!error) {
        const { data } = client.storage.from(ASSET_BUCKET).getPublicUrl(key)
        return { ok: true, url: data.publicUrl, storage: 'supabase', path: key }
      }
      console.warn('[storage] supabase upload failed, falling back to local:', error.message)
    } catch (e) {
      console.warn('[storage] supabase upload threw, falling back to local:', e)
    }
  }

  // Local fallback — served from public/uploads (same path the existing
  // user-photo upload route uses).
  try {
    const dir = path.join(process.cwd(), 'public', 'uploads', 'assets', folder)
    await mkdir(dir, { recursive: true })
    const filename = key.slice(folder.length + 1)
    await writeFile(path.join(dir, filename), buffer)
    return { ok: true, url: `/uploads/assets/${folder}/${filename}`, storage: 'local', path: key }
  } catch (e) {
    return { ok: false, message: 'Upload failed — storage is not reachable.' }
  }
}

/** Which storage mode is active (shown in the admin Settings screen). */
export function storageInfo(): { mode: 'supabase' | 'local'; bucket: string; configured: boolean } {
  return { mode: getServiceClient() ? 'supabase' : 'local', bucket: ASSET_BUCKET, configured: !!getServiceClient() }
}
