'use client'

// Quicky — Spin the Bottle 2D canvas (Three.js orthographic)
// Renders a rectangular table + 12 player avatars around the edge + a bottle
// sprite. When `spinning` is true the bottle interpolates from startRotation
// to endRotation with a quintic ease-out over `duration` ms. When false, the
// scene renders once and stops the requestAnimationFrame loop.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'

export type CanvasPlayer = {
  userId: string
  seatIndex: number
  displayName: string
  avatar: string | null
  isTarget?: boolean
}

type Props = {
  players: CanvasPlayer[]
  // Bottle animation state
  startRotation: number
  endRotation: number
  duration: number
  // When true, animate from start→end. When false, jump to end instantly.
  spinning: boolean
  // When true, the bottle points at the target (status='awaiting').
  pointing?: boolean
}

// 12 seat positions matching the server-side `seatAngle` table.
const SEAT_POSITIONS: { x: number; y: number }[] = [
  { x: 0, y: -1 },  // 0 top center
  { x: -0.85, y: -0.7 },
  { x: -0.95, y: 0 },
  { x: -0.85, y: 0.7 },
  { x: -0.4, y: 1 },
  { x: 0.4, y: 1 },
  { x: 0.85, y: 0.7 },
  { x: 0.95, y: 0 },
  { x: 0.85, y: -0.7 },
  { x: 0.4, y: -0.85 },
  { x: -0.4, y: -0.85 },
  { x: 0, y: -0.5 },
]

function easeOutQuint(t: number) {
  return 1 - Math.pow(1 - t, 5)
}

// Camera framing for a given container aspect: fit the whole scene (table
// 1.6x1.0 + outer player avatars at ±0.81/±0.85 world units) so every seat
// stays visible on any screen, as large as possible.
function frameFor(aspect: number) {
  const needW = 0.95 // half-extent incl. avatar radius + margin
  const needH = 1.0
  let halfH = Math.max(needH, needW / aspect)
  let halfW = halfH * aspect
  if (halfW < needW) {
    halfW = needW
    halfH = halfW / aspect
  }
  return { halfW, halfH }
}

function makeAvatarTexture(letter: string, accent: string) {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, size, size)
  grad.addColorStop(0, accent)
  grad.addColorStop(1, '#1a1a2e')
  ctx.fillStyle = grad
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
  ctx.fill()
  // Border
  ctx.lineWidth = 6
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.stroke()
  // Initials
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 64px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(letter.toUpperCase().slice(0, 1), size / 2, size / 2 + 4)
  return new THREE.CanvasTexture(c)
}

function loadImageTexture(url: string, fallback: string): Promise<THREE.Texture> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const size = 128
      const c = document.createElement('canvas')
      c.width = c.height = size
      const ctx = c.getContext('2d')!
      // Crop to a circle
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(img, 0, 0, size, size)
      // Border ring
      ctx.lineWidth = 6
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2)
      ctx.stroke()
      resolve(new THREE.CanvasTexture(c))
    }
    img.onerror = () => resolve(makeAvatarTexture(fallback, '#FF2D55'))
    img.src = url
  })
}

function makeBottleTexture() {
  const w = 80
  const h = 280
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  // Bottle silhouette
  ctx.translate(w / 2, h / 2)
  // Body
  ctx.fillStyle = '#B8A4FF'
  ctx.beginPath()
  ctx.ellipse(0, 20, 30, 80, 0, 0, Math.PI * 2)
  ctx.fill()
  // Neck
  ctx.fillStyle = '#D4C8FF'
  ctx.fillRect(-10, -90, 20, 70)
  // Cap
  ctx.fillStyle = '#F5C570'
  ctx.fillRect(-12, -100, 24, 18)
  // Highlight stripe
  ctx.fillStyle = 'rgba(255,255,255,0.25)'
  ctx.fillRect(-22, -10, 6, 50)
  // Subtle inner shadow
  ctx.fillStyle = 'rgba(0,0,0,0.18)'
  ctx.fillRect(20, -10, 6, 50)
  return new THREE.CanvasTexture(c)
}

