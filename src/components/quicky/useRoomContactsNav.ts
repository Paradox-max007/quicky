'use client'

// Quicky — SHARED ROOM CONTACTS NAVIGATION (Unified PRD §23/§24/§25/§100)
//
// THE universal rule for opening "Game Chats" from ANY game room
// (§24 — implemented ONCE here, never separately in Ludo and Spin Bottle):
//
//   Desktop Web          → setRoomChatPanel('contacts')  — the embedded
//                          contacts panel INSIDE the right chat sidebar;
//                          the game table stays visible, playable and
//                          realtime (§12/§13 — the key fix: the old
//                          openChats('game') full-page branch is GONE).
//
//   Mobile Web / Capacitor → openGameChatContacts(view) — the DEDICATED
//                          full-screen contacts page (§20/§22), which flows
//                          Contacts → Personal Chat → back. The game runtime
//                          NEVER detaches (§21/§92/§97): the module
//                          controller keeps streaming while the user is in
//                          chats and returning reconciles instantly from the
//                          authoritative server state.
//
// The same behavior backs BOTH entry points: the "Game Chats" header button
// and the 💬 message button in the room composer (§25: emoji · gift ·
// message/contact · send).

import { useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { useQuickyStore } from '@/store/quicky'
import { useIsDesktopShell } from '@/hooks/useIsDesktopShell'

/** Valid return views for the dedicated contacts screen (§22/§82). */
export type RoomContactsReturnView = 'ludo-room' | 'spin-bottle-room'

/**
 * One shared resolver for "open the contacts surface" from a game room.
 *
 * @param returnView the live room view the mobile contacts page returns to.
 */
export function useRoomContactsNav(returnView: RoomContactsReturnView): () => void {
  const setRoomChatPanel = useQuickyStore((s) => s.setRoomChatPanel)
  const isDeskShell = useIsDesktopShell()
  // null (SSR / first paint) is treated as MOBILE — the mobile layout paints
  // first, exactly like every other desktop-shell consumer in the app.
  const isDesktopWeb = isDeskShell === true

  return useCallback(() => {
    const isMobile = Capacitor.isNativePlatform() || !isDesktopWeb
    if (isMobile) {
      // §20/§22 — dedicated full-screen contacts page (Game Chats | Dating
      // Chats tabs), chat flow from there. The room runtime stays attached.
      useQuickyStore.getState().openGameChatContacts(returnView)
    } else {
      // §23/§96 — embedded contacts state inside the right chat panel. The
      // table never unmounts; back returns to Room Chat. No full-page route.
      setRoomChatPanel('contacts')
    }
  }, [isDesktopWeb, returnView, setRoomChatPanel])
}
