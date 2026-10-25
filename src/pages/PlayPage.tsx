import { useEffect, useRef, useState } from 'react'
import { channelName, getVideo, relatedVideos } from '../lib/api'
import { href } from '../lib/router'
import { ensurePlayUrl } from '../lib/source'
import { historyOf, rememberPlay } from '../lib/storage'
import type { VideoItem } from '../lib/types'
import { Player } from '../components/Player'
import { PosterCard } from '../components/PosterCard'

type Props = {
  id: string
  ep: number
  onLibraryChange: () => void
}

export function PlayPage({ id, ep, onLibraryChange }: Props) {
  const [item, setItem] = useState<VideoItem | undefined>(() => getVideo(id))
  const [playUrl, setPlayUrl] = useState('')
  const [lineName, setLineName] = useState('')
  const [error, setError] = useState('')
  const [pick, setPick] = useState<{ id: string; ep: number; path: string } | null>(null)
  const savedAt = useRef(0)
  const index = item && item.episodes.length ? Math.min(Math.max(ep, 0), item.episodes.length - 1) : Math.max(ep, 0)
  const episode = item?.episodes[index]
  const history = item ? historyOf(item.id) : undefined
  const resumeAt = history && history.ep === index ? history.time : 0
  const forced = pick && pick.id === id && pick.ep === index ? pick.path : ''

  useEffect(() => {
    let live = true
    setError('')
    setPlayUrl('')
    setLineName('')
    ensurePlayUrl(id, index, forced)
      .then((result) => {
        if (!live) return
        setItem(getVideo(id))
        setPlayUrl(result.url)
        setLineName(result.line)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '这一段还没到来')
      })
    return () => {
      live = false
    }
  }, [id, index, forced])

  useEffect(() => {
    if (!item) return
    rememberPlay(item.id, index, resumeAt)
    onLibraryChange()
  }, [item, index, onLibraryChange, resumeAt])

  if (error) return <div className="wrap empty">{error}</div>
  if (!item || !episode) return <div className="wrap empty">正在把这一段请到眼前…</div>

  const remember = (time: number) => {
    const now = Date.now()
    if (now - savedAt.current < 1500) return
    savedAt.current = now
    rememberPlay(item.id, index, time)
  }

  return (
    <div className="play-page">
      <div className="wrap play-layout">
        <div>
          <Player
            episode={{ ...episode, url: playUrl || episode.url }}
            resumeAt={resumeAt}
            onTime={remember}
            onEnded={() => {
              if (index < item.episodes.length - 1) {
                location.hash = href({ name: 'play', id: item.id, ep: index + 1 })
              }
            }}
          />
          <div className="play-copy">
            <p className="crumb light">
              <a href={href({ name: 'home' })}>首页</a>
              <span>/</span>
              <a href={href({ name: 'channel', channel: item.channel })}>{channelName(item.channel)}</a>
            </p>
            <h1>{item.title}</h1>
            <p>
              {[episode.title, lineName, item.year || '', item.region, item.score > 0 ? `${item.score.toFixed(1)} 分` : ''].filter(Boolean).join(' · ')}
            </p>
            <p className="detail-summary">{item.summary}</p>
          </div>
        </div>
        <aside className="ep-panel">
          {episode.lines && episode.lines.length > 1 ? (
            <>
              <div className="ep-panel-head">
                <strong>一条路</strong>
                <span>{lineName || '正在挑选'}</span>
              </div>
              <div className="ep-grid dark">
                {episode.lines.map((line) => (
                  <button
                    key={line.playPath}
                    type="button"
                    className={lineName.startsWith(line.label) ? 'on' : ''}
                    onClick={() => setPick({ id: item.id, ep: index, path: line.playPath })}
                  >
                    {line.label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
          <div className="ep-panel-head">
            <strong>选一段</strong>
            <span>
              {index + 1}/{item.episodes.length}
            </span>
          </div>
          <div className="ep-grid dark">
            {item.episodes.map((entry, entryIndex) => (
              <a key={entry.id} className={entryIndex === index ? 'on' : ''} href={href({ name: 'play', id: item.id, ep: entryIndex })}>
                {entry.title}
              </a>
            ))}
          </div>
        </aside>
      </div>
      <div className="wrap play-related">
        <section className="block">
          <div className="block-head">
            <h2>也许你也想看</h2>
          </div>
          <div className="poster-grid">
            {relatedVideos(item.id, 6).map((video) => (
              <PosterCard key={video.id} item={video} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
