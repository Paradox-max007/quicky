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
  | 'games'
  | 'community'
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
  premiumUntil?: string | null
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
  privacyHideReadReceipts: boolean
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
    lastActiveAt?: string | null
    hideOnline?: boolean
  }
  streak: number
  preview: string
  unread: boolean
  unreadCount: number
  lastMessageAt: string
}

export type ChatMessage = {
  id: string
  senderId: string
  type: 'text' | 'image' | 'video' | 'voice' | 'quicky' | 'system'
  text: string | null
  mediaUrl: string | null
  // Voice message duration in ms
  mediaDuration?: number | null
  quickyDuration?: number | null
  quickyOpenedAt?: string | null
  quickyExpiresAt?: string | null
  screenshotFlagged?: boolean
  readAt?: string | null
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
  // view to return to when the profile view closes
  profileReturnView: AppView
  pendingMatchPartner: { matchId: string; partnerId: string; partnerName: string | null; partnerPhoto: string | null } | null
  paywall: PaywallContext | null
  // Post to scroll to & highlight when the Community tab next opens
  communityFocusPostId: string | null

  // Per-chat unread counts — source of truth for the nav Chats badge and the
  // per-row badges. Patched instantly on read events; reconciled from the
  // server aggregate whenever the matches list refreshes.
  unreadByMatch: Record<string, number>
  // Incoming likes not yet viewed from the Likes page (nav Likes badge)
  unviewedLikes: number
  totalUnread: number

  // navigation
  setView: (v: AppView) => void
  setUser: (u: QuickyUser | null) => void
  setHydrated: (h: boolean) => void
  openChat: (matchId: string) => void
  openProfile: (userId: string, returnView?: AppView) => void
  setUnreadMap: (map: Record<string, number>) => void
  clearUnreadForMatch: (matchId: string) => void
  setTotalUnread: (n: number) => void
  setUnviewedLikes: (n: number) => void
  showMatchCelebration: (m: { matchId: string; partnerId: string; partnerName: string | null; partnerPhoto: string | null }) => void
  clearMatchCelebration: () => void
  showPaywall: (ctx: PaywallContext) => void
  clearPaywall: () => void
  openCommunityPost: (postId: string) => void
  clearCommunityFocus: () => void
  logout: () => void
}

export const useQuickyStore = create<State>((set) => ({
  view: 'splash',
  user: null,
  hydrated: false,
  activeMatchId: null,
  activeProfileUserId: null,
  profileReturnView: 'discovery',
  pendingMatchPartner: null,
  paywall: null,
  communityFocusPostId: null,
  unreadByMatch: {},
  unviewedLikes: 0,
  totalUnread: 0,

  setView: (v) => set({ view: v }),
  setUser: (u) => set({ user: u }),
  setHydrated: (h) => set({ hydrated: h }),
  openChat: (matchId) => set({ activeMatchId: matchId, view: 'chat' }),
  openProfile: (userId, returnView) =>
    set({ activeProfileUserId: userId, view: 'profile-view', ...(returnView ? { profileReturnView: returnView } : {}) }),
  setUnreadMap: (map) => {
    const total = Object.values(map).reduce((s, n) => s + n, 0)
    set({ unreadByMatch: map, totalUnread: total })
  },
  clearUnreadForMatch: (matchId) =>
    set((prev) => {
      const had = prev.unreadByMatch[matchId] ?? 0
      if (!had && !prev.totalUnread) return prev
      const map = { ...prev.unreadByMatch, [matchId]: 0 }
      return { unreadByMatch: map, totalUnread: Math.max(0, prev.totalUnread - had) }
    }),
  // Legacy setter kept for callers that only know the aggregate; recomputes
  // the per-match map proportionally is unnecessary — it just sets the total.
  setTotalUnread: (n) => set({ totalUnread: n }),
  setUnviewedLikes: (n) => set({ unviewedLikes: n }),
  showMatchCelebration: (m) => set({ pendingMatchPartner: m }),
  clearMatchCelebration: () => set({ pendingMatchPartner: null }),
  showPaywall: (ctx) => set({ paywall: ctx }),
  clearPaywall: () => set({ paywall: null }),
  openCommunityPost: (postId) => set({ communityFocusPostId: postId, view: 'community' }),
  clearCommunityFocus: () => set({ communityFocusPostId: null }),
  logout: () => set({ user: null, view: 'splash', activeMatchId: null, activeProfileUserId: null, unreadByMatch: {}, unviewedLikes: 0, totalUnread: 0 }),
}))
