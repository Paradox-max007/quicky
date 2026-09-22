'use client'

// Quicky — REALM REWARDS UNLOCKED popup (admin-console PRD §12.1)
//
// The reward-collection modal: lists every PENDING grant (icon from the
// snapshot — image or emoji, animated level-3 previews play), a Collect
// Rewards action that claims ALL grants atomically (server-idempotent), and
// the collection result. Painted with the app theme tokens so it matches
// every theme on web + Capacitor.

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Coins, Gift, Sparkles, X } from 'lucide-react'
import { useRewardsStore, type PendingGrant, type LevelAsset, type CosmeticAnimation } from '@/store/rewards'
import { useQuickyStore } from '@/store/quicky'
import { toast } from 'sonner'

function isImageUrl(v: string): boolean {
  return /^https?:\/\//i.test(v) || v.startsWith('/uploads/') || v.startsWith('data:image/')
}

type AnyAsset = LevelAsset | CosmeticAnimation | null | undefined

/** Grant icon: level-3 animated assets play right in the popup (§9.2). */
function GrantIcon({ grant }: { grant: PendingGrant }) {
  const asset: AnyAsset = grant.levelAsset
  if (grant.level === 3 && asset && 'type' in asset) {
    if (asset.type === 'animated-image' && isImageUrl(asset.url)) {
       
      return <img src={asset.url} alt={grant.name} className="w-12 h-12 object-contain" />
    }
    if (asset.type === 'frames' && asset.frameUrls.length > 0) {
      return <FrameCycle urls={asset.frameUrls} fps={asset.fps} />
    }
  }
  if (asset && 'kind' in asset && asset.kind === 'image' && isImageUrl(asset.url)) {
     
    return <img src={asset.url} alt={grant.name} className="w-12 h-12 object-contain" />
  }
  const glyph = asset && 'kind' in asset && asset.kind === 'emoji' ? asset.glyph : grant.icon
  if (isImageUrl(glyph)) {
     
    return <img src={glyph} alt={grant.name} className="w-12 h-12 object-contain" />
  }
  return <span className="text-3xl leading-none" aria-hidden>{glyph || '🎁'}</span>
}

function FrameCycle({ urls, fps }: { urls: string[]; fps: number }) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (urls.length < 2) return
    const id = setInterval(() => setFrame((f) => (f + 1) % urls.length), 1000 / Math.max(1, Math.min(24, Math.floor(fps) || 10)))
    return () => clearInterval(id)
  }, [urls.length, fps])
  const url = urls[Math.min(frame, urls.length - 1)]
   
  return <img src={url} alt="animated reward" className="w-12 h-12 object-contain" />
}

const RARITY_TINT: Record<string, string> = {
  LEGENDARY: 'text-amber-300',
  EPIC: 'text-purple-300',
  RARE: 'text-sky-300',
  COMMON: 'text-white/60',
}

function subtitle(grant: PendingGrant): string {
  if (grant.rewardType === 'COINS') return `${(grant.coinAmount ?? 0).toLocaleString()} coins`
  if (grant.quantity > 1) return `Quantity ×${grant.quantity}`
  if (grant.level >= 2) return `Level ${grant.level}${grant.level === 3 ? ' · Animated' : ''}`
  return 'Ready'
}

