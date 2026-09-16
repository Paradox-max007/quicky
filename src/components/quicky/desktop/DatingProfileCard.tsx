'use client'

import { useMemo } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { PencilLine } from 'lucide-react'

/**
 * DATING PROFILE section under the discover stage (concept doc §15/§16/§53):
 * real completeness computed from actual profile fields, with actionable
 * "why" hints (§16) — never a made-up percentage.
 */

type Check = { ok: boolean; weight: number; missing: string }

export function DatingProfileCard() {
  const user = useQuickyStore((s) => s.user)
  const setView = useQuickyStore((s) => s.setView)
  const openWebEditProfile = useQuickyStore((s) => s.openWebEditProfile)

  const { completeness, missing, interests } = useMemo(() => {
    const photos = user?.photos ?? []
    const ints = user?.interests ?? []
    const checks: Check[] = [
      { ok: photos.length > 0, weight: 30, missing: 'Add a profile photo' },
      { ok: photos.length >= 3, weight: 10, missing: 'Add 2 more photos' },
      { ok: !!user?.bio, weight: 15, missing: 'Add your bio' },
      { ok: ints.length >= 3, weight: 20, missing: ints.length === 0 ? 'Add interests' : `Add ${3 - Math.min(3, ints.length)} more interest${3 - ints.length === 1 ? '' : 's'}` },
      { ok: (user?.prompts ?? []).length > 0, weight: 10, missing: 'Answer a profile prompt' },
      { ok: !!user?.city, weight: 5, missing: 'Add your city' },
      { ok: !!user?.lookingFor, weight: 10, missing: "Set what you're looking for" },
    ]
    const total = checks.reduce((s, c) => s + c.weight, 0)
    const done = checks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0)
    return {
      completeness: Math.round((done / total) * 100),
      missing: checks.filter((c) => !c.ok).map((c) => c.missing),
      interests: ints,
    }
  }, [user])

  return (
    <section className="w-full rounded-3xl border border-white/8 bg-[var(--qk-card)]/60 p-6" data-testid="desktop-dating-profile">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-bold tracking-widest text-white/40 uppercase">Dating Profile</p>
        <button
          onClick={() => openWebEditProfile()}
          className="flex items-center gap-1.5 rounded-full border border-[var(--qk-accent)]/30 bg-[var(--qk-accent)]/10 px-3 py-1.5 text-xs font-semibold text-[var(--qk-accent)] hover:bg-[var(--qk-accent)]/20 transition-colors"
        >
          <PencilLine className="w-3.5 h-3.5" />
          Edit Profile
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-sm font-semibold text-white/90">Profile {completeness}% complete</span>
          </div>
          <div className="h-2 rounded-full bg-white/8 overflow-hidden">
            <div
              className="h-full rounded-full bg-coral-gradient transition-all duration-500"
              style={{ width: `${completeness}%` }}
              data-testid="desktop-completeness-bar"
            />
          </div>
        </div>
      </div>

      {missing.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {missing.slice(0, 3).map((m) => (
            <li key={m} className="text-[11px] text-white/45">
              <span className="text-[var(--qk-accent)] mr-1">·</span>
              {m}
            </li>
          ))}
        </ul>
      )}

      {interests.length > 0 && (
        <div className="mt-4 pt-4 border-t border-white/8">
          <p className="text-[10px] font-bold tracking-widest text-white/40 uppercase mb-2">Interests</p>
          <div className="flex flex-wrap gap-1.5">
            {interests.slice(0, 10).map((t) => (
              <span key={t} className="text-[11px] font-medium bg-white/8 text-white/75 rounded-full px-2.5 py-1 capitalize">
                {t.replace(/-/g, ' ')}
              </span>
            ))}
            {interests.length > 10 && <span className="text-[11px] text-white/50 self-center">+{interests.length - 10}</span>}
          </div>
        </div>
      )}
    </section>
  )
}
