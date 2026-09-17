'use client'

// Quicky — GAME FRIENDS SCREEN (Unified Game Primary Screen PRD §15-§18)
//
// The DEDICATED Capacitor/mobile Friends screen:
//
//   Game Primary Screen → (👥 Friends icon) → GameFriendsScreen (HERE)
//                       → 👤 → Friend Profile ('profile-view', back → HERE, §17)
//                       → 💬 → One-to-One Chat ('game-chat', back → HERE, §18)
//
// Uses the EXISTING friends system (GET /friends via GameFriendsList) and the
// EXISTING profile/chat navigation — no new relationship or messaging logic
// (§35/§34). Back navigation (§17/§18/§40):
//   Profile  → Friends (never Game Primary directly)
//   Chat     → Friends
//   Friends  → the Game Primary Screen that opened it (gameFriendsReturnView)

import { ArrowLeft } from 'lucide-react'
import { useQuickyStore } from '@/store/quicky'
import { GameFriendsList, type GameFriendRow } from './GameFriendsList'

export function GameFriendsScreen() {
  const back = () => {
    // §40: Back = previous logical screen — the Game Primary Screen that
    // opened Friends (game-landing / spin-bottle), never the Games list.
    const qk = useQuickyStore.getState()
    qk.setView(qk.gameFriendsReturnView || 'games')
  }

  // §17: Profile opens from a friend row; its back arrow returns HERE
  // (openProfile stores profileReturnView = 'game-friends').
  const openProfile = (f: GameFriendRow) => {
    useQuickyStore.getState().openProfile(f.id, 'game-friends')
  }

  // §18: Chat opens the one-to-one chat INSIDE the game chat flow; back from
  // the chat returns HERE (openGameChat stores gameChatReturnView).
  const openChat = (f: GameFriendRow) => {
    useQuickyStore.getState().openGameChat(
      { peerUserId: f.id, peerName: f.name ?? null, peerAvatar: f.photo ?? null },
      'game-friends'
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--qk-bg)] text-white" data-testid="cap-friends-screen">
      {/* Header (§45: respects safe-area-inset-top — never under the notch) */}
      <header className="shrink-0 safe-area-top px-2 pt-2.5 pb-2 flex items-center gap-2 border-b border-white/10 bg-[var(--qk-bg)]/80 backdrop-blur">
        <button onClick={back} className="p-2 rounded-full hover:bg-white/10" aria-label="Back" data-testid="game-friends-back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <p className="font-black text-sm text-white">Friends</p>
      </header>

      {/* §16: search + friend rows (avatar, name, online, 👤 + 💬 per row) */}
      <div className="flex-1 min-h-0 pb-[env(safe-area-inset-bottom,0px)]">
        <GameFriendsList onOpenProfile={openProfile} onOpenChat={openChat} testIdPrefix="game-friends" />
      </div>
    </div>
  )
}
