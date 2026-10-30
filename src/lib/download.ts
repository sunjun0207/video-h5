import { findAdGroups, type GroupHead } from './hlsAds'
import { API_PREFIX, rewritePlaylist, upstreamFromPlay } from './mediaProxy'
import { probeTs, type TsHead } from './mpegts'
import { downloadLanes } from './playback'
import { openRemux, type RemuxPipe } from './remuxPipe'

/** 不在播放时最多开几路；在播时按缓冲余量收窄，见 downloadLanes。 */
const FILE_LANES = 8
const PART_LANES = 8
const MIN_SLICE = 1024 * 1024
/** 读首帧时间和编码只需要片段开头这一段。 */
const HEAD_BYTES = 256 * 1024
const CLOCK = 90_000

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

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** 下载请求都标成低优先级，播放器的分片先走。 */
async function pull(url: string, signal: AbortSignal, headers?: HeadersInit): Promise<Response> {
  const response = await fetch(url, { signal, credentials: credentialsFor(url), headers, priority: 'low' })
  if (!response.ok) throw new Error('下载遇到一点问题，请稍后再试')
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

type Part = { url: string; duration: number; group: number }
type Plan = { init: string; parts: Part[]; ext: 'ts' | 'mp4' }

/** 分片按 DISCONTINUITY 分组，广告总是自成一组。 */
function mediaPlan(text: string): Plan {
  let init = ''
  let group = 0
  let duration = 0
  let broken = false
  const parts: Part[] = []
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim()
    if (!row) continue
    const map = row.match(/^#EXT-X-MAP:.*URI="([^"]+)"/)
    if (map) {
      init ||= map[1]
      continue
    }
    if (row === '#EXT-X-DISCONTINUITY') {
      broken = true
      continue
    }
    if (row.startsWith('#EXTINF:')) {
      duration = Number.parseFloat(row.slice(8)) || 0
      continue
    }
    if (row.startsWith('#')) continue
    if (broken && parts.length) group += 1
    broken = false
    parts.push({ url: row, duration, group })
    duration = 0
  }
  const sample = parts[parts.length - 1]?.url || ''
  return { init, parts, ext: init || sample.includes('.mp4') ? 'mp4' : 'ts' }
}

async function loadPlan(url: string, signal: AbortSignal): Promise<Plan> {
  const response = await pull(url, signal)
  const upstream = upstreamFromPlay(response.url || url) || response.url || url
  const text = rewritePlaylist(await response.text(), upstream)
  if (!text.includes('#EXTM3U')) throw new Error('这一集暂时下载不了，换条线路试试')
  if (text.includes('#EXT-X-STREAM-INF')) {
    const next = variantOf(text)
    if (!next) throw new Error('这一集暂时下载不了，换条线路试试')
    return loadPlan(next, signal)
  }
  const plan = mediaPlan(text)
  if (!plan.parts.length) throw new Error('这一集暂时下载不了，换条线路试试')
  return plan
}

function saveBlob(blob: Blob, filename: string): string {
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000)
  return filename
}

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: {
    startIn?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<unknown>
}

/**
 * 网页没法直接打开系统文件夹。桌面 Chrome / Edge 能弹出从「下载」文件夹开始的文件框，刚存的文件就在里面；
 * 其它浏览器返回 false，由页面提示去浏览器的下载列表里找。
 */
