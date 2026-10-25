import { Cover } from './Cover'
import type { VideoItem } from '../lib/types'
import { href } from '../lib/router'

type Props = {
  item: VideoItem
  anchorId?: string
  marked?: boolean
  onOpen?: () => void
}

export function PosterCard({ item, anchorId, marked, onOpen }: Props) {
  return (
    <a
      id={anchorId}
      className={marked ? 'poster spot' : 'poster'}
      href={href({ name: 'detail', id: item.id })}
      onClick={onOpen}
    >
      <span className="poster-art" style={{ background: `linear-gradient(155deg, ${item.tone[0]}, ${item.tone[1]})` }}>
        {item.cover ? <Cover src={item.cover} /> : <i>{item.mark}</i>}
        {item.badge ? <em className="poster-badge">{item.badge}</em> : null}
        <span className="poster-ep">{item.updateText}</span>
        <span className="poster-play" aria-hidden>
          ▶
        </span>
      </span>
      <span className="poster-name">{item.title}</span>
      <span className="poster-meta">
        <span>{item.actors[0]}</span>
        <em>{item.score > 0 ? item.score.toFixed(1) : ''}</em>
      </span>
    </a>
  )
}
