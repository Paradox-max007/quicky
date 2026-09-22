'use client'

// Quicky — COSMETICS WARDROBE (admin-console PRD §8.2/§9)
//
// The user's cosmetics inventory: owned hats / frames / name decorators /
// chat bubbles with their cosmetic LEVELS. One equipped cosmetic per TYPE —
// equipping a hat unequips every other hat (server-enforced). Level-3
// animated assets play in the list (real animation assets, §9.2).

import { motion, AnimatePresence } from 'framer-motion'
import { Shirt, X } from 'lucide-react'
import { useRewardsStore, type CosmeticItem } from '@/store/rewards'
import { CosmeticAsset } from './Cosmetics'

const TYPE_LABEL: Record<string, string> = {
  HAT: '🎩 Hats',
  PROFILE_FRAME: '🖼️ Frames',
  NAME_DECORATOR: '👑 Name Decorators',
  CHAT_BUBBLE: '💬 Chat Bubbles',
}

const TYPE_ORDER = ['PROFILE_FRAME', 'HAT', 'NAME_DECORATOR', 'CHAT_BUBBLE']

export function CosmeticsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const cosmetics = useRewardsStore((s) => s.cosmetics)
  const equip = useRewardsStore((s) => s.equip)
  const refresh = useRewardsStore((s) => s.refresh)

  // Refresh the inventory whenever the sheet opens (claims may have landed).
  if (open && !useRewardsStore.getState().loaded) void refresh()

  const grouped = TYPE_ORDER.map((type) => ({
    type,
    label: TYPE_LABEL[type] ?? type,
    items: cosmetics.filter((c) => c.rewardType === type),
  })).filter((g) => g.items.length > 0)

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[220] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            className="relative w-[min(94vw,28rem)] max-h-[82vh] overflow-y-auto no-scrollbar rounded-3xl border border-white/12 bg-[var(--qk-card)] p-4 flex flex-col gap-3"
            role="dialog"
            aria-label="Cosmetics wardrobe"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h3 className="text-sm font-black flex items-center gap-2">
                <Shirt className="w-4 h-4 text-[var(--qk-accent)]" aria-hidden />
                My Cosmetics
              </h3>
              <button onClick={onClose} className="p-2 rounded-full bg-white/5 hover:bg-white/15 text-white/50" aria-label="Close">
                <X className="w-4 h-4" aria-hidden />
              </button>
            </div>

            {grouped.length === 0 ? (
              <div className="py-10 text-center flex flex-col items-center gap-2">
                <span className="text-3xl" aria-hidden>✨</span>
                <p className="text-sm text-white/50">No cosmetics yet — finish top-3 in a realm cycle to win some.</p>
                <p className="text-[11px] text-white/35">Level 3 rewards are ANIMATED — earn them and turn them on here.</p>
              </div>
            ) : (
              grouped.map((group) => (
                <div key={group.type}>
                  <p className="text-[10px] font-black uppercase tracking-wider text-white/40 mb-1.5">{group.label}</p>
                  <div className="flex flex-col gap-1.5">
                    {group.items.map((item: CosmeticItem) => (
                      <button
                        key={item.id}
                        onClick={() => void equip(item.rewardId, item.level, !item.equipped)}
                        className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                          item.equipped
                            ? 'border-[var(--qk-accent)]/50 bg-[var(--qk-accent)]/10'
                            : 'border-white/8 bg-white/[0.03] hover:bg-white/[0.06]'
                        }`}
                      >
                        <span className="w-10 h-10 shrink-0 rounded-xl bg-black/30 border border-white/10 flex items-center justify-center overflow-hidden">
                          <CosmeticAsset asset={item.levelAsset} className="w-8 h-8 object-contain" fallback="✨" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold truncate">{item.name}</span>
                          <span className="block text-[10.5px] text-white/45">
                            Level {item.level}{item.level === 3 ? ' · Animated' : ''} · {item.rarity.toLowerCase()}
                          </span>
                        </span>
                        <span
                          className={`text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full shrink-0 ${
                            item.equipped ? 'bg-[var(--qk-accent)] text-[var(--qk-on-accent)]' : 'bg-white/10 text-white/50'
                          }`}
                        >
                          {item.equipped ? 'On' : 'Equip'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
            <p className="text-[10px] text-white/30 leading-relaxed pt-1">
              One cosmetic per type can be equipped at a time — equipping a new {TYPE_ORDER.map((t) => TYPE_LABEL[t]?.split(' ')[1] ?? '').join('/')}.
              Your choices show up in game chats and on your profile.
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
