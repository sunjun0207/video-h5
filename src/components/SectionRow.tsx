import { useState } from 'react'
import type { VideoItem } from '../lib/types'
import { PosterCard } from './PosterCard'

type Props = {
  title: string
  more?: string
  items: VideoItem[]
}

export function SectionRow({ title, more, items }: Props) {
  const size = 6
  const pages = Math.max(1, Math.ceil(items.length / size))
  const [page, setPage] = useState(0)
  const slice = items.slice(page * size, page * size + size)

  return (
    <section className="block">
      <div className="block-head">
        <h2>{title}</h2>
        <div className="block-actions">
          {pages > 1 ? (
            <button type="button" className="text-btn" onClick={() => setPage((value) => (value + 1) % pages)}>
              再换一批
            </button>
          ) : null}
          {more ? (
            <a className="text-btn" href={more}>
              再往下看
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
