/** 品牌名跟着构建环境走，标题里「 · 」后面的副标题不算。 */
export const BRAND = (import.meta.env.VITE_APP_TITLE || '观影jun.sun').replace(/ · .+$/, '')
export const SLOGAN = '好看的，都在这里！'

/** row、desc 是首页栏目名和副标题，desc 也用在频道页标题下面。 */
export const CHANNELS: { id: 'movie' | 'tv' | 'anime' | 'variety' | 'short'; name: string; row: string; desc: string }[] = [
  { id: 'movie', name: '电影', row: '精品影视', desc: '精选好内容，享受视觉盛宴' },
  { id: 'tv', name: '连续剧', row: '爆款热播', desc: '高人气作品，越看越精彩' },
  { id: 'anime', name: '动漫', row: '人气动漫', desc: '热血燃情，每一帧都精彩' },
  { id: 'variety', name: '综艺纪录', row: '综艺纪录', desc: '轻松一刻，看见更大的世界' },
  { id: 'short', name: '短剧', row: '人气短剧', desc: '高能剧情，根本停不下来' },
]