export async function revealDownload(): Promise<boolean> {
  const picker = (window as FilePickerWindow).showOpenFilePicker
  if (!picker) return false
  try {
    await picker.call(window, {
      startIn: 'downloads',
      types: [{ description: '视频', accept: { 'video/mp4': ['.mp4'], 'video/mp2t': ['.ts'] } }],
    })
    return true
  } catch (reason) {
    return reason instanceof DOMException && reason.name === 'AbortError'
  }
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

/** 多路同时拉。播放器在播时按缓冲余量少开几路；暂停只重下当前这一段；某一路失败则停掉其余连接。 */
async function inLanes(jobs: number[], lanes: number, control: DownloadControl, job: (index: number) => Promise<void>) {
  const pending = jobs.slice()
  let dead: unknown = null
  const workers = Array.from({ length: Math.min(lanes, pending.length) }, async (_, lane) => {
    while (!control.stopped && !dead && pending.length) {
      await control.wait()
      if (control.stopped || dead) return
      if (lane >= downloadLanes(lanes)) {
        await sleep(500)
        continue
      }
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
    if (!blob.size) throw new Error('下载遇到一点问题，请稍后再试')
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
      priority: 'low',
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
      throw new Error('下载遇到一点问题，请稍后再试')
    }
    const blob = await readBody(response, control, (bytes) => {
      counted += bytes
      meter.add(bytes)
    })
    if (blob.size < expect) throw new Error('下载遇到一点问题，请稍后再试')
    done = true
    return blob.size === expect ? blob : blob.slice(0, expect)
  } catch (reason) {
    if (!done && counted) meter.add(-counted)
    throw reason
  }
}

async function headOf(blob: Blob): Promise<TsHead> {
  return probeTs(new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer()))
}

/** mux.js 只认 H.264 + AAC，其它编码直接存 ts。 */
function remuxable(head: TsHead): boolean {
  if (head.video === null && head.audio === null) return false
  return (head.videoCodec === '' || head.videoCodec === 'avc') && (head.audioCodec === '' || head.audioCodec === 'aac')
}

async function packTs(chunks: Blob[]): Promise<Blob | null> {
  if (!remuxable(await headOf(chunks[0]))) return null
  const remux = openRemux()
  try {
    for (const chunk of chunks) remux.push(chunk)
    return await remux.finish()
  } finally {
    remux.close()
  }
}

async function downloadWhole(url: string, filename: string, control: DownloadControl, meter: Meter): Promise<string> {
  const probe = await probeRange(url, control.signal)
  if (control.stopped) return ''
  let blob: Blob
  if (probe.ranged && probe.total >= MIN_SLICE * 2) {
    const slices = slicesOf(probe.total)
    const pieces: Blob[] = new Array(slices.length)
    meter.setTotal(probe.total)
    await inLanes(
      slices.map((_, index) => index),
      FILE_LANES,
      control,
      async (index) => {
        const slice = slices[index]
        pieces[index] = await takeSlice(url, slice.start, slice.end, control, meter)
      },
    )
    if (control.stopped) return ''
    if (pieces.some((piece) => !piece)) throw new Error('下载遇到一点问题，请稍后再试')
    blob = new Blob(pieces, { type: url.includes('.mp4') ? 'video/mp4' : 'video/mp2t' })
  } else {
    if (probe.total > 0) meter.setTotal(probe.total)
    let stored: Blob | null = null
    await inLanes([0], 1, control, async () => {
      stored = await take(url, control, meter, (size) => meter.setTotal(size))
    })
    if (control.stopped || !stored) return ''
    blob = stored
  }
  if (url.includes('.mp4')) return saveBlob(blob, `${filename}.mp4`)
  meter.pack()
  const packed = await packTs([blob])
  if (control.stopped) return ''
  return saveBlob(packed || blob, `${filename}.${packed ? 'mp4' : 'ts'}`)
}

async function fetchMp4Parts(plan: Plan, filename: string, control: DownloadControl, meter: Meter): Promise<string> {
  const urls = [...(plan.init ? [plan.init] : []), ...plan.parts.map((part) => part.url)]
  const chunks: Blob[] = new Array(urls.length)
  let finished = 0
  await inLanes(
    urls.map((_, index) => index),
    PART_LANES,
    control,
    async (index) => {
      chunks[index] = await take(urls[index], control, meter)
      finished += 1
      meter.setShare(finished / urls.length)
    },
  )
  if (control.stopped) return ''
  if (chunks.some((chunk) => !chunk)) throw new Error('下载遇到一点问题，请稍后再试')
  return saveBlob(new Blob(chunks, { type: 'video/mp4' }), `${filename}.mp4`)
}

/**
 * 先拉每组第一个分片，按时间线认出广告组；再只拉正片分片，边下边按顺序交给后台装成 mp4。
 */
async function fetchTsParts(plan: Plan, filename: string, control: DownloadControl, meter: Meter): Promise<string> {
  const { parts } = plan
  const chunks: Array<Blob | undefined> = new Array(parts.length)
  const sizes = new Array<number>(parts.length).fill(0)
  const wanted = new Array<boolean>(parts.length).fill(true)
  const probes = new Map<number, TsHead>()
  let order: number[] | null = null
  let cursor = 0
  let remux = undefined as RemuxPipe | null | undefined
  let feeding = Promise.resolve()

  const estimate = () => {
    let count = 0
    let done = 0
    let known = 0
    let knownBytes = 0
    let samples = 0
    let sampleBytes = 0
    for (let index = 0; index < parts.length; index += 1) {
      if (!wanted[index]) continue
      count += 1
      if (chunks[index]) done += 1
      if (sizes[index] <= 0) continue
      known += 1
      knownBytes += sizes[index]
      if (sizes[index] >= 8 * 1024) {
        samples += 1
        sampleBytes += sizes[index]
      }
    }
    if (known === count) meter.setTotal(knownBytes)
    else if (samples) meter.setTotal(Math.round(knownBytes + (sampleBytes / samples) * (count - known)))
    meter.setShare(count ? done / count : 0)
  }

  const feed = () => {
    feeding = feeding.then(async () => {
      if (!order) return
      while (cursor < order.length) {
        const chunk = chunks[order[cursor]]
        if (!chunk) return
        if (remux === undefined) {
          const head = probes.get(order[cursor]) ?? (await headOf(chunk).catch(() => null))
          remux = head && remuxable(head) ? openRemux() : null
        }
        remux?.push(chunk)
        cursor += 1
      }
    })
  }

  const fetchOne = async (index: number) => {
    const blob = await take(parts[index].url, control, meter, (size) => {
      sizes[index] = size
      estimate()
    })
    chunks[index] = blob
    estimate()
    feed()
  }

  try {
    const heads = parts.flatMap((part, index) => (index === 0 || part.group !== parts[index - 1].group ? [index] : []))
    if (heads.length > 1) {
      await inLanes(heads, PART_LANES, control, async (index) => {
        await fetchOne(index)
        probes.set(index, await headOf(chunks[index]!))
      })
      if (control.stopped) return ''
      if (heads.some((index) => !probes.has(index))) throw new Error('下载遇到一点问题，请稍后再试')
      const groups: GroupHead[] = heads.map((index) => {
        const head = probes.get(index)!
        const start = head.video ?? head.audio
        return { start: start === null ? null : start / CLOCK, duration: 0, parts: 0, sps: head.sps, audio: head.audio !== null }
      })
      for (const part of parts) {
        groups[part.group].duration += part.duration
        groups[part.group].parts += 1
      }
      const ads = findAdGroups(groups)
      parts.forEach((part, index) => {
        if (!ads.has(part.group)) return
        wanted[index] = false
        const chunk = chunks[index]
        if (chunk) meter.add(-chunk.size)
        chunks[index] = undefined
      })
    }
    order = parts.flatMap((_, index) => (wanted[index] ? [index] : []))
    estimate()
    feed()
    await inLanes(
      order.filter((index) => !chunks[index]),
      PART_LANES,
      control,
      fetchOne,
    )
    if (control.stopped) return ''
    if (order.some((index) => !chunks[index])) throw new Error('下载遇到一点问题，请稍后再试')
    feed()
    await feeding
    if (remux) meter.pack()
    const packed = remux ? await remux.finish() : null
    if (control.stopped) return ''
    if (packed) return saveBlob(packed, `${filename}.mp4`)
    return saveBlob(new Blob(order.map((index) => chunks[index]!), { type: 'video/mp2t' }), `${filename}.ts`)
  } finally {
    remux?.close()
  }
}

/** 按当前播放地址下载，返回存下的文件名（被取消时为空）。地址已由 VITE_USE_PROXY 决定是片源直连还是本站代理。 */
export async function downloadEpisode(url: string, filename: string, control: DownloadControl, onProgress: Progress): Promise<string> {
  const meter = createMeter(onProgress)
  while (!control.stopped) {
    await control.wait()
    if (control.stopped) return ''
    try {
      if (!url.includes('.m3u8')) return await downloadWhole(url, filename, control, meter)
      const plan = await loadPlan(url, control.signal)
      if (plan.ext === 'mp4') return await fetchMp4Parts(plan, filename, control, meter)
      return await fetchTsParts(plan, filename, control, meter)
    } catch (reason) {
      if (control.stopped) return ''
      if (control.paused || isAbort(reason)) {
        meter.reset()
        continue
      }
      throw reason
    }
  }
  return ''
}
