import { stripInjectedAds } from './hlsAds'

/** 片库页始终走 /vod。图片和播放地址仅在 VITE_USE_PROXY=true 时走本站前缀。 */
export const API_PREFIX = '/api-video-pomelo7-server'

export const useProxy = import.meta.env.VITE_USE_PROXY === 'true'

const VOD_TARGET = (import.meta.env.VITE_VOD_TARGET || 'https://www.dushe05.com').replace(/\/$/, '')
const IMG_TARGET = (import.meta.env.VITE_IMG_TARGET || 'https://vres.wkcyvs.cn').replace(/\/$/, '')
const IMG_A_TARGET = (import.meta.env.VITE_IMG_A_TARGET || 'https://103.39.111.180:51050').replace(/\/$/, '')
const IMG_B_TARGET = (import.meta.env.VITE_IMG_B_TARGET || 'https://103.39.111.184:51050').replace(/\/$/, '')

export const VOD_COOKIE_PATH = `${API_PREFIX}/vod`

/** 封面直连时的主图源，页面一打开就可以先建连接。走代理时为空。 */
export const DIRECT_IMAGE_ORIGIN = useProxy ? '' : IMG_TARGET

const PAGE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export const PROXY_HEADERS = {
  Referer: `${VOD_TARGET}/`,
  'User-Agent': PAGE_UA,
}

function joinTarget(target: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${target}${normalized}`
}

function playProxyPath(absolute: string): string {
  const target = new URL(absolute)
  const scheme = target.protocol === 'https:' ? 'https' : 'http'
  const port = target.port || (scheme === 'https' ? '443' : '80')
  return `${API_PREFIX}/play/${scheme}/${target.hostname}/${port}${target.pathname}${target.search}`
}

function vodProxyPath(path: string): string {
  if (path.startsWith('http')) {
    const target = new URL(path)
    return `${API_PREFIX}/vod${target.pathname}${target.search}`
  }
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${API_PREFIX}/vod${normalized}`
}

function coverProxyPath(raw: string): string {
  const target = new URL(raw)
  const origin = `${target.protocol}//${target.host}`
  const prefix =
    origin === IMG_A_TARGET ? `${API_PREFIX}/img-a` : origin === IMG_B_TARGET ? `${API_PREFIX}/img-b` : `${API_PREFIX}/img`
  return `${prefix}${target.pathname}${target.search}`
}

function asPlayProxy(absolute: string): string {
  const upstream = upstreamFromPlay(absolute) || absolute
  if (!upstream.startsWith('http')) return absolute
  return new URL(playProxyPath(upstream), window.location.origin).href
}

export function vodUrl(path: string): string {
  return vodProxyPath(path)
}

export function coverUrl(raw: string): string {
  if (!raw || raw.includes('logo_placeholder')) return ''
  if (!useProxy) {
    if (raw.startsWith('http')) return raw
    if (raw.startsWith('/')) return joinTarget(IMG_TARGET, raw)
    return ''
  }
  if (raw.startsWith('/')) return `${API_PREFIX}/img${raw}`
  try {
    return coverProxyPath(raw)
  } catch {
    return ''
  }
}

export function nextCover(url: string): string {
  if (url.includes(`${API_PREFIX}/img-b/`)) return ''
  if (url.includes(`${API_PREFIX}/img-a/`)) return url.replace(`${API_PREFIX}/img-a/`, `${API_PREFIX}/img-b/`)
  if (url.includes(`${API_PREFIX}/img/`)) return url.replace(`${API_PREFIX}/img/`, `${API_PREFIX}/img-a/`)
  if (url.startsWith(IMG_TARGET)) return IMG_A_TARGET + url.slice(IMG_TARGET.length)
  if (url.startsWith(IMG_A_TARGET)) return IMG_B_TARGET + url.slice(IMG_A_TARGET.length)
  return ''
}

export function playProxy(absolute: string): string {
  if (!absolute.startsWith('http')) return absolute
  if (!useProxy) return absolute
  return playProxyPath(absolute)
}

export function absolutePlayUrl(absolute: string): string {
  if (!useProxy) return absolute
  return asPlayProxy(absolute)
}

export function upstreamFromPlay(value: string): string | null {
  const path = value.startsWith('http') ? `${new URL(value).pathname}${new URL(value).search}` : value
  const matched = path.match(/^\/api-video-pomelo7-server\/play\/(https?)\/([^/]+)\/(\d+)(\/.*)$/)
  if (!matched) return null
  const scheme = matched[1]
  const host = matched[2]
  const port = matched[3]
  const rest = matched[4]
  const omit = (scheme === 'https' && port === '443') || (scheme === 'http' && port === '80')
  return `${scheme}://${host}${omit ? '' : `:${port}`}${rest}`
}

const SEED_MS = 2 * 60 * 1000
const seeded = new Map<string, { text: string; at: number }>()

/** 选线时已经拉过的播放列表先留着，播放器第一次要时直接给，省一次往返。 */
export function seedPlaylist(upstream: string, text: string) {
  const now = Date.now()
  for (const [key, entry] of seeded) if (now - entry.at > SEED_MS) seeded.delete(key)
  seeded.set(upstream, { text, at: now })
}

export function takePlaylist(upstream: string): string | null {
  const entry = seeded.get(upstream)
  if (!entry) return null
  seeded.delete(upstream)
  return Date.now() - entry.at > SEED_MS ? null : entry.text
}

export function rewritePlaylist(text: string, upstreamUrl: string): string {
  const cleaned = stripInjectedAds(text)
  const base = new URL(upstreamUrl)
  const mapUri = (uri: string) => {
    const absolute = new URL(uri, base).href
    return useProxy ? asPlayProxy(absolute) : absolute
  }
  return cleaned
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line
      if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${mapUri(uri)}"`)
      return mapUri(line.trim())
    })
    .join('\n')
}
