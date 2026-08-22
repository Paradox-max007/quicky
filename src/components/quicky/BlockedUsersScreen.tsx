'use client'

import { useState, useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Shield, BadgeCheck, Crown, User as UserIcon } from 'lucide-react'

type BlockedUser = {
  blockId: string
  blockedAt: string
  user: {
    id: string
    name: string | null
    age: number | null
    city: string | null
    isPremium: boolean
    isVerified: boolean
    photo: string | null
  }
}

export function BlockedUsersScreen() {
  const openProfile = useQuickyStore((s) => s.openProfile)
  const [blocked, setBlocked] = useState<BlockedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [unblocking, setUnblocking] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    try {
      const res = await api.settings.blocked.list()
      setBlocked(res.blocked)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to load blocked users')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const unblock = async (blockId: string, name: string | null) => {
    if (!confirm(`Unblock ${name ?? 'this user'}? They will be able to see and message you again.`)) return
    setUnblocking(blockId)
    try {
      await api.settings.blocked.unblock(blockId)
      toast.success(`${name ?? 'User'} unblocked`)
      setBlocked((prev) => prev.filter((b) => b.blockId !== blockId))
    } catch (e: any) {
      toast.error(e.body?.error ?? e.message ?? 'Failed to unblock')
    } finally {
      setUnblocking(null)
    }
  }

  return (
    <SettingsSubScreen title="Blocked Users">
      <div className="px-5 py-5">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
          </div>
        ) : blocked.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Shield className="w-12 h-12 text-white/20 mb-3" />
            <h2 className="text-lg font-semibold">No blocked users</h2>
            <p className="text-white/50 text-sm mt-1">Users you block will appear here. You can unblock them anytime.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {blocked.map((b) => (
              <li
                key={b.blockId}
                className="bg-white/5 rounded-2xl p-3 border border-white/8 flex items-center gap-3"
              >
                <button
                  onClick={() => openProfile(b.user.id)}
                  className="relative shrink-0"
                  aria-label={`View ${b.user.name ?? 'user'}'s profile`}
                >
                  {b.user.photo ? (
                    <img src={b.user.photo} alt={b.user.name ?? ''} className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center">
                      <UserIcon className="w-6 h-6 text-white/40" />
                    </div>
                  )}
                  {b.user.isVerified && (
                    <BadgeCheck className="absolute -bottom-0.5 -right-0.5 w-4 h-4 text-[#FF2D55] bg-[#0F0F14] rounded-full" fill="currentColor" stroke="white" />
                  )}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <p className="text-sm font-semibold truncate">{b.user.name}, {b.user.age}</p>
                    {b.user.isPremium && (
                      <Crown className="w-3 h-3 text-[#F5C570]" fill="currentColor" stroke="none" />
                    )}
                  </div>
                  {b.user.city && (
                    <p className="text-xs text-white/50 truncate">{b.user.city}</p>
                  )}
                </div>
                <button
                  onClick={() => unblock(b.blockId, b.user.name)}
                  disabled={unblocking === b.blockId}
                  className="text-xs font-semibold text-[#FF5E7E] hover:text-[#FF2D55] px-3 py-1.5 rounded-full hover:bg-[#FF2D55]/10 transition-colors disabled:opacity-50 shrink-0"
                >
                  {unblocking === b.blockId ? '...' : 'Unblock'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsSubScreen>
  )
}
