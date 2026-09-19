'use client'

// Quicky — LUDO THREE.JS DICE (Unified PRD §34–§47)
//
// A REAL WebGL dice (three is already a project dependency — no new
// rendering dependency added). Replaces the CSS 3D cube + Framer Motion die:
//
//   · ONE renderer / ONE scene / ONE camera / ONE dice mesh — created on
//     mount, disposed on unmount (§45/§46: no renderer recreation per roll,
//     no texture recreation per frame, no WebGL memory leaks).
//   · Canvas-generated pip face textures (§36): six 128px faces, correct
//     pips, drawn ONCE at mount.
//   · DETERMINISTIC FACE ORIENTATION (§37): every value 1–6 maps to a fixed
//     quaternion — the final visible face is ALWAYS the server's value
//     (§36/§41), on every device, every roll.
//   · The sequencer's phase machine still owns the choreography (§38):
//     entering → rolling (hop + fast tumble + deceleration) → settling
//     (server face alignment + small bounce) → revealed (hold) → exiting —
//     so the WebGL die is inherently beat-synced with the "rolled {n}"
//     hint, the coin-selectability gate and the 45s move timer.
//   · requestAnimationFrame render loop; rendering is SKIPPED while the die
//     is hidden (battery-friendly on mobile).
//   · DPR capped at 1.5 on mobile (§45) — no 4K framebuffers.
//   · prefers-reduced-motion (§47): a short, non-tumbling presentation that
//     still lands on the authoritative face.
//   · The component stays mounted for the whole room session (the outer
//     wrapper fades it in/out per roll) — exactly "no renderer recreation
//     per roll".

import { memo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { DICE_ENTER_MS, DICE_ROLL_MS, DICE_SETTLE_MS, DICE_HOLD_MS } from '@/lib/quicky/ludo/constants'
import type { DicePhase } from './useDiceSequencer'

// Canonical layout (same convention the CSS cube used): opposites sum to 7 —
// BoxGeometry material slots are ordered +X, -X, +Y, -Y, +Z, -Z.
const SLOT_VALUES = [3, 4, 2, 5, 1, 6] // +X right, -X left, +Y top, -Y bottom, +Z front, -Z back

/**
 * DETERMINISTIC ORIENTATION (§37) — the Euler rotation (XYZ) that brings the
 * face carrying `value` toward +Z (the camera's nominal axis).
 * 1 → front · 2 → top → front · 3 → right → front · 4 → left → front ·
 * 5 → bottom → front · 6 → back → front.
 */
const FACE_EULER: Record<number, [number, number, number]> = {
  1: [0, 0, 0],
  2: [Math.PI / 2, 0, 0],
  3: [0, -Math.PI / 2, 0],
  4: [0, Math.PI / 2, 0],
  5: [-Math.PI / 2, 0, 0],
  6: [0, Math.PI, 0],
}

/** TILT FIX — the camera sits ABOVE the die (0, 2.05, 4.9), so a face
 * oriented to plain +Z is viewed at a ~23° downward angle: the landed die
 * read as "still tilted". Every resting orientation is therefore
 * PRE-CORRECTED: the value's face normal is aligned EXACTLY at the camera
 * (billboarded along the camera ray), so the landed face is perfectly
 * square to the viewer on every device while the die still keeps its 3D
 * perspective from the projection. */
const CAMERA_DIR = new THREE.Vector3(0, 2.05, 4.9).normalize()
const ALIGN_TO_CAMERA = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 0, 1),
  CAMERA_DIR
)

/** Quaternion cache for the six camera-facing resting orientations. */
const FACE_QUAT: Record<number, THREE.Quaternion> = Object.fromEntries(
  ([1, 2, 3, 4, 5, 6] as const).map((v) => {
    const [x, y, z] = FACE_EULER[v]!
    const face = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'))
    return [v, ALIGN_TO_CAMERA.clone().multiply(face)]
  })
)

function quatForValue(v: number | null): THREE.Quaternion {
  return FACE_QUAT[v ?? 1] ?? FACE_QUAT[1]!
}

// ── Pip layout on a 3×3 normalized grid (§36 — correct pips per face) ───────
const PIP_GRID: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.26, 0.26],
    [0.74, 0.74],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.26, 0.5],
    [0.74, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
}

