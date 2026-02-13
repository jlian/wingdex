import { useEffect, useRef } from 'react'

interface ConfettiProps {
  /** Fire when this becomes true */
  active: boolean
  /** Duration in ms before auto-cleanup (default 3000) */
  duration?: number
  /** Number of particles (default 80) */
  count?: number
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  rotation: number
  rotationSpeed: number
  opacity: number
  shape: 'circle' | 'rect' | 'star'
}

const COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#ef4444', // red
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
]

export function Confetti({ active, duration = 3000, count = 80 }: ConfettiProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)
  const firedRef = useRef(false)

  useEffect(() => {
    if (!active || firedRef.current) return
    firedRef.current = true

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Full viewport
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const particles: Particle[] = []
    const shapes: Particle['shape'][] = ['circle', 'rect', 'star']

    for (let i = 0; i < count; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.4,
        y: canvas.height * 0.4,
        vx: (Math.random() - 0.5) * 12,
        vy: -Math.random() * 14 - 4,
        size: Math.random() * 6 + 3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        opacity: 1,
        shape: shapes[Math.floor(Math.random() * shapes.length)],
      })
    }

    const startTime = performance.now()
    const gravity = 0.25
    const drag = 0.99

    function draw(time: number) {
      const elapsed = time - startTime
      if (elapsed > duration) {
        ctx!.clearRect(0, 0, canvas!.width, canvas!.height)
        return
      }

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height)

      const fadeStart = duration * 0.6
      const globalFade = elapsed > fadeStart
        ? 1 - (elapsed - fadeStart) / (duration - fadeStart)
        : 1

      for (const p of particles) {
        p.vy += gravity
        p.vx *= drag
        p.x += p.vx
        p.y += p.vy
        p.rotation += p.rotationSpeed
        p.opacity = globalFade

        ctx!.save()
        ctx!.translate(p.x, p.y)
        ctx!.rotate((p.rotation * Math.PI) / 180)
        ctx!.globalAlpha = p.opacity
        ctx!.fillStyle = p.color

        if (p.shape === 'circle') {
          ctx!.beginPath()
          ctx!.arc(0, 0, p.size / 2, 0, Math.PI * 2)
          ctx!.fill()
        } else if (p.shape === 'rect') {
          ctx!.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        } else {
          // star
          drawStar(ctx!, 0, 0, 5, p.size / 2, p.size / 4)
        }

        ctx!.restore()
      }

      animRef.current = requestAnimationFrame(draw)
    }

    animRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animRef.current)
    }
  }, [active, duration, count])

  // Reset when active becomes false
  useEffect(() => {
    if (!active) {
      firedRef.current = false
    }
  }, [active])

  if (!active) return null

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[100]"
      aria-hidden="true"
    />
  )
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  spikes: number,
  outerR: number, innerR: number,
) {
  let rot = (Math.PI / 2) * 3
  const step = Math.PI / spikes
  ctx.beginPath()
  ctx.moveTo(cx, cy - outerR)
  for (let i = 0; i < spikes; i++) {
    ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR)
    rot += step
    ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR)
    rot += step
  }
  ctx.lineTo(cx, cy - outerR)
  ctx.closePath()
  ctx.fill()
}
