import { API_PREFIX, rewritePlaylist, stripInjectedAds, upstreamFromPlay } from './mediaProxy'
import { remuxTsBlobs } from './remux'

/** 单文件按区间切开的连接数。播放列表分片更碎，多开几路把等待叠起来。 */
const FILE_LANES = 8
const PART_LANES = 16
const MIN_SLICE = 1024 * 1024

export type DownloadProgress = {
  received: number
  total: number
  speed: number
  ratio: number
  stage?: 'pack'
}

type Progress = (stat: DownloadProgress) => void

function credentialsFor(url: string): RequestCredentials {
  return url.includes(API_PREFIX) ? 'same-origin' : 'omit'
}

function aborted(): Error {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function isAbort(reason: unknown): boolean {
  return reason instanceof Error && reason.name === 'AbortError'
}

async function pull(url: string, signal: AbortSignal, headers?: HeadersInit): Promise<Response> {
  const response = await fetch(url, { signal, credentials: credentialsFor(url), headers })
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
  const text = rewritePlaylist(stripInjectedAds(await response.text()), upstream)
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
  interrupt: () => void
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
    interrupt() {
      if (stopped) return
      current.abort()
      current = new AbortController()
    },
    wait() {
      if (!held || stopped) return Promise.resolve()
      return new Promise((resolve) => {
        waiters.push(resolve)
      })
    },
  }
}

function createMeter(onProgress: Progress) {
  let received = 0
  let total = 0
  let share = 0
  let stage: DownloadProgress['stage']
  let lastEmit = 0
  let timer = 0
  const marks: { at: number; received: number }[] = []

  const speedOf = () => {
    const now = performance.now()
    const cutoff = now - 2000
    while (marks.length > 1 && marks[0].at < cutoff) marks.shift()
    if (marks.length < 2) return 0
    const span = (marks[marks.length - 1].at - marks[0].at) / 1000
    if (span < 0.4) return 0
    return Math.max(0, (marks[marks.length - 1].received - marks[0].received) / span)
  }

  const snapshot = (): DownloadProgress => {
    const shown = total > 0 ? Math.max(total, received) : 0
    return {
      received,
      total: shown,
      speed: stage === 'pack' ? 0 : speedOf(),
      ratio: shown > 0 ? Math.min(1, received / shown) : share,
      stage,
    }
  }

  const emit = (force: boolean) => {
    const now = performance.now()
    if (!force && now - lastEmit < 200) {
      if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0
          emit(true)
        }, 200)
      }
      return
    }
    lastEmit = now
    if (timer) {
      window.clearTimeout(timer)
      timer = 0
    }
    onProgress(snapshot())
  }

  return {
    add(bytes: number) {
      received = Math.max(0, received + bytes)
      const now = performance.now()
      const last = marks[marks.length - 1]
      if (last && now - last.at < 100) last.received = received
      else marks.push({ at: now, received })
      emit(false)
    },
    setTotal(bytes: number) {
      if (bytes <= 0) return
      total = bytes
      emit(true)
    },
    setShare(ratio: number) {
      share = ratio
      if (total <= 0) emit(false)
    },
    pack() {
      stage = 'pack'
      emit(true)
    },
    reset() {
      received = 0
      total = 0
      share = 0
      stage = undefined
      marks.length = 0
      emit(true)
    },
  }
}

type Meter = ReturnType<typeof createMeter>

async function readBody(response: Response, control: DownloadControl, onBytes: (bytes: number) => void): Promise<Blob> {
  const reader = response.body?.getReader()
  if (!reader) {
    const data = new Uint8Array(await response.arrayBuffer())
    if (data.byteLength) onBytes(data.byteLength)
    return new Blob([data])
  }
  const chunks: Uint8Array[] = []
  try {
    while (!control.stopped && !control.paused) {
      const { done, value } = await reader.read()
      if (done || control.stopped || control.paused) break
      if (!value?.byteLength) continue
      chunks.push(value)
      onBytes(value.byteLength)
    }
  } catch (reason) {
    await reader.cancel().catch(() => undefined)
    if (isAbort(reason) || control.paused || control.stopped) throw aborted()
    throw reason
  }
  if (control.stopped || control.paused) {
    await reader.cancel().catch(() => undefined)
    throw aborted()
  }
  return new Blob(chunks)
}

/** 多路同时拉。暂停只重下当前这一段；某一路失败则停掉其余连接。 */
async function inLanes(count: number, lanes: number, control: DownloadControl, job: (index: number) => Promise<void>) {
  const pending = Array.from({ length: count }, (_, index) => index)
  let dead: unknown = null
  const workers = Array.from({ length: Math.min(lanes, count) }, async () => {
    while (!control.stopped && !dead) {
      await control.wait()
      if (control.stopped || dead) return
      const index = pending.shift()
      if (index === undefined) return
      if (control.paused) {
        pending.unshift(index)
        continue
      }
      try {
        await job(index)
      } catch (reason) {
        if (control.stopped || dead) return
        if (control.paused || isAbort(reason)) {
          pending.unshift(index)
          continue
        }
        dead = reason
        control.interrupt()
        return
      }
    }
  })
  await Promise.all(workers)
  if (dead) throw dead
}

async function take(url: string, control: DownloadControl, meter: Meter, onSize?: (size: number) => void): Promise<Blob> {
  let counted = 0
  let done = false
  try {
    const response = await pull(url, control.signal)
    const length = Number(response.headers.get('content-length') || 0)
    if (Number.isFinite(length) && length > 0) onSize?.(length)
    const blob = await readBody(response, control, (bytes) => {
      counted += bytes
      meter.add(bytes)
    })
    if (!blob.size) throw new Error('暂时收不下来')
    onSize?.(blob.size)
    done = true
    return blob
  } catch (reason) {
    if (!done && counted) meter.add(-counted)
    throw reason
  }
}

