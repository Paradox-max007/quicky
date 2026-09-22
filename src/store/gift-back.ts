// Quicky — GIFT BACK STORE (gifting-revision: reply-gifting from ANY surface)
//
// Opens the per-recipient gift sheet (GiftBackSheet) for one player — from
// the room-chat gift card's "Send gift back" button, the GameGiftAlert
// drawer's "Send Gift" action or the chat-panel drawer — WITHOUT leaving
// the current screen (no navigation, the sheet is a global AppRoot surface
// that works on every view because the room runtime stays attached).

import { create } from 'zustand'

export type GiftBackPeer = {
  id: string
  name: string
  avatar?: string | null
}

type GiftBackState = {
  open: boolean
  peer: GiftBackPeer | null
  roomId: string | null
  openGiftBack: (peer: GiftBackPeer, roomId: string | null) => void
  close: () => void
}

export const useGiftBackStore = create<GiftBackState>((set) => ({
  open: false,
  peer: null,
  roomId: null,
  openGiftBack: (peer, roomId) => set({ open: true, peer, roomId }),
  close: () => set({ open: false, peer: null, roomId: null }),
}))
