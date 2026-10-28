import type { ChannelId, PlayLine, VideoItem } from './types'
import { stripInjectedAds } from './hlsAds'
import { absolutePlayUrl, coverUrl, playProxy, seedPlaylist, upstreamFromPlay, useProxy, VOD_COOKIE_PATH, vodUrl } from './mediaProxy'
import { sha1 } from './sha1'

const CHANNELS: { id: ChannelId; name: string; path: string }[] = [
  { id: 'movie', name: '电影', path: '/channel/1.html' },
  { id: 'tv', name: '连续剧', path: '/channel/2.html' },
  { id: 'anime', name: '动漫', path: '/channel/3.html' },
  { id: 'variety', name: '综艺纪录', path: '/channel/4.html' },
  { id: 'short', name: '短剧', path: '/channel/6.html' },
]
const CHANNEL_BY_NO: Record<string, ChannelId> = { 1: 'movie', 2: 'tv', 3: 'anime', 4: 'variety', 6: 'short' }
const TYPE_CHANNEL: Record<string, ChannelId> = {
  电影: 'movie',
  连续剧: 'tv',
  动漫: 'anime',
  综艺纪录: 'variety',
  短剧: 'short',
}
const PLAY_PATH = /^\/play\/\d+-\d+-\d+\.html$/

const TOKEN_KEY = 'video_h5_search_token'
/** 搜索口令实测 10 分钟后仍然有效；超过 8 分钟就先换一个新的。 */
const TOKEN_FRESH_MS = 8 * 60 * 1000
/** 校验 Cookie 在对方那边能用多久不确定，浏览器这边先留 7 天，失效了会再算一次。 */
const COOKIE_AGE = 7 * 24 * 3600
/** 一条线路这么久还没测完，不停它，再加测下一条。有的片源播放列表要二十多秒才回来，但能播。 */
const SLOW_LINE_MS = 8000
/** 测速：整段最多等这么久（含首字节）。 */
const SAMPLE_MS = 4500
/** 测速：读够这么久或这么多就停。 */
const SAMPLE_READ_MS = 1500
const SAMPLE_BYTES = 1200 * 1024
const GOOD_RATIO = 1.3
const STEADY_RATIO = 1.05
/** 第一条能播的线路测完后，再等这么久，看有没有更合适的。 */
const PICK_GRACE_MS = 1500
/** 同时测速的线路数，太多会互相抢带宽、测不准。 */
const RACE_LANES = 3

let solvedAt = 0
let searchToken = readToken()
let tokenWarming: Promise<unknown> | null = null
const playCache = new Map<string, { at: number; value: { url: string; line: string } }>()
const playLoads = new Map<string, Promise<{ url: string; line: string }>>()

function readToken(): { value: string; at: number } {
  try {
    const data = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null') as { value?: unknown; at?: unknown } | null
    if (data && typeof data.value === 'string') return { value: data.value, at: Number(data.at) || 0 }
  } catch {
    // 读不出来就当没有
  }
  return { value: '', at: 0 }
}

/** issuedAt 取响应头 Date：浏览器缓存里的旧页面带的是旧口令，不能盖掉新的。 */
function noteToken(html: string, issuedAt: number) {
  const value = html.match(/name="t" value="([^"]+)"/)?.[1]
  if (!value || issuedAt <= searchToken.at) return
  searchToken = { value, at: issuedAt }
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(searchToken))
  } catch {
    // 隐私模式下可能存不进去，本次照常用内存里的
  }
}

