// Quicky — file upload (photo, video, quicky media)
// POST /api/quicky/upload  multipart/form-data
// Saves to /home/z/my-project/public/uploads/{cuid}.{ext}
// Returns { url }
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import { db } from '@/lib/db'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const UPLOAD_DIR = '/home/z/my-project/public/uploads'
const PUBLIC_PREFIX = '/uploads'

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

const MAX_BYTES = 25 * 1024 * 1024 // 25MB

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const kind = String(formData.get('kind') ?? 'photo') // 'photo' | 'quicky' | 'voice'
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file' }, { status: 400 })
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 415 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (max 25MB)' }, { status: 413 })
    }

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

    const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
    const id = crypto.randomBytes(12).toString('hex')
    const filename = `${id}.${ext}`
    const filepath = path.join(UPLOAD_DIR, filename)

    const buf = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(filepath, buf)

    const url = `${PUBLIC_PREFIX}/${filename}`

    // If kind=photo, also create a Photo record (called separately if user wants primary etc.)
    if (kind === 'photo') {
      const photo = await db.photo.create({
        data: {
          userId: me.id,
          url,
        },
      })
      return NextResponse.json({ url, photoId: photo.id })
    }

    return NextResponse.json({ url })
  } catch (e: any) {
    console.error('Upload error', e)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
