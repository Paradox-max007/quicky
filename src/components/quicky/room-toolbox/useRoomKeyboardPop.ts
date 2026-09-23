'use client'

// Quicky — useRoomKeyboardPop (v5) — THE shared game-room keyboard shim.
// Used by BOTH room shells (SpinBottleRoom + LudoRoom). v4 pinned the room
// root to a focus-time baseline (--sbr-room-h) and translated the composer
// by a STALE keyboard height — in webviews that resize the layout or
// auto-scroll the document to reveal the focused input, the pinned root
// overflowed the viewport, the browser scrolled it, and the composer landed
// near the game table with a huge dead gap above the keyboard (the exact
// bug the screenshots showed). v5 deletes every baseline-derived position:
//
//  1. NO pins. The room root never changes height (no --sbr-room-h /
//     --sbr-sheet-h) → the document can never overflow → the webview has
//     nothing to auto-scroll. The painted table keeps its size purely via
//     each room's lockedStageHeight (an inline flex-basis pin on the stage
//     itself, which the root's overflow:hidden clips instead of the doc).
//
//  2. LIVE flush measurement. On every keyboard / visual-viewport / resize /
//     focus event we MEASURE the chat sheet's bottom edge (getBoundingClientRect
//     — live client coordinates, so any document scroll is already included)
//     and shift the pop targets up by EXACTLY the distance to the keyboard's
//     top edge:   --sbr-pop = sheetRect.bottom − (innerHeight − kb)
//     The popped bar lands flush on the keyboard with ZERO extra gap — the
//     same visual contract as the personal chat screen (whose composer rides
//     marginBottom: kb above the keyboard). A short rAF settle chain keeps
//     re-measuring while the keyboard animates / the webview relayouts, so
//     the bar is self-correcting every frame instead of trusting one number.
//
//  3. Keyboard height, resolved per engine:
//     · resizes-visual web (Chrome Android / interactive-widget=resizes-visual,
//       the app's configured mode): kb = innerHeight − visualViewport.height
//       − offsetTop (the personal chat's proven formula, live values only).
//     · Capacitor (KeyboardResize.None — the keyboard overlays the WebView,
//       which never resizes): kb = the Keyboard plugin's keyboardHeight.
//     · resizes-content webviews (legacy): the LAYOUT viewport shrinks, so
//       the keyboard sits BELOW the layout — kb resolves to 0 and the flush
//       measurement still parks the composer on the visible bottom edge
//       (innerHeight), which IS the keyboard's top edge there.
//     The engine is detected live (innerHeight vs a focus-time baseline), not
//     cached: `layoutShrunk` = innerHeight dropped >60px under the baseline.
//
// The state returned drives the cosmetics: kbUp flips the .sbr-kb-open class
// (floating surface, no safe-area padding) and kbHeight feeds each room's
// lockedStageHeight guard.

