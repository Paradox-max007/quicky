// Quicky — MENTION NOTIFICATION SOUND (room-chat-settings revision)
//
// A soft two-tone chime played whenever someone mentions the user in a room
// chat — REGARDLESS of the surface they are on (game screen, room chat,
// another app screen: every mention notification flows through
// alertMentionOnce, which calls playMentionSound()). Visual toast + haptic
// + sound ride together; the sound is switchable from the room chat header
// speaker button / the chat settings panel (localStorage, default ON).
//
// ENGINE: WebAudio oscillator synthesis — zero audio assets, zero network,
// works in the Capacitor WebView and every mobile browser. Autoplay policy:
// an AudioContext must be created/resumed inside a user gesture, so
// primeMentionSound() attaches ONE global listener set (pointer/key/touch)
// that unlocks the context at the first interaction; mentions arriving
// before that first gesture stay silent-but-visual (same OS rule every
// browser app lives under) and work from the next mention on.

const STORAGE_KEY = 'qk_mention_sound'

let ctx: AudioContext | null = null
let primed = false

/** Default ON; anything other than the literal 'off' counts as enabled. */
export function isMentionSoundEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setMentionSoundEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, 'off')
  } catch {}
}

function ensureCtx(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext
      if (!AC) return null
      ctx = new AC() as AudioContext
    }
    if (ctx && ctx.state === 'suspended') void ctx.resume().catch(() => {})
    return ctx
  } catch {
    return null
  }
}

/**
 * Unlock the AudioContext at the user's first gesture (autoplay policy).
 * Safe to call any number of times — listeners attach once.
 */
export function primeMentionSound(): void {
  if (primed || typeof window === 'undefined') return
  primed = true
  const unlock = () => {
    ensureCtx()
    window.removeEventListener('pointerdown', unlock)
    window.removeEventListener('touchstart', unlock)
    window.removeEventListener('keydown', unlock)
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  window.addEventListener('touchstart', unlock, { passive: true })
  window.addEventListener('keydown', unlock)
}

/** Soft two-note chime (E5 → B5, sine, ~260ms) — notification-style, never harsh. */
export function playMentionSound(): void {
  if (!isMentionSoundEnabled()) return
  try {
    const ac = ensureCtx()
    if (!ac || ac.state !== 'running') return
    const now = ac.currentTime
    const mkNote = (freq: number, at: number, dur: number, vol: number) => {
      const osc = ac.createOscillator()
      const gain = ac.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, at)
      gain.gain.setValueAtTime(0, at)
      gain.gain.linearRampToValueAtTime(vol, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(gain).connect(ac.destination)
      osc.start(at)
      osc.stop(at + dur + 0.05)
    }
    mkNote(659.25, now, 0.16, 0.09) // E5
    mkNote(987.77, now + 0.09, 0.24, 0.07) // B5
  } catch {}
}
