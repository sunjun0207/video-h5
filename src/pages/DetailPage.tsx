import { useEffect, useState } from 'react'
import { channelName, getVideo, relatedVideos } from '../lib/api'
import { href } from '../lib/router'
import { ensureDetail, ensurePlayUrl, useVideos } from '../lib/source'
import { historyOf, isFavorite, toggleFavorite } from '../lib/storage'
import { Cover } from '../components/Cover'
import { PosterCard } from '../components/PosterCard'
import { Pending } from '../components/Pending'

/** 在详情页停留这么久，就先替第一集挑好线路。 */
const PLAY_WARM_MS = 600

type Props = {
  id: string
  libraryVersion: number
  onLibraryChange: () => void
  onBack: () => void
}

export function DetailPage({ id, libraryVersion, onLibraryChange, onBack }: Props) {
  useVideos()
  const item = getVideo(id)
  const [error, setError] = useState('')
  const [settled, setSettled] = useState(false)
  const hasEpisodes = Boolean(item?.episodes.length)

  useEffect(() => {
    let live = true
    setError('')
    setSettled(false)
    ensureDetail(id)
      .then(() => {
        if (live) setSettled(true)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '没有找到相关内容')
      })
    return () => {
      live = false
    }
  }, [id])

  useEffect(() => {
    if (!hasEpisodes) return
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
    const timer = window.setTimeout(() => {
      void ensurePlayUrl(id, 0).catch(() => undefined)
    }, PLAY_WARM_MS)
    return () => window.clearTimeout(timer)
  }, [id, hasEpisodes])

  if (!item && error) {
    return (
      <div className="wrap empty">
        <button type="button" className="detail-back" aria-label="返回" onClick={onBack}>
          <BackGlyph />
        </button>
        <p>{error}</p>
      </div>
    )
  }
  if (!item) {
    return (
      <div className="wrap">
        <button type="button" className="detail-back" aria-label="返回" onClick={onBack}>
          <BackGlyph />
        </button>
        <Pending text="正在为你加载精彩内容…" />
      </div>
    )
  }
  const saved = isFavorite(item.id)
  const last = historyOf(item.id)
  const resumeEp = last && last.ep < item.episodes.length ? last.ep : -1
  void libraryVersion

  return (
    <div className="page">
      <div className="wrap">
        <p className="crumb">
          <button type="button" className="detail-back" aria-label="返回" onClick={onBack}>
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M14.2 6.2 8 12l6.2 5.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <a href={href({ name: 'home' })}>首页</a>
          <span>/</span>
          {item.guessed ? null : (
            <>
              <a href={href({ name: 'channel', channel: item.channel })}>{channelName(item.channel)}</a>
              <span>/</span>
            </>
          )}
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
              {item.episodes.length > 0 ? (
                <a className="btn-play" href={href({ name: 'play', id: item.id, ep: Math.max(resumeEp, 0) })}>
                  {resumeEp >= 0 ? '接着看，精彩别错过' : '立即观看'}
                </a>
              ) : (
                <p className="detail-line">{settled || error ? error || '没有找到可播放的资源' : '正在确认能不能播放…'}</p>
              )}
              <button
                type="button"
                className={saved ? 'btn-ghost on' : 'btn-ghost'}
                onClick={() => {
                  toggleFavorite(item.id)
                  onLibraryChange()
                }}
              >
                {saved ? '已收藏' : '收下这份精彩'}
              </button>
            </div>
          </div>
        </section>
        <section className="block">
          <div className="block-head">
            <h2>选集</h2>
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
            <div className="block-title">
              <h2>猜你喜欢</h2>
              <p>懂你的喜好，推荐你的精彩</p>
            </div>
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

function BackGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M14.2 6.2 8 12l6.2 5.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
