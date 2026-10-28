import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'
import { absolutePlayUrl, rewritePlaylist, upstreamFromPlay, useProxy } from '../lib/mediaProxy'
import { reportPlayback } from '../lib/playback'
import type { Episode } from '../lib/types'

type Props = {
  episode: Episode
  resumeAt: number
  loadError?: string
  onTime: (time: number) => void
  onEnded: () => void
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const total = Math.floor(value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function Player({ episode, resumeAt, loadError = '', onTime, onEnded }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const resumed = useRef(false)
  const endedRef = useRef(false)
  const endAtRef = useRef(0)
  const nativePlayback = useRef(false)
  const onEndedRef = useRef(onEnded)
  const waitTimer = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const [booting, setBooting] = useState(true)
  const [waiting, setWaiting] = useState(false)
  const [needTap, setNeedTap] = useState(false)
  onEndedRef.current = onEnded

  const finish = () => {
    if (endedRef.current) return
    endedRef.current = true
    videoRef.current?.pause()
    onEndedRef.current()
  }

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let wants = true
    const report = (event?: Event) => {
      const type = event?.type
      if (type === 'pause' || type === 'ended') wants = false
      if (type === 'play' || type === 'playing' || type === 'loadstart') wants = true
      const time = video.currentTime
      let ahead = 0
      for (let index = 0; index < video.buffered.length; index += 1) {
        if (video.buffered.start(index) <= time + 0.5 && time < video.buffered.end(index)) ahead = video.buffered.end(index) - time
      }
      reportPlayback({ playing: wants && !video.ended, ahead, stalled: !video.paused && video.readyState < 3 })
    }
    const events = ['loadstart', 'play', 'playing', 'pause', 'waiting', 'seeking', 'timeupdate', 'progress', 'ended']
    for (const name of events) video.addEventListener(name, report)
    report()
    return () => {
      for (const name of events) video.removeEventListener(name, report)
      reportPlayback({ playing: false, ahead: 0, stalled: false })
    }
  }, [])

  useEffect(() => {
    resumed.current = false
    endedRef.current = false
    endAtRef.current = 0
    nativePlayback.current = false
    setError('')
    setPlaying(false)
    setCurrent(0)
    setDuration(0)
    setNeedTap(false)
    setWaiting(false)
    setBooting(true)
    const video = videoRef.current
    if (!video || !episode.url) return
    let live = true
    let hls: Hls | undefined
    let started = false
    let starting = false
    const attachedAt = Date.now()
    const bufferedAhead = () => {
      if (!video.buffered.length) return 0
      return video.buffered.end(video.buffered.length - 1) - video.currentTime
    }
    const start = () => {
      if (!live || started || starting || endedRef.current) return
      const ahead = bufferedAhead()
      const waited = Date.now() - attachedAt
      if (ahead < 6 && waited < 10000) return
      if (video.readyState < 3 && ahead < 2 && waited < 15000) return
      starting = true
      void video.play().then(() => {
        if (!live) return
        started = true
        starting = false
        setNeedTap(false)
      }).catch((reason: unknown) => {
        if (!live) return
        starting = false
        const blocked = reason instanceof DOMException && reason.name === 'NotAllowedError'
        if (!blocked) return
        started = true
        if (!endedRef.current) setNeedTap(true)
      })
    }
    const armEnd = (seconds: number) => {
      if (Number.isFinite(seconds) && seconds > 8) endAtRef.current = seconds
    }
    if (episode.url.includes('.m3u8') && Hls.isSupported()) {
      const slow = {
        maxTimeToFirstByteMs: 20000,
        maxLoadTimeMs: 60000,
        timeoutRetry: { maxNumRetry: 4, retryDelayMs: 400, maxRetryDelayMs: 4000 },
        errorRetry: { maxNumRetry: 6, retryDelayMs: 800, maxRetryDelayMs: 8000 },
      }
      const BaseLoader = Hls.DefaultConfig.loader
      class ProxyLoader extends BaseLoader {
        load(context: any, config: any, callbacks: any) {
          const original = String(context.url)
          const upstream = upstreamFromPlay(original) || original
          if (useProxy) context.url = absolutePlayUrl(upstream)
          const onSuccess = callbacks.onSuccess
          callbacks.onSuccess = (response: { data: unknown }, stats: unknown, ctx: { url: string }, networkDetails?: XMLHttpRequest) => {
            const finalUpstream = upstreamFromPlay(networkDetails?.responseURL || ctx.url) || upstream
            if (typeof response.data === 'string' && response.data.includes('#EXTM3U')) {
              response.data = rewritePlaylist(response.data, finalUpstream)
            }
            onSuccess(response, stats, ctx, networkDetails)
          }
          super.load(context, config, callbacks)
        }
      }
      const startAt = resumeAt > 1 ? resumeAt : -1
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        capLevelToPlayerSize: true,
        startLevel: 0,
        startPosition: startAt,
        testBandwidth: true,
        abrEwmaDefaultEstimate: 900_000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.5,
        maxBufferLength: 24,
        maxMaxBufferLength: 48,
        maxBufferSize: 28 * 1000 * 1000,
        backBufferLength: 12,
        startFragPrefetch: true,
        maxBufferHole: 0.5,
        nudgeMaxRetry: 8,
        manifestLoadPolicy: { default: slow },
        playlistLoadPolicy: { default: slow },
        fragLoadPolicy: { default: slow },
        loader: ProxyLoader,
      })
      hls.autoLevelCapping = 0
      hls.loadSource(episode.url)
      hls.attachMedia(video)
      hls.on(Hls.Events.FRAG_BUFFERED, () => start())
      hls.on(Hls.Events.LEVEL_LOADED, (_, data) => {
        if (!data.details.live) armEnd(data.details.totalduration)
      })
      hls.on(Hls.Events.MEDIA_ENDED, () => finish())
      let recovers = 0
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          const level = hls?.currentLevel ?? -1
          if (hls && level > 0) hls.autoLevelCapping = level - 1
          return
        }
        if (!data.fatal || !hls) return
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR && recovers < 3) {
          recovers += 1
          hls.startLoad()
          return
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && recovers < 2) {
          recovers += 1
          hls.recoverMediaError()
          return
        }
        setError('这一段暂时安静了，换一条路，或稍后再来。')
        setBooting(false)
      })
    } else {
      nativePlayback.current = true
      video.src = episode.url
      if (resumeAt > 1) video.currentTime = resumeAt
      video.load()
    }
    const onCanPlay = () => start()
    video.addEventListener('canplay', onCanPlay)
    video.addEventListener('progress', onCanPlay)
    return () => {
      live = false
      window.clearTimeout(waitTimer.current)
      video.removeEventListener('canplay', onCanPlay)
      video.removeEventListener('progress', onCanPlay)
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [episode.url, resumeAt])

  const toggle = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      endedRef.current = false
      void video.play().catch(() => setError('这一段暂时安静了，换一段试试。'))
    } else video.pause()
  }

  const seek = (value: number) => {
    const video = videoRef.current
    if (!video) return
    if (endAtRef.current > 8 && value < endAtRef.current - 1) endedRef.current = false
    video.currentTime = value
    setCurrent(value)
    onTime(value)
  }

  const fullscreen = () => {
    const stage = stageRef.current
    if (!stage) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void stage.requestFullscreen().catch(() => undefined)
  }

  const message = loadError || error
  const showPlay = !message && (needTap || (!booting && !waiting && !playing))

  return (
    <div className="stage" ref={stageRef}>
      <video
        ref={videoRef}
        playsInline
        autoPlay
        preload="auto"
        onPlay={() => {
          window.clearTimeout(waitTimer.current)
          setPlaying(true)
          setBooting(false)
          setWaiting(false)
          setNeedTap(false)
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => {
          window.clearTimeout(waitTimer.current)
          waitTimer.current = window.setTimeout(() => setWaiting(true), 350)
        }}
        onPlaying={() => {
          window.clearTimeout(waitTimer.current)
          setPlaying(true)
          setBooting(false)
          setWaiting(false)
        }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget
          const time = video.currentTime
          setCurrent(time)
          onTime(time)
          const endAt = endAtRef.current
          if (endAt > 8 && time >= endAt - 0.35) finish()
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget
          const length = video.duration || 0
          setDuration(length)
          if (nativePlayback.current && Number.isFinite(length) && length > 8) endAtRef.current = length
          if (nativePlayback.current && !resumed.current && resumeAt > 1 && length > resumeAt + 3) {
            video.currentTime = resumeAt
            resumed.current = true
          }
        }}
        onEnded={finish}
        onError={() => {
          if (episode.url) {
            setError('画面没有回应。换一段，或稍后再来。')
            setBooting(false)
          }
        }}
        onClick={toggle}
      />
      {message ? <div className="stage-error">{message}</div> : null}
      {!message && (booting || waiting) && !needTap ? (
        <div className="stage-loading" role="status">
          <span className="stage-spinner" aria-hidden />
          <p>{booting ? '正在加载中' : '正在缓冲…'}</p>
        </div>
      ) : null}
      {showPlay ? (
        <button type="button" className="stage-center" onClick={toggle} aria-label="播放">
          ▶
        </button>
      ) : null}
      <div className="controls">
        <button type="button" onClick={toggle} aria-label={playing ? '暂停' : '播放'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="time">{formatTime(current)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(current, duration || 0)}
          aria-label="进度"
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span className="time">{formatTime(duration)}</span>
        <button type="button" onClick={fullscreen} aria-label="全屏">
          全屏
        </button>
      </div>
    </div>
  )
}
