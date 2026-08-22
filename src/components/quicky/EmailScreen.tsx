'use client'

import { useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Mail, ArrowRight, ShieldCheck } from 'lucide-react'

export function EmailScreen() {
  const setUser = useQuickyStore((s) => s.setUser)
  const user = useQuickyStore((s) => s.user)
  const hasEmail = !!user?.email

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [step, setStep] = useState<'edit' | 'otp'>('edit')
  const [loading, setLoading] = useState(false)

  const sendOtp = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email address')
      return
    }
    setLoading(true)
    try {
      const res = await api.settings.email.otp(email)
      setDemoCode(res.demoCode)
      setStep('otp')
      toast.success('Code sent to your email')
    } catch (e: any) {
      toast.error(e.body?.error ?? e.message ?? 'Failed to send code')
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
      const res = await api.settings.email.verify(email, code)
      if (res.ok) {
        toast.success(hasEmail ? 'Email updated' : 'Email added')
        const me = await api.auth.me()
        if (me.user) setUser(me.user)
        useQuickyStore.getState().setView('settings')
      }
    } catch (e: any) {
      toast.error(e.body?.error ?? e.message ?? 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SettingsSubScreen title={hasEmail ? 'Change Email' : 'Add Email'}>
      <div className="px-5 py-6 flex flex-col gap-5">
        {hasEmail && (
          <div className="bg-white/5 rounded-2xl p-4 border border-white/8">
            <p className="text-xs text-white/50 uppercase tracking-wide mb-1">Current Email</p>
            <p className="text-base font-semibold truncate">{user?.email}</p>
          </div>
        )}

        {step === 'edit' ? (
          <>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wide">
                {hasEmail ? 'New Email' : 'Your Email'}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-10 py-3.5 text-base placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55] transition-colors"
                />
              </div>
            </div>
            <button
              onClick={sendOtp}
              disabled={loading}
              className="w-full bg-coral-gradient glow-coral rounded-2xl py-3.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {loading ? 'Sending...' : 'Send verification code'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </>
        ) : (
          <>
            <div className="bg-[#FF2D55]/10 border border-[#FF2D55]/30 rounded-2xl p-3 text-center">
              <p className="text-xs text-white/60">A 4-digit code was sent to</p>
              <p className="text-sm font-semibold text-[#FF5E7E] mt-0.5">{email}</p>
            </div>
            <input
              type="text"
              inputMode="numeric"
              placeholder="0000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3.5 text-center text-2xl font-bold tracking-[0.6em] placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55] transition-colors"
              autoFocus
            />
            {demoCode && (
              <div className="bg-[#FF2D55]/10 border border-[#FF2D55]/30 rounded-xl px-4 py-3 text-center">
                <p className="text-xs text-white/60">Demo code (no real email sent):</p>
                <p className="text-2xl font-bold text-[#FF2D55] tracking-[0.4em] mt-1">{demoCode}</p>
              </div>
            )}
            <button
              onClick={verify}
              disabled={loading}
              className="w-full bg-coral-gradient glow-coral rounded-2xl py-3.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {loading ? 'Verifying...' : 'Verify & save'}
            </button>
            <button
              onClick={() => {
                setStep('edit')
                setCode('')
                setDemoCode(null)
              }}
              className="text-white/40 text-sm hover:text-white text-center"
            >
              ← Change email
            </button>
          </>
        )}

        <div className="flex items-start gap-2 text-xs text-white/40 mt-4 px-1">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>Your email is used for account recovery and important notifications. It&apos;s never shown on your public profile.</p>
        </div>
      </div>
    </SettingsSubScreen>
  )
}
