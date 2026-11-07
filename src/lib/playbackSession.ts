export type NowPlaying = {
  id: string
  ep: number
  title: string
  subtitle: string
  cover?: string
  /** 正在播的画面缩略图，给通知栏用。 */
  thumb?: string
  mark: string
  tone: [string, string]
  playing: boolean
  current: number
  duration: number
}

type Controls = {
  toggle: () => void
  pause: () => void
  play: () => void
  seek: (seconds: number) => void
}

type NoticeBridge = {
  update: (json: string) => void
  progress?: (positionMs: number, durationMs: number, playing: boolean) => void
  frame?: (dataUrl: string) => void
  clear: () => void
  consumeOpen?: () => string
}

let now: NowPlaying | null = null
let controls: Controls | null = null
let queued = 0
let noticeKey = ''
let noticePos = -1
let noticeDuration = -1
let sessionBound = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function publishNow(next: NowPlaying | null, immediate = false) {
  if (next && !next.thumb && now && now.id === next.id && now.ep === next.ep) next = { ...next, thumb: now.thumb }
  now = next
  if (next === null || immediate) {
    window.clearTimeout(queued)
    queued = 0
    emit()
    pushNotice(now)
    return
  }
  if (queued) return
  queued = window.setTimeout(() => {
    queued = 0
    emit()
    pushNotice(now)
  }, 250)
}

export function bindPlaybackControls(next: Controls | null) {
  controls = next
}

export function playbackNow() {
  return now
}

export function togglePlayback() {
  controls?.toggle()
}

export function pausePlayback() {
  controls?.pause()
}

export function playPlayback() {
  controls?.play()
}

export function seekPlayback(seconds: number) {
  if (!Number.isFinite(seconds)) return
  controls?.seek(seconds)
}

/** 把当前画面交给通知卡片。系统卡片只能换图，不能嵌一个真播放器。 */
export function pushFrame(dataUrl: string) {
  const bridge = nativeNotice()
  if (!bridge || typeof bridge.frame !== 'function' || !dataUrl) return
  bridge.frame(dataUrl)
}

/** 通知卡片点进来时，原生侧记下的影片。空字符串表示这次不是从卡片进来的。 */
export function consumeNoticeOpen(): string {
  const bridge = nativeNotice()
  if (!bridge || typeof bridge.consumeOpen !== 'function') return ''
  return bridge.consumeOpen() || ''
}

function bindSession() {
  const session = navigator.mediaSession
  if (!session || sessionBound) return
  sessionBound = true
  try {
    session.setActionHandler('play', () => playPlayback())
    session.setActionHandler('pause', () => pausePlayback())
    session.setActionHandler('stop', () => window.dispatchEvent(new Event('app-close-playback')))
  } catch {
    // 旧内核没有的动作会抛错，剩下的照常登记。
  }
}

function syncSession(item: NowPlaying | null) {
  const session = navigator.mediaSession
  if (!session) return
  bindSession()
  if (!item) {
    session.playbackState = 'none'
    session.metadata = null
    return
  }
  const artwork = item.thumb
    ? [{ src: item.thumb, sizes: '320x180', type: 'image/jpeg' }]
    : item.cover
      ? [{ src: item.cover }]
      : []
  try {
    session.metadata = new MediaMetadata({ title: item.title, artist: item.subtitle, artwork })
  } catch {
    session.metadata = new MediaMetadata({ title: item.title, artist: item.subtitle })
  }
  session.playbackState = item.playing ? 'playing' : 'paused'
  if (item.duration > 0 && Number.isFinite(item.current)) {
    try {
      session.setPositionState({
        duration: item.duration,
        playbackRate: item.playing ? 1 : 0,
        position: Math.min(Math.max(item.current, 0), item.duration),
      })
    } catch {
      // 进度超出时长时有的浏览器会拒绝，通知栏仍用标题。
    }
  }
}

function nativeNotice(): NoticeBridge | null {
  const bridge = (window as Window & { PlaybackNotice?: NoticeBridge }).PlaybackNotice
  if (!bridge || typeof bridge.update !== 'function' || typeof bridge.clear !== 'function') return null
  return bridge
}

function pushNotice(item: NowPlaying | null) {
  const bridge = nativeNotice()
  if (!bridge) {
    syncSession(item)
    noticeKey = ''
    noticePos = -1
    noticeDuration = -1
    return
  }
  if (!item) {
    if (noticeKey) bridge.clear()
    noticeKey = ''
    noticePos = -1
    noticeDuration = -1
    return
  }
  const position = Math.max(0, Math.round(item.current * 1000))
  const duration = Math.max(0, Math.round((Number.isFinite(item.duration) ? item.duration : 0) * 1000))
  const key = `${item.id}\n${item.ep}\n${item.playing ? 1 : 0}\n${item.title}\n${item.subtitle}\n${item.thumb || ''}`
  if (key !== noticeKey) {
    noticeKey = key
    noticePos = position
    noticeDuration = duration
    bridge.update(
      JSON.stringify({
        id: item.id,
        ep: item.ep,
        title: item.title,
        subtitle: item.subtitle,
        playing: item.playing,
        thumb: item.thumb || '',
        position,
        duration,
      }),
    )
    return
  }
  if (typeof bridge.progress !== 'function') return
  if (Math.abs(position - noticePos) < 1000 && duration === noticeDuration) return
  noticePos = position
  noticeDuration = duration
  bridge.progress(position, duration, item.playing)
}

export function subscribePlayback(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
