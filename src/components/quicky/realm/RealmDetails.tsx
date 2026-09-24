'use client'

// Quicky — REALM DETAILS SHEET (realm PRD §41/§57/§71)
// The shared Realm view opened from the 👑 room-HUD chip on EVERY game
// surface (Spin Bottle, Ludo, future games) — a global bottom sheet
// (AppRoot surface, works without leaving the current screen).
// Tabs: Realm (progress + cycle timer + multiplier) · Leaderboard · History.

import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Crown, Trophy, History } from 'lucide-react'
import { useRealmStore } from '@/store/realm'
import { RealmProgress, RealmCycleTimer, GiftMultiplierHeader } from './RealmProgress'
import { RealmLeaderboard } from './RealmLeaderboard'

type Tab = 'realm' | 'leaderboard' | 'history'

export function RealmDetails() {
  const open = useRealmStore((s) => s.detailsOpen)
  const close = useRealmStore((s) => s.closeDetails)
  const snapshot = useRealmStore((s) => s.snapshot)
  const refresh = useRealmStore((s) => s.refresh)
  const history = useRealmStore((s) => s.history)
  const refreshHistory = useRealmStore((s) => s.refreshHistory)
  const [tab, setTab] = useState<Tab>('realm')

  useEffect(() => {
    if (open) {
      void refresh()
      if (tab === 'history') void refreshHistory()
    }
  }, [open, tab, refresh, refreshHistory])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[190] bg-black/60"
            onClick={close}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 30 }}
            className="fixed inset-x-0 bottom-0 z-[191] mx-auto w-[min(96vw,30rem)] max-h-[82vh] flex flex-col rounded-t-3xl border border-white/10 bg-[var(--qk-card)] text-[var(--qk-text)] shadow-2xl"
            style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom, 0px))' }}
            role="dialog"
            aria-label="Realm details"
            data-testid="realm-details"
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" />
            <div className="flex items-center gap-2 px-4 py-3">
              <span className="w-9 h-9 rounded-2xl flex items-center justify-center text-lg" style={{ background: 'color-mix(in srgb, var(--qk-gold) 20%, transparent)' }} aria-hidden>
                👑
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-black tracking-wide uppercase">Realm Progression</p>
                <p className="text-[10.5px] font-semibold opacity-60">3-day cycles · Top 3 + threshold advance</p>
              </div>
              <button onClick={close} className="p-2 rounded-full hover:bg-white/10 transition-colors" aria-label="Close realm details">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-4 pb-2">
              {([
                { key: 'realm', label: 'Realm', icon: Crown },
                { key: 'leaderboard', label: 'Cohort', icon: Trophy },
                { key: 'history', label: 'History', icon: History },
              ] as const).map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2 text-[11.5px] font-bold transition-colors ${
                    tab === key ? 'text-[var(--qk-on-accent)]' : 'bg-white/5 opacity-70 hover:opacity-100'
                  }`}
                  style={tab === key ? { background: 'var(--qk-accent)' } : undefined}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden />
                  {label}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto px-4 pb-2 flex flex-col gap-3">
              {tab === 'realm' && (
                <>
                  <GiftMultiplierHeader />
                  {snapshot ? (
                    <>
                      <RealmProgress
                        level={snapshot.realm.level}
                        name={snapshot.realm.name}
                        points={snapshot.points}
                        threshold={snapshot.threshold}
                        nextRealmName={snapshot.nextRealm?.name ?? null}
                      />
                      {snapshot.cycle && (
                        <div className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3 py-2.5">
                          <p className="text-[11px] font-bold uppercase tracking-wide opacity-70">Realm cycle</p>
                          <p className="text-[12px] font-black tabular-nums" style={{ color: 'var(--qk-gold)' }}>
                            <RealmCycleTimer endsAt={snapshot.cycle.endsAt} /> remaining
                          </p>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-2">
                        <Stat label="Rank" value={snapshot.rank ? `#${snapshot.rank}` : '—'} />
                        <Stat label="Cohort" value={snapshot.cohortSize ? `${snapshot.cohortSize}/8` : '—'} />
                        <Stat label="Lifetime" value={snapshot.lifetimeRealmPoints.toLocaleString()} />
                      </div>
                      {snapshot.realm.description && (
                        <p className="text-[11px] leading-relaxed opacity-60 italic">{snapshot.realm.description}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-xs font-semibold opacity-60 py-6 text-center">Loading your realm…</p>
                  )}
                </>
              )}

              {tab === 'leaderboard' && (
                snapshot ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-black uppercase tracking-wide opacity-70">{snapshot.realm.name} · your cohort</p>
                      <p className="text-[10px] font-semibold opacity-50">Top 3 + {snapshot.threshold.toLocaleString()} pts promote</p>
                    </div>
                    <RealmLeaderboard rows={snapshot.leaderboard} threshold={snapshot.threshold} />
                  </>
                ) : (
                  <p className="text-xs font-semibold opacity-60 py-6 text-center">Loading standings…</p>
                )
              )}

              {tab === 'history' && (
                <div className="flex flex-col gap-1.5" data-testid="realm-history">
                  {history.length === 0 && <p className="text-xs font-semibold opacity-60 py-6 text-center">No Realm Points yet — send or receive gifts.</p>}
                  {history.map((row) => (
                    <div key={row.id} className="flex items-center gap-2.5 rounded-xl bg-white/5 border border-white/10 px-3 py-2">
                      <span className="text-[15px] shrink-0" aria-hidden>{row.itemEmoji ?? (row.sourceType === 'GIFT_SENT' ? '🎁' : '📥')}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[12px] font-bold truncate">
                          {row.sourceType === 'GIFT_SENT'
                            ? row.itemName
                              ? `Gift sent · ${row.itemName}`
                              : 'Gift sent'
                            : row.itemName
                              ? `Gift received · ${row.itemName}`
                              : 'Gift received'}
                        </p>
                        <p className="text-[10px] font-semibold opacity-55">
                          {row.multiplier > 1 ? `${row.basePoints} × ${row.multiplier} = ${row.awardedPoints} · ${row.multiplierEventName ?? ''}` : `+${row.awardedPoints}`} ·{' '}
                          {new Date(row.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </p>
                      </div>
                      <span className="text-[13px] font-black tabular-nums shrink-0" style={{ color: 'var(--qk-accent)' }}>
                        +{row.awardedPoints}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 px-2 py-2 text-center">
      <p className="text-[9px] font-black uppercase tracking-wider opacity-50">{label}</p>
      <p className="text-[14px] font-black tabular-nums">{value}</p>
    </div>
  )
}
