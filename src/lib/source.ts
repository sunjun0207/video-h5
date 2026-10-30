import { useEffect, useSyncExternalStore } from 'react'
import {
  getVideo,
  homeLoadedAt,
  markHomeLoaded,
  mergeVideos,
  resetHomeRank,
  subscribeVideos,
  upsertVideo,
  videoCount,
  videosVersion,
} from './api'
import { dropLine, loadDetail, loadHome, loadPlay, loadSearch, type PlayChoice } from './dusheClient'
import type { VideoItem } from './types'

export { warmSearchToken } from './dusheClient'

/** 首页片单在这段时间内不重拉；过期后先显示旧的，后台再换新。 */
const HOME_FRESH_MS = 10 * 60 * 1000
const DETAIL_FRESH_MS = 30 * 60 * 1000
const SEARCH_FRESH_MS = 10 * 60 * 1000
const SEARCH_KEEP = 60

type LibraryState = { ready: boolean; loading: boolean; error: string }

let library: LibraryState = { ready: homeLoadedAt() > 0 && videoCount() > 0, loading: false, error: '' }
let homeRound: Promise<void> | null = null
const libraryListeners = new Set<() => void>()
const detailLoads = new Map<string, Promise<VideoItem>>()
const searches = new Map<string, { at: number; task: Promise<VideoItem[]>; list?: VideoItem[] }>()

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback
}

function setLibrary(next: Partial<LibraryState>) {
  library = { ...library, ...next }
  for (const listener of libraryListeners) listener()
}

function subscribeLibrary(listener: () => void): () => void {
  libraryListeners.add(listener)
  return () => libraryListeners.delete(listener)
}

function readLibrary(): LibraryState {
  return library
}

/** 没有旧片单时哪页先到先显示；有旧片单时等这一轮齐了一次换上，免得推荐顺序来回跳。 */
function refreshHome(): Promise<void> {
  const progressive = !library.ready
  const parts: { videos: VideoItem[]; home: boolean }[] = []
  setLibrary({ loading: true, error: '' })
  return loadHome((videos, home) => {
    parts.push({ videos, home })
    if (!progressive) return
    mergeVideos(videos)
    if (home) setLibrary({ ready: videoCount() > 0 })
  })
    .then(() => {
      const gotHome = parts.some((part) => part.home)
      if (!progressive) {
        if (gotHome) resetHomeRank()
        mergeVideos([...parts.filter((part) => part.home), ...parts.filter((part) => !part.home)].flatMap((part) => part.videos))
      }
      if (gotHome) markHomeLoaded()
      setLibrary({ ready: videoCount() > 0, loading: false })
    })
    .catch((reason: unknown) => {
      setLibrary({ loading: false, error: library.ready ? '' : messageOf(reason, '网络开了个小差，请稍后再试') })
      throw reason
    })
    .finally(() => {
      homeRound = null
    })
}

export function ensureLibrary(): Promise<void> {
  if (!homeRound && (!library.ready || Date.now() - homeLoadedAt() > HOME_FRESH_MS)) {
    homeRound = refreshHome()
    homeRound.catch(() => undefined)
  }
  return homeRound && !library.ready ? homeRound : Promise.resolve()
}

function fetchDetail(id: string): Promise<VideoItem> {
  const running = detailLoads.get(id)
  if (running) return running
  const task = loadDetail(id)
    .then((item) => {
      const current = getVideo(id)
      if (current) {
        item.hot = current.hot || item.hot
        item.featured = current.featured || item.featured
        item.fresh = current.fresh
        if (item.guessed && !current.guessed) {
          item.channel = current.channel
          item.guessed = undefined
        }
        if (!item.score && current.score) item.score = current.score
        if (!item.cover && current.cover) item.cover = current.cover
        if (!item.badge && current.badge) item.badge = current.badge
        for (const episode of item.episodes) {
          const prev = current.episodes.find((old) => old.playPath === episode.playPath)
          if (!prev?.url) continue
          episode.url = prev.url
          episode.line = prev.line
          episode.linePath = prev.linePath
        }
      }
      item.loadedAt = Date.now()
      upsertVideo(item)
      return getVideo(id) ?? item
    })
    .finally(() => detailLoads.delete(id))
  detailLoads.set(id, task)
  return task
}

