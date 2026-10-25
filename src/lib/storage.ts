import type { HistoryItem } from './types'

const KEYS = {
  searchHistory: 'video_h5_search_history',
  favorites: 'video_h5_favorites',
  history: 'video_h5_history',
} as const

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function getSearchHistory(): string[] {
  return readJson<string[]>(KEYS.searchHistory, [])
}

export function addSearchHistory(keyword: string) {
  const text = keyword.trim()
  if (!text) return
  const list = getSearchHistory().filter((item) => item !== text)
  list.unshift(text)
  writeJson(KEYS.searchHistory, list.slice(0, 12))
}

export function removeSearchHistory(keyword: string) {
  writeJson(
    KEYS.searchHistory,
    getSearchHistory().filter((item) => item !== keyword),
  )
}

export function clearSearchHistory() {
  writeJson(KEYS.searchHistory, [])
}

export function getFavorites(): string[] {
  return readJson<string[]>(KEYS.favorites, [])
}

export function isFavorite(id: string): boolean {
  return getFavorites().includes(id)
}

export function toggleFavorite(id: string): boolean {
  const list = getFavorites()
  const exists = list.includes(id)
  const next = exists ? list.filter((item) => item !== id) : [id, ...list]
  writeJson(KEYS.favorites, next.slice(0, 100))
  return !exists
}

export function getHistory(): HistoryItem[] {
  return readJson<HistoryItem[]>(KEYS.history, [])
}

export function rememberPlay(id: string, ep: number, time: number) {
  const list = getHistory().filter((item) => item.id !== id)
  list.unshift({ id, ep, time: Number.isFinite(time) ? time : 0, at: Date.now() })
  writeJson(KEYS.history, list.slice(0, 50))
}

export function historyOf(id: string): HistoryItem | undefined {
  return getHistory().find((item) => item.id === id)
}

export function clearHistory() {
  writeJson(KEYS.history, [])
}
