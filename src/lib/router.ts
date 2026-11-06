import type { ChannelId } from './types'

export type Route =
  | { name: 'home' }
  | { name: 'channel'; channel: ChannelId }
  | { name: 'search'; q: string }
  | { name: 'detail'; id: string }
  | { name: 'play'; id: string; ep: number }
  | { name: 'favorite' }
  | { name: 'history' }

const CHANNELS = new Set<ChannelId>(['tv', 'movie', 'variety', 'anime', 'short'])

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/'
  const [path, query = ''] = raw.split('?')
  const parts = path.split('/').filter(Boolean)
  const params = new URLSearchParams(query)
  if (parts[0] === 'channel' && CHANNELS.has(parts[1] as ChannelId)) {
    return { name: 'channel', channel: parts[1] as ChannelId }
  }
  if (parts[0] === 'search') return { name: 'search', q: params.get('q') ?? '' }
  if (parts[0] === 'detail' && parts[1]) return { name: 'detail', id: decodeURIComponent(parts[1]) }
  if (parts[0] === 'play' && parts[1]) {
    const ep = Number(parts[2] ?? 0)
    return {
      name: 'play',
      id: decodeURIComponent(parts[1]),
      ep: Number.isFinite(ep) && ep >= 0 ? Math.floor(ep) : 0,
    }
  }
  if (parts[0] === 'favorite') return { name: 'favorite' }
  if (parts[0] === 'history') return { name: 'history' }
  return { name: 'home' }
}

type NavState = { appDepth?: number }

let scrollSaver: (() => void) | null = null

/** 换页前记下当前滚动位置，避免浏览器先滚回顶部把位置冲掉。 */
export function bindScrollSaver(save: () => void) {
  scrollSaver = save
}

function navState(): NavState {
  const state = window.history.state
  return state && typeof state === 'object' ? (state as NavState) : {}
}

function pageUrl(hash: string): string {
  return `${window.location.pathname}${window.location.search}${hash}`
}

function emitHash() {
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

export function appDepth(): number {
  const depth = navState().appDepth
  return typeof depth === 'number' && depth > 0 ? depth : 1
}

export function ensureAppDepth() {
  if (typeof navState().appDepth === 'number') return
  window.history.replaceState({ appDepth: 1 }, '', window.location.href)
}

/** 站内换页。用 pushState 记下层数，系统返回和页面上的返回走同一条历史。 */
export function navigate(route: Route) {
  const next = href(route)
  if (next === href(parseHash(window.location.hash))) return
  scrollSaver?.()
  const depth = appDepth() + 1
  window.history.pushState({ appDepth: depth }, '', pageUrl(next))
  emitHash()
}

function replaceRoute(route: Route) {
  const next = href(route)
  window.history.replaceState({ appDepth: appDepth() }, '', pageUrl(next))
  emitHash()
}

export function goBack(fallback: Route) {
  scrollSaver?.()
  if (appDepth() > 1) {
    window.history.back()
    return
  }
  replaceRoute(fallback)
}

/** 已经在播放页时换集、换片不新增历史，返回键才能回到点进来之前的那一页。 */
export function goPlay(id: string, ep: number) {
  const nextEp = Math.max(0, Math.floor(ep))
  const current = parseHash(window.location.hash)
  if (current.name === 'play' && current.id === id && current.ep === nextEp) return
  const route: Route = { name: 'play', id, ep: nextEp }
  if (current.name === 'play') {
    replaceRoute(route)
    return
  }
  navigate(route)
}

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'channel':
      return `#/channel/${route.channel}`
    case 'search':
      return `#/search?q=${encodeURIComponent(route.q)}`
    case 'detail':
      return `#/detail/${encodeURIComponent(route.id)}`
    case 'play':
      return `#/play/${encodeURIComponent(route.id)}/${route.ep}`
    case 'favorite':
      return '#/favorite'
    case 'history':
      return '#/history'
  }
}