/** 已有选集就先用；拉到的时间久了，后台再刷新一次。 */
export function ensureDetail(id: string): Promise<VideoItem> {
  const current = getVideo(id)
  const hasLines = current?.episodes.some((episode) => episode.lines && episode.lines.length > 0)
  if (!current || !current.episodes.length || !hasLines) return fetchDetail(id)
  if (Date.now() - (current.loadedAt || 0) > DETAIL_FRESH_MS) void fetchDetail(id).catch(() => undefined)
  return Promise.resolve(current)
}

/** 卡片被指到或按下时先拉详情，点进去就不用再等。 */
export function warmDetail(id: string): void {
  const current = getVideo(id)
  if (current?.episodes.some((episode) => episode.lines && episode.lines.length > 0)) return
  void fetchDetail(id).catch(() => undefined)
}

/** skip：开播时连不上、这次不再挑的线路。 */
export async function ensurePlayUrl(id: string, ep: number, onlyPath = '', skip: string[] = []): Promise<PlayChoice> {
  const item = await ensureDetail(id)
  const episode = item.episodes[ep]
  if (!episode) throw new Error('没有找到这一集')
  const lines = (episode.lines?.length
    ? episode.lines
    : [{ label: episode.title, note: '', playPath: episode.playPath || '' }]
  ).filter((line) => line.playPath)
  const selected = onlyPath
    ? lines.filter((line) => line.playPath === onlyPath)
    : lines.filter((line) => !skip.includes(line.playPath))
  const use = selected.length ? selected : lines
  if (!use.length) throw new Error('没有播放地址')
  if (!onlyPath && episode.url && !skip.includes(episode.linePath || '')) {
    return { url: episode.url, line: episode.line || '', playPath: episode.linePath || '' }
  }
  const data = await loadPlay(use, Boolean(onlyPath))
  episode.url = data.url
  episode.line = data.line
  episode.linePath = data.playPath
  return data
}

/** 这一集挑中的线路开播时连不上：忘掉记住的地址，下次不再先挑它，也不挑给出同一个地址 url 的线路。 */
export function dropPlayLine(id: string, ep: number, playPath: string, url: string): void {
  const episode = getVideo(id)?.episodes[ep]
  if (episode && (episode.linePath === playPath || episode.url === url)) {
    episode.url = ''
    episode.line = ''
    episode.linePath = ''
  }
  dropLine(playPath, url)
}

/** 联想和搜索页共用结果：输入时已经搜过的词，回车后直接出结果。 */
export function searchRemote(keyword: string): Promise<VideoItem[]> {
  const q = keyword.trim()
  const hit = searches.get(q)
  if (hit && Date.now() - hit.at < SEARCH_FRESH_MS) return hit.task
  const task = loadSearch(q).then((list) => {
    mergeVideos(list)
    return list
  })
  const entry: { at: number; task: Promise<VideoItem[]>; list?: VideoItem[] } = { at: Date.now(), task }
  searches.delete(q)
  searches.set(q, entry)
  if (searches.size > SEARCH_KEEP) searches.delete(searches.keys().next().value as string)
  task.then(
    (list) => {
      entry.list = list
    },
    () => {
      if (searches.get(q) === entry) searches.delete(q)
    },
  )
  return task
}

/** 已经搜完的词直接给结果，回到搜索页时不用再等。 */
export function peekSearch(keyword: string): VideoItem[] | undefined {
  const hit = searches.get(keyword.trim())
  return hit && Date.now() - hit.at < SEARCH_FRESH_MS ? hit.list : undefined
}

/** 首页、栏目页用：拉片单，并在片单变动时重画。 */
export function useCatalog(): LibraryState {
  useSyncExternalStore(subscribeVideos, videosVersion)
  const state = useSyncExternalStore(subscribeLibrary, readLibrary)
  useEffect(() => {
    void ensureLibrary().catch(() => undefined)
  }, [])
  return state
}

/** 片单变动时重画，但不主动去拉首页。 */
export function useVideos(): number {
  return useSyncExternalStore(subscribeVideos, videosVersion)
}
