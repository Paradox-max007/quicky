'use client'

import { useEffect, useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Camera, ArrowLeft, Check, RefreshCw } from 'lucide-react'

type Step = 'intro' | 'camera' | 'challenge' | 'review' | 'success'

export function PhotoVerification({
  onClose,
  onVerified,
}: {
  onClose: () => void
  onVerified: () => void
}) {
  const [step, setStep] = useState<Step>('intro')
  const [challenge, setChallenge] = useState<{ id: string; text: string; emoji: string } | null>(null)
  const [selfieUrl, setSelfieUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const requestChallenge = async () => {
    try {
      const res = await api.verifyPhoto('request_challenge')
      setChallenge(res.challenge)
    } catch (e: any) {
      toast.error(e.message ?? 'Failed')
    }
  }

  useEffect(() => {
    if (step === 'challenge' && !challenge) requestChallenge()
  }, [step])

  const takeSelfie = async () => {
    // For demo: trigger file picker
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.capture = 'user'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      try {
        const res = await api.upload(file, 'photo')
        if (res.url) {
          setSelfieUrl(res.url)
          setStep('review')
        }
      } catch (e: any) {
        toast.error(e.message ?? 'Upload failed')
      }
    }
    input.click()
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const res = await api.verifyPhoto('submit')
      if (res.ok) {
        setStep('success')
        setTimeout(() => {
          onVerified()
          onClose()
          toast.success('Verified! Badge added to your profile.')
        }, 1500)
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Verification failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 z-[160] bg-[var(--qk-bg)] text-white flex flex-col"
      >
        <header className="shrink-0 px-3 pt-3 pb-3 flex items-center gap-2 border-b border-white/5">
          <button onClick={() => (step === 'intro' ? onClose() : setStep('intro'))} className="p-2 hover:bg-white/5 rounded-full" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-bold text-base">Photo Verification</h1>
          <button onClick={onClose} className="ml-auto p-2 hover:bg-white/5 rounded-full" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto no-scrollbar p-5 flex flex-col items-center justify-center text-center">
          {step === 'intro' && (
            <div className="flex flex-col items-center gap-4 max-w-xs">
              <div className="w-20 h-20 rounded-full bg-[var(--qk-accent)]/15 flex items-center justify-center">
                <Camera className="w-10 h-10 text-[var(--qk-accent)]" />
              </div>
              <h2 className="text-xl font-bold">Get verified</h2>
              <p className="text-sm text-white/60 text-pretty">
                Take a selfie and a quick live challenge. Your verified badge builds trust and helps you rank higher in discovery.
              </p>
              <button
                onClick={() => setStep('camera')}
                className="w-full bg-coral-gradient glow-coral rounded-2xl py-3 font-semibold text-sm"
              >
                Start verification
              </button>
            </div>
          )}

          {step === 'camera' && (
            <div className="flex flex-col items-center gap-4 max-w-xs">
              <div className="w-20 h-20 rounded-full bg-[var(--qk-accent)]/15 flex items-center justify-center">
                <Camera className="w-10 h-10 text-[var(--qk-accent)]" />
              </div>
              <h2 className="text-xl font-bold">Take a clear selfie</h2>
              <p className="text-sm text-white/60 text-pretty">
                Face the camera directly. Good lighting helps.
              </p>
              <button
                onClick={takeSelfie}
                className="w-full bg-coral-gradient glow-coral rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" /> Take selfie
              </button>
            </div>
          )}

          {step === 'challenge' && challenge && (
            <div className="flex flex-col items-center gap-4 max-w-xs">
              <div className="text-6xl">{challenge.emoji}</div>
              <h2 className="text-xl font-bold">Live challenge</h2>
              <p className="text-sm text-white/80 text-pretty">{challenge.text}</p>
              <p className="text-xs text-white/50">We’ll use this to confirm you’re real.</p>
              <button
                onClick={takeSelfie}
                className="w-full bg-coral-gradient glow-coral rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2"
              >
                <Camera className="w-4 h-4" /> Capture challenge
              </button>
              <button onClick={requestChallenge} className="text-xs text-white/50 hover:text-white flex items-center gap-1 mt-2">
                <RefreshCw className="w-3 h-3" /> Get a different challenge
              </button>
            </div>
          )}

          {step === 'review' && selfieUrl && (
            <div className="flex flex-col items-center gap-4 max-w-xs">
              <img src={selfieUrl} alt="Selfie" className="w-48 h-48 rounded-3xl object-cover border-2 border-[var(--qk-accent)]" />
              <h2 className="text-xl font-bold">Looks good?</h2>
              <p className="text-sm text-white/60">If approved, you’ll get a verified badge.</p>
              <button
                onClick={submit}
                disabled={submitting}
                className="w-full bg-coral-gradient glow-coral rounded-2xl py-3 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> {submitting ? 'Submitting...' : 'Submit'}
              </button>
              <button onClick={() => setStep('camera')} className="text-xs text-white/50 hover:text-white">
                Retake
              </button>
            </div>
          )}

          {step === 'success' && (
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="w-24 h-24 rounded-full bg-[var(--qk-accent)] glow-coral-strong flex items-center justify-center animate-pop-in">
                <Check className="w-12 h-12 text-white" strokeWidth={3} />
              </div>
              <h2 className="text-xl font-bold text-gradient-coral">Verified!</h2>
            </motion.div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
