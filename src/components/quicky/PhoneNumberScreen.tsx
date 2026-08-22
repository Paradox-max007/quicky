'use client'

import { useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Phone, ArrowRight, ShieldCheck } from 'lucide-react'

export function PhoneNumberScreen() {
  const setUser = useQuickyStore((s) => s.setUser)
  const user = useQuickyStore((s) => s.user)

  const [newPhone, setNewPhone] = useState('')
  const [code, setCode] = useState('')
  const [demoCode, setDemoCode] = useState<string | null>(null)
  const [step, setStep] = useState<'edit' | 'otp'>('edit')
  const [loading, setLoading] = useState(false)

  const sendOtp = async () => {
    if (!newPhone || newPhone.replace(/\D/g, '').length < 10) {
      toast.error('Enter a valid phone number')
      return
    }
    setLoading(true)
    try {
      const res = await api.settings.phone.otp(newPhone)
      setDemoCode(res.demoCode)
      setStep('otp')
      toast.success('Code sent to your new number')
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
      const res = await api.settings.phone.verify(newPhone, code)
      if (res.ok) {
        toast.success('Phone number updated')
        const me = await api.auth.me()
        if (me.user) setUser(me.user)
        // Navigate back to settings
        useQuickyStore.getState().setView('settings')
      }
    } catch (e: any) {
      toast.error(e.body?.error ?? e.message ?? 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const maskedPhone = (() => {
    if (!user?.phone) return '—'
    const digits = user.phone.replace(/\D/g, '')
    if (digits.length >= 10) {
      return `+1 (${digits.slice(-10, -7)}) •••-${digits.slice(-4)}`
    }
    return user.phone
  })()

  return (
    <SettingsSubScreen title="Phone Number">
      <div className="px-5 py-6 flex flex-col gap-5">
        <div className="bg-white/5 rounded-2xl p-4 border border-white/8">
          <p className="text-xs text-white/50 uppercase tracking-wide mb-1">Current Number</p>
          <p className="text-base font-semibold">{maskedPhone}</p>
        </div>

        {step === 'edit' ? (
          <>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wide">New Phone Number</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="tel"
                  placeholder="+1 (555) 555-0100"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
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
              <p className="text-sm font-semibold text-[#FF5E7E] mt-0.5">{newPhone}</p>
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
                <p className="text-xs text-white/60">Demo code (no real SMS):</p>
                <p className="text-2xl font-bold text-[#FF2D55] tracking-[0.4em] mt-1">{demoCode}</p>
              </div>
            )}
            <button
              onClick={verify}
              disabled={loading}
              className="w-full bg-coral-gradient glow-coral rounded-2xl py-3.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {loading ? 'Verifying...' : 'Verify & update'}
            </button>
            <button
              onClick={() => {
                setStep('edit')
                setCode('')
                setDemoCode(null)
              }}
              className="text-white/40 text-sm hover:text-white text-center"
            >
              ← Change number
            </button>
          </>
        )}

        <div className="flex items-start gap-2 text-xs text-white/40 mt-4 px-1">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <p>For security, your phone number can only be changed after verifying a code sent to the new number.</p>
        </div>
      </div>
    </SettingsSubScreen>
  )
}
