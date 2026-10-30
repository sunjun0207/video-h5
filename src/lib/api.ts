import { CHANNELS } from './catalog'
import type { ChannelId, ChannelQuery, Episode, VideoItem } from './types'

/** 片单存在本地，下次打开先用旧的，后台再刷新。 */
const STORE_KEY = 'video_h5_catalog_v2'
/** 旧版片单把首页的剧集、综艺都记成了电影，直接丢掉重拉。 */
const LEGACY_KEYS = ['video_h5_catalog_v1']
const STORE_MAX = 600
/** 只给最近看过详情的这么多部存选集，避免撑爆 localStorage。 */
const STORE_DETAILS = 40

let videos: VideoItem[] = []
let homeAt = 0
let version = 0
let saveTimer = 0
const listeners = new Set<() => void>()

function readStore() {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return
    const data = JSON.parse(raw) as { homeAt?: number; items?: VideoItem[] }
    if (!Array.isArray(data.items)) return
    videos = data.items.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        Array.isArray(item.actors) &&
        Array.isArray(item.genres) &&
        Array.isArray(item.episodes) &&
        Array.isArray(item.tone),
    )
    homeAt = Number(data.homeAt) || 0
  } catch {
    videos = []
    homeAt = 0
  }
}

readStore()

function storedEpisodes(episodes: Episode[]): Episode[] {
  return episodes.map((episode) => ({ id: episode.id, title: episode.title, url: '', playPath: episode.playPath, lines: episode.lines }))
}

function writeStore() {
  saveTimer = 0
  const detailed = new Set(
    videos
      .filter((item) => item.episodes.length && item.loadedAt)
      .sort((a, b) => (b.loadedAt || 0) - (a.loadedAt || 0))
      .slice(0, STORE_DETAILS)
      .map((item) => item.id),
  )
  const recent = new Set(
    [...videos]
      .sort((a, b) => (b.seenAt || 0) - (a.seenAt || 0))
      .slice(0, STORE_MAX)
      .map((item) => item.id),
  )
  const items = videos
    .filter((item) => recent.has(item.id))
    .map((item) =>
      detailed.has(item.id) ? { ...item, episodes: storedEpisodes(item.episodes) } : { ...item, episodes: [], loadedAt: undefined },
    )
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ homeAt, items }))
  } catch {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ homeAt, items: items.map((item) => ({ ...item, episodes: [], loadedAt: undefined })) }))
    } catch {
      localStorage.removeItem(STORE_KEY)
    }
  }
}

function changed() {
  version += 1
  for (const listener of listeners) listener()
  if (!saveTimer) saveTimer = window.setTimeout(writeStore, 800)
}

