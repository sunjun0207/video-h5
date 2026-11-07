import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { getVideo } from '../lib/api'
import { ensureDetail } from '../lib/source'
import { getHistory, isFavorite, toggleFavorite } from '../lib/storage'
import type { VideoItem } from '../lib/types'

type Tab = 'now' | 'recent'

type Props = {
  open: boolean
  videoId: string
  ep: number
  onClose: () => void
  onPick: (id: string, ep: number) => void
}

function formatClock(value: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function PlayQueueSheet({ open, videoId, ep, onClose, onPick }: Props) {
  const [tab, setTab] = useState<Tab>('now')
  const [revision, setRevision] = useState(0)
  const video = getVideo(videoId)
  const history = getHistory()
  void revision

  useEffect(() => {
    const onFavorites = () => setRevision((value) => value + 1)
    window.addEventListener('video-h5-favorites', onFavorites)
    return () => window.removeEventListener('video-h5-favorites', onFavorites)
  }, [])

  useEffect(() => {
    if (!open) return
    setTab('now')
    let live = true
    const missing = getHistory().filter((entry) => !getVideo(entry.id)?.title).map((entry) => entry.id)
    Promise.all(missing.map((id) => ensureDetail(id).catch(() => undefined))).then(() => {
      if (live) setRevision((value) => value + 1)
    })
    return () => {
      live = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const frame = window.requestAnimationFrame(() => {
      document.querySelector('.queue-list .queue-row.on')?.scrollIntoView({ block: 'nearest' })
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.cancelAnimationFrame(frame)
    }
  }, [open, onClose, tab])

  if (!open) return null

  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="sheet queue-sheet" role="dialog" aria-label="播放列表" onClick={(event) => event.stopPropagation()}>
        <div className="queue-head">
          <h3>播放列表</h3>
          <button type="button" className="queue-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="queue-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'now'} className={tab === 'now' ? 'queue-tab on' : 'queue-tab'} onClick={() => setTab('now')}>
            当前播放
            <span>{video?.episodes.length ?? 0}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'recent'}
            className={tab === 'recent' ? 'queue-tab on' : 'queue-tab'}
            onClick={() => setTab('recent')}
          >
            最近播放
            <span>{history.length}</span>
          </button>
        </div>
        <div className="queue-list">
          {tab === 'now' ? <NowList video={video} ep={ep} onPick={onPick} /> : <RecentList videoId={videoId} ep={ep} onPick={onPick} />}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function NowList({ video, ep, onPick }: { video: VideoItem | undefined; ep: number; onPick: (id: string, ep: number) => void }) {
  if (!video || video.episodes.length === 0) return <div className="empty">还没有正在播放的内容</div>
  return video.episodes.map((episode, index) => (
    <QueueRow
      key={episode.id}
      current={index === ep}
      index={index + 1}
      title={episode.title}
      subtitle={subtitleOf(video.title, episode.title)}
      favorite={isFavorite(video.id)}
      onOpen={() => onPick(video.id, index)}
      onFavorite={() => toggleFavorite(video.id)}
    />
  ))
}

function RecentList({ videoId, ep, onPick }: { videoId: string; ep: number; onPick: (id: string, ep: number) => void }) {
  const history = getHistory()
  if (history.length === 0) return <div className="empty">还没有最近播放</div>
  return history.map((entry) => {
    const video = getVideo(entry.id)
    const episode = video?.episodes[entry.ep]
    const title = video?.title || '这部片子'
    const part = episode?.title || `第 ${entry.ep + 1} 集`
    const current = entry.id === videoId && entry.ep === ep
    return (
      <QueueRow
        key={entry.id}
        current={current}
        index={entry.ep + 1}
        title={title}
        subtitle={`${part} · ${formatClock(entry.time)}`}
        favorite={isFavorite(entry.id)}
        onOpen={() => onPick(entry.id, entry.ep)}
        onFavorite={() => toggleFavorite(entry.id)}
      />
    )
  })
}

function subtitleOf(show: string, episode: string) {
  return episode && episode !== show ? show : '正片'
}

function QueueRow({
  current,
  index,
  title,
  subtitle,
  favorite,
  onOpen,
  onFavorite,
}: {
  current: boolean
  index: number
  title: string
  subtitle: string
  favorite: boolean
  onOpen: () => void
  onFavorite: () => void
}) {
  return (
    <div className={current ? 'queue-row on' : 'queue-row'}>
      <button type="button" className="queue-open" onClick={onOpen}>
        <span className="queue-index">{index}</span>
        <span className="queue-main">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
      </button>
      <button
        type="button"
        className={favorite ? 'queue-heart is-on' : 'queue-heart'}
        aria-label={favorite ? '取消收藏' : '收藏'}
        aria-pressed={favorite}
        onClick={onFavorite}
      >
        <HeartIcon solid={favorite} />
      </button>
    </div>
  )
}

function HeartIcon({ solid }: { solid: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path
        d="M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9Z"
        fill={solid ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  )
}
