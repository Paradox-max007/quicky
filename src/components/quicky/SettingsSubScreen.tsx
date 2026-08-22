'use client'

import { ReactNode } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { ArrowLeft } from 'lucide-react'

export function SettingsSubScreen({
  title,
  onBack,
  children,
}: {
  title: string
  onBack?: () => void
  children: ReactNode
}) {
  const setView = useQuickyStore((s) => s.setView)
  return (
    <div className="w-full h-full flex flex-col bg-[#0F0F14] text-white">
      <header className="shrink-0 px-3 pt-3 pb-3 flex items-center gap-2 border-b border-white/5">
        <button
          onClick={onBack ?? (() => setView('settings'))}
          className="p-2 hover:bg-white/5 rounded-full"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
      </header>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {children}
      </div>
    </div>
  )
}