/** One pip face as a canvas texture — drawn once, never per frame (§45).
 *  BLACK die with RED pips: a glossy near-black body with a soft top-left
 *  sheen and deep-red radial pips — classic casino dice look, reads clearly
 *  on the dark game table. */
function makeFaceTexture(value: number): THREE.CanvasTexture {
  const S = 128
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  // Glossy black body — radial sheen from the upper-left, deep black edges.
  const grad = ctx.createRadialGradient(S * 0.32, S * 0.26, S * 0.06, S * 0.5, S * 0.55, S * 0.85)
  grad.addColorStop(0, '#3a3a44')
  grad.addColorStop(0.45, '#22222a')
  grad.addColorStop(1, '#0c0c10')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, S, S)
  // Subtle inner border so faces read individually while tumbling — a
  // whisper of red rim light on the black body.
  ctx.strokeStyle = 'rgba(255, 80, 110, 0.20)'
  ctx.lineWidth = 4
  ctx.strokeRect(3, 3, S - 6, S - 6)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
  ctx.lineWidth = 2
  ctx.strokeRect(6, 6, S - 12, S - 12)
  for (const [px, py] of PIP_GRID[value] ?? PIP_GRID[1]!) {
    const r = S * 0.095
    // pip shadow — a soft dark halo on the black body
    ctx.beginPath()
    ctx.arc(px * S + 1.5, py * S + 2.5, r * 1.12, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fill()
    // pip body — deep red radial, brighter core
    ctx.beginPath()
    ctx.arc(px * S, py * S, r, 0, Math.PI * 2)
    const pip = ctx.createRadialGradient(px * S - r * 0.3, py * S - r * 0.35, r * 0.1, px * S, py * S, r)
    pip.addColorStop(0, '#ff5a63')
    pip.addColorStop(0.55, '#e11d48')
    pip.addColorStop(1, '#8f0f26')
    ctx.fillStyle = pip
    ctx.fill()
    // pip glint — a tiny hot highlight, keeps the red alive under light
    ctx.beginPath()
    ctx.arc(px * S - r * 0.32, py * S - r * 0.38, r * 0.22, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(255, 205, 210, 0.55)'
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.anisotropy = 4
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Soft radial contact shadow texture for the under-die blob. */
function makeShadowTexture(): THREE.CanvasTexture {
  const S = 128
  const canvas = document.createElement('canvas')
  canvas.width = S
  canvas.height = S
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2)
  grad.addColorStop(0, 'rgba(12, 6, 0, 0.5)')
  grad.addColorStop(0.6, 'rgba(12, 6, 0, 0.22)')
  grad.addColorStop(1, 'rgba(12, 6, 0, 0)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, S, S)
  return new THREE.CanvasTexture(canvas)
}

/** Resolve a CSS var (e.g. "var(--ldo-red)") to a paintable color. */
function resolveCssColor(color: string, root: HTMLElement | null): THREE.Color {
  const fallback = new THREE.Color('#f43f5e')
  try {
    const m = color.match(/var\(\s*(--[\w-]+)/)
    if (m) {
      const raw = getComputedStyle(root ?? document.documentElement).getPropertyValue(m[1]!).trim()
      if (raw) return new THREE.Color(raw)
    }
    if (color.startsWith('#') || color.startsWith('rgb')) return new THREE.Color(color)
  } catch {}
  return fallback
}

// ── Easing helpers ──────────────────────────────────────────────────────────
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}
/** Classic easeOutBounce — the die's landing. */
function easeOutBounce(t: number): number {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}
function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t
}

// Mutable render state shared with the rAF loop — React re-renders only carry
// phase/value/color changes in; nothing is ever re-created per frame.
type GLState = {
  phase: DicePhase
  phaseStart: number
  value: number | null
  settleFrom: THREE.Quaternion
  settleTo: THREE.Quaternion
  spin: THREE.Vector3
  accentColor: THREE.Color
  reduced: boolean
  die: THREE.Mesh | null
  accent: THREE.PointLight | null
}

export const LudoThreeDice = memo(function LudoThreeDice({
  phase,
  value,
  color,
  size = 128,
}: {
  /** The sequencer's phase — owns the whole choreography (§38). */
  phase: DicePhase
  /** The SERVER value — the only face the die ever settles on (§36/§41). */
  value: number | null
  /** Current player color (CSS var) — accents the resting glow. */
  color: string
  /** Logical canvas size in CSS px (the renderer scales by DPR internally). */
  size?: number
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const stateRef = useRef<GLState>({
    phase: 'hidden',
    phaseStart: 0,
    value: null,
    settleFrom: new THREE.Quaternion(),
    settleTo: new THREE.Quaternion(),
    spin: new THREE.Vector3(Math.PI, Math.PI * 0.7, 0),
    accentColor: new THREE.Color('#f43f5e'),
    reduced: false,
    die: null,
    accent: null,
  })

  // ── Phase/value sync into the render state (mutates, never re-creates) ───
  useEffect(() => {
    const st = stateRef.current
    const now = performance.now()
    if (st.phase !== phase) {
      st.phase = phase
      st.phaseStart = now
      if (phase === 'settling') {
        // Capture the alignment start the moment the tumble ends — the slerp
        // then finishes ON the deterministic face for the server value.
        st.settleFrom.copy(st.die?.quaternion ?? new THREE.Quaternion())
        st.settleTo.copy(quatForValue(value))
      }
      if (phase === 'entering') {
        // Randomized tumble start so consecutive rolls never look identical.
        const s = 8 + Math.random() * 7
        st.spin.set(s * (0.9 + Math.random() * 0.4), s * (0.55 + Math.random() * 0.5), s * 0.22)
      }
    }
    st.value = value
  }, [phase, value])

  // ── ONE renderer / scene / camera / mesh — mount → dispose (§45/§46) ─────
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const st = stateRef.current
    st.reduced =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // DPR capped at 1.5 (§45) — mobile never renders 4K buffers.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
    renderer.setPixelRatio(dpr)
    renderer.setSize(size, size, false)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    wrap.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 40)
    camera.position.set(0, 2.05, 4.9)
    camera.lookAt(0, 0, 0)

    // Lights: warm key from the camera side + cool fill + colored accent.
    // Tuned for the BLACK die: a touch more ambient/key so the dark body
    // keeps its glossy reads without washing out the red pips.
    scene.add(new THREE.AmbientLight(0xfff2e2, 1.15))
    const key = new THREE.DirectionalLight(0xffffff, 1.85)
    key.position.set(2.4, 4.2, 3.6)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0xbcd4ff, 0.65)
    fill.position.set(-3, 1.2, 2.5)
    scene.add(fill)
    const accent = new THREE.PointLight(0xf43f5e, 2.2, 7.5, 1.8)
    accent.position.set(0, -0.9, 2.1)
    scene.add(accent)
    accent.color.copy(st.accentColor)
    st.accent = accent

    // The die — ONE mesh, six canvas-texture faces (§36). Glossy black body:
    // low roughness + a hint of metalness gives the casino-dice sheen.
    const textures = SLOT_VALUES.map((v) => makeFaceTexture(v))
    const materials = textures.map(
      (map) => new THREE.MeshStandardMaterial({ map, roughness: 0.26, metalness: 0.12 })
    )
    const geometry = new THREE.BoxGeometry(1.55, 1.55, 1.55)
    const die = new THREE.Mesh(geometry, materials)
    die.rotation.set(
      Math.PI * (Math.random() * 2 - 1) * 0.6,
      Math.PI * (Math.random() * 2 - 1) * 0.8,
      0
    )
    scene.add(die)
    st.die = die

    // Contact shadow blob under the die.
    const shadowTex = makeShadowTexture()
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    )
    shadow.rotation.x = -Math.PI / 2
    shadow.position.y = -1.18
    scene.add(shadow)

    die.quaternion.copy(quatForValue(st.value))

    // ── The single render loop (§45): rAF-driven, skipped while hidden ─────
    let raf = 0
    let last = performance.now()
    const tmpQuat = new THREE.Quaternion()
    const totalMs = DICE_ENTER_MS + DICE_ROLL_MS + DICE_SETTLE_MS + DICE_HOLD_MS + 400
    void totalMs

    const frame = (nowMs: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (nowMs - last) / 1000)
      last = nowMs
      const p = st.phase
      if (p === 'hidden') return // battery: nothing to draw while idle

      if (st.reduced) {
        // §47 — short, non-tumbling presentation that still lands on the
        // authoritative face: soft fade at the target orientation.
        die.quaternion.slerp(quatForValue(st.value), 0.4)
        die.position.set(0, 0, 0)
        shadow.scale.setScalar(1)
      } else if (p === 'entering') {
        // Drop-in with a real bounce landing (§38 "enter").
        const k = clamp01((nowMs - st.phaseStart) / DICE_ENTER_MS)
        die.position.y = (1 - easeOutBounce(k)) * 2.35
        die.rotation.x += st.spin.x * 0.55 * dt
        die.rotation.y += st.spin.y * 0.55 * dt
        shadow.scale.setScalar(0.7 + 0.3 * easeOutCubic(k))
      } else if (p === 'rolling') {
        // Hop + fast tumble with geometric deceleration (§38/§20).
        const r = clamp01((nowMs - st.phaseStart) / DICE_ROLL_MS)
        const decay = Math.pow(1 - r, 1.55)
        die.rotation.x += st.spin.x * decay * dt
        die.rotation.y += st.spin.y * decay * dt
        die.rotation.z += st.spin.z * decay * dt
        // SMOOTH-FACE CONVERGENCE (§41 smoothness): through the FINAL 40% of
        // the tumble the die is progressively pulled toward the target
        // orientation for the SERVER value — the die visibly TURNS INTO the
        // final number (6 slowly rotates into place) instead of stopping on
        // some other face and snapping. The pull ramps up quadratically as
        // the spin decays, so motion stays fluid — never a sudden swap.
        if (r > 0.6) {
          const k = (r - 0.6) / 0.4
          const pull = 0.03 + 0.19 * k * k
          die.quaternion.slerp(quatForValue(st.value), Math.min(0.4, pull))
        }
        // Three diminishing hops while it tumbles.
        const hop = Math.abs(Math.sin(r * Math.PI * 3)) * 0.42 * (1 - r)
        die.position.y = hop
        shadow.scale.setScalar(1 - hop * 0.35)
      } else if (p === 'settling') {
        // SERVER face alignment + small landing bounce (§38/§41): slerp to
        // the deterministic orientation for the server value — the face can
        // NEVER land anywhere else.
        const k = clamp01((nowMs - st.phaseStart) / DICE_SETTLE_MS)
        const e = easeOutQuart(k)
        tmpQuat.copy(st.settleFrom).slerp(st.settleTo, e)
        die.quaternion.copy(tmpQuat)
        // Landing dip — a tiny impact bounce.
        die.position.y = -0.16 * Math.sin(Math.PI * k)
        shadow.scale.setScalar(1 + 0.08 * Math.sin(Math.PI * k))
      } else {
        // revealed / exiting — hold the authoritative face; a whisper of
        // idle float keeps it alive (the exit fade belongs to the wrapper).
        die.quaternion.slerp(quatForValue(st.value), 0.35)
        const idle = p === 'revealed' ? Math.sin((nowMs - st.phaseStart) / 520) * 0.045 : 0
        die.position.y = idle
        shadow.scale.setScalar(1 - idle * 0.3)
      }

      // Accent light breathes with the roll.
      accent.intensity = p === 'rolling' ? 2.2 + Math.sin(nowMs / 90) * 0.6 : 1.8
      renderer.render(scene, camera)
    }
    raf = requestAnimationFrame(frame)

    // Keep the pixel ratio capped if the viewport moves between screens.
    const ro = new ResizeObserver(() => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    })
    ro.observe(wrap)

    // ── Dispose EVERYTHING (§46: no WebGL memory leaks) ─────────────────────
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      geometry.dispose()
      materials.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
      shadowTex.dispose()
      shadow.geometry.dispose()
      ;(shadow.material as THREE.Material).dispose()
      renderer.dispose()
      renderer.domElement.remove()
      st.die = null
      st.accent = null
    }
    // ONE renderer per room session — size changes alone never rebuild it.
  }, [size])

  // Accent light follows the current player color — a one-light mutation,
  // never a renderer/scene re-creation.
  useEffect(() => {
    const st = stateRef.current
    st.accentColor = resolveCssColor(color, wrapRef.current)
    if (st.accent) st.accent.color.copy(st.accentColor)
  }, [color])

  const resting = phase === 'settling' || phase === 'revealed' || phase === 'exiting'

  return (
    <div
      className={`ldo-dice-gl${resting ? ' ldo-dice-gl-settled' : ''}`}
      style={{ '--ldo-dice-ring': color } as React.CSSProperties}
      ref={wrapRef}
      role="img"
      aria-label={resting ? `Dice showing ${value ?? ''}` : 'Dice rolling'}
      data-testid="ludo-dice"
    />
  )
})
