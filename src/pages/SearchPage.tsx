import { useEffect, useState } from 'react'
import { href } from '../lib/router'
import { searchRemote } from '../lib/source'
import { clearSearchHistory, clearSearchSpot, getSearchHistory, markSearchSpot, readSearchSpot, removeSearchHistory } from '../lib/storage'
import type { VideoItem } from '../lib/types'
import { PosterCard } from '../components/PosterCard'
import { SearchBox } from '../components/SearchBox'
import { Pending } from '../components/Pending'

type Props = {
  keyword: string
  libraryVersion: number
  onLibraryChange: () => void
  onSearch: (keyword: string) => void
}

export function SearchPage({ keyword, libraryVersion, onLibraryChange, onSearch }: Props) {
  const q = keyword.trim()
  const [draft, setDraft] = useState(q)
  const [list, setList] = useState<VideoItem[]>([])
  const [pending, setPending] = useState(Boolean(q))
  const [error, setError] = useState('')
  const [spotId, setSpotId] = useState('')
  const [loadedFor, setLoadedFor] = useState('')
  const history = getSearchHistory()
  void libraryVersion

  useEffect(() => {
    setDraft(q)
  }, [q])

  useEffect(() => {
    if (!q) {
      setList([])
      setLoadedFor('')
      setError('')
      setPending(false)
      return
    }
    let live = true
    setPending(true)
    setError('')
    searchRemote(q)
      .then((items) => {
        if (!live) return
        setList(items)
        setLoadedFor(q)
      })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : '搜索失败')
      })
      .finally(() => {
        if (live) setPending(false)
      })
    return () => {
      live = false
    }
  }, [q])

  useEffect(() => {
    setSpotId('')
  }, [q])

  useEffect(() => {
    if (pending || !q || loadedFor !== q) return
    const id = readSearchSpot(q)
    if (!id) return
    if (!list.some((item) => item.id === id)) {
      clearSearchSpot()
      return
    }
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`search-item-${id}`)?.scrollIntoView({ block: 'center' })
      setSpotId(id)
      clearSearchSpot()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [pending, q, list, loadedFor])

  return (
    <div className="page">
      <div className="wrap">
        <h1 className="page-title">{q ? `遇见「${q}」` : '寻一部'}</h1>
        <SearchBox value={draft} onChange={setDraft} onSubmit={() => onSearch(draft)} />
        {!q ? (
          <section className="history-block">
            <div className="block-head">
              <h2>最近寻过</h2>
              {history.length ? (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    clearSearchHistory()
                    onLibraryChange()
                  }}
                >
                  忘掉它们
                </button>
              ) : null}
            </div>
            {history.length === 0 ? (
              <div className="empty">还没有写下名字。先寻一部，让故事慢慢到来。</div>
            ) : (
              <div className="chips">
                {history.map((item) => (
                  <span key={item} className="chip">
                    <button type="button" onClick={() => onSearch(item)}>
                      {item}
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${item}`}
                      onClick={() => {
                        removeSearchHistory(item)
                        onLibraryChange()
                      }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>
        ) : pending ? (
          <Pending text="正在轻轻寻找…" />
        ) : error ? (
          <div className="empty">{error}</div>
        ) : list.length === 0 ? (
          <div className="empty">没有遇见同名的片子。换个名字再试试。</div>
        ) : (
          <>
            <p className="result-count">遇见 {list.length} 部</p>
            <div className="poster-grid">
              {list.map((item) => (
                <PosterCard
                  key={item.id}
                  item={item}
                  anchorId={`search-item-${item.id}`}
                  marked={item.id === spotId}
                  onOpen={() => markSearchSpot(q, item.id)}
                />
              ))}
            </div>
          </>
        )}
        <p className="search-hint">
          也可以去<a href={href({ name: 'channel', channel: 'movie' })}>电影</a>或
          <a href={href({ name: 'channel', channel: 'anime' })}>动漫</a>里慢慢翻。
        </p>
      </div>
    </div>
  )
}
