export type NowPlaying = {
  id: string
  ep: number
  title: string
  subtitle: string
  cover?: string
  mark: string
  tone: [string, string]
  playing: boolean
  current: number
  duration: number
}

type Controls = {
  toggle: () => void
  pause: () => void
}

let now: NowPlaying | null = null
let controls: Controls | null = null
let queued = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

export function publishNow(next: NowPlaying | null, immediate = false) {
  now = next
  if (next === null || immediate) {
    window.clearTimeout(queued)
    queued = 0
    emit()
    return
  }
  if (queued) return
  queued = window.setTimeout(() => {
    queued = 0
    emit()
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

export function subscribePlayback(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
