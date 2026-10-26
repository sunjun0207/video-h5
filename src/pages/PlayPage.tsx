import { useEffect, useRef, useState } from 'react'
import { channelName, getVideo, relatedVideos } from '../lib/api'
import { href } from '../lib/router'
import { createDownloadControl, downloadEpisode, downloadName, qualityOf, type DownloadControl, type DownloadProgress } from '../lib/download'
import { ensurePlayUrl } from '../lib/source'
import { historyOf, rememberPlay } from '../lib/storage'
import type { VideoItem } from '../lib/types'
import { Player } from '../components/Player'
import { PosterCard } from '../components/PosterCard'
import { Pending } from '../components/Pending'

const emptyStat: DownloadProgress = { received: 0, total: 0, speed: 0, ratio: 0 }

function formatSize(bytes: number): string {
  const value = Math.max(0, Number.isFinite(bytes) ? bytes : 0)
  if (value < 1024) return `${Math.round(value)} B`
  const kb = value / 1024
  if (kb < 1024) return `${kb >= 100 ? kb.toFixed(0) : kb.toFixed(1)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb >= 100 ? mb.toFixed(1) : mb.toFixed(2)} MB`
  return `${(mb / 1024).toFixed(2)} GB`
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1024) return '0 KB/s'
  return `${formatSize(bytesPerSecond)}/s`
}

function formatPercent(ratio: number): string {
  const value = Math.min(100, Math.max(0, ratio * 100))
  if (value >= 10) return String(Math.round(value))
  if (value >= 1) return value.toFixed(1)
  if (value > 0) return value.toFixed(2)
  return '0'
}

function downloadText(phase: 'idle' | 'running' | 'paused', stat: DownloadProgress): string {
  const percent = formatPercent(stat.ratio)
  const size = stat.total > 0 ? `${formatSize(stat.received)} / ${formatSize(stat.total)}` : formatSize(stat.received)
  const head = `已下载 ${percent}% · ${size}`
  if (stat.stage === 'pack') return `正在整理成 mp4 · ${head}`
  if (phase === 'paused') return `已暂停 · ${head}`
  const speed = stat.speed >= 1024 ? formatSpeed(stat.speed) : '测速中'
  return `${head} · ${speed}`
}

type Props = {
  id: string
  ep: number
  onLibraryChange: () => void
}

export function PlayPage({ id, ep, onLibraryChange }: Props) {
  const [item, setItem] = useState<VideoItem | undefined>(() => getVideo(id))
  const [stream, setStream] = useState({ key: '', url: '', line: '' })
  const [error, setError] = useState('')
  const [pick, setPick] = useState<{ id: string; ep: number; path: string } | null>(null)
  const [saveStat, setSaveStat] = useState<DownloadProgress>(emptyStat)
  const [savePhase, setSavePhase] = useState<'idle' | 'running' | 'paused'>('idle')
  const [saveNote, setSaveNote] = useState('')
  const savedAt = useRef(0)
  const warmed = useRef('')
  const saveControl = useRef<DownloadControl | null>(null)
  const saveTicket = useRef(0)
  const index = item && item.episodes.length ? Math.min(Math.max(ep, 0), item.episodes.length - 1) : Math.max(ep, 0)
  const episode = item?.episodes[index]
  const history = item ? historyOf(item.id) : undefined
  const resumeAt = history && history.ep === index ? history.time : 0
  const forced = pick && pick.id === id && pick.ep === index ? pick.path : ''
  const streamKey = `${id}:${index}:${forced}`
  const playUrl = error ? '' : stream.key === streamKey ? stream.url : episode?.url || ''
  const lineName = stream.key === streamKey ? stream.line : episode?.line || ''

  useEffect(() => {
    let live = true
    setError('')
    ensurePlayUrl(id, index, forced)
      .then((result) => {
        if (!live) return
        setItem(getVideo(id))
        setStream({ key: streamKey, url: result.url, line: result.line })
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '这一段还没到来')
      })
    return () => {
      live = false
    }
  }, [id, index, forced, streamKey])

  useEffect(() => {
    if (!item) return
    rememberPlay(item.id, index, resumeAt)
    onLibraryChange()
  }, [item, index, onLibraryChange, resumeAt])

  useEffect(() => {
    setSavePhase('idle')
    setSaveStat(emptyStat)
    setSaveNote('')
    return () => {
      saveTicket.current += 1
      saveControl.current?.cancel()
      saveControl.current = null
    }
  }, [streamKey])

  const saveEpisode = () => {
    if (savePhase === 'running') {
      saveControl.current?.pause()
      setSavePhase('paused')
      return
    }
    if (savePhase === 'paused') {
      saveControl.current?.resume()
      setSavePhase('running')
      return
    }
    if (!playUrl || !item || !episode) return
    const control = createDownloadControl()
    const ticket = saveTicket.current + 1
    saveTicket.current = ticket
    saveControl.current = control
    setSaveNote('')
    setSaveStat(emptyStat)
    setSavePhase('running')
    const episodeName = item.episodes.length > 1 ? episode.title : ''
    downloadEpisode(playUrl, downloadName(item.title, episodeName, qualityOf(lineName)), control, (stat) => {
      if (saveTicket.current !== ticket || control.stopped) return
      setSaveStat(stat)
    })
      .then(() => {
        if (saveTicket.current !== ticket || control.stopped) return
        saveControl.current = null
        setSavePhase('idle')
        setSaveStat(emptyStat)
        setSaveNote('已经留下')
      })
      .catch((reason: unknown) => {
        if (saveTicket.current !== ticket || control.stopped) return
        saveControl.current = null
        setSavePhase('idle')
        setSaveStat(emptyStat)
        setSaveNote(reason instanceof Error ? reason.message : '暂时收不下来')
      })
  }

  if (!item || !episode) {
    if (error) return <div className="wrap empty">{error}</div>
    return (
      <div className="wrap">
        <Pending text="正在加载中" />
      </div>
    )
  }

  const remember = (time: number) => {
    const now = Date.now()
    if (now - savedAt.current < 1500) return
    savedAt.current = now
    rememberPlay(item.id, index, time)
    const warmKey = `${item.id}:${index}`
    if (time > 40 && warmed.current !== warmKey && index < item.episodes.length - 1) {
      warmed.current = warmKey
      void ensurePlayUrl(item.id, index + 1).catch(() => undefined)
    }
  }

  return (
    <div className="play-page">
      <div className="wrap play-layout">
        <div>
          <Player
            key={streamKey}
            episode={{ ...episode, url: playUrl }}
            resumeAt={playUrl ? resumeAt : 0}
            loadError={error}
            onTime={remember}
            onEnded={() => {
              if (index < item.episodes.length - 1) {
                window.location.hash = href({ name: 'play', id: item.id, ep: index + 1 })
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
            <div className="download-row">
              {savePhase === 'idle' ? null : (
                <div className="download-meter" role="status">
                  <div className="download-progress">{downloadText(savePhase, saveStat)}</div>
                  <div
                    className="download-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(100, Math.round(saveStat.ratio * 100))}
                  >
                    <span style={{ width: `${Math.min(100, saveStat.ratio * 100)}%` }} />
                  </div>
                </div>
              )}
              <button type="button" className="download-btn" disabled={savePhase === 'idle' && !playUrl} onClick={saveEpisode}>
                {savePhase === 'running' ? '暂停' : savePhase === 'paused' ? '继续下载' : '下载'}
              </button>
              {savePhase === 'idle' && saveNote ? <span>{saveNote}</span> : null}
            </div>
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
