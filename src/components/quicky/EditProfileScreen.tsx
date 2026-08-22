'use client'

import { useEffect, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { INTEREST_TAGS, PROFILE_PROMPTS } from '@/lib/quicky/constants'
import { toast } from 'sonner'
import { ArrowLeft, Check, Plus, X, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'

type Step = 'basics' | 'bio' | 'interests' | 'prompts'

const STEP_ORDER: Step[] = ['basics', 'bio', 'interests', 'prompts']
const STEP_LABELS: Record<Step, string> = {
  basics: 'Basics',
  bio: 'Bio',
  interests: 'Interests',
  prompts: 'Prompts',
}

export function EditProfileScreen() {
  const setView = useQuickyStore((s) => s.setView)
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const showPaywall = useQuickyStore((s) => s.showPaywall)

  const [stepIdx, setStepIdx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Profile fields
  const [name, setName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | 'nonbinary' | 'other' | ''>('')
  const [lookingFor, setLookingFor] = useState<'men' | 'women' | 'everyone' | ''>('')
  const [bio, setBio] = useState('')
  const [city, setCity] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [promptTexts, setPromptTexts] = useState<Record<string, string>>({})

  // Hydrate from store / API
  useEffect(() => {
    ;(async () => {
      try {
        const res = await api.auth.me()
        if (res.user) {
          setUser(res.user)
          const u = res.user
          setName(u.name ?? '')
          if (u.dateOfBirth) {
            const d = new Date(u.dateOfBirth)
            setDateOfBirth(d.toISOString().slice(0, 10))
          }
          setGender((u.gender as any) ?? '')
          setLookingFor((u.lookingFor as any) ?? '')
          setBio(u.bio ?? '')
          setCity(u.city ?? '')
          setInterests(u.interests ?? [])
          const promptMap: Record<string, string> = {}
          for (const p of u.prompts ?? []) {
            promptMap[p.prompt] = p.answer
          }
          setPromptTexts(promptMap)
        }
      } catch (e: any) {
        toast.error(e.message ?? 'Failed to load profile')
      } finally {
        setLoading(false)
      }
    })()
  }, [setUser])

  const step = STEP_ORDER[stepIdx]

  const saveAll = async () => {
    setSaving(true)
    try {
      const prompts = Object.entries(promptTexts)
        .filter(([, answer]) => answer.trim().length > 0)
        .map(([prompt, answer]) => ({ prompt, answer: answer.trim() }))
        .slice(0, 3)

      const payload: any = {
        name,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        lookingFor: lookingFor || undefined,
        bio,
        city,
        interests,
        prompts,
      }
      const res = await api.auth.update(payload)
      if (res.ok) {
        // Re-fetch the full profile (with photos) so the store is fresh
        const me = await api.auth.me()
        if (me.user) setUser(me.user)
        toast.success('Profile updated')
        setView('profile-me')
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const next = () => {
    if (stepIdx < STEP_ORDER.length - 1) setStepIdx(stepIdx + 1)
    else saveAll()
  }
  const back = () => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1)
    else setView('profile-me')
  }

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#0F0F14]">
        <div className="w-10 h-10 rounded-full border-2 border-[#FF2D55] border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white overflow-hidden">
      {/* Header with progress + back + save */}
      <header className="shrink-0 px-4 pt-3 pb-2 flex items-center gap-2 border-b border-white/5">
        <button onClick={back} className="p-2 hover:bg-white/5 rounded-full" aria-label="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="font-bold text-base">Edit Profile</h1>
          <p className="text-xs text-white/50">{STEP_LABELS[step]} · Step {stepIdx + 1} of {STEP_ORDER.length}</p>
        </div>
        <button
          onClick={saveAll}
          disabled={saving}
          className="text-[#FF5E7E] hover:text-[#FF2D55] text-sm font-semibold px-3 py-1.5 rounded-full hover:bg-[#FF2D55]/10 transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </header>

      {/* Progress bar */}
      <div className="shrink-0 px-4 py-2">
        <div className="flex items-center gap-1">
          {STEP_ORDER.map((s, i) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-all',
                i < stepIdx ? 'bg-[#FF2D55]' : i === stepIdx ? 'bg-[#FF2D55]/60' : 'bg-white/10'
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-4">
        {step === 'basics' && (
          <Section title="The basics" subtitle="Name, age, and who you're looking for.">
            <Field label="Name">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 50))}
                placeholder="Your name"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-base placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55]"
              />
            </Field>

            <Field label="Date of birth">
              <div className="relative">
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-base focus:outline-none focus:border-[#FF2D55] [color-scheme:dark]"
                />
              </div>
              {dateOfBirth && new Date().getFullYear() - new Date(dateOfBirth).getFullYear() < 18 && (
                <p className="text-[#FF3B30] text-xs mt-1.5">You must be 18 or older.</p>
              )}
            </Field>

            <Field label="I am">
              <div className="grid grid-cols-2 gap-2">
                {(['male', 'female', 'nonbinary', 'other'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setGender(g)}
                    className={cn(
                      'rounded-2xl border px-4 py-3 text-sm font-medium capitalize transition-all',
                      gender === g
                        ? 'border-[#FF2D55] bg-[#FF2D55]/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/70'
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Looking for">
              <div className="grid grid-cols-3 gap-2">
                {(['women', 'men', 'everyone'] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setLookingFor(g)}
                    className={cn(
                      'rounded-2xl border px-3 py-2.5 text-sm font-medium capitalize transition-all',
                      lookingFor === g
                        ? 'border-[#FF2D55] bg-[#FF2D55]/10 text-white'
                        : 'border-white/10 bg-white/5 text-white/70'
                    )}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="City">
              <input
                type="text"
                value={city}
                onChange={(e) => setCity(e.target.value.slice(0, 100))}
                placeholder="Brooklyn, NY"
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-base placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55]"
              />
            </Field>
          </Section>
        )}

        {step === 'bio' && (
          <Section title="Your bio" subtitle="Short, specific, and you. Max 300 characters.">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 300))}
              rows={6}
              placeholder="Painter + part-time barista. Looking for late-night diners and gallery openings."
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55] resize-none"
            />
            <div className="flex justify-between text-xs text-white/40 mt-1">
              <span>Tell us something true.</span>
              <span>{bio.length}/300</span>
            </div>
          </Section>
        )}

        {step === 'interests' && (
          <Section title="Interests" subtitle="Choose up to 8. We'll match you on overlap.">
            <div className="flex flex-wrap gap-2">
              {INTEREST_TAGS.map((tag) => {
                const selected = interests.includes(tag)
                const disabled = !selected && interests.length >= 8
                return (
                  <button
                    key={tag}
                    onClick={() => {
                      setInterests((prev) =>
                        selected ? prev.filter((t) => t !== tag) : prev.length < 8 ? [...prev, tag] : prev
                      )
                    }}
                    disabled={disabled}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-all capitalize',
                      selected
                        ? 'border-[#FF2D55] bg-[#FF2D55] text-white'
                        : 'border-white/10 bg-white/5 text-white/70',
                      disabled && 'opacity-30'
                    )}
                  >
                    {tag.replace(/-/g, ' ')}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-white/40 mt-3">{interests.length}/8 selected</p>
          </Section>
        )}

        {step === 'prompts' && (
          <Section title="Prompts" subtitle="Pick up to 3. Premium gets 3, free gets 1.">
            <div className="flex flex-col gap-3">
              {PROFILE_PROMPTS.map((p) => {
                const has = promptTexts[p] !== undefined
                return (
                  <div key={p} className="bg-white/5 border border-white/10 rounded-2xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-white/80">{p}</span>
                      <button
                        onClick={() => {
                          setPromptTexts((prev) => {
                            const next = { ...prev }
                            if (has) delete next[p]
                            else {
                              // Free users limited to 1 prompt — block second selection
                              const currentCount = Object.keys(prev).length
                              if (!user?.isPremium && currentCount >= 1) {
                                showPaywall({ kind: 'generic' })
                                return prev
                              }
                              next[p] = ''
                            }
                            return next
                          })
                        }}
                        className={cn(
                          'text-xs font-medium px-2 py-1 rounded',
                          has ? 'text-[#FF2D55] bg-[#FF2D55]/10' : 'text-white/50 bg-white/5'
                        )}
                      >
                        {has ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                      </button>
                    </div>
                    {has && (
                      <textarea
                        value={promptTexts[p]}
                        onChange={(e) =>
                          setPromptTexts((prev) => ({ ...prev, [p]: e.target.value.slice(0, 200) }))
                        }
                        rows={2}
                        placeholder="Your answer..."
                        className="w-full bg-transparent text-sm placeholder:text-white/30 focus:outline-none resize-none"
                      />
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-white/40 mt-3">
              {Object.keys(promptTexts).length}
              {user?.isPremium ? '/3' : '/1'} prompts selected
              {!user?.isPremium && ' · upgrade for 3'}
            </p>
          </Section>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 px-5 py-3 border-t border-white/5 flex items-center justify-between gap-3 safe-area-bottom">
        {stepIdx > 0 ? (
          <button onClick={back} className="px-3 py-2.5 text-sm text-white/60 hover:text-white flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        ) : (
          <button onClick={back} className="px-3 py-2.5 text-sm text-white/60 hover:text-white flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Cancel
          </button>
        )}
        <button
          onClick={next}
          disabled={saving}
          className="flex-1 bg-coral-gradient glow-coral rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {stepIdx === STEP_ORDER.length - 1 ? (
            <>
              <Check className="w-4 h-4" /> {saving ? 'Saving...' : 'Save changes'}
            </>
          ) : (
            'Continue'
          )}
        </button>
      </div>
    </div>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 pb-6 animate-slide-up">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-balance">{title}</h2>
        <p className="text-white/50 text-sm mt-1 text-pretty">{subtitle}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wide block">{label}</label>
      {children}
    </div>
  )
}
