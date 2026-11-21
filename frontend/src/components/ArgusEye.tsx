import { useEffect, useId, useRef, useState } from 'react'

export type EyeMood = 'calm' | 'problem' | 'investigating'

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Argus' eye next to the wordmark: almond outline, round iris, pupil. Pure SVG + CSS, driven by the status sentence.
// Calm: mint, a slow blink every 6–8 s. Problem: pink, looking toward the issue card (right). Investigating: the iris
// ring turns slowly. Back to calm (resolved): mint with one blink. Reduced motion: colour only.
export default function ArgusEye({ mood }: { mood: EyeMood }) {
  const clip = useId()
  const [blink, setBlink] = useState(false)
  const prev = useRef(mood)
  const still = reducedMotion()

  const doBlink = () => {
    setBlink(true)
    window.setTimeout(() => setBlink(false), 200)
  }

  // Idle blink with jitter while calm.
  useEffect(() => {
    if (still || mood !== 'calm') return
    let t: number
    const next = () => (t = window.setTimeout(() => (doBlink(), next()), 6000 + Math.random() * 2000))
    next()
    return () => window.clearTimeout(t)
  }, [mood, still])

  // Resolved: one blink when coming back to calm.
  useEffect(() => {
    if (prev.current !== 'calm' && mood === 'calm' && !still) doBlink()
    prev.current = mood
  }, [mood, still])

  const color = mood === 'problem' ? 'var(--color-problem)' : 'var(--color-ok)'
  const look = mood === 'problem' && !still ? 'translate(2.6px, 0.6px)' : 'translate(0, 0)'
  return (
    <svg
      className={`argus-eye${blink ? ' argus-eye--blink' : ''}${mood === 'investigating' ? ' argus-eye--scan' : ''}`}
      viewBox="0 0 36 22"
      width={36}
      height={22}
      role="img"
      aria-label={mood === 'problem' ? 'Argus: needs attention' : mood === 'investigating' ? 'Argus: checking' : 'Argus: all calm'}
    >
      <defs>
        <clipPath id={clip}>
          <path d="M2 11 Q18 -2.5 34 11 Q18 24.5 2 11 Z" />
        </clipPath>
      </defs>
      <g className="argus-eye__lid">
        <g clipPath={`url(#${clip})`}>
          <g className="argus-eye__iris" style={{ transform: look }}>
            <circle cx="18" cy="11" r="5.4" style={{ fill: color }} opacity="0.22" />
            <circle className="argus-eye__ring" cx="18" cy="11" r="5.4" fill="none" strokeWidth="1.5" style={{ stroke: color }} />
            <circle cx="18" cy="11" r="2.1" style={{ fill: color }} />
          </g>
        </g>
        <path d="M2 11 Q18 -2.5 34 11 Q18 24.5 2 11 Z" fill="none" stroke="var(--color-fg-2)" strokeOpacity="0.7" strokeWidth="1.3" strokeLinejoin="round" />
      </g>
    </svg>
  )
}
