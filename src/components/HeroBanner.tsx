import { useEffect, useState } from 'react'
import { nextCover } from '../lib/mediaProxy'
import { href } from '../lib/router'
import type { VideoItem } from '../lib/types'

type Props = {
  items: VideoItem[]
}

export function HeroBanner({ items }: Props) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const count = items.length
  const current = items[index] ?? items[0]
  const [cover, setCover] = useState(current?.cover || '')

  useEffect(() => {
    const initial = current?.cover || ''
    setCover(initial)
    if (!initial) return
    const image = new Image()
    image.onerror = () => {
      const next = nextCover(image.src)
      if (!next || next === image.src) {
        setCover('')
        return
      }
      image.src = next
      setCover(next)
    }
    image.src = initial
  }, [current?.cover])

  useEffect(() => {
    if (paused || count < 2) return
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), 5000)
    return () => window.clearInterval(timer)
  }, [paused, count])

  if (!current) return null

  return (
    <section
      className="hero"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="hero-stage"
        style={{
          backgroundImage: cover
            ? `linear-gradient(180deg, rgba(14,8,28,.04) 0%, rgba(14,8,28,.42) 46%, rgba(14,8,28,.94) 100%), linear-gradient(115deg, rgba(139,92,246,.32), transparent 62%), url(${cover})`
            : `linear-gradient(115deg, ${current.tone[0]} 0%, ${current.tone[1]} 78%)`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <span className="hero-kicker">{current.badge ?? current.updateText}</span>
        <strong>{current.title}</strong>
        <p>{current.summary}</p>
        <span className="hero-facts">
          {[current.score > 0 ? `${current.score.toFixed(1)} 分` : '', current.year || '', current.region, current.genres.join(' / ')]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="hero-actions">
          <a className="btn-play" href={href({ name: 'play', id: current.id, ep: 0 })}>
            立即观看
          </a>
          <a className="btn-ghost" href={href({ name: 'detail', id: current.id })}>
            马上探索
          </a>
        </span>
        <div className="hero-dots" role="tablist" aria-label="精彩推荐">
          {items.map((item, dot) => (
            <button
              key={item.id}
              type="button"
              className={dot === index ? 'on' : ''}
              aria-label={item.title}
              onClick={() => setIndex(dot)}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
