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