export function RewardCollectPopup() {
  const popupOpen = useRewardsStore((s) => s.popupOpen)
  const grants = useRewardsStore((s) => s.grants)
  const claiming = useRewardsStore((s) => s.claiming)
  const claim = useRewardsStore((s) => s.claim)
  const closePopup = useRewardsStore((s) => s.closePopup)
  const lastClaim = useRewardsStore((s) => s.lastClaim)
  const setView = useQuickyStore((s) => s.setView)

  const collect = async () => {
    const result = await claim()
    if (result) {
      toast.success(result.claimed.length > 0 ? `Collected ${result.claimed.length} reward${result.claimed.length > 1 ? 's' : ''}` : 'Already collected')
    } else {
      toast.error('Could not collect — try again')
    }
  }

  return (
    <AnimatePresence>
      {popupOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Realm rewards unlocked"
        >
          <motion.div
            initial={{ scale: 0.92, y: 24 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 12 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="w-full max-w-sm max-h-[86vh] overflow-y-auto no-scrollbar rounded-3xl border border-white/12 bg-[var(--qk-card)] p-5 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/10">
              <div>
                <h2 className="text-base font-black flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[var(--qk-gold)]" aria-hidden />
                  {grants.length > 0 ? 'Realm Rewards Unlocked' : 'Rewards Collected'}
                </h2>
                <p className="text-[11px] text-white/45 mt-0.5">
                  {grants.length > 0
                    ? 'Congratulations! Your realm rewards are ready to collect.'
                    : lastClaim && lastClaim.claimed.length > 0
                      ? 'Your rewards were added to your inventory and wallet.'
                      : 'Nothing pending right now.'}
                </p>
              </div>
              <button
                onClick={closePopup}
                className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/50"
                aria-label="Close"
              >
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>

            {grants.length > 0 ? (
              <>
                <div className="py-3 flex flex-col gap-2">
                  {grants.map((grant) => (
                    <div
                      key={grant.id}
                      className="flex items-center gap-3 rounded-2xl border border-white/8 bg-[var(--qk-elev)] px-3 py-2.5"
                    >
                      <div className="w-12 h-12 shrink-0 rounded-xl bg-black/30 border border-white/10 flex items-center justify-center overflow-hidden">
                        <GrantIcon grant={grant} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold truncate">{grant.name}</p>
                        <p className="text-[11px] text-white/45">
                          {grant.rewardType === 'COINS' && <Coins className="w-3 h-3 inline-block mr-0.5 -mt-0.5 text-[var(--qk-gold)]" aria-hidden />}
                          {subtitle(grant)}
                          {grant.rarity !== 'COMMON' && <span className={`ml-1.5 font-bold ${RARITY_TINT[grant.rarity] ?? ''}`}>{grant.rarity}</span>}
                        </p>
                      </div>
                      <span className="text-[9px] font-black uppercase tracking-wider text-[#30D158] shrink-0">Ready</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => void collect()}
                  disabled={claiming}
                  className="w-full rounded-2xl py-3 font-black text-sm flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.98] transition-transform"
                  style={{ background: 'var(--qk-accent)', color: 'var(--qk-on-accent)' }}
                >
                  <Gift className="w-4 h-4" aria-hidden />
                  {claiming ? 'Collecting…' : 'Collect Rewards'}
                </button>
                <p className="mt-2 text-center text-[10px] text-white/30">Tapping multiple times never duplicates rewards — claims are server-verified.</p>
              </>
            ) : lastClaim && lastClaim.claimed.length > 0 ? (
              <div className="py-4 flex flex-col gap-3">
                <div className="flex flex-wrap gap-2 justify-center">
                  {lastClaim.claimed.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 rounded-full bg-[var(--qk-elev)] border border-white/10 px-3 py-1.5">
                      {isImageUrl(item.icon) ? (
                         
                        <img src={item.icon} alt={item.name} className="w-5 h-5 object-contain" />
                      ) : (
                        <span aria-hidden>{item.icon}</span>
                      )}
                      <span className="text-xs font-bold">{item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
                    </div>
                  ))}
                </div>
                {lastClaim.coinBalance > 0 && (
                  <p className="text-center text-xs text-white/50">
                    Coin balance: <b className="text-[var(--qk-gold)]">{lastClaim.coinBalance.toLocaleString()}</b>
                  </p>
                )}
                <button
                  onClick={closePopup}
                  className="w-full rounded-2xl py-3 font-black text-sm border border-white/15 bg-white/5"
                >
                  Done
                </button>
              </div>
            ) : (
              <div className="py-6 flex flex-col items-center gap-3">
                <p className="text-sm text-white/50">No rewards waiting — finish top-3 in a realm cycle to earn some.</p>
                <button onClick={() => { closePopup(); setView('games') }} className="rounded-full border border-[var(--qk-accent)]/40 px-4 py-2 text-xs font-bold text-[var(--qk-accent)]">
                  Play now
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
