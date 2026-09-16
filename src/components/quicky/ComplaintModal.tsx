'use client'

// Quicky — COMPLAINT MODAL (refactor PRD §57/§58/§83)
// Shared by profile ••• menus, dating chat actions and game chat actions.
// Fields: Reason + Details (§57). Submit stores a server-side complaint with
// the reporter + reported IDs (canonical relations) and a name snapshot
// (§59). Honest error/loading/empty handling (§83).
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X, ShieldAlert } from 'lucide-react'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'

const REASONS: { value: string; label: string }[] = [
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'fake', label: 'Fake profile' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'underage', label: 'Underage user' },
  { value: 'other', label: 'Something else' },
]

type Props = {
  open: boolean
  onClose: () => void
  reportedUserId: string
  reportedName?: string | null
  roomId?: string | null
  messageId?: string | null
  conversationId?: string | null
}

export function ComplaintModal({
  open,
  onClose,
  reportedUserId,
  reportedName,
  roomId,
  messageId,
  conversationId,
}: Props) {
  const [reason, setReason] = useState('harassment')
  const [details, setDetails] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // §83: reopening the form starts a fresh complaint.
  useEffect(() => {
    if (open) {
      setReason('harassment')
      setDetails('')
    }
  }, [open])

  const submit = async () => {
    if (submitting) return
    setSubmitting(true)
    try {
      await api.complaints.create({
        reportedUserId,
        reason,
        description: details.trim(),
        roomId: roomId ?? undefined,
        messageId: messageId ?? undefined,
        conversationId: conversationId ?? undefined,
      })
      toast.success('Complaint submitted — our team will review it')
      onClose()
    } catch (e: any) {
      toast.error(e?.message ?? 'Something went wrong. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 z-[70]"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed z-[71] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)] max-w-sm bg-[var(--qk-card)] border border-white/10 rounded-3xl p-5"
            role="dialog"
            aria-label="File a complaint"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-[var(--qk-gold)]" />
                Complaint
              </h3>
              <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10" aria-label="Close">
                <X className="w-5 h-5 text-white/60" />
              </button>
            </div>
            {reportedName && (
              <p className="text-xs text-white/50 mb-3">
                You are reporting <span className="font-semibold text-white/80">{reportedName}</span>.
              </p>
            )}

            <p className="text-[11px] font-black uppercase tracking-widest text-white/40 mb-2">Reason</p>
            <div className="flex flex-col gap-1.5 mb-4">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setReason(r.value)}
                  className={`text-left text-sm rounded-xl px-3.5 py-2.5 border transition-colors ${
                    reason === r.value
                      ? 'border-[var(--qk-accent)]/60 bg-[var(--qk-accent)]/12 text-white'
                      : 'border-white/8 bg-white/4 text-white/70 hover:bg-white/8'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <p className="text-[11px] font-black uppercase tracking-widest text-white/40 mb-2">Details</p>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Tell us what happened (optional)"
              className="w-full rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[var(--qk-accent)]/50 resize-none"
            />

            <div className="flex gap-2 mt-4">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-full border border-white/12 text-sm font-semibold text-white/70 hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-full bg-coral-gradient text-sm font-bold text-white active:scale-95 transition-transform disabled:opacity-50"
                data-testid="complaint-submit"
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
