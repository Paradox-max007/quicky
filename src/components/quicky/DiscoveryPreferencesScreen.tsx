'use client'

import { useState, useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Toggle } from './Toggle'
import { Lock, Crown, Users, MapPin, Shield, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INTEREST_TAGS } from '@/lib/quicky/constants'

export function DiscoveryPreferencesScreen() {
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const showPaywall = useQuickyStore((s) => s.showPaywall)

  const [ageMin, setAgeMin] = useState(user?.discoveryAgeMin ?? 18)
  const [ageMax, setAgeMax] = useState(user?.discoveryAgeMax ?? 50)
  const [distance, setDistance] = useState(user?.discoveryDistanceKm ?? 25)
  const [gender, setGender] = useState<'women' | 'men' | 'everyone'>(user?.lookingFor as any ?? 'everyone')
  const [interests, setInterests] = useState<string[]>(user?.interests ?? [])
  const [verifiedOnly, setVerifiedOnly] = useState(user?.discoveryShowVerifiedOnly ?? false)
  const [recentlyActive, setRecentlyActive] = useState(user?.discoveryRecentlyActive ?? false)
  const [saving, setSaving] = useState(false)

  const isPremium = user?.isPremium ?? false
  // Free users: age 18-50, distance max 50km
  // Premium users: age 18-99, distance up to 500km
  const maxAgeForUser = isPremium ? 99 : 50
  const maxDistanceForUser = isPremium ? 500 : 50

  const save = async () => {
    setSaving(true)
    try {
      // Update gender + interests + discovery prefs in one call
      await api.auth.update({
        lookingFor: gender,
        interests,
        discoveryAgeMin: ageMin,
        discoveryAgeMax: ageMax,
        discoveryDistanceKm: distance,
        discoveryShowVerifiedOnly: verifiedOnly,
        discoveryRecentlyActive: recentlyActive,
      })
      const me = await api.auth.me()
      if (me.user) setUser(me.user)
      toast.success('Discovery preferences saved')
      useQuickyStore.getState().setView('settings')
    } catch (e: any) {
      if (e.status === 402 && e.body?.paywall === 'discovery_filters') {
        showPaywall({ kind: 'advanced_filters' })
      } else {
        toast.error(e.body?.error ?? e.message ?? 'Failed to save')
      }
    } finally {
      setSaving(false)
    }
  }

  const trySetAgeMin = (v: number) => {
    if (!isPremium && v > 50) {
      showPaywall({ kind: 'advanced_filters' })
      return
    }
    setAgeMin(Math.min(v, ageMax - 1))
  }
  const trySetAgeMax = (v: number) => {
    if (!isPremium && v > 50) {
      showPaywall({ kind: 'advanced_filters' })
      return
    }
    setAgeMax(Math.max(v, ageMin + 1))
  }
  const trySetDistance = (v: number) => {
    if (!isPremium && v > 50) {
      showPaywall({ kind: 'advanced_filters' })
      return
    }
    setDistance(v)
  }

  return (
    <SettingsSubScreen title="Discovery Preferences">
      <div className="px-5 py-5 flex flex-col gap-6">
        {/* Age range */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/8">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-[var(--qk-accent-light)]" />
            <h3 className="text-sm font-semibold">Age Range</h3>
            {!isPremium && <span className="ml-auto text-[10px] text-white/40">18–50 (Premium: 18–99)</span>}
          </div>
          <div className="flex items-center gap-3 mb-2">
            <label className="text-xs text-white/60 w-12">Min</label>
            <input
              type="range"
              min={18}
              max={maxAgeForUser}
              value={ageMin}
              onChange={(e) => trySetAgeMin(Number(e.target.value))}
              className="flex-1 accent-[var(--qk-accent)]"
            />
            <span className="text-sm font-bold w-8 text-right">{ageMin}</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-xs text-white/60 w-12">Max</label>
            <input
              type="range"
              min={18}
              max={maxAgeForUser}
              value={ageMax}
              onChange={(e) => trySetAgeMax(Number(e.target.value))}
              className="flex-1 accent-[var(--qk-accent)]"
            />
            <span className="text-sm font-bold w-8 text-right">{ageMax}</span>
          </div>
          {!isPremium && (
            <PremiumHint onClick={() => showPaywall({ kind: 'advanced_filters' })} />
          )}
        </div>

        {/* Distance */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/8">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-4 h-4 text-[var(--qk-accent-light)]" />
            <h3 className="text-sm font-semibold">Maximum Distance</h3>
            {!isPremium && <span className="ml-auto text-[10px] text-white/40">Max 50km (Premium: 500km)</span>}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={maxDistanceForUser}
              value={distance}
              onChange={(e) => trySetDistance(Number(e.target.value))}
              className="flex-1 accent-[var(--qk-accent)]"
            />
            <span className="text-sm font-bold w-12 text-right">{distance} km</span>
          </div>
          {!isPremium && (
            <PremiumHint onClick={() => showPaywall({ kind: 'advanced_filters' })} />
          )}
        </div>

        {/* Gender preference */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/8">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-[var(--qk-accent-light)]" />
            <h3 className="text-sm font-semibold">Show Me</h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(['women', 'men', 'everyone'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGender(g)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-sm font-medium capitalize transition-all',
                  gender === g
                    ? 'border-[var(--qk-accent)] bg-[var(--qk-accent)]/10 text-white'
                    : 'border-white/10 bg-white/5 text-white/70'
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {/* Interests */}
        <div className="bg-white/5 rounded-2xl p-4 border border-white/8">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-[var(--qk-accent-light)]" />
            <h3 className="text-sm font-semibold">Interests (match on overlap)</h3>
            <span className="ml-auto text-[10px] text-white/40">{interests.length}/8</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {INTEREST_TAGS.map((tag) => {
              const selected = interests.includes(tag)
              const disabled = !selected && interests.length >= 8
              return (
                <button
                  key={tag}
                  onClick={() => setInterests((prev) =>
                    selected ? prev.filter((t) => t !== tag) : prev.length < 8 ? [...prev, tag] : prev
                  )}
                  disabled={disabled}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-all',
                    selected
                      ? 'border-[var(--qk-accent)] bg-[var(--qk-accent)] text-white'
                      : 'border-white/10 bg-white/5 text-white/70',
                    disabled && 'opacity-30'
                  )}
                >
                  {tag.replace(/-/g, ' ')}
                </button>
              )
            })}
          </div>
        </div>

        {/* Toggles */}
        <div className="bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
          <ToggleRow
            icon={<Shield className="w-4 h-4 text-[var(--qk-accent-light)]" />}
            label="Verified profiles only"
            description="Only show profiles with a verified badge"
            value={verifiedOnly}
            onChange={setVerifiedOnly}
          />
          <div className="border-t border-white/5" />
          <ToggleRow
            icon={<Clock className="w-4 h-4 text-[var(--qk-accent-light)]" />}
            label="Recently active"
            description="Only show users active in the last 7 days"
            value={recentlyActive}
            onChange={setRecentlyActive}
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-coral-gradient glow-coral rounded-2xl py-3.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {saving ? 'Saving...' : 'Save preferences'}
        </button>
      </div>
    </SettingsSubScreen>
  )
}

function ToggleRow({
  icon, label, description, value, onChange,
}: {
  icon: React.ReactNode
  label: string
  description: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-white/50">{description}</p>
      </div>
      <Toggle value={value} onChange={onChange} label={label} />
    </div>
  )
}

function PremiumHint({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-2 w-full text-left text-[10px] text-[var(--qk-gold)] flex items-center gap-1 hover:underline"
    >
      <Crown className="w-3 h-3" /> Unlock wider ranges with Premium
    </button>
  )
}
