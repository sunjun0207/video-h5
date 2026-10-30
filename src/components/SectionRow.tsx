import { useState } from 'react'
import type { VideoItem } from '../lib/types'
import { PosterCard } from './PosterCard'

type Props = {
  title: string
  desc?: string
  more?: string
  moreText?: string
  items: VideoItem[]
}

export function SectionRow({ title, desc, more, moreText = '更多精彩', items }: Props) {
  const size = 6
  const pages = Math.max(1, Math.ceil(items.length / size))
  const [page, setPage] = useState(0)
  if (!items.length) return null
  const at = page < pages ? page : 0
  const slice = items.slice(at * size, at * size + size)

  return (
    <section className="block">
      <div className="block-head">
        <div className="block-title">
          <h2>{title}</h2>
          {desc ? <p>{desc}</p> : null}
        </div>
        <div className="block-actions">
          {pages > 1 ? (
            <button type="button" className="text-btn" onClick={() => setPage((at + 1) % pages)}>
              换一批
            </button>
          ) : null}
          {more ? (
            <a className="text-btn more" href={more}>
              {moreText}
            </a>
          ) : null}
        </div>
      </div>
      <div className="poster-grid">
        {slice.map((item) => (
          <PosterCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}
