// Quicky — double-tap detector (works on web + Capacitor WebView)
// Fires `onDouble` when two pointer-up events land within `window` ms and
// inside `radius` px of each other. Ignores the second tap if the user is
// actually long-pressing (combine with useLongPress upstream if needed).
import { useRef } from 'react'

export function useDoubleTap(onDouble: () => void, window = 300, radius = 30) {
  const last = useRef<{ t: number; x: number; y: number } | null>(null)
  return {
    onPointerUp: (e: React.PointerEvent) => {
      const now = Date.now()
      const prev = last.current
      last.current = { t: now, x: e.clientX, y: e.clientY }
      if (
        prev &&
        now - prev.t < window &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < radius
      ) {
        last.current = null
        onDouble()
      }
    },
  }
}
