import { useEffect, useState } from 'react'
import { channelName, getVideo, relatedVideos } from '../lib/api'
import { href } from '../lib/router'
import { ensureDetail } from '../lib/source'
import { isFavorite, toggleFavorite } from '../lib/storage'
import type { VideoItem } from '../lib/types'
import { Cover } from '../components/Cover'
import { PosterCard } from '../components/PosterCard'

type Props = {
  id: string
  libraryVersion: number
  onLibraryChange: () => void
}

export function DetailPage({ id, libraryVersion, onLibraryChange }: Props) {
  const [item, setItem] = useState<VideoItem | undefined>(() => getVideo(id))
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setError('')
    setItem(getVideo(id))
    ensureDetail(id)
      .then((video) => {
        if (live) setItem(video)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '没有找到这部片子')
      })
    return () => {
      live = false
    }
  }, [id])

  if (error) return <div className="wrap empty">{error}</div>
  if (!item) return <div className="wrap empty">故事还在路上…</div>
  const saved = isFavorite(item.id)
  void libraryVersion

  return (
    <div className="page">
      <div className="wrap">
        <p className="crumb">
          <a href={href({ name: 'home' })}>首页</a>
          <span>/</span>
          <a href={href({ name: 'channel', channel: item.channel })}>{channelName(item.channel)}</a>
          <span>/</span>
          <em>{item.title}</em>
        </p>
        <section className="detail">
          <div className="detail-poster" style={{ background: `linear-gradient(160deg, ${item.tone[0]}, ${item.tone[1]})` }}>
            {item.cover ? <Cover src={item.cover} /> : <i>{item.mark}</i>}
          </div>
          <div className="detail-copy">
            <h1>{item.title}</h1>
            <p className="detail-score">
              <strong>{item.score > 0 ? item.score.toFixed(1) : '--'}</strong>
              <span>分</span>
              <em>{item.updateText}</em>
            </p>
            <p className="detail-line">
              {item.year} · {item.region} · {item.genres.join(' / ')}
            </p>
            <p className="detail-line">导演：{item.director}</p>
            <p className="detail-line">演职员：{item.actors.join('、')}</p>
            <p className="detail-summary">{item.summary}</p>
            <div className="detail-actions">
              <a className="btn-play" href={href({ name: 'play', id: item.id, ep: 0 })}>
                开始观看
              </a>
              <button
                type="button"
                className={saved ? 'btn-ghost on' : 'btn-ghost'}
                onClick={() => {
                  toggleFavorite(item.id)
                  onLibraryChange()
                }}
              >
                {saved ? '已留下' : '留下它'}
              </button>
            </div>
          </div>
        </section>
        <section className="block">
          <div className="block-head">
            <h2>选一段</h2>
            <span className="muted">{item.episodes.length} 集</span>
          </div>
          <div className="ep-grid">
            {item.episodes.map((episode, index) => (
              <a key={episode.id} href={href({ name: 'play', id: item.id, ep: index })}>
                {episode.title}
              </a>
            ))}
          </div>
        </section>
        <section className="block">
          <div className="block-head">
            <h2>也许你也想看</h2>
          </div>
          <div className="poster-grid">
            {relatedVideos(item.id).map((video) => (
              <PosterCard key={video.id} item={video} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