export function SpinBottleCanvas({ players, startRotation, endRotation, duration, spinning, pointing }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.OrthographicCamera
    bottle: THREE.Sprite
    players: THREE.Group
    targetRing: THREE.Mesh
  } | null>(null)
  const animRef = useRef<{ startTime: number; from: number; to: number; dur: number } | null>(null)
  const pointingRef = useRef<boolean>(!!pointing)
  pointingRef.current = !!pointing

  // Build scene once
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const w = el.clientWidth
    const h = el.clientHeight
    if (w === 0 || h === 0) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0f0f14')

    // Orthographic camera centred on the table.
    const aspect = w / h
    const { halfW, halfH } = frameFor(aspect)
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 0.1, 100)
    camera.position.z = 10

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h)
    el.innerHTML = ''
    el.appendChild(renderer.domElement)

    // Table rectangle (gradient texture)
    const table = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.0),
      new THREE.MeshBasicMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.95 })
    )
    table.position.set(0, 0, -1)
    scene.add(table)

    // Inner table highlight
    const innerTable = new THREE.Mesh(
      new THREE.PlaneGeometry(1.45, 0.85),
      new THREE.MeshBasicMaterial({ color: 0x25253a, transparent: true, opacity: 0.9 })
    )
    innerTable.position.set(0, 0, -0.5)
    scene.add(innerTable)

    // Bottle sprite (default 0 rotation; we rotate via setRotation below)
    const bottleTexture = makeBottleTexture()
    const bottleMat = new THREE.SpriteMaterial({ map: bottleTexture, transparent: true })
    const bottle = new THREE.Sprite(bottleMat)
    bottle.scale.set(0.18, 0.55, 1)
    bottle.position.set(0, 0, 1)
    scene.add(bottle)

    // Players group — we'll populate whenever players change
    const playersGroup = new THREE.Group()
    scene.add(playersGroup)

    // Target ring (hidden by default)
    const targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.075, 0.09, 32),
      new THREE.MeshBasicMaterial({ color: 0xff2d55, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
    )
    targetRing.visible = false
    scene.add(targetRing)

    sceneRef.current = { renderer, scene, camera, bottle, players: playersGroup, targetRing }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      renderer.dispose()
      bottleTexture.dispose()
      sceneRef.current = null
    }
  }, [])

  // Resize observer
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const s = sceneRef.current
      if (!s) return
      const w = el.clientWidth
      const h = el.clientHeight
      if (w === 0 || h === 0) return
      const { halfW, halfH } = frameFor(w / h)
      s.camera.left = -halfW
      s.camera.right = halfW
      s.camera.top = halfH
      s.camera.bottom = -halfH
      s.camera.updateProjectionMatrix()
      s.renderer.setSize(w, h)
      s.renderer.render(s.scene, s.camera)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Update players when the list changes
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    // Clear previous
    while (s.players.children.length) {
      const c = s.players.children.pop()!
      ;(c as any).material?.map?.dispose?.()
      ;(c as any).material?.dispose?.()
    }
    const ACCENTS = ['#FF2D55', '#B8A4FF', '#F5C570', '#30D158', '#5AC8FA', '#FF5E7E']
    let acc = 0
    players.forEach((p) => {
      const pos = SEAT_POSITIONS[p.seatIndex] ?? { x: 0, y: 0 }
      const mat = new THREE.SpriteMaterial({ transparent: true })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(0.18, 0.18, 1)
      sprite.position.set(pos.x * 0.85, pos.y * 0.85, 0.5)
      s.players.add(sprite)
      const accent = ACCENTS[acc++ % ACCENTS.length]
      const letter = (p.displayName ?? '?').trim()
      // Paint the initials avatar immediately (avoids a white flash while the
      // photo texture loads), then swap in the photo when ready.
      mat.map = makeAvatarTexture(letter, accent)
      mat.needsUpdate = true
      if (p.avatar) {
        loadImageTexture(p.avatar, letter).then((t) => {
          if (sprite.material instanceof THREE.SpriteMaterial) sprite.material.map = t
          sprite.material.needsUpdate = true
          // Texture arrived async — repaint the scene
          const s2 = sceneRef.current
          if (s2) s2.renderer.render(s2.scene, s2.camera)
        })
      }
    })
    // Repaint so newly added avatars are visible without waiting for a spin
    s.renderer.render(s.scene, s.camera)
  }, [players])

  // Spin animation
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (spinning) {
      animRef.current = { startTime: performance.now(), from: startRotation, to: endRotation, dur: duration }
      const tick = () => {
        const a = animRef.current
        if (!a) return
        const t = Math.min(1, (performance.now() - a.startTime) / a.dur)
        const eased = easeOutQuint(t)
        const rot = a.from + (a.to - a.from) * eased
        s.bottle.material.rotation = rot
        s.renderer.render(s.scene, s.camera)
        if (t < 1) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          // After landing, point the target ring at the chosen seat
          renderTarget(s)
          rafRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    } else {
      // Land directly at endRotation and highlight the target
      s.bottle.material.rotation = endRotation
      renderTarget(s)
      s.renderer.render(s.scene, s.camera)
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, startRotation, endRotation, duration, players])

  // Pulse the target ring while in 'awaiting'
  useEffect(() => {
    const s = sceneRef.current
    if (!s) return
    if (!pointing) {
      s.targetRing.visible = false
      s.renderer.render(s.scene, s.camera)
      return
    }
    const start = performance.now()
    const tick = () => {
      const t = (performance.now() - start) / 1000
      s.targetRing.visible = true
      s.targetRing.scale.setScalar(1 + Math.sin(t * 4) * 0.18)
      s.renderer.render(s.scene, s.camera)
      if (pointingRef.current) rafRef.current = requestAnimationFrame(tick)
      else {
        s.targetRing.visible = false
        s.renderer.render(s.scene, s.camera)
        rafRef.current = null
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [pointing])

  function renderTarget(s: NonNullable<typeof sceneRef.current>) {
    const target = players.find((p) => p.isTarget)
    if (!target) {
      s.targetRing.visible = false
      return
    }
    const pos = SEAT_POSITIONS[target.seatIndex] ?? { x: 0, y: 0 }
    s.targetRing.position.set(pos.x * 0.85, pos.y * 0.85, 0.2)
  }

  return <div ref={containerRef} className="absolute inset-0" />
}
