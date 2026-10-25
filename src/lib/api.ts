import { CHANNELS } from './catalog'
import type { ChannelId, ChannelQuery, VideoItem } from './types'

let videos: VideoItem[] = []

export function videoCount(): number {
  return videos.length
}

export function setVideos(list: VideoItem[]): void {
  videos = list
}

export function upsertVideo(item: VideoItem): void {
  const index = videos.findIndex((video) => video.id === item.id)
  if (index >= 0) videos[index] = item
  else videos = [item, ...videos]
}

export function channelName(id: ChannelId): string {
  return CHANNELS.find((item) => item.id === id)?.name ?? id
}

export function getVideo(id: string): VideoItem | undefined {
  return videos.find((item) => item.id === id)
}

export function heroVideos(): VideoItem[] {
  const picked = videos.filter((item) => item.featured)
  return picked.length ? picked : videos.slice(0, 4)
}

export function rankVideos(limit = 8): VideoItem[] {
  return [...videos].sort((a, b) => b.hot - a.hot).slice(0, limit)
}

export function listByChannel(channel: ChannelId): VideoItem[] {
  return videos.filter((item) => item.channel === channel).sort((a, b) => b.hot - a.hot)
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

export function hotVideos(limit = 12): VideoItem[] {
  return rankVideos(limit)
}

export function relatedVideos(id: string, limit = 6): VideoItem[] {
  const current = getVideo(id)
  if (!current) return rankVideos(limit)
  const same = videos.filter((item) => item.id !== id && item.channel === current.channel)
  const rest = videos.filter((item) => item.id !== id && item.channel !== current.channel)
  return [...same, ...rest].slice(0, limit)
}

export function channelFacets(channel: ChannelId) {
  const list = videos.filter((item) => item.channel === channel)
  const genres = unique(list.flatMap((item) => item.genres))
  const regions = unique(list.map((item) => item.region).filter(Boolean))
  const years = unique(list.map((item) => String(item.year)).filter((item) => item !== '0')).sort(
    (a, b) => Number(b) - Number(a),
  )
  return { genres, regions, years }
}

export function queryChannel(query: ChannelQuery): VideoItem[] {
  let list = videos.filter((item) => item.channel === query.channel)
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
