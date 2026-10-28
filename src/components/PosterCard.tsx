import { useEffect, useRef } from 'react'
import { Cover } from './Cover'
import type { VideoItem } from '../lib/types'
import { href } from '../lib/router'
import { warmDetail } from '../lib/source'

/** 鼠标在卡片上停这么久才预先拉详情，划过去的不算。 */
const HOVER_WARM_MS = 150

type Props = {
  item: VideoItem
  anchorId?: string
  marked?: boolean
  onOpen?: () => void
}

export function PosterCard({ item, anchorId, marked, onOpen }: Props) {
  const hoverTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(hoverTimer.current), [])

  return (
    <a
      id={anchorId}
      className={marked ? 'poster spot' : 'poster'}
      href={href({ name: 'detail', id: item.id })}
      onClick={onOpen}
      onPointerEnter={(event) => {
        if (event.pointerType !== 'mouse') return
        window.clearTimeout(hoverTimer.current)
        hoverTimer.current = window.setTimeout(() => warmDetail(item.id), HOVER_WARM_MS)
      }}
      onPointerLeave={() => window.clearTimeout(hoverTimer.current)}
      onFocus={() => warmDetail(item.id)}
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
