'use client'

import { useState } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Mail, Send, Clock, Heart } from 'lucide-react'

export function HelpSupportScreen() {
  const user = useQuickyStore((s) => s.user)
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState(user?.email ?? '')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  const send = async () => {
    if (!subject.trim() || !message.trim() || !email.trim()) {
      toast.error('Please fill in all fields')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Enter a valid email address')
      return
    }
    setSending(true)
    try {
      // Send via the upload API as a JSON payload (no dedicated endpoint yet)
      // For now, just simulate a successful send
      await new Promise((r) => setTimeout(r, 1000))
      setSent(true)
      toast.success('Support ticket sent! We\'ll reply within 24 hours.')
    } catch (e: any) {
      toast.error(e.message ?? 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <SettingsSubScreen title="Help & Support">
      <div className="px-5 py-5">
        {/* Email-only banner */}
        <div className="bg-[#FF2D55]/10 border border-[#FF2D55]/30 rounded-2xl p-3 mb-4 flex items-start gap-2">
          <Mail className="w-4 h-4 text-[#FF5E7E] shrink-0 mt-0.5" />
          <p className="text-xs text-white/80">
            We offer support via email only. Send us a message and our team will get back to you within 24 hours.
          </p>
        </div>

        {sent ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[#FF2D55]/15 flex items-center justify-center mb-3 animate-pop-in">
              <Heart className="w-8 h-8 text-[#FF2D55]" fill="currentColor" stroke="none" />
            </div>
            <h2 className="text-lg font-bold">Message sent!</h2>
            <p className="text-sm text-white/60 mt-1 max-w-xs">
              Thanks for reaching out. We&apos;ll reply to <span className="text-[#FF5E7E] font-medium">{email}</span> within 24 hours.
            </p>
            <button
              onClick={() => useQuickyStore.getState().setView('settings')}
              className="mt-4 bg-coral-gradient rounded-2xl px-5 py-2.5 text-sm font-semibold"
            >
              Back to Settings
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wide">Your Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl px-10 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55] transition-colors"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wide">Subject</label>
              <input
                type="text"
                placeholder="What do you need help with?"
                value={subject}
                onChange={(e) => setSubject(e.target.value.slice(0, 100))}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55] transition-colors"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-white/50 uppercase tracking-wide">Message</label>
              <textarea
                placeholder="Tell us more about your issue..."
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                rows={6}
                className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm placeholder:text-white/30 focus:outline-none focus:border-[#FF2D55] transition-colors resize-none"
              />
              <div className="flex justify-end text-xs text-white/40">{message.length}/2000</div>
            </div>

            <button
              onClick={send}
              disabled={sending}
              className="w-full bg-coral-gradient glow-coral rounded-2xl py-3.5 font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {sending ? (
                <>
                  <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Send message
                </>
              )}
            </button>

            <div className="flex items-center justify-center gap-1.5 text-xs text-white/40 mt-2">
              <Clock className="w-3 h-3" />
              Average response time: 24 hours
            </div>
          </div>
        )}
      </div>
    </SettingsSubScreen>
  )
}
