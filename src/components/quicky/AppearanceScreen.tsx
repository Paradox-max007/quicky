'use client'

import { useState, useEffect } from 'react'
import { useQuickyStore } from '@/store/quicky'
import { api } from '@/lib/quicky/api-client'
import { toast } from 'sonner'
import { SettingsSubScreen } from './SettingsSubScreen'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { applyThemeToDOM } from '@/lib/quicky/theme'

type Theme = {
  id: string
  name: string
  description: string
  preview: {
    bg: string
    card: string
    accent: string
    text: string
  }
}

const THEMES: Theme[] = [
  {
    id: 'dark',
    name: 'Midnight',
    description: 'Deep charcoal with coral accents',
    preview: { bg: '#0F0F14', card: '#1A1A2E', accent: '#FF2D55', text: '#F5F5F7' },
  },
  {
    id: 'light',
    name: 'Daylight',
    description: 'Clean white with coral accents',
    preview: { bg: '#F6F6F9', card: '#FFFFFF', accent: '#E0244B', text: '#16161D' },
  },
  {
    id: 'midnight',
    name: 'Ocean Night',
    description: 'Deep blue-black with coral pop',
    preview: { bg: '#0A0E27', card: '#11173A', accent: '#FF2D55', text: '#E8E8F0' },
  },
  {
    id: 'coral',
    name: 'Coral Sunset',
    description: 'Warm dark base with coral gradients',
    preview: { bg: '#1A0F12', card: '#2A1A1F', accent: '#FF2D55', text: '#FFE8E8' },
  },
  {
    id: 'lavender',
    name: 'Lavender Dream',
    description: 'Soft purple dark with gold accents',
    preview: { bg: '#13101A', card: '#1F1A2E', accent: '#B8A4FF', text: '#F0EAFF' },
  },
  {
    id: 'gold',
    name: 'Golden Hour',
    description: 'Premium gold-on-dark theme',
    preview: { bg: '#15110A', card: '#241E14', accent: '#F5C570', text: '#FFF4E0' },
  },
]

export function AppearanceScreen() {
  const user = useQuickyStore((s) => s.user)
  const setUser = useQuickyStore((s) => s.setUser)
  const [selected, setSelected] = useState(user?.settings?.theme ?? 'dark')
  const [saving, setSaving] = useState(false)

  const applyTheme = async (themeId: string) => {
    setSelected(themeId)
    applyThemeToDOM(themeId)
    setSaving(true)
    try {
      await api.settings.update({ theme: themeId })
      const me = await api.auth.me()
      if (me.user) setUser(me.user)
      toast.success(`Theme set to ${THEMES.find(t => t.id === themeId)?.name}`)
    } catch (e: any) {
      // Revert to the previously persisted theme on failure
      applyThemeToDOM(user?.settings?.theme)
      setSelected(user?.settings?.theme ?? 'dark')
      toast.error(e.body?.error ?? e.message ?? 'Failed to set theme')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SettingsSubScreen title="Appearance / Theme">
      <div className="px-5 py-5">
        <p className="text-xs text-white/50 mb-4 px-1">Pick a theme that feels like you. Your theme syncs across all your devices.</p>
        <div className="flex flex-col gap-3">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() => applyTheme(theme.id)}
              disabled={saving}
              className={cn(
                'relative rounded-2xl border-2 overflow-hidden transition-all text-left',
                selected === theme.id
                  ? 'border-[var(--qk-accent)] glow-coral'
                  : 'border-white/8 hover:border-white/20'
              )}
            >
              {/* Preview swatch */}
              <div className="flex items-stretch h-20">
                <div className="flex-1 flex flex-col justify-between p-3" style={{ backgroundColor: theme.preview.bg }}>
                  <div className="flex items-center gap-1.5">
                    <div className="w-6 h-6 rounded-full" style={{ backgroundColor: theme.preview.accent }} />
                    <span className="text-xs font-bold" style={{ color: theme.preview.text }}>{theme.name}</span>
                  </div>
                  <div className="flex gap-1">
                    <div className="h-2 w-8 rounded-full" style={{ backgroundColor: theme.preview.accent }} />
                    <div className="h-2 w-4 rounded-full" style={{ backgroundColor: theme.preview.card, border: '1px solid rgba(255,255,255,0.1)' }} />
                  </div>
                </div>
                <div className="w-20 flex flex-col justify-center p-2 gap-1" style={{ backgroundColor: theme.preview.card }}>
                  <div className="h-1.5 w-full rounded-full" style={{ backgroundColor: theme.preview.text, opacity: 0.8 }} />
                  <div className="h-1.5 w-3/4 rounded-full" style={{ backgroundColor: theme.preview.text, opacity: 0.4 }} />
                  <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: theme.preview.text, opacity: 0.4 }} />
                </div>
              </div>
              {/* Description */}
              <div className="px-3 py-2.5 bg-[var(--qk-bg)] flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{theme.name}</p>
                  <p className="text-xs text-white/50">{theme.description}</p>
                </div>
                {selected === theme.id && (
                  <div className="w-6 h-6 rounded-full bg-[var(--qk-accent)] flex items-center justify-center shrink-0">
                    <Check className="w-4 h-4 text-white" strokeWidth={3} />
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </SettingsSubScreen>
  )
}