function decode(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function tone(id: string): [string, string] {
  let n = 0
  for (const ch of id) n = (n * 33 + ch.charCodeAt(0)) >>> 0
  const hue = n % 360
  return [`hsl(${hue} 42% 28%)`, `hsl(${(hue + 32) % 360} 48% 42%)`]
}

function blankItem(partial: Partial<VideoItem> & { id: string; title: string }): VideoItem {
  return {
    id: partial.id,
    title: partial.title,
    channel: partial.channel || 'movie',
    genres: partial.genres || [],
    region: partial.region || '',
    year: partial.year || 0,
    score: partial.score || 0,
    hot: partial.hot || 0,
    badge: partial.badge,
    updateText: partial.updateText || '正片',
    actors: partial.actors || [],
    director: partial.director || '',
    summary: partial.summary || '',
    tone: tone(partial.id),
    mark: partial.title.slice(0, 1),
    featured: partial.featured || false,
    cover: partial.cover || '',
    episodes: partial.episodes || [],
  }
}

function solveChallenge(html: string): string {
  const prefix = html.match(/'([0-9A-F]{40})'/)?.[1]
  if (!prefix) return ''
  const index = Number.parseInt(prefix[0], 16)
  for (let i = 0; i < 5_000_000; i += 1) {
    const digest = sha1(prefix + i)
    if (digest[index] === 0xb0 && digest[index + 1] === 0x0b) return `${prefix}${i}`
  }
  return ''
}

async function openPage(path: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(vodUrl(path), { credentials: 'same-origin', signal })
  } catch (reason) {
    if (reason instanceof TypeError) throw new Error('片库暂时没有打开')
    throw reason
  }
}

/** 片库要求先算一道题时，用它给的题目算出 Cookie。同时撞上的请求，只要有一个算过就直接重试。 */
function passChallenge(html: string, sentAt: number) {
  if (solvedAt >= sentAt) return
  const solved = solveChallenge(html)
  if (!solved) throw new Error('片库暂时没有打开')
  document.cookie = `cdndefend_js_cookie=${solved}; path=${VOD_COOKIE_PATH}; max-age=${COOKIE_AGE}`
  solvedAt = Date.now()
}

async function fetchHtml(path: string, signal?: AbortSignal): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const sentAt = Date.now()
    const response = await openPage(path, signal)
    const html = await response.text()
    if (response.status === 850 || html.includes('cdndefend_js_cookie')) {
      passChallenge(html, sentAt)
      continue
    }
    if (response.status !== 200) throw new Error('片库暂时没有打开')
    noteToken(html, Date.parse(response.headers.get('date') || '') || Date.now())
    return html
  }
  throw new Error('片库暂时没有打开')
}

function visibleTitle(block: string): string {
  const titles = [...block.matchAll(/<div class="v-item-title"([^>]*)>([^<]*)<\/div>/g)]
  for (const match of titles) {
    if (/display:\s*none/.test(match[1])) continue
    const text = decode(match[2])
    if (!text || /可可影视|kkys/i.test(text)) continue
    return text
  }
  return ''
}

function parseCards(html: string, channel: ChannelId): VideoItem[] {
  const items: VideoItem[] = []
  const re = /<a href="\/detail\/(\d+)\.html" class="v-item">([\s\S]*?)<\/a>/g
  let index = 0
  for (const match of html.matchAll(re)) {
    const id = match[1]
    const block = match[2]
    const title = visibleTitle(block)
    if (!title) continue
    const cover = block
      .match(/data-original="([^"]+)"/g)
      ?.map((item) => item.slice(15, -1))
      .find((item) => item.includes('/vod1/') || item.includes('/cover/'))
    const scoreText = block.match(/豆瓣:\s*([0-9.]+)/)?.[1]
    const badge = decode((block.match(/<div class="v-item-bottom">[\s\S]*?<span>\s*([^<]+?)\s*<\/span>/) || [])[1] || '')
    items.push(
      blankItem({
        id,
        title,
        channel,
        cover: coverUrl(cover || ''),
        score: scoreText ? Number(scoreText) : 0,
        hot: 1000 - index,
        badge: badge || undefined,
        updateText: badge || '正片',
        featured: false,
      }),
    )
    index += 1
  }
  return items
}

