// Quicky — Zustand store for app state & view routing

import { create } from 'zustand'

export type AppView =
  | 'splash'
  | 'auth'
  | 'onboarding'
  | 'discovery'
  | 'matches'
  | 'likes-you'
  | 'profile-me'
  | 'edit-profile'
  | 'settings'
  | 'settings-phone'
  | 'settings-email'
  | 'settings-discovery'
  | 'settings-notifications'
  | 'settings-appearance'
  | 'settings-blocked'
  | 'settings-privacy'
  | 'settings-terms'
  | 'settings-privacy-policy'
  | 'settings-help'
  | 'premium'
  | 'chat'
  | 'profile-view'

export type QuickyUser = {
  id: string
  phone: string
  email?: string | null
  name: string | null
  age: number | null
  gender: string | null
  lookingFor: string | null
  bio?: string | null
  city?: string | null
  interests?: string[]
  prompts?: { prompt: string; answer: string }[]
  photos?: { id: string; url: string; isPrimary: boolean; isPrivate: boolean; position: number }[]
  isPremium: boolean
  isVerified: boolean
  quickyScore: number
  onboardedAt: string | null
  discoveryAgeMin?: number | null
  discoveryAgeMax?: number | null
  discoveryDistanceKm?: number | null
  discoveryShowVerifiedOnly?: boolean
  discoveryRecentlyActive?: boolean
  settings?: UserSettings
}

export type UserSettings = {
  notifMessages: boolean
  notifConnectionReqs: boolean
  notifLikes: boolean
  notifProfileViews: boolean
  notifSnackbars: boolean
  privacyHideAge: boolean
  privacyHideDistance: boolean
  privacyHideOnline: boolean
  privacyHideTyping: boolean
  theme: string
}

export type DiscoveryCandidate = {
  id: string
  name: string | null
  age: number | null
  bio: string | null
  city: string | null
  interests: string[]
  photos: { id: string; url: string }[]
  isVerified: boolean
  isPremium: boolean
  quickyScore: number
  visibility: number
  distanceKm: number | null
}

export type MatchPreview = {
  id: string
  partner: {
    id: string
    name: string | null
    age: number | null
    isPremium: boolean
    isVerified: boolean
    quickyScore: number
    photo: string | null
  }
  streak: number
  preview: string
  unread: boolean
  lastMessageAt: string
}

export type ChatMessage = {
  id: string
  senderId: string
  type: 'text' | 'image' | 'video' | 'quicky' | 'system'
  text: string | null
  mediaUrl: string | null
  quickyDuration?: number | null
  quickyOpenedAt?: string | null
  quickyExpiresAt?: string | null
  screenshotFlagged?: boolean
  createdAt: string
}

export type PaywallContext =
  | { kind: 'likes' }
  | { kind: 'superlikes' }
  | { kind: 'quicky' }
  | { kind: 'games' }
  | { kind: 'see_likes' }
  | { kind: 'advanced_filters' }
  | { kind: 'boost' }
  | { kind: 'private_photos' }
  | { kind: 'generic' }

type State = {
  view: AppView
  user: QuickyUser | null
  hydrated: boolean

  // active view targets
  activeMatchId: string | null
  activeProfileUserId: string | null
  pendingMatchPartner: { matchId: string; partnerId: string; partnerName: string | null; partnerPhoto: string | null } | null
  paywall: PaywallContext | null

  // navigation
  setView: (v: AppView) => void
  setUser: (u: QuickyUser | null) => void
  setHydrated: (h: boolean) => void
  openChat: (matchId: string) => void
  openProfile: (userId: string) => void
  showMatchCelebration: (m: { matchId: string; partnerId: string; partnerName: string | null; partnerPhoto: string | null }) => void
  clearMatchCelebration: () => void
  showPaywall: (ctx: PaywallContext) => void
  clearPaywall: () => void
  logout: () => void
}

export const useQuickyStore = create<State>((set) => ({
  view: 'splash',
  user: null,
  hydrated: false,
  activeMatchId: null,
  activeProfileUserId: null,
  pendingMatchPartner: null,
  paywall: null,

  setView: (v) => set({ view: v }),
  setUser: (u) => set({ user: u }),
  setHydrated: (h) => set({ hydrated: h }),
  openChat: (matchId) => set({ activeMatchId: matchId, view: 'chat' }),
  openProfile: (userId) => set({ activeProfileUserId: userId, view: 'profile-view' }),
  showMatchCelebration: (m) => set({ pendingMatchPartner: m }),
  clearMatchCelebration: () => set({ pendingMatchPartner: null }),
  showPaywall: (ctx) => set({ paywall: ctx }),
  clearPaywall: () => set({ paywall: null }),
  logout: () => set({ user: null, view: 'splash', activeMatchId: null, activeProfileUserId: null }),
}))
