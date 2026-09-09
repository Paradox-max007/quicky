import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getCurrentUser } from "@/lib/quicky/auth"

export async function GET(_req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const user = await db.user.findUnique({ where: { id: me.id }, select: { coinBalance: true } })
  return NextResponse.json({ coinBalance: user?.coinBalance ?? 0 })
}