import { useEffect, useRef, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'

/* A focused text element is the tell for "the soft keyboard is opening or
   up": its layout resize lands on the FOCUS frame in resizes-content
   webviews, so viewport re-baselining must be suppressed while one holds
   focus. Exported — LudoRoom's stage lock reuses them. */
export function isTextElement(el: EventTarget | null): el is HTMLElement {
  return (
    el instanceof HTMLElement &&
    el.matches('input, textarea, [contenteditable="true"], [contenteditable=""]')
  )
}

export function anyTextFocused(): boolean {
  return isTextElement(document.activeElement)
}

/* Everything that pops out of the chat sheet while the keyboard is up:
   the room composer row and the embedded personal/dating chat docks. */
const POP_TARGETS = '.sbr-chat .sbr-composer, .sbr-chat .qk-embed-dock'

export function useRoomKeyboardPop() {
  /** Overlay keyboard height in px (0 = down). */
  const kbHeightRef = useRef(0)
  const [kbHeight, setKbHeight] = useState(0)
  /** True while a soft keyboard is believed up in ANY resize mode. */
  const [kbUp, setKbUp] = useState(false)

  useEffect(() => {
    const doc = document.documentElement
    let baselineInner = window.innerHeight // last keyboard-free LAYOUT height
    let pluginKb = 0 // Capacitor Keyboard height (0 = hidden)
    let settleTicks = 0
    let rafId = 0
    let lastKb = 0
    let lastUp = false

    const writePop = (dy: number) => {
      doc.querySelectorAll<HTMLElement>(POP_TARGETS).forEach((el) => {
        if (dy > 0) el.style.setProperty('--sbr-pop', `${dy}px`)
        else el.style.removeProperty('--sbr-pop')
      })
    }

    // THE FLUSH MEASUREMENT — the pop targets are docked at the chat sheet's
    // bottom edge, so one rect covers them all. gBCR returns live client
    // coordinates (document scroll included), and the transform is applied in
    // the same space, so the bar re-lands flush on the keyboard's top edge
    // even if the webview scrolled the page to reveal the focused input.
    const shift = () => {
      const sheet = doc.querySelector<HTMLElement>('.sbr-chat')
      if (sheet) {
        const kb = kbHeightRef.current
        // Keyboard top in client coords: innerHeight − kb. resizes-content
        // resolves kb = 0 and innerHeight is already the shrunken visible
        // height, so the same expression is the keyboard's top edge there.
        const keyboardTop = window.innerHeight - kb
        const dy = Math.round(sheet.getBoundingClientRect().bottom - keyboardTop)
        writePop(Math.max(0, dy))
      }
      if (settleTicks > 0) {
        settleTicks--
        rafId = requestAnimationFrame(shift)
      }
    }

    // Keep re-measuring for a few frames after each event: the keyboard
    // animates in, the webview relayouts asynchronously, and the sheet's
    // rect only settles over a handful of frames.
    const schedule = (ticks: number) => {
      settleTicks = Math.max(settleTicks, ticks)
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(shift)
    }

    const apply = () => {
      const layoutShrunk = window.innerHeight < baselineInner - 60
      const vv = window.visualViewport
      const vvKb = vv
        ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
        : 0
      let kb = layoutShrunk ? 0 : Math.max(vvKb, pluginKb)
      kb = Math.round(Math.min(kb, window.innerHeight * 0.85))
      kbHeightRef.current = kb
      const up = kb > 0 || layoutShrunk
      if (kb !== lastKb) {
        lastKb = kb
        setKbHeight(kb)
      }
      if (up !== lastUp) {
        lastUp = up
        setKbUp(up)
      }
      schedule(up ? 12 : 3)
    }

    // Web / safety net — the personal chat's proven formula, on LIVE values.
    const vv = window.visualViewport ?? null
    const onVV = () => apply()
    vv?.addEventListener('resize', onVV)
    vv?.addEventListener('scroll', onVV)

    // FOCUS-TIME BASELINE — the only moment the layout is guaranteed
    // keyboard-free. Used ONLY to detect that a webview shrinks the layout
    // (resizes-content); it never positions anything, so a stale value can
    // no longer misplace the composer (the v4 failure mode).
    const onFocusIn = (e: FocusEvent) => {
      if (!isTextElement(e.target)) return
      if (kbHeightRef.current === 0 && pluginKb === 0) {
        baselineInner = Math.max(baselineInner, window.innerHeight)
      }
      apply()
    }
    doc.addEventListener('focusin', onFocusIn)

    const onResize = () => {
      if (kbHeightRef.current === 0 && pluginKb === 0 && !anyTextFocused()) {
        baselineInner = window.innerHeight
      }
      apply()
    }
    window.addEventListener('resize', onResize)

    // Native (Capacitor): exact overlay height from the Keyboard plugin.
    let handles: Awaited<ReturnType<typeof Keyboard.addListener>>[] = []
    if (Capacitor.isNativePlatform()) {
      const onShow = (i: { keyboardHeight?: number }) => {
        pluginKb = i.keyboardHeight ?? 0
        apply()
        schedule(14)
      }
      const onHide = () => {
        pluginKb = 0
        apply()
        schedule(8)
      }
      void Keyboard.addListener('keyboardWillShow', onShow).then((h) => handles.push(h))
      void Keyboard.addListener('keyboardDidShow', onShow).then((h) => handles.push(h))
      void Keyboard.addListener('keyboardWillHide', onHide).then((h) => handles.push(h))
      void Keyboard.addListener('keyboardDidHide', onHide).then((h) => handles.push(h))
    }

    return () => {
      vv?.removeEventListener('resize', onVV)
      vv?.removeEventListener('scroll', onVV)
      doc.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('resize', onResize)
      handles.forEach((h) => h.remove())
      cancelAnimationFrame(rafId)
      writePop(0)
      kbHeightRef.current = 0
      lastKb = 0
      lastUp = false
      setKbHeight(0)
      setKbUp(false)
    }
  }, [])

  return { kbUp, kbHeight, kbHeightRef }
}