function totalFromRange(header: string | null): number {
  const value = Number((header || '').split('/').pop())
  return Number.isFinite(value) && value > 0 ? value : 0
}

async function probeRange(url: string, signal: AbortSignal): Promise<{ total: number; ranged: boolean }> {
  try {
    const response = await fetch(url, {
      signal,
      credentials: credentialsFor(url),
      headers: { Range: 'bytes=0-0' },
    })
    try {
      if (response.status === 206) {
        const total = totalFromRange(response.headers.get('content-range'))
        return { total, ranged: total > 0 }
      }
      const total = Number(response.headers.get('content-length') || 0)
      return { total: Number.isFinite(total) && total > 0 ? total : 0, ranged: false }
    } finally {
      await response.body?.cancel().catch(() => undefined)
    }
  } catch (reason) {
    if (isAbort(reason)) throw reason
    return { total: 0, ranged: false }
  }
}

function slicesOf(total: number): Array<{ start: number; end: number }> {
  const count = Math.max(1, Math.min(FILE_LANES, Math.floor(total / MIN_SLICE)))
  const size = Math.ceil(total / count)
  const slices: Array<{ start: number; end: number }> = []
  for (let start = 0; start < total; start += size) {
    slices.push({ start, end: Math.min(total - 1, start + size - 1) })
  }
  return slices
}

async function takeSlice(url: string, start: number, end: number, control: DownloadControl, meter: Meter): Promise<Blob> {
  const expect = end - start + 1
  let counted = 0
  let done = false
  try {
    const response = await pull(url, control.signal, { Range: `bytes=${start}-${end}` })
    if (response.status !== 206) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('暂时收不下来')
    }
    const blob = await readBody(response, control, (bytes) => {
      counted += bytes
      meter.add(bytes)
    })
    if (blob.size < expect) throw new Error('暂时收不下来')
    done = true
    return blob.size === expect ? blob : blob.slice(0, expect)
  } catch (reason) {
    if (!done && counted) meter.add(-counted)
    throw reason
  }
}

async function downloadWhole(url: string, filename: string, control: DownloadControl, meter: Meter) {
  const probe = await probeRange(url, control.signal)
  if (control.stopped) return
  let blob: Blob
  if (probe.ranged && probe.total >= MIN_SLICE * 2) {
    const slices = slicesOf(probe.total)
    const pieces: Blob[] = new Array(slices.length)
    meter.setTotal(probe.total)
    await inLanes(slices.length, slices.length, control, async (index) => {
      const slice = slices[index]
      pieces[index] = await takeSlice(url, slice.start, slice.end, control, meter)
    })
    if (control.stopped) return
    if (pieces.some((piece) => !piece)) throw new Error('暂时收不下来')
    blob = new Blob(pieces, { type: url.includes('.mp4') ? 'video/mp4' : 'video/mp2t' })
  } else {
    if (probe.total > 0) meter.setTotal(probe.total)
    let stored: Blob | null = null
    await inLanes(1, 1, control, async () => {
      stored = await take(url, control, meter, (size) => meter.setTotal(size))
    })
    if (control.stopped || !stored) return
    blob = stored
  }
  if (url.includes('.mp4')) {
    saveBlob(blob, `${filename}.mp4`)
    return
  }
  meter.pack()
  const packed = await remuxTsBlobs([blob], control)
  if (control.stopped) return
  saveBlob(packed || blob, `${filename}.${packed ? 'mp4' : 'ts'}`)
}

async function fetchParts(parts: string[], ext: string, filename: string, control: DownloadControl, meter: Meter) {
  const chunks: Blob[] = new Array(parts.length)
  const sizes = new Array<number>(parts.length).fill(0)
  let sized = 0
  let sizedBytes = 0
  let finished = 0

  const rememberSize = (index: number, size: number) => {
    if (size <= 0 || sizes[index] === size) return
    if (sizes[index] === 0) sized += 1
    sizedBytes += size - sizes[index]
    sizes[index] = size
    if (sized === parts.length) {
      meter.setTotal(sizedBytes)
      return
    }
    const samples = sizes.filter((item) => item >= 8 * 1024)
    if (!samples.length) return
    const average = samples.reduce((sum, item) => sum + item, 0) / samples.length
    const missing = parts.length - sized
    meter.setTotal(Math.round(sizedBytes + average * missing))
  }

  await inLanes(parts.length, PART_LANES, control, async (index) => {
    chunks[index] = await take(parts[index], control, meter, (size) => rememberSize(index, size))
    finished += 1
    meter.setShare(finished / parts.length)
  })
  if (control.stopped) return
  if (chunks.some((chunk) => !chunk)) throw new Error('暂时收不下来')
  if (ext === 'mp4') {
    saveBlob(new Blob(chunks, { type: 'video/mp4' }), `${filename}.mp4`)
    return
  }
  meter.pack()
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
  const meter = createMeter(onProgress)
  while (!control.stopped) {
    await control.wait()
    if (control.stopped) return
    try {
      if (!url.includes('.m3u8')) {
        await downloadWhole(url, filename, control, meter)
        return
      }
      const { parts, ext } = await playlist(url, control.signal)
      await fetchParts(parts, ext, filename, control, meter)
      return
    } catch (reason) {
      if (control.stopped) return
      if (control.paused || isAbort(reason)) {
        meter.reset()
        continue
      }
      throw reason
    }
  }
}
