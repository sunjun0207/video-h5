import { useEffect, useRef, useState } from 'react'
import Hls, { type XhrLoader } from 'hls.js'
import { cleanAds } from '../lib/adScan'
import { absolutePlayUrl, rewritePlaylist, takePlaylist, upstreamFromPlay, useProxy } from '../lib/mediaProxy'
import { reportPlayback } from '../lib/playback'
import { createPrefetcher } from '../lib/prefetch'
import type { Episode } from '../lib/types'

/** 正在拉的分片之外，最多再提前并行拉几个。 */
const PREFETCH_AHEAD = 3
/** 缓冲不到这么多秒时只多拉一个，带宽先给眼下要用的分片。 */
const PREFETCH_DEEP_AT = 10
/** 开播这么久还一点画面都没缓冲上，就当这条线路连不上。探线路时它刚下得动，正常的线路用不了这么久。 */
const START_LIMIT = 20_000

type Props = {
  episode: Episode
  resumeAt: number
  loadError?: string
  onTime: (time: number) => void
  onEnded: () => void
  /** 这条线路开不了播时调用。返回 true 表示页面去换线路，播放器就不再报错。 */
  onStartFail?: () => boolean
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const total = Math.floor(value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function Player({ episode, resumeAt, loadError = '', onTime, onEnded, onStartFail }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const resumed = useRef(false)
  const endedRef = useRef(false)
  const endAtRef = useRef(0)
  const nativePlayback = useRef(false)
  const onEndedRef = useRef(onEnded)
  const onStartFailRef = useRef(onStartFail)
  /** 还没缓冲上画面时放弃这条线路，交给页面换。每个地址只放弃一次，返回页面换没换。 */
  const giveUpRef = useRef<() => boolean>(() => false)
  const waitTimer = useRef(0)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState('')
  const [booting, setBooting] = useState(true)
  const [waiting, setWaiting] = useState(false)
  const [needTap, setNeedTap] = useState(false)
  onEndedRef.current = onEnded
  onStartFailRef.current = onStartFail

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
    let gaveUp = false
    giveUpRef.current = () => {
      if (gaveUp || video.buffered.length) return false
      gaveUp = true
      return onStartFailRef.current?.() ?? false
    }
    const startTimer = window.setTimeout(() => giveUpRef.current(), START_LIMIT)
    const attachedAt = Date.now()
    const bufferedAhead = () => {
      if (!video.buffered.length) return 0
      return video.buffered.end(video.buffered.length - 1) - video.currentTime
    }
    const start = () => {
      if (!live || started || starting || endedRef.current) return
      const ahead = bufferedAhead()
      const waited = Date.now() - attachedAt
      if (ahead < 4 && waited < 10000) return
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
      const prefetch = createPrefetcher(PREFETCH_AHEAD, useProxy ? 'same-origin' : 'omit')
      /** 每档清晰度的分片地址，按 sn 排；预取靠它知道接下来是哪几个。 */
      const tracks = new Map<string, { startSN: number; urls: string[] }>()
      /** 第一个分片到了才开始预取，起播时带宽先给它。 */
      let primed = false
      const BaseLoader = Hls.DefaultConfig.loader as unknown as typeof XhrLoader
      class ProxyLoader extends BaseLoader {
        /** 还在等的异步步骤（预置列表、去广告、预取的分片），中止时调用。 */
        private release: (() => void) | null = null
        load(context: any, config: any, callbacks: any) {
          const original = String(context.url)
          const upstream = upstreamFromPlay(original) || original
          if (useProxy) context.url = absolutePlayUrl(upstream)
          if (context.type === 'media-fragment') {
            this.loadFragment(original, context, config, callbacks)
            return
          }
          const onSuccess = callbacks.onSuccess
          callbacks.onSuccess = (response: { data: unknown }, stats: unknown, ctx: { url: string }, networkDetails?: XMLHttpRequest | null) => {
            const data = response.data
            if (typeof data !== 'string' || !data.includes('#EXTM3U')) {
              onSuccess(response, stats, ctx, networkDetails)
              return
            }
            const finalUpstream = upstreamFromPlay(networkDetails?.responseURL || ctx.url) || upstream
            let waiting = true
            this.release = () => {
              waiting = false
            }
            void cleanAds(data, finalUpstream).then((cleaned) => {
              if (!waiting) return
              this.release = null
              onSuccess({ ...response, data: rewritePlaylist(cleaned, finalUpstream) }, stats, ctx, networkDetails)
            })
          }
          const seeded = context.type === 'manifest' || context.type === 'level' ? takePlaylist(upstream) : null
          if (!seeded) {
            super.load(context, config, callbacks)
            return
          }
          const stats = this.stats
          stats.loading.start = stats.loading.first = stats.loading.end = self.performance.now()
          stats.loaded = stats.total = seeded.length
          this.context = context
          this.config = config
          this.callbacks = callbacks
          const timer = window.setTimeout(() => {
            callbacks.onSuccess({ url: context.url, data: seeded, code: 200 }, stats, context, null)
          }, 0)
          this.release = () => window.clearTimeout(timer)
        }
        /** 已经预取的分片直接交给 hls.js；预取迟迟没回应就照常重新请求。 */
        private loadFragment(original: string, context: any, config: any, callbacks: any) {
          const frag = context.frag
          const plain = !context.rangeEnd && !context.resetIV && typeof frag.sn === 'number'
          const entry = plain ? prefetch.take(original) : undefined
          const track = tracks.get(`${frag.type}:${frag.level}`)
          if (plain && track && primed) {
            prefetch.plan(track.urls, frag.sn - track.startSN + 1, bufferedAhead() >= PREFETCH_DEEP_AT ? PREFETCH_AHEAD : 1)
          }
          if (!entry) {
            super.load(context, config, callbacks)
            return
          }
          const stats = this.stats
          stats.loading.start = self.performance.now()
          this.context = context
          this.config = config
          this.callbacks = callbacks
          const policy = config.loadPolicy
          let timer = 0
          const release = () => {
            window.clearTimeout(timer)
            this.release = null
            entry.controller.abort()
          }
          const fallback = () => {
            if (this.release !== release) return
            release()
            stats.loading.start = 0
            super.load(context, config, callbacks)
          }
          const watch = () => {
            if (entry.endAt) return
            const age = self.performance.now() - entry.startedAt
            if ((!entry.firstAt && age >= policy.maxTimeToFirstByteMs) || age >= policy.maxLoadTimeMs) fallback()
            else timer = window.setTimeout(watch, 1000)
          }
          this.release = release
          watch()
          entry.promise.then((data) => {
            if (this.release !== release) return
            window.clearTimeout(timer)
            this.release = null
            stats.loading.first = Math.max(entry.firstAt, stats.loading.start)
            stats.loading.end = Math.max(self.performance.now(), stats.loading.first)
            stats.loaded = stats.total = data.byteLength
            stats.bwEstimate = (stats.total * 8000) / Math.max(1, stats.loading.end - stats.loading.first)
            callbacks.onSuccess({ url: context.url, data, code: 200 }, stats, context, null)
          }, fallback)
        }
        abort() {
          this.release?.()
          super.abort()
        }
        destroy() {
          this.release?.()
          super.destroy()
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
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        maxBufferSize: 60 * 1000 * 1000,
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
        const { details } = data
        if (!details.live) armEnd(details.totalduration)
        if (details.fragments.some((frag) => frag.byteRange.length)) tracks.delete(`main:${data.level}`)
        else tracks.set(`main:${data.level}`, { startSN: details.startSN, urls: details.fragments.map((frag) => frag.url) })
      })
      hls.once(Hls.Events.FRAG_LOADED, () => {
        primed = true
      })
      hls.on(Hls.Events.DESTROYING, () => prefetch.clear())
      hls.on(Hls.Events.MEDIA_ENDED, () => finish())
      let recovers = 0
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          const level = hls?.currentLevel ?? -1
          if (hls && level > 0) hls.autoLevelCapping = level - 1
          return
        }
        if (!data.fatal || !hls) return
        if (giveUpRef.current()) return
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
        setError('播放遇到一点问题，换条线路或稍后再试试')
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
      window.clearTimeout(startTimer)
      giveUpRef.current = () => false
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
      void video.play().catch(() => setError('播放遇到一点问题，换个方式再试试'))
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
          // 换线路拆掉旧画面时也会触发一次、位置归零。还没有画面就不记进度，免得冲掉续播位置。
          if (video.readyState > 0) onTime(time)
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
          if (episode.url && !giveUpRef.current()) {
            setError('播放遇到一点问题，换个方式再试试')
            setBooting(false)
          }
        }}
        onClick={toggle}
      />
      {message ? <div className="stage-error">{message}</div> : null}
      {!message && (booting || waiting) && !needTap ? (
        <div className="stage-loading" role="status">
          <span className="stage-spinner" aria-hidden />
          <p>{booting ? '正在为你加载精彩内容…' : '正在缓冲…'}</p>
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
