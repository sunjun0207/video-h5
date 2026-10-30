export type ChannelId = 'tv' | 'movie' | 'variety' | 'anime' | 'short'

export type PlayLine = {
  label: string
  note: string
  playPath: string
}

export type Episode = {
  id: string
  title: string
  url: string
  playPath?: string
  line?: string
  /** url 是从哪条线路的播放页挑出来的。 */
  linePath?: string
  lines?: PlayLine[]
}

export type VideoItem = {
  id: string
  title: string
  channel: ChannelId
  genres: string[]
  region: string
  year: number
  score: number
  hot: number
  badge?: string
  updateText: string
  actors: string[]
  director: string
  summary: string
  tone: [string, string]
  mark: string
  featured?: boolean
  /** 频道是猜的：片库首页的轮播和各类混排的分区没写是哪一类，等频道页、详情或搜索结果补上。 */
  guessed?: boolean
  /** 在片库首页「最近更新」里的名次，越大越新。 */
  fresh?: number
  cover?: string
  episodes: Episode[]
  /** 详情页（选集、线路）拉到的时间。 */
  loadedAt?: number
  /** 最近一次出现在首页、栏目、搜索或详情里的时间，本地只留最近的一批。 */
  seenAt?: number
}

export type HistoryItem = {
  id: string
  ep: number
  time: number
  at: number
}

export type SortKey = 'hot' | 'new' | 'score'

export type ChannelQuery = {
  channel: ChannelId
  genre: string
  region: string
  year: string
  sort: SortKey
}
