'use client'

import { useState } from 'react'
import { api } from '@/lib/quicky/api-client'
import { useQuickyStore } from '@/store/quicky'
import { QuickyBrand } from './brand'
import { toast } from 'sonner'
import { Phone, ArrowRight, ShieldCheck } from 'lucide-react'

export function AuthScreen() {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [step, setStep] = useState<'phone' | 'otp'>('phone')
  const [loading, setLoading] = useState(false)

  const setUser = useQuickyStore((s) => s.setUser)
  const setView = useQuickyStore((s) => s.setView)

  const sendOtp = async () => {
    if (!phone || phone.replace(/\D/g, '').length < 10) {
      toast.error('Enter a valid phone number')
      return
    }
    setLoading(true)
    try {
      const res = await api.auth.otp(phone)
      setDemoCode(res.demoCode)
      setStep('otp')
      toast.success('Code sent — check the demo code below')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  const verify = async () => {
    if (!/^\d{4}$/.test(code)) {
      toast.error('Enter the 4-digit code')
      return
    }
    setLoading(true)
    try {
      const res = await api.auth.verify(phone, code)
      if (res.ok && res.user) {
        setUser(res.user)
        if (res.onboarded) {
          setView('discovery')
          toast.success(`Welcome back, ${res.user.name ?? 'there'}`)
        } else {
          setView('onboarding')
        }
      }
    } catch (e: any) {
      toast.error(e.message ?? 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white px-6 py-8 overflow-y-auto no-scrollbar">
      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        <QuickyBrand size="lg" />
        <div className="text-center max-w-xs">
          <h1 className="text-3xl font-bold tracking-tight leading-tight">
            {step === 'phone' ? (
              <>
                Find your spark.
                <br />
                <span className="text-gradient-coral">In seconds.</span>
              </>
            ) : (
              <>
                Enter your
                <br />
                <span className="text-gradient-coral">code</span>
              </>
            )}
          </h1>
          <p className="text-white/50 text-sm mt-2 leading-relaxed">
            {step === 'phone'
              ? 'We’ll text you a 4-digit code to verify your phone.'
              : `Sent to ${phone}. For demo, the code is shown below.`}
          </p>
        </div>

        {step === 'phone' ? (
          <div className="w-full max-w-xs flex flex-col gap-3">
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
              <input
                type="tel"
                inputMode="tel"
                placeholder="+1 (555) 555-0100"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendOtp()}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-10 py-3.5 text-base placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)] transition-colors"
                aria-label="Phone number"
              />
            </div>
            <button
              onClick={sendOtp}
              disabled={loading}
              className="w-full bg-coral-gradient glow-coral rounded-2xl py-3.5 font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              Send code
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="w-full max-w-xs flex flex-col gap-3">
            <input
              type="text"
              inputMode="numeric"
              placeholder="0000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => e.key === 'Enter' && verify()}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-center text-2xl font-bold tracking-[0.6em] placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)] transition-colors"
              aria-label="OTP code"
              autoFocus
            />
            {demoCode && (
              <div className="bg-[var(--qk-accent)]/10 border border-[var(--qk-accent)]/30 rounded-xl px-4 py-3 text-center">
                <p className="text-xs text-white/60">Demo code (no real SMS):</p>
                <p className="text-2xl font-bold text-[var(--qk-accent)] tracking-[0.4em] mt-1">{demoCode}</p>
              </div>
            )}
            <button
              onClick={verify}
              disabled={loading}
              className="w-full bg-coral-gradient glow-coral rounded-2xl py-3.5 font-semibold text-base flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              Verify
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setStep('phone')
                setCode('')
                setDemoCode(null)
              }}
              className="text-white/40 text-sm hover:text-white/70"
            >
              {'\u2190'} Change phone number
            </button>
          </div>
        )}
      </div>

      <div className="shrink-0 mt-6 flex items-center justify-center gap-1.5 text-xs text-white/40">
        <ShieldCheck className="w-3.5 h-3.5" />
        Encrypted. 18+ only. You can delete your account anytime.
      </div>
    </div>
  )
}
