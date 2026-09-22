// Quicky — ROOM CHAT MENTION ALERT HELPER (mentions PRD §47/§49/§52/§55/§91)
//
// ONE module-level dedup gate for every mention alert path:
//   · in-room  → Supabase room channel 'chat' payload (game-room store)
//   · any-screen → per-user game-chat SSE 'mention' event (game-chat store)
// A single mention therefore produces exactly ONE visual alert + ONE haptic
// event, no matter which path wins the race — and a realtime reconnect can
// never replay old alerts (§55/§113: dedupe by mention.id, module-level so
// it survives remounts exactly like the stores do).

import { toast } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { playMentionSound } from './mention-sound'

export type MentionAlertInput = {
  id: string
  actorName: string
  textPreview: string
  /** true = the user is inside the room (lightweight in-room alert, §89). */
  inRoom: boolean
}

const g = globalThis as unknown as { __quickyMentionAlertIds?: Set<string> }
const alertedIds: Set<string> = (g.__quickyMentionAlertIds ??= new Set())

/** Short notification-style haptic (§49/§52) — never an aggressive vibration. */
function buzz() {
  try {
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/haptics')
        .then(({ Haptics, NotificationType }) =>
          Haptics.notification({ type: NotificationType.Warning })
        )
        .catch(() => {})
    } else if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(20)
    }
  } catch {}
}

/**
 * Show the mention alert exactly once per mention id. Returns true when THIS
 * call was the one that alerted (first path wins).
 */
export function alertMentionOnce(m: MentionAlertInput): boolean {
  if (!m.id || alertedIds.has(m.id)) return false
  alertedIds.add(m.id)
  // Bound the set so a very long session cannot grow it forever.
  if (alertedIds.size > 400) {
    let n = 200
    for (const id of alertedIds) {
      if (n-- <= 0) break
      alertedIds.delete(id)
    }
  }
  buzz()
  // Room-chat-settings revision: the mention chime rides EVERY mention
  // alert path (in-room channel AND per-user SSE — any screen, game or
  // not). Switchable via the chat header speaker button / settings panel;
  // default ON. WebAudio synthesis — no asset, works in the WebView.
  playMentionSound()
  // §91 copy: "@Luna mentioned you in Club Royale" (+ preview) — in-room the
  // shorter lightweight variant; never expose more than a short preview.
  const title = m.inRoom
    ? `@${m.actorName} mentioned you`
    : `@${m.actorName} mentioned you in Club Royale`
  toast(title, {
    description: m.textPreview || undefined,
    duration: 3500,
  })
  return true
}