export function subscribeVideos(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function videosVersion(): number {
  return version
}

export function videoCount(): number {
  return videos.length
}

/** 上次完整拉到首页片单的时间，0 表示从没拉到过。 */
export function homeLoadedAt(): number {
  return homeAt
}

export function markHomeLoaded(): void {
  homeAt = Date.now()
  changed()
}

/** 新一轮首页数据到来前，旧的推荐顺序作废。 */
export function resetHomeRank(): void {
  for (const item of videos) {
    item.hot = Math.min(item.hot, 1)
    item.featured = false
    item.fresh = undefined
  }
}

/** 合并片单：已有的保留选集等详情，只补缺的字段。 */
export function mergeVideos(list: VideoItem[]): void {
  if (!list.length) return
  const now = Date.now()
  const index = new Map(videos.map((item) => [item.id, item]))
  const added: VideoItem[] = []
  for (const item of list) {
    const prev = index.get(item.id)
    if (!prev) {
      item.seenAt = now
      index.set(item.id, item)
      added.push(item)
      continue
    }
    prev.seenAt = now
    if (!prev.cover && item.cover) prev.cover = item.cover
    if (!prev.summary && item.summary) prev.summary = item.summary
    if (!prev.actors.length && item.actors.length) prev.actors = item.actors
    if (!prev.genres.length && item.genres.length) prev.genres = item.genres
    if (!prev.region && item.region) prev.region = item.region
    if (!prev.year && item.year) prev.year = item.year
    if (item.score) prev.score = item.score
    if (item.badge) prev.badge = item.badge
    if (item.featured) prev.featured = true
    if (item.hot > prev.hot) prev.hot = item.hot
    if ((item.fresh || 0) > (prev.fresh || 0)) prev.fresh = item.fresh
    if (prev.guessed && !item.guessed) {
      prev.channel = item.channel
      prev.guessed = undefined
    }
    if (!prev.episodes.length && item.updateText) prev.updateText = item.updateText
  }
  videos = [...videos, ...added]
  changed()
}

export function upsertVideo(item: VideoItem): void {
  item.seenAt = Date.now()
  const index = videos.findIndex((video) => video.id === item.id)
  if (index >= 0) videos[index] = item
  else videos = [item, ...videos]
  changed()
}

export function channelName(id: ChannelId): string {
  return CHANNELS.find((item) => item.id === id)?.name ?? id
}

export function getVideo(id: string): VideoItem | undefined {
  return videos.find((item) => item.id === id)
}

export function heroVideos(): VideoItem[] {
  const picked = videos.filter((item) => item.featured)
  return picked.length ? picked : rankVideos(4)
}

export function rankVideos(limit = 8): VideoItem[] {
  return [...videos].sort((a, b) => b.hot - a.hot).slice(0, limit)
}

/** 频道是猜的不算，免得剧集、综艺混进电影里。 */
function inChannel(item: VideoItem, channel: ChannelId): boolean {
  return item.channel === channel && !item.guessed
}

export function listByChannel(channel: ChannelId): VideoItem[] {
  return videos.filter((item) => inChannel(item, channel)).sort((a, b) => b.hot - a.hot)
}

export function suggestVideos(keyword: string, limit = 8): VideoItem[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return []
  return videos
    .filter((item) => {
      const haystack = [item.title, item.director, ...item.actors].join(' ').toLowerCase()
      return haystack.includes(q)
    })
    .slice(0, limit)
}

export type HomeLayout = {
  hero: VideoItem[]
  rank: VideoItem[]
  picks: VideoItem[]
  fresh: VideoItem[]
  channels: { channel: ChannelId; items: VideoItem[] }[]
  top: VideoItem[]
}

/**
 * 首页从上到下：轮播、热门推荐、猜你喜欢、最新上线、各频道、高分推荐。
 * 前面的栏目放过的，后面就不再放，同一部只出现一次。
 */
export function homeLayout(watched: string[]): HomeLayout {
  const shown = new Set<string>()
  const take = (list: VideoItem[], limit: number) => {
    const picked: VideoItem[] = []
    for (const item of list) {
      if (picked.length >= limit) break
      if (shown.has(item.id)) continue
      shown.add(item.id)
      picked.push(item)
    }
    return picked
  }
  const ranked = rankVideos(videos.length)
  const seen = new Set(watched)
  return {
    hero: take(heroVideos(), 8),
    rank: take(ranked, 8),
    picks: take(mixChannels(ranked.filter((item) => !seen.has(item.id)), watched), 12),
    fresh: take(
      videos.filter((item) => item.fresh).sort((a, b) => (b.fresh || 0) - (a.fresh || 0)),
      12,
    ),
    channels: CHANNELS.map((channel) => ({
      channel: channel.id,
      items: take(ranked.filter((item) => inChannel(item, channel.id)), 12),
    })),
    top: take(
      videos.filter((item) => item.score >= 7.5).sort((a, b) => b.score - a.score || b.hot - a.hot),
      12,
    ),
  }
}

/** 各频道轮流出一部，看过哪类多，哪类排前面；频道没确定的单算一组。 */
function mixChannels(ranked: VideoItem[], watched: string[]): VideoItem[] {
  const weight = new Map<string, number>()
  for (const id of watched) {
    const item = getVideo(id)
    if (item && !item.guessed) weight.set(item.channel, (weight.get(item.channel) || 0) + 1)
  }
  const groups = new Map<string, VideoItem[]>()
  for (const item of ranked) {
    const key = item.guessed ? '' : item.channel
    const group = groups.get(key)
    if (group) group.push(item)
    else groups.set(key, [item])
  }
  const order = [...groups.keys()].sort((a, b) => (weight.get(b) || 0) - (weight.get(a) || 0))
  const mixed: VideoItem[] = []
  for (let round = 0; mixed.length < ranked.length; round += 1) {
    for (const key of order) {
      const item = groups.get(key)?.[round]
      if (item) mixed.push(item)
    }
  }
  return mixed
}

export function relatedVideos(id: string, limit = 6): VideoItem[] {
  const current = getVideo(id)
  const ranked = rankVideos(videos.length).filter((item) => item.id !== id)
  if (!current || current.guessed) return ranked.slice(0, limit)
  const same = ranked.filter((item) => inChannel(item, current.channel))
  const picked = new Set(same.map((item) => item.id))
  return [...same, ...ranked.filter((item) => !picked.has(item.id))].slice(0, limit)
}

export function channelFacets(channel: ChannelId) {
  const list = videos.filter((item) => inChannel(item, channel))
  const genres = unique(list.flatMap((item) => item.genres))
  const regions = unique(list.map((item) => item.region).filter(Boolean))
  const years = unique(list.map((item) => String(item.year)).filter((item) => item !== '0')).sort(
    (a, b) => Number(b) - Number(a),
  )
  return { genres, regions, years }
}

export function queryChannel(query: ChannelQuery): VideoItem[] {
  let list = videos.filter((item) => inChannel(item, query.channel))
  if (query.genre !== '全部') list = list.filter((item) => item.genres.includes(query.genre))
  if (query.region !== '全部') list = list.filter((item) => item.region === query.region)
  if (query.year !== '全部') list = list.filter((item) => String(item.year) === query.year)
  if (query.sort === 'new') list.sort((a, b) => b.year - a.year || b.hot - a.hot)
  else if (query.sort === 'score') list.sort((a, b) => b.score - a.score || b.hot - a.hot)
  else list.sort((a, b) => b.hot - a.hot)
  return list
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}