function parseCarousel(html: string): VideoItem[] {
  const items: VideoItem[] = []
  const re = /<a href="\/detail\/(\d+)\.html" class="carousel-item">([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(re)) {
    const block = match[2]
    const title = decode((block.match(/<div class="carousel-item-title">([^<]*)<\/div>/) || [])[1] || '')
    if (!title) continue
    const summary = decode((block.match(/<div class="carousel-item-desc">([\s\S]*?)<\/div>/) || [])[1] || '')
    const cover = (block.match(/data-original="([^"]+)"/) || [])[1] || ''
    const tags = [...block.matchAll(/<span class="tag">([^<]+)<\/span>/g)].map((item) => decode(item[1]))
    items.push(
      blankItem({
        id: match[1],
        title,
        channel: 'movie',
        cover: coverUrl(cover),
        summary,
        badge: tags[0] || '焦点',
        updateText: tags[0] || '正片',
        featured: true,
        hot: 2000 - items.length,
      }),
    )
  }
  return items
}

function lineRank(label = '', note = ''): number {
  const text = `${label} ${note}`
  if (/4K|超清|蓝光|1080|原画/.test(text)) return 40
  if (/极速|播放快|流畅/.test(text)) return 0
  if (/标清/.test(text)) return 1
  if (/720/.test(text)) return 2
  if (/大陆/.test(text)) return 3
  if (/高清/.test(text)) return 8
  if (/香港/.test(text)) return 10
  return 20
}

function parseDetail(html: string, id: string): VideoItem {
  const titleBlock = html.match(/<div class="detail-title">([\s\S]*?)<\/div>/)?.[1] || ''
  const titles = [...titleBlock.matchAll(/<strong>([^<]*)<\/strong>/g)].map((item) => decode(item[1]))
  const title = titles.find((item) => item && !/[𝕜𝕜𝕪𝕤]|kkys|\.com/i.test(item)) || titles[1] || id
  const tags = [...(html.match(/<div class="detail-tags[\s\S]*?<\/div>/)?.[0] || '').matchAll(/>([^<]+)<\/a>/g)]
    .map((item) => decode(item[1]))
    .filter(Boolean)
  const yearTag = tags.find((item) => /^\d{4}$/.test(item))
  const year = Number(yearTag || (html.match(/首映:[\s\S]*?<div class="detail-info-row-main">(\d{4})/) || [])[1] || 0)
  const region = tags.find((item) => item !== yearTag && !/^\d{4}$/.test(item) && item.length <= 8) || ''
  const genres = tags.filter((item) => item !== yearTag && item !== region)
  const summary = decode((html.match(/<div class="detail-desc">[\s\S]*?<p>([\s\S]*?)<\/p>/) || [])[1] || '')
  const director = decode((html.match(/导演:[\s\S]*?<div class="detail-info-row-main">([\s\S]*?)<\/div>/) || [])[1] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const actorBlock = (html.match(/演员:[\s\S]*?<div class="detail-info-row-main">([\s\S]*?)<\/div>/) || [])[1] || ''
  const actors = [...actorBlock.matchAll(/>([^<]+)<\/a>/g)].map((item) => decode(item[1])).filter(Boolean)
  const note = decode((html.match(/备注:[\s\S]*?<div class="detail-info-row-main">([^<]+)/) || [])[1] || '')
  const cover = (html.match(/<div class="detail-pic">[\s\S]*?data-original="([^"]+)"/) || [])[1] || ''
  const channelNo = (html.match(/\/show\/(\d+)/) || [])[1]
  const scoreText = html.match(/豆瓣[:：]\s*([0-9.]+)/)?.[1]
  const sources = [...html.matchAll(/<a href="#" class="source-item[^"]*">([\s\S]*?)<\/a>/g)].map((item) => ({
    label: decode((item[1].match(/source-item-label">([^<]+)/) || [])[1] || ''),
    note: decode((item[1].match(/source-item-sublabel">([^<]+)/) || [])[1] || ''),
  }))
  const lists = [...html.matchAll(/<div class="episode-list"[^>]*>([\s\S]*?)<\/div>/g)].map((item) =>
    [...item[1].matchAll(/<a href="(\/play\/[^"]+)"[^>]*>[\s\S]*?<span>([^<]*)<\/span>/g)].map((episode) => ({
      playPath: episode[1],
      title: decode(episode[2]),
    })),
  )
  const order = lists
    .map((_, index) => index)
    .sort((a, b) => lineRank(sources[a]?.label, sources[a]?.note) - lineRank(sources[b]?.label, sources[b]?.note))
  const width = Math.max(0, ...lists.map((list) => list.length))
  const episodes = []
  for (let index = 0; index < width; index += 1) {
    const lines: PlayLine[] = order
      .filter((sourceIndex) => lists[sourceIndex][index])
      .map((sourceIndex) => ({
        label: sources[sourceIndex]?.label || `线路${sourceIndex + 1}`,
        note: sources[sourceIndex]?.note || '',
        playPath: lists[sourceIndex][index].playPath,
      }))
    if (!lines.length) continue
    const titled = order.map((sourceIndex) => lists[sourceIndex][index]).find(Boolean)
    episodes.push({
      id: String(episodes.length + 1),
      title: titled?.title || `第${episodes.length + 1}集`,
      url: '',
      playPath: lines[0].playPath,
      lines,
    })
  }
  return blankItem({
    id,
    title,
    channel: CHANNEL_BY_NO[channelNo || ''] || 'movie',
    genres,
    region,
    year,
    score: scoreText ? Number(scoreText) : 0,
    hot: 1,
    badge: note || undefined,
    updateText: episodes.length > 1 ? `更新至${episodes.length}集` : note || '正片',
    actors,
    director,
    summary,
    cover: coverUrl(cover),
    episodes,
  })
}

function parseSearch(html: string): VideoItem[] {
  const items: VideoItem[] = []
  const re = /<a href="\/detail\/(\d+)\.html" class="search-result-item">([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(re)) {
    const block = match[2]
    const title = decode((block.match(/<div class="title">([^<]+)/) || [])[1] || '')
    if (!title) continue
    const kind = decode((block.match(/search-result-item-header">\s*<div>([^<]+)/) || [])[1] || '')
    const tagBlock = (block.match(/<div class="tags">([\s\S]*?)<\/div>/) || [])[1] || ''
    const tags = [...tagBlock.matchAll(/<span>([^<]+)<\/span>/g)].map((span) => decode(span[1]))
    const year = Number(tags.find((item) => /^\d{4}$/.test(item)) || 0)
    const region = tags.find((item) => item !== String(year) && !item.includes(',')) || ''
    const genres = tags
      .flatMap((item) => (item.includes(',') ? item.split(',') : []))
      .map((item) => item.trim())
      .filter(Boolean)
    const actors = decode((block.match(/<div class="actors">[\s\S]*?<span>([^<]*)<\/span>/) || [])[1] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const summary = decode((block.match(/<div class="desc">([\s\S]*?)<\/div>/) || [])[1] || '')
    const cover = [...block.matchAll(/data-original="([^"]+)"/g)].map((item) => item[1]).find((item) => item.includes('/vod1/'))
    items.push(
      blankItem({
        id: match[1],
        title,
        channel: TYPE_CHANNEL[kind] || 'movie',
        genres,
        region,
        year,
        actors,
        summary,
        cover: coverUrl(cover || ''),
        hot: 500 - items.length,
        updateText: kind || '正片',
      }),
    )
  }
  return items
}

function parsePlay(html: string): string {
  const src = html.match(/src:\s*"([^"]+\.m3u8[^"]*)"/)?.[1]
  if (!src) throw new Error('这一集没有播放地址')
  return src
}

function chooseVariant(text: string, playlistUrl: string): string {
  if (!text.includes('#EXT-X-STREAM-INF')) return playlistUrl
  const rows = text.split(/\r?\n/)
  const variants: { bandwidth: number; url: string }[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXT-X-STREAM-INF')) continue
    const bandwidth = Number((rows[index].match(/BANDWIDTH=(\d+)/) || [])[1] || 0)
    const uri = (rows[index + 1] || '').trim()
    if (!uri || uri.startsWith('#')) continue
    variants.push({ bandwidth, url: new URL(uri, playlistUrl).href })
  }
  if (!variants.length) return playlistUrl
  const target = 900_000
  const usable = variants.filter((item) => item.bandwidth >= 350_000 && item.bandwidth <= 1_600_000)
  const pool = usable.length ? usable : variants
  return pool.sort((a, b) => Math.abs(a.bandwidth - target) - Math.abs(b.bandwidth - target))[0].url
}

/** 外部取消或超时，任一发生就中止。 */
function withDeadline(signal: AbortSignal, ms: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController()
  const stop = () => controller.abort()
  const timer = window.setTimeout(stop, ms)
  if (signal.aborted) stop()
  else signal.addEventListener('abort', stop, { once: true })
  return {
    signal: controller.signal,
    clear: () => {
      window.clearTimeout(timer)
      signal.removeEventListener('abort', stop)
    },
  }
}

async function readPlaylist(upstream: string, signal: AbortSignal): Promise<{ text: string; url: string }> {
  const response = await fetch(playProxy(upstream), { credentials: useProxy ? 'same-origin' : 'omit', signal })
  const text = stripInjectedAds(await response.text())
  if (!response.ok || !text.includes('#EXTM3U')) throw new Error('播放列表无效')
  return { text, url: upstreamFromPlay(response.url) || upstream }
}

function looksLikeMedia(buf: Uint8Array): boolean {
  if (buf.length < 188) return false
  if (buf[0] === 0x47) return true
  const head = String.fromCharCode(...buf.subarray(0, 32))
  return head.includes('ftyp')
}

type Sample = {
  bytes: Uint8Array
  aborted: boolean
  capped: boolean
  size: number
  headerSize: number
  /** 发出请求到收到响应头。 */
  waitMs: number
  /** 收到响应头之后读数据用的时间。 */
  readMs: number
}

async function readLimited(url: string, signal: AbortSignal): Promise<Sample> {
  const limit = withDeadline(signal, SAMPLE_MS)
  const sent = Date.now()
  let response: Response
  try {
    response = await fetch(url, { signal: limit.signal, credentials: useProxy ? 'same-origin' : 'omit' })
  } catch {
    limit.clear()
    return { bytes: new Uint8Array(), aborted: true, capped: false, size: 0, headerSize: 0, waitMs: Date.now() - sent, readMs: 0 }
  }
  if (!response.ok || !response.body) {
    limit.clear()
    throw new Error('片段没有回应')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let aborted = false
  let capped = false
  const started = Date.now()
  try {
    while (true) {
      const step = await reader.read()
      if (step.done) break
      chunks.push(step.value)
      total += step.value.length
      if (total >= SAMPLE_BYTES || Date.now() - started >= SAMPLE_READ_MS) {
        capped = true
        void reader.cancel()
        break
      }
    }
  } catch {
    aborted = true
  } finally {
    limit.clear()
  }
  const readMs = Date.now() - started
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  const headerSize = Number(response.headers.get('content-length') || 0)
  return { bytes, aborted, capped, size: headerSize || total, headerSize, waitMs: started - sent, readMs }
}

/** ratio 为 0 表示没测出速度（没测或分片超时），只在别的线路都不行时才用。 */
type ProbeEntry = PlayLine & { mediaUrl?: string; playUrl?: string; ratio?: number; bitrate?: number }

/** 解析出这条线路的播放列表；measure 为真时再拉一个分片测速。 */
async function probeEntry(entry: PlayLine, signal: AbortSignal, measure: boolean): Promise<ProbeEntry | null> {
  const html = await fetchHtml(entry.playPath, signal)
  const master = parsePlay(html)
  const playlist = await readPlaylist(master, signal)
  const variantUrl = chooseVariant(playlist.text, playlist.url)
  const media = variantUrl === playlist.url ? playlist : await readPlaylist(variantUrl, signal)
  const rows = media.text.split(/\r?\n/)
  const segments: { duration: number; url: string }[] = []
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXTINF:')) continue
    const duration = Number.parseFloat(rows[index].slice(8))
    const uri = (rows[index + 1] || '').trim()
    if (!uri || uri.startsWith('#') || !duration) continue
    segments.push({ duration, url: uri })
  }
  const sample = segments[Math.min(6, Math.max(segments.length - 1, 0))]
  if (!sample) return null
  seedPlaylist(media.url, media.text)
  const found = { ...entry, mediaUrl: media.url, playUrl: absolutePlayUrl(media.url), ratio: 0, bitrate: 0 }
  if (!measure) return found
  const segmentUrl = new URL(sample.url, media.url).href
  const { bytes, aborted, capped, size, headerSize, waitMs, readMs } = await readLimited(playProxy(segmentUrl), signal)
  if (aborted && bytes.length < 188) return found
  if (!looksLikeMedia(bytes) || !size || (aborted && !headerSize && !capped)) return null
  // 只读了一部分时按读取速度推算整段要多久，等响应头的时间只算一次。
  const fullMs = waitMs + (headerSize * Math.max(readMs, 50)) / bytes.length
  const ratio = headerSize
    ? (sample.duration * 1000) / fullMs
    : (bytes.length * 8) / ((Math.max(waitMs + readMs, 50) / 1000) * 800_000)
  const bitrate = sample.duration > 0 ? ((headerSize || size) * 8) / sample.duration : 0
  return { ...found, ratio, bitrate }
}

/** 首页和各频道页同时拉，哪页先到先交出去；全部失败才算失败。 */
export async function loadHome(onPart: (videos: VideoItem[], home: boolean) => void): Promise<void> {
  const parts = [
    fetchHtml('/').then((html) => onPart([...parseCarousel(html), ...parseCards(html, 'movie')], true)),
    ...CHANNELS.map((channel) => fetchHtml(channel.path).then((html) => onPart(parseCards(html, channel.id), false))),
  ]
  const results = await Promise.allSettled(parts)
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed.length === results.length) throw failed[0].reason
}

export async function loadDetail(id: string): Promise<VideoItem> {
  if (!/^\d+$/.test(id)) throw new Error('没有这部片子')
  return parseDetail(await fetchHtml(`/detail/${id}.html`), id)
}

/**
 * 搜索要带片库页面里的口令 t，口令会过期，过期时照样返回 0 条。
 * 先用记住的口令；搜到 0 条且结果页给了不同的口令，就换上再搜一次。
 */
export async function loadSearch(keyword: string): Promise<VideoItem[]> {
  const q = keyword.trim()
  if (!q) return []
  if (tokenWarming) await tokenWarming
  const read = async (token: string) => {
    const html = await fetchHtml(`/search?k=${encodeURIComponent(q)}${token ? `&t=${encodeURIComponent(token)}` : ''}`)
    return { items: parseSearch(html), token: html.match(/name="t" value="([^"]+)"/)?.[1] || '' }
  }
  const used = searchToken.value
  const first = await read(used)
  if (first.items.length || !first.token || first.token === used) return first.items
  return (await read(first.token)).items
}

/** 要开始输入时，口令放久了就先换个新的，真正搜索时只要一次请求。 */
export function warmSearchToken(): void {
  if (tokenWarming || Date.now() - searchToken.at < TOKEN_FRESH_MS) return
  tokenWarming = fetchHtml('/search?k=')
    .catch(() => undefined)
    .finally(() => {
      tokenWarming = null
    })
}

/** 够流畅的里挑码率最低的，都不够就挑最快的。 */
function bestOf(pool: ProbeEntry[]): ProbeEntry {
  const steady = pool.filter((item) => (item.ratio || 0) >= STEADY_RATIO)
  if (steady.length) return [...steady].sort((a, b) => (a.bitrate || Infinity) - (b.bitrate || Infinity))[0]
  return [...pool].sort((a, b) => (b.ratio || 0) - (a.ratio || 0))[0]
}

/**
 * 同时测几条线路，测挂一条或测得太久就补上下一条。排在前面的线路够快就用它；
 * 否则第一条测出速度的线路测完后再等一小会儿，从已测完的里挑；都没测出速度，就用排在最前、播放列表正常的那条。
 * 选定后其余请求全部取消。
 */
function raceLines(picked: PlayLine[]): Promise<ProbeEntry> {
  const controllers = picked.map(() => new AbortController())
  const results: Array<ProbeEntry | null | undefined> = picked.map(() => undefined)
  const timers: number[] = []
  return new Promise((resolve, reject) => {
    let settled = false
    let graceStarted = false
    let next = 0
    const finish = (entry: ProbeEntry | undefined) => {
      if (settled) return
      settled = true
      for (const timer of timers) window.clearTimeout(timer)
      for (const controller of controllers) controller.abort()
      if (entry) resolve(entry)
      else reject(new Error('这一集没有可播放的线路'))
    }
    const decide = (late: boolean) => {
      for (const result of results) {
        if (result === undefined && !late) break
        if (result && (result.ratio || 0) >= GOOD_RATIO) return finish(result)
      }
      const pool = results.filter((result): result is ProbeEntry => Boolean(result?.ratio))
      if (late && pool.length) return finish(bestOf(pool))
      if (results.some((result) => result === undefined)) return
      finish(pool.length ? bestOf(pool) : results.find((result): result is ProbeEntry => Boolean(result)))
    }
    const launch = () => {
      if (settled || next >= picked.length) return
      const index = next
      next += 1
      const slow = window.setTimeout(launch, SLOW_LINE_MS)
      timers.push(slow)
      probeEntry(picked[index], controllers[index].signal, true)
        .catch(() => null)
        .then((found) => {
          window.clearTimeout(slow)
          results[index] = found?.playUrl ? found : null
          if (settled) return
          if (!results[index]?.ratio) launch()
          else if (!graceStarted) {
            graceStarted = true
            timers.push(window.setTimeout(() => decide(true), PICK_GRACE_MS))
          }
          decide(false)
        })
    }
    for (let lane = 0; lane < Math.min(RACE_LANES, picked.length); lane += 1) launch()
  })
}

function pickLines(list: PlayLine[]): PlayLine[] {
  const ranked = [...list].sort((a, b) => lineRank(a.label, a.note) - lineRank(b.label, b.note))
  const picked: PlayLine[] = []
  const textOf = (entry: PlayLine) => `${entry.label} ${entry.note}`
  const take = (match: (text: string) => boolean, limit: number) => {
    let count = 0
    for (const entry of ranked) {
      if (picked.length >= 6 || count >= limit) return
      if (picked.includes(entry) || !match(textOf(entry))) continue
      picked.push(entry)
      count += 1
    }
  }
  const heavy = (text: string) => /蓝光|4K|超清|1080|原画/.test(text)
  take((text) => /标清/.test(text) && !heavy(text), 2)
  take((text) => /720/.test(text) && !heavy(text), 2)
  take((text) => /极速|播放快|流畅/.test(text) && !heavy(text), 2)
  take((text) => /大陆/.test(text) && !heavy(text), 1)
  take((text) => !heavy(text), 6)
  if (!picked.length) take(() => true, 3)
  return picked
}

/** only：用户点名的线路，不测速直接用，慢不慢由用户自己判断。只有一条线路时也不用测。 */
export async function loadPlay(entries: PlayLine[], only = false): Promise<{ url: string; line: string }> {
  const list = entries.filter((entry) => PLAY_PATH.test(entry.playPath))
  if (!list.length) throw new Error('没有播放地址')
  const key = `${only ? '1' : '0'}:${list.map((entry) => entry.playPath).join('|')}`
  const cached = playCache.get(key)
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value
  const running = playLoads.get(key)
  if (running) return running
  const task = (async () => {
    const picked = pickLines(list)
    const best =
      only || picked.length === 1
        ? await probeEntry(picked[0], new AbortController().signal, false).catch(() => null)
        : await raceLines(picked)
    if (!best?.playUrl) throw new Error('这一集没有可播放的线路')
    const value = {
      url: absolutePlayUrl(best.playUrl || best.mediaUrl || ''),
      line: [best.label, best.note].filter(Boolean).join(' · '),
    }
    playCache.set(key, { at: Date.now(), value })
    return value
  })().finally(() => playLoads.delete(key))
  playLoads.set(key, task)
  return task
}
