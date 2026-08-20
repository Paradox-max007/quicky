'use client'

import { useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { INTEREST_TAGS, PROFILE_PROMPTS } from '@/lib/quicky/constants'
import { toast } from 'sonner'
import { ArrowRight, ArrowLeft, Camera, Plus, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

type Step =
  | 'dob'
  | 'gender'
  | 'photos'
  | 'bio'
  | 'interests'
  | 'prompts'
  | 'finish'

const STEP_ORDER: Step[] = ['dob', 'gender', 'photos', 'bio', 'interests', 'prompts', 'finish']

export function OnboardingFlow() {
  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)
  const user = useQuickyStore((s) => s.user)

  const [stepIdx, setStepIdx] = useState(0)
  const [dob, setDob] = useState('')
  const [gender, setGender] = useState<'male' | 'female' | 'nonbinary' | 'other' | ''>('')
  const [lookingFor, setLookingFor] = useState<'men' | 'women' | 'everyone' | ''>('')
  const [bio, setBio] = useState('')
  const [city, setCity] = useState('')
  const [interests, setInterests] = useState<string[]>([])
  const [promptTexts, setPromptTexts] = useState<Record<string, string>>({})
  const [photoUrls, setPhotoUrls] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const step = STEP_ORDER[stepIdx]

  const uploadPhoto = async (file: File) => {
    setUploading(true)
    try {
      const res = await api.upload(file, 'photo')
      if (res.url) {
        const added = await api.photos.add(res.url, photoUrls.length, photoUrls.length === 0)
        if (added.ok) {
          setPhotoUrls((p) => [...p, res.url])
          toast.success('Photo added')
        }
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const finish = async () => {
    setSaving(true)
    try {
      const prompts = Object.entries(promptTexts)
        .filter(([, answer]) => answer.trim().length > 0)
        .map(([prompt, answer]) => ({ prompt, answer }))
        .slice(0, 3)
      const res = await api.onboarding.complete({
        name: user?.name ?? 'You',
        dateOfBirth: dob,
        gender,
        lookingFor,
        bio,
        city,
        interests,
        prompts,
      })
      if (res.ok) {
        const me = await api.auth.me()
        if (me.user) {
          setUser(me.user)
          setView('discovery')
          toast.success('You’re all set! Start swiping.')
        }
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const next = () => {
    if (stepIdx < STEP_ORDER.length - 1) setStepIdx(stepIdx + 1)
    else finish()
  }
  const back = () => {
    if (stepIdx > 0) setStepIdx(stepIdx - 1)
  }

  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white overflow-hidden">
      {/* Progress bar */}
      <div className="px-6 pt-2 pb-3 shrink-0">
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

      <div className="flex-1 overflow-y-auto no-scrollbar px-6 py-4">
        {step === 'dob' && (
          <StepShell title="When were you born?" subtitle="You must be 18 or older to use Quicky.">
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              max={new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-base focus:outline-none focus:border-[#FF2D55] [color-scheme:dark]"
            />
            {dob && new Date().getFullYear() - new Date(dob).getFullYear() < 18 && (
              <p className="text-[#FF3B30] text-sm mt-2">You must be 18 or older.</p>
            )}
          </StepShell>
        )}

        {step === 'gender' && (
          <StepShell title="Who are you?" subtitle="This helps us show you the right people.">
            <div className="grid grid-cols-2 gap-2 mb-4">
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
            <h3 className="text-sm font-semibold text-white/80 mt-4 mb-2">Who do you want to see?</h3>
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
          </StepShell>
        )}

        {step === 'photos' && (
          <StepShell title="Add your photos" subtitle="2-6 photos. The first one is your primary.">
            <div className="grid grid-cols-3 gap-2 mb-3">
              {Array.from({ length: 6 }).map((_, i) => {
                const url = photoUrls[i]
                return (
                  <label
                    key={i}
                    className={cn(
                      'aspect-[3/4] rounded-xl border border-white/10 bg-white/5 flex items-center justify-center overflow-hidden relative cursor-pointer',
                      i === 0 && 'card-border-coral',
                      uploading && 'opacity-50'
                    )}
                  >
                    {url ? (
                      <>
                        <img src={url} alt="" className="w-full h-full object-cover" />
                        {i === 0 && (
                          <span className="absolute top-1 left-1 bg-[#FF2D55] text-white text-[10px] font-bold px-1.5 py-0.5 rounded">
                            PRIMARY
                          </span>
                        )}
                      </>
                    ) : (
                      <Camera className="w-5 h-5 text-white/40" />
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) uploadPhoto(f)
                        e.target.value = ''
                      }}
                    />
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-white/40">{photoUrls.length}/6 added · at least 2 required to continue</p>
          </StepShell>
        )}

        {step === 'bio' && (
          <StepShell title="Your bio" subtitle="Make it short, specific, and you.">
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 300))}
              placeholder="Painter + part-time barista. Looking for late-night diners and gallery openings."
              rows={5}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55] resize-none"
            />
            <div className="flex justify-between text-xs text-white/40 mt-1">
              <span>Tell us something true.</span>
              <span>{bio.length}/300</span>
            </div>
            <h3 className="text-sm font-semibold text-white/80 mt-4 mb-2">Your city</h3>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Brooklyn, NY"
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-[#FF2D55]"
            />
          </StepShell>
        )}

        {step === 'interests' && (
          <StepShell title="Pick your interests" subtitle="Choose up to 8. We’ll match you on overlap.">
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
          </StepShell>
        )}

        {step === 'prompts' && (
          <StepShell title="Prompts (optional)" subtitle="Pick up to 3. Premium gets 3, free gets 1.">
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
                            else next[p] = ''
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
          </StepShell>
        )}

        {step === 'finish' && (
          <StepShell title="You’re ready!" subtitle="Hit finish to start discovering people.">
            <div className="flex flex-col gap-2 text-sm">
              <SummaryRow label="Age" value={dob ? String(new Date().getFullYear() - new Date(dob).getFullYear()) : '—'} />
              <SummaryRow label="Gender" value={gender || '—'} />
              <SummaryRow label="Looking for" value={lookingFor || '—'} />
              <SummaryRow label="City" value={city || '—'} />
              <SummaryRow label="Photos" value={`${photoUrls.length}/6`} />
              <SummaryRow label="Interests" value={`${interests.length} tags`} />
              <SummaryRow label="Prompts" value={`${Object.keys(promptTexts).length}`} />
            </div>
          </StepShell>
        )}
      </div>

      {/* Footer nav */}
      <div className="shrink-0 px-6 py-3 border-t border-white/5 flex items-center justify-between gap-3 safe-area-bottom">
        {stepIdx > 0 ? (
          <button onClick={back} className="px-3 py-2.5 text-sm text-white/60 hover:text-white flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
        ) : (
          <div className="w-16" />
        )}
        <button
          onClick={next}
          disabled={saving || (step === 'photos' && photoUrls.length < 2) || (step === 'dob' && !dob)}
          className="flex-1 bg-coral-gradient glow-coral rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
        >
          {step === 'finish' ? (saving ? 'Saving...' : 'Start discovering') : 'Continue'}
          {step !== 'finish' && <ArrowRight className="w-4 h-4" />}
        </button>
      </div>
    </div>
  )
}

function StepShell({
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
      {children}
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/5 py-2">
      <span className="text-white/60">{label}</span>
      <span className="font-semibold capitalize">{value}</span>
    </div>
  )
}
