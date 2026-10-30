import { useEffect, useMemo, useRef, useState } from 'react'
import { channelName, getVideo, relatedVideos } from '../lib/api'
import { href } from '../lib/router'
import {
  createDownloadControl,
  downloadEpisode,
  downloadName,
  qualityOf,
  revealDownload,
  type DownloadControl,
  type DownloadProgress,
} from '../lib/download'
import { dropPlayLine, ensurePlayUrl, useVideos } from '../lib/source'
import { historyOf, rememberPlay } from '../lib/storage'
import { Player } from '../components/Player'
import { PosterCard } from '../components/PosterCard'
import { Pending } from '../components/Pending'

const emptyStat: DownloadProgress = { received: 0, total: 0, speed: 0, ratio: 0 }
/** 自动挑的线路开不了播时，一集最多自动换这么多次。 */
const MAX_SWITCH = 2

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

function folderHint(file: string): string {
  const agent = navigator.userAgent
  const mobile = /Android|iPhone|iPad|iPod/i.test(agent) || (navigator.maxTouchPoints > 1 && /Macintosh/i.test(agent))
  if (mobile) return `「${file}」已保存到下载列表，iPhone / iPad 可以在「文件」App 的「下载」文件夹里找到。`
  const keys = /Macintosh/i.test(agent) ? '⌥⌘L' : 'Ctrl+J'
  return `「${file}」已保存到下载文件夹：按 ${keys} 打开下载列表，点「在文件夹中显示」。`
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
  useVideos()
  const item = getVideo(id)
  const [stream, setStream] = useState({ key: '', url: '', line: '', path: '' })
  /** 这一集开播时连不上、已经自动换掉的线路。 */
  const [dropped, setDropped] = useState<{ key: string; paths: string[] }>({ key: '', paths: [] })
  const [error, setError] = useState('')
  const [pick, setPick] = useState<{ id: string; ep: number; path: string } | null>(null)
  const [saveStat, setSaveStat] = useState<DownloadProgress>(emptyStat)
  const [savePhase, setSavePhase] = useState<'idle' | 'running' | 'paused'>('idle')
  const [saveNote, setSaveNote] = useState('')
  const [savedFile, setSavedFile] = useState('')
  const savedAt = useRef(0)
  const warmed = useRef('')
  const saveControl = useRef<DownloadControl | null>(null)
  const saveTicket = useRef(0)
  const index = item && item.episodes.length ? Math.min(Math.max(ep, 0), item.episodes.length - 1) : Math.max(ep, 0)
  const episode = item?.episodes[index]
  const forced = pick && pick.id === id && pick.ep === index ? pick.path : ''
  const streamKey = `${id}:${index}:${forced}`
  const skipped = dropped.key === streamKey ? dropped.paths : []
  const skipKey = skipped.join('|')
  /** 只在换集、换线路时读一次续播位置。播放中每 1.5 秒会写回进度，每次渲染都重读会让播放器反复重建。 */
  const resumeAt = useMemo(() => {
    const history = historyOf(id)
    return history && history.ep === index ? history.time : 0
  }, [id, index, streamKey])
  /** 换线路时先不放旧线路的地址，免得新线路还没选好时旧线路又拉起来抢带宽。 */
  const known = forced || skipped.length ? undefined : episode
  const playUrl = error ? '' : stream.key === streamKey ? stream.url : known?.url || ''
  const lineName = stream.key === streamKey ? stream.line : known?.line || ''
  const linePath = stream.key === streamKey ? stream.path : known?.linePath || ''

  useEffect(() => {
    let live = true
    setError('')
    ensurePlayUrl(id, index, forced, skipKey ? skipKey.split('|') : [])
      .then((result) => {
        if (live) setStream({ key: streamKey, url: result.url, line: result.line, path: result.playPath })
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '播放遇到一点问题，换个方式再试试')
      })
    return () => {
      live = false
    }
  }, [id, index, forced, streamKey, skipKey])

  const itemId = item?.id
  useEffect(() => {
    if (!itemId) return
    rememberPlay(itemId, index, resumeAt)
    onLibraryChange()
  }, [itemId, index, onLibraryChange, resumeAt])

  useEffect(() => {
    setSavePhase('idle')
    setSaveStat(emptyStat)
    setSaveNote('')
    setSavedFile('')
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
    setSavedFile('')
    setSaveStat(emptyStat)
    setSavePhase('running')
    const episodeName = item.episodes.length > 1 ? episode.title : ''
    downloadEpisode(playUrl, downloadName(item.title, episodeName, qualityOf(lineName)), control, (stat) => {
      if (saveTicket.current !== ticket || control.stopped) return
      setSaveStat(stat)
    })
      .then((file) => {
        if (saveTicket.current !== ticket || control.stopped) return
        saveControl.current = null
        setSavePhase('idle')
        setSaveStat(emptyStat)
        setSaveNote('下载完成')
        setSavedFile(file)
      })
      .catch((reason: unknown) => {
        if (saveTicket.current !== ticket || control.stopped) return
        saveControl.current = null
        setSavePhase('idle')
        setSaveStat(emptyStat)
        setSaveNote(reason instanceof Error ? reason.message : '下载遇到一点问题，请稍后再试')
      })
  }

  const openFolder = () => {
    const file = savedFile
    void revealDownload().then((shown) => {
      if (!shown) setSaveNote(folderHint(file))
    })
  }

  if (!item || !episode) {
    if (error) return <div className="wrap empty">{error}</div>
    return (
      <div className="wrap">
        <Pending text="正在为你加载精彩内容…" />
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

  /** 自动挑的线路开不了播，就记下它、另挑一条。用户点名的线路不换。 */
  const switchLine = () => {
    if (forced || !linePath || skipped.length >= MAX_SWITCH) return false
    dropPlayLine(id, index, linePath, playUrl)
    setDropped({ key: streamKey, paths: [...skipped, linePath] })
    setStream({ key: streamKey, url: '', line: '', path: '' })
    return true
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
            onStartFail={switchLine}
            onEnded={() => {
              if (index < item.episodes.length - 1) {
                window.location.hash = href({ name: 'play', id: item.id, ep: index + 1 })
              }
            }}
          />
          <div className="play-copy">
            <p className="crumb light">
              <a href={href({ name: 'home' })}>首页</a>
              {item.guessed ? null : (
                <>
                  <span>/</span>
                  <a href={href({ name: 'channel', channel: item.channel })}>{channelName(item.channel)}</a>
                </>
              )}
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
              {savePhase === 'idle' && savedFile ? (
                <button type="button" className="download-btn ghost" title={savedFile} onClick={openFolder}>
                  打开文件所在位置
                </button>
              ) : null}
              {savePhase === 'idle' && saveNote ? <span>{saveNote}</span> : null}
            </div>
            <p className="detail-summary">{item.summary}</p>
          </div>
        </div>
        <aside className="ep-panel">
          {episode.lines && episode.lines.length > 1 ? (
            <>
              <div className="ep-panel-head">
                <strong>线路</strong>
                <span>{lineName || '正在为你挑选'}</span>
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
            <strong>选集</strong>
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
            <div className="block-title">
              <h2>猜你喜欢</h2>
              <p>懂你的喜好，推荐你的精彩</p>
            </div>
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
