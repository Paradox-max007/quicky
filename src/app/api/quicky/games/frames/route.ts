import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/quicky/auth"
import { PROFILE_FRAMES } from "@/lib/quicky/constants"

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const [user, userFrames] = await Promise.all([
    db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true, equippedFrameId: true } }),
    db.userFrame.findMany({ where: { userId: me.id }, select: { frameId: true, equipped: true } }),
  ])

  const owned = new Set(userFrames.map((f) => f.frameId))
  const equipped = userFrames.find((f) => f.equipped)?.frameId ?? "frame_default"

  return NextResponse.json({
    catalog: PROFILE_FRAMES.map((f) => ({ ...f, owned: owned.has(f.id) || f.id === "frame_default" })),
    equippedFrameId: equipped,
    coinBalance: user?.coinBalance ?? 0,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })

  const { frameId, action } = await req.json()
  if (!frameId || !action) return NextResponse.json({ error: "missing_fields" }, { status: 400 })

  const frameDef = PROFILE_FRAMES.find((f) => f.id === frameId)
  if (!frameDef) return NextResponse.json({ error: "invalid_frame" }, { status: 400 })

  const existingOwnership = await db.userFrame.findFirst({ where: { userId: me.id, frameId } })

  if (action === "buy") {
    if (frameDef.id === "frame_default") return NextResponse.json({ error: "frame_is_free" }, { status: 400 })
    if (existingOwnership) return NextResponse.json({ error: "already_owned" }, { status: 400 })

    const user = await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } })
    if (!user || user.coinBalance < frameDef.coinPrice) {
      return NextResponse.json({ error: "insufficient_coins" }, { status: 402 })
    }

    await db.$transaction([
      db.user.update({ where: { id: me.id }, data: { coinBalance: { decrement: frameDef.coinPrice } } }),
      db.coinLedger.create({ data: { userId: me.id, delta: -frameDef.coinPrice, reason: "frame_purchase", meta: JSON.stringify({ frameId }) } }),
      db.userFrame.create({ data: { userId: me.id, frameId, equipped: false } }),
    ])
    return NextResponse.json({ ok: true, action: "bought" })
  }

  if (action === "equip") {
    const isDefault = frameDef.id === "frame_default"
    if (!isDefault && !existingOwnership) return NextResponse.json({ error: "not_owned" }, { status: 403 })

    await db.$transaction([
      db.userFrame.updateMany({ where: { userId: me.id }, data: { equipped: false } }),
      ...(isDefault ? [] : [
        db.userFrame.update({
          where: { userId_frameId: { userId: me.id, frameId } },
          data: { equipped: true },
        }),
      ]),
      db.user.update({ where: { id: me.id }, data: { equippedFrameId: isDefault ? null : frameId } }),
    ])
    return NextResponse.json({ ok: true, action: "equipped", equippedFrameId: isDefault ? null : frameId })
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 })
}
