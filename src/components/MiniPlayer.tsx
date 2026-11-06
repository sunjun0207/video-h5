import { useEffect, useState } from 'react'
import { getVideo } from '../lib/api'
import { playbackNow, subscribePlayback, togglePlayback } from '../lib/playbackSession'
import { Cover } from './Cover'

type Props = {
  id: string
  ep: number
  onOpen: () => void
  onQueue: () => void
  onClose: () => void
}

const RING = 2 * Math.PI * 17

export function MiniPlayer({ id, ep, onOpen, onQueue, onClose }: Props) {
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribePlayback(() => setRevision((value) => value + 1)), [])
  void revision
  const now = playbackNow()
  const video = getVideo(now?.id === id ? now.id : id)
  const episode = video?.episodes[now?.id === id ? now.ep : ep]
  const title = now?.title || video?.title || '正在播放'
  const subtitle = now?.subtitle || episode?.title || `第 ${ep + 1} 集`
  const cover = now?.cover || video?.cover
  const mark = now?.mark || video?.mark || ''
  const tone = now?.tone || video?.tone || (['#7c3aed', '#db2777'] as [string, string])
  const playing = now?.id === id && now.playing
  const progress = now && now.id === id && now.duration > 0 ? Math.min(1, Math.max(0, now.current / now.duration)) : 0

  return (
    <div className="mini-player" role="button" tabIndex={0} aria-label={`回到播放：${title}`} onClick={onOpen}>
      <span className="mini-cover" style={{ background: `linear-gradient(160deg, ${tone[0]}, ${tone[1]})` }}>
        {cover ? <Cover src={cover} /> : <i>{mark}</i>}
      </span>
      <span className="mini-meta">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <button
        type="button"
        className="mini-btn mini-toggle"
        aria-label={playing ? '暂停' : '继续播放'}
        onClick={(event) => {
          event.stopPropagation()
          togglePlayback()
        }}
      >
        <svg className="mini-ring" viewBox="0 0 40 40" aria-hidden>
          <circle cx="20" cy="20" r="17" />
          <circle cx="20" cy="20" r="17" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
        </svg>
        {playing ? '❚❚' : '▶'}
      </button>
      <button
        type="button"
        className="mini-btn"
        aria-label="播放列表"
        onClick={(event) => {
          event.stopPropagation()
          onQueue()
        }}
      >
        <ListGlyph />
      </button>
      <button
        type="button"
        className="mini-btn"
        aria-label="关闭当前播放"
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
      >
        ×
      </button>
    </div>
  )
}

function ListGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 7h11M8 12h11M8 17h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}
