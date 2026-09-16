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
  | 'game-landing'
  | 'chats'
  | 'community'
  | 'chat'
  | 'profile-view'
  | 'spin-bottle'
  | 'spin-bottle-room'
  | 'game-chat'
  | 'game-chat-contacts'
  | 'admin-gifts'
  | 'admin-rules'
  | 'admin-stickers'

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
  // v3 economy + admin (real DB values via /auth/me)
  isAdmin?: boolean
  coinBalance?: number
  kissPoints?: number
  onboardedAt: string | null
  discoveryAgeMin?: number | null
  discoveryAgeMax?: number | null
  discoveryDistanceKm?: number | null
  discoveryShowVerifiedOnly?: boolean
  discoveryRecentlyActive?: boolean
  discoveryHeightMin?: number | null
  discoveryHeightMax?: number | null
  discoveryEducations?: string[]
  discoveryLifestyles?: string[]
  // profile details
  heightCm?: number | null
  education?: string | null
  lifestyle?: string | null
  lastActiveAt?: string | null
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
  heightCm: number | null
  education: string | null
  lifestyle: string | null
  lastActiveAt: string | null
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
  // Active Spin the Bottle roomId (set when join succeeds; cleared on leave)
  spinBottleRoomId: string | null
  // Game Hub PRD §12: the slug of the game whose landing page is open in the
  // 'game-landing' view (Games → card → landing). null = nothing selected.
  gameLandingSlug: string | null
  // Where a full-screen mobile dating chat's back arrow returns (§54):
  // the unified center ('chats'), the in-game contacts screen
  // ('game-chat-contacts') or the live room ('spin-bottle-room').
  chatReturnView: AppView | null
  // ─── Game Chat (private player-to-player, game-chat PRD §7) — SEPARATE
  // from Dating Chat: own list, own messages, own notifications.
  gameChatPeer: { peerUserId: string; peerName: string | null; peerAvatar: string | null } | null
  // Where the back arrow returns to (room screen / game landing / chat list)
  gameChatReturnView: AppView
  // Bug-fix PRD §9/§10: the WEB room sidebar is a 3-state chat section —
  // 'room' (Room Chat, stays mounted underneath), 'contacts' (Game Contact
  // List) and 'personal' (Personal Game Chat). Capacitor ignores this and
  // uses the dedicated 'game-chat-contacts' / 'game-chat' screens instead
  // (layout PRD §8: Message → Contact List → Personal Chat).
  roomChatPanel: 'room' | 'contacts' | 'personal' | 'dating'
  // Layout PRD §2.1/§51: "Message" on a player opens the CONTACT LIST with
  // that player pinned at the top — the conversation may not exist yet and
  // the list only shows real conversations (§23). The pinned row is
  // synthesized client-side and cleared when the contacts surface closes.
  gameChatPinnedPeer: { peerUserId: string; peerName: string | null; peerAvatar: string | null } | null
  // Mentions PRD §10/§82: the CONTACTS screen's own back target. The personal
  // chat opened straight from "Message" returns to the contacts screen
  // (gameChatReturnView = 'game-chat-contacts'), so the contacts screen can
  // NOT reuse gameChatReturnView — it would return to itself. This dedicated
  // field is where the contacts screen's back arrow (and the Android hardware
  // back) goes: Game Contacts → Game Room.
  gameChatContactsReturnView: AppView
  // Mentions PRD §77: Profile → "Mention" sets this draft; RoomChatPanel
  // consumes it (insert @DisplayName token + focus composer). No message is
  // ever sent automatically (§29).
  roomChatMentionDraft: { userId: string; displayName: string } | null

  // Web Premium PRD §8-§9/§67: the desktop Chats page is ONE shell —
  // GameChatShell (contacts pane | conversation pane) with a Dating tab.
  // Which list the contacts pane shows is app-level state so the top nav,
  // the room's "Message" action and the page itself share one selection.
  chatsSection: 'game' | 'dating'

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
  openChat: (matchId: string, returnView?: AppView) => void
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
  setSpinBottleRoomId: (id: string | null) => void
  openGameChat: (
    peer: { peerUserId: string; peerName: string | null; peerAvatar: string | null },
    returnView?: AppView
  ) => void
  closeGameChat: () => void
  // Layout PRD §8: the dedicated Capacitor CONTACT LIST screen (Game Room →
  // Game Contact List → Personal Game Chat). Back returns to `returnView`.
  openGameChatContacts: (returnView?: AppView) => void
  pinGameChatPeer: (
    peer: { peerUserId: string; peerName: string | null; peerAvatar: string | null } | null
  ) => void
  setRoomChatPanel: (p: 'room' | 'contacts' | 'personal' | 'dating') => void
  /** Web Premium PRD §9/§67: open the desktop Chats page (GameChatShell). */
  openChats: (section?: 'game' | 'dating') => void
  /** Game Hub PRD §12: open a game's landing page from its card. */
  openGameLanding: (slug: string) => void
  setChatsSection: (s: 'game' | 'dating') => void
  /** Desktop chats page: select a dating conversation without navigating. */
  setActiveMatchId: (id: string | null) => void
  /** Mentions PRD §77: profile popup → Mention → composer token + focus. */
  insertRoomChatMention: (m: { userId: string; displayName: string }) => void
  clearRoomChatMentionDraft: () => void
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
  spinBottleRoomId: null,
  gameLandingSlug: null,
  chatReturnView: null,
  gameChatPeer: null,
  gameChatReturnView: 'spin-bottle',
  roomChatPanel: 'room',
  gameChatPinnedPeer: null,
  gameChatContactsReturnView: 'spin-bottle-room',
  roomChatMentionDraft: null,
  chatsSection: 'game',
  unreadByMatch: {},
  unviewedLikes: 0,
  totalUnread: 0,

  setView: (v) => set({ view: v }),
  setUser: (u) => set({ user: u }),
  setHydrated: (h) => set({ hydrated: h }),
  openChat: (matchId, returnView) =>
    set({ activeMatchId: matchId, view: 'chat', chatReturnView: returnView ?? null }),
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
  setSpinBottleRoomId: (id) => {
    // game-chat PRD §100: the active room id survives a browser refresh so
    // the runtime can be restored IF the server still says we are a member.
    try {
      if (id) localStorage.setItem('quicky_room_id', id)
      else localStorage.removeItem('quicky_room_id')
    } catch {}
    set({ spinBottleRoomId: id })
  },
  openGameChat: (peer, returnView) =>
    set({
      gameChatPeer: peer,
      gameChatReturnView: returnView ?? 'spin-bottle',
      view: 'game-chat',
    }),
  closeGameChat: () =>
    set((prev) => ({ view: prev.gameChatReturnView || 'spin-bottle', gameChatPeer: null })),
  openGameChatContacts: (returnView) =>
    set({
      view: 'game-chat-contacts',
      // Mentions PRD §10/§82: the contacts screen keeps its OWN back target —
      // gameChatReturnView may be pointing at this very screen when the
      // personal chat was opened straight from "Message".
      ...(returnView ? { gameChatContactsReturnView: returnView } : {}),
    }),
  pinGameChatPeer: (peer) => set({ gameChatPinnedPeer: peer }),
  setRoomChatPanel: (p) =>
    set((prev) => ({
      roomChatPanel: p,
      // Leaving the contacts state drops the pinned "Message" row (§2.1).
      ...(p !== 'contacts' && prev.gameChatPinnedPeer ? { gameChatPinnedPeer: null } : {}),
    })),
  insertRoomChatMention: (m) => set({ roomChatMentionDraft: m, roomChatPanel: 'room' }),
  clearRoomChatMentionDraft: () => set({ roomChatMentionDraft: null }),
  openChats: (section) =>
    set((prev) => ({ view: 'chats', ...(section ? { chatsSection: section } : {}) })),
  openGameLanding: (slug) => set({ gameLandingSlug: slug, view: 'game-landing' }),
  setChatsSection: (s) => set({ chatsSection: s }),
  setActiveMatchId: (id) => set({ activeMatchId: id }),
  logout: () => set({ user: null, view: 'splash', activeMatchId: null, activeProfileUserId: null, unreadByMatch: {}, unviewedLikes: 0, totalUnread: 0, spinBottleRoomId: null, gameLandingSlug: null, chatReturnView: null, gameChatPeer: null, gameChatReturnView: 'spin-bottle', roomChatPanel: 'room', gameChatPinnedPeer: null, gameChatContactsReturnView: 'spin-bottle-room', roomChatMentionDraft: null, communityFocusPostId: null, chatsSection: 'game' }),
}))
