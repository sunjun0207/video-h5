import { API_PREFIX, rewritePlaylist, stripInjectedAds, upstreamFromPlay } from './mediaProxy'
import { remuxTsBlobs } from './remux'

type Progress = (done: number, total: number, stage?: 'pack') => void

function credentialsFor(url: string): RequestCredentials {
  return url.includes(API_PREFIX) ? 'same-origin' : 'omit'
}

async function pull(url: string, signal: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal, credentials: credentialsFor(url) })
  if (!response.ok) throw new Error('暂时收不下来')
  return response
}

function variantOf(text: string): string {
  const rows = text.split(/\r?\n/)
  const variants: { bandwidth: number; url: string }[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXT-X-STREAM-INF')) continue
    const bandwidth = Number((rows[index].match(/BANDWIDTH=(\d+)/) || [])[1] || 0)
    const uri = (rows[index + 1] || '').trim()
    if (!uri || uri.startsWith('#')) continue
    variants.push({ bandwidth, url: uri })
  }
  if (!variants.length) return ''
  const target = 900_000
  const usable = variants.filter((item) => item.bandwidth >= 350_000 && item.bandwidth <= 1_600_000)
  const pool = usable.length ? usable : variants
  return pool.sort((a, b) => Math.abs(a.bandwidth - target) - Math.abs(b.bandwidth - target))[0].url
}

function mediaParts(text: string): string[] {
  const rows = text.split(/\r?\n/)
  const parts: string[] = []
  for (const row of rows) {
    const init = row.match(/^#EXT-X-MAP:.*URI="([^"]+)"/)
    if (init) parts.push(init[1])
  }
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXTINF:')) continue
    const uri = (rows[index + 1] || '').trim()
    if (uri && !uri.startsWith('#')) parts.push(uri)
  }
  return parts
}

async function playlist(url: string, signal: AbortSignal): Promise<{ parts: string[]; ext: string }> {
  const response = await pull(url, signal)
  const upstream = upstreamFromPlay(url) || url
  let text = rewritePlaylist(stripInjectedAds(await response.text()), upstream)
  if (!text.includes('#EXTM3U')) throw new Error('这一集暂时收不下来')
  if (text.includes('#EXT-X-STREAM-INF')) {
    const next = variantOf(text)
    if (!next) throw new Error('这一集暂时收不下来')
    return playlist(next, signal)
  }
  const parts = mediaParts(text)
  if (!parts.length) throw new Error('这一集暂时收不下来')
  const sample = parts[parts.length - 1]
  const ext = sample.includes('.mp4') ? 'mp4' : 'ts'
  return { parts, ext }
}

function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000)
}

const QUALITY = /4K|超清|蓝光|1080|原画|高清|标清|720|极速|流畅|播放快/

function cleanName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()
}

/** 线路文案里的清晰度，例如「LZ线路 · 标清」取「标清」。 */
export function qualityOf(line: string): string {
  const parts = line.split('·').map((part) => part.trim()).filter(Boolean)
  return parts.find((part) => QUALITY.test(part)) || ''
}

/** 文件名：视频名称-品质。多集时名称里带上这一集，避免互相覆盖。 */
export function downloadName(title: string, episode: string, quality: string): string {
  const mark = cleanName(quality)
  const head = [cleanName(title), cleanName(episode)].filter(Boolean).join('-')
  const room = mark ? 80 - mark.length - 1 : 80
  const name = (room > 0 ? head.slice(0, room) : head.slice(0, 80)).replace(/-+$/, '')
  return [name, mark].filter(Boolean).join('-') || '影片'
}

export type DownloadControl = {
  pause: () => void
  resume: () => void
  cancel: () => void
  wait: () => Promise<void>
  readonly signal: AbortSignal
  readonly paused: boolean
  readonly stopped: boolean
}

export function createDownloadControl(): DownloadControl {
  let held = false
  let stopped = false
  let current = new AbortController()
  let waiters: Array<() => void> = []
  return {
    get signal() {
      return current.signal
    },
    get paused() {
      return held
    },
    get stopped() {
      return stopped
    },
    pause() {
      if (held || stopped) return
      held = true
      current.abort()
      current = new AbortController()
    },
    resume() {
      if (!held || stopped) return
      held = false
      const list = waiters
      waiters = []
      for (const wake of list) wake()
    },
    cancel() {
      if (stopped) return
      stopped = true
      held = false
      current.abort()
      const list = waiters
      waiters = []
      for (const wake of list) wake()
    },
    wait() {
      if (!held || stopped) return Promise.resolve()
      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    },
  }
}

function isAbort(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'AbortError'
}

async function fetchParts(parts: string[], ext: string, filename: string, control: DownloadControl, onProgress: Progress) {
  const chunks: Blob[] = new Array(parts.length)
  const pending = parts.map((_, index) => index)
  let done = 0
  const workers = Array.from({ length: Math.min(4, parts.length) }, async () => {
    while (!control.stopped) {
      await control.wait()
      if (control.stopped) return
      const index = pending.shift()
      if (index === undefined) return
      if (control.stopped || control.paused) {
        pending.push(index)
        continue
      }
      try {
        const response = await pull(parts[index], control.signal)
        const blob = await response.blob()
        if (control.stopped) return
        chunks[index] = blob
        done += 1
        onProgress(done, parts.length)
      } catch (reason) {
        if (control.stopped) return
        if (isAbort(reason) || control.paused) {
          pending.push(index)
          continue
        }
        throw reason
      }
    }
  })
  await Promise.all(workers)
  if (control.stopped) return
  if (chunks.some((chunk) => !chunk)) return
  if (ext === 'mp4') {
    saveBlob(new Blob(chunks, { type: 'video/mp4' }), `${filename}.mp4`)
    return
  }
  onProgress(chunks.length, chunks.length, 'pack')
  const packed = await remuxTsBlobs(chunks, control)
  if (control.stopped) return
  if (packed) {
    saveBlob(packed, `${filename}.mp4`)
    return
  }
  saveBlob(new Blob(chunks, { type: 'video/mp2t' }), `${filename}.ts`)
}

/** 按当前播放地址下载。地址已由 VITE_USE_PROXY 决定是片源直连还是本站代理。 */
export async function downloadEpisode(url: string, filename: string, control: DownloadControl, onProgress: Progress): Promise<void> {
  while (!control.stopped) {
    await control.wait()
    if (control.stopped) return
    try {
      if (!url.includes('.m3u8')) {
        const response = await pull(url, control.signal)
        const blob = await response.blob()
        if (control.stopped) return
        if (url.includes('.mp4')) {
          saveBlob(blob, `${filename}.mp4`)
          onProgress(1, 1)
          return
        }
        onProgress(1, 1, 'pack')
        const packed = await remuxTsBlobs([blob], control)
        if (control.stopped) return
        saveBlob(packed || blob, `${filename}.${packed ? 'mp4' : 'ts'}`)
        onProgress(1, 1)
        return
      }
      const { parts, ext } = await playlist(url, control.signal)
      await fetchParts(parts, ext, filename, control, onProgress)
      return
    } catch (reason) {
      if (control.stopped) return
      if (control.paused || isAbort(reason)) continue
      throw reason
    }
  }
}
