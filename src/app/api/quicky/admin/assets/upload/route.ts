// Quicky — ADMIN ASSET UPLOAD (admin-console PRD §6.1/§6.2 + §18.1 ImageUploader)
// POST /api/quicky/admin/assets/upload  (multipart: file, folder)
//
// Validates type + size SERVER-side, stores the binary in Supabase Storage
// (bucket "quicky-assets" via the service-role key) — or the local public/
// uploads fallback when Supabase is not configured — and returns the public
// URL used by gifts / stickers / cosmetics / animations.
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, logAdminAction } from '@/lib/quicky/admin'
import { uploadAsset, validateAsset, ASSET_FOLDERS, storageInfo } from '@/lib/quicky/storage'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireAdmin()
  if (gate.error) return gate.error
  return NextResponse.json({ ok: true, folders: ASSET_FOLDERS, storage: storageInfo() })
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin()
  if (gate.error) return gate.error

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'multipart_form_required' }, { status: 400 })
  }

  const file = form.get('file')
  const folder = String(form.get('folder') ?? 'generic')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 })
  if (!(ASSET_FOLDERS as readonly string[]).includes(folder)) {
    return NextResponse.json({ error: 'invalid_folder', folders: ASSET_FOLDERS }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const check = validateAsset(buffer, file.type)
  if (!check.ok) return NextResponse.json({ error: 'invalid_asset', message: check.message }, { status: 400 })

  const result = await uploadAsset(buffer, {
    folder,
    contentType: check.contentType,
    ext: check.ext,
    filename: file.name || `asset.${check.ext}`,
  })
  if (!result.ok) return NextResponse.json({ error: 'upload_failed', message: result.message }, { status: 500 })

  await logAdminAction(gate.me.id, 'upload', 'asset', result.path, { folder, bytes: buffer.length, storage: result.storage })
  return NextResponse.json({
    ok: true,
    url: result.url,
    path: result.path,
    animated: check.animated,
    storage: storageInfo(),
  })
}
