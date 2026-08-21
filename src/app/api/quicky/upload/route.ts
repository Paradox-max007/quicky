// Quicky — File upload handler
// POST /api/quicky/upload
// Accepts multipart/form-data with 'file' and optional 'kind' ('photo' | 'quicky' | 'voice')
// Saves file to public/uploads/ and returns { ok: true, url: '/uploads/<filename>' }

import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/quicky/auth'
import path from 'path'
import fs from 'fs/promises'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const kind = (formData.get('kind') as string) || 'photo'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Limit file size (max 20MB)
    const MAX_SIZE = 20 * 1024 * 1024
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File size exceeds 20MB limit' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Determine extension safely
    let ext = path.extname(file.name).toLowerCase()
    if (!ext || ext.length > 5) {
      if (file.type.includes('jpeg') || file.type.includes('jpg')) ext = '.jpg'
      else if (file.type.includes('png')) ext = '.png'
      else if (file.type.includes('webp')) ext = '.webp'
      else if (file.type.includes('gif')) ext = '.gif'
      else if (file.type.includes('mp4')) ext = '.mp4'
      else if (file.type.includes('webm')) ext = '.webm'
      else if (file.type.includes('quicktime')) ext = '.mov'
      else ext = '.bin'
    }

    const filename = `${kind}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads')

    await fs.mkdir(uploadsDir, { recursive: true })
    const filePath = path.join(uploadsDir, filename)
    await fs.writeFile(filePath, buffer)

    const url = `/uploads/${filename}`

    return NextResponse.json({
      ok: true,
      url,
      filename,
      kind,
    })
  } catch (error: any) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to upload file' },
      { status: 500 }
    )
  }
}
