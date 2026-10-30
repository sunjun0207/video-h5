import { useEffect, useState } from 'react'
import { href } from '../lib/router'
import { peekSearch, searchRemote } from '../lib/source'
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
  const [list, setList] = useState<VideoItem[]>(() => peekSearch(q) ?? [])
  const [pending, setPending] = useState(() => Boolean(q) && !peekSearch(q))
  const [error, setError] = useState('')
  const [spotId, setSpotId] = useState('')
  const [loadedFor, setLoadedFor] = useState(() => (peekSearch(q) ? q : ''))
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
    const cached = peekSearch(q)
    if (cached) {
      setList(cached)
      setLoadedFor(q)
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
        if (live) setError(reason instanceof Error ? reason.message : '网络开了个小差，请稍后再试')
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
        <h1 className="page-title">{q ? `「${q}」的精彩内容` : '搜一搜'}</h1>
        <SearchBox value={draft} onChange={setDraft} onSubmit={() => onSearch(draft)} />
        {!q ? (
          <section className="history-block">
            <div className="block-head">
              <h2>最近搜过</h2>
              {history.length ? (
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    clearSearchHistory()
                    onLibraryChange()
                  }}
                >
                  清空
                </button>
              ) : null}
            </div>
            {history.length === 0 ? (
              <div className="empty">暂时还没有搜索记录，去发现更多精彩吧</div>
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
          <Pending text="正在为你加载精彩内容…" />
        ) : error ? (
          <div className="empty">{error}</div>
        ) : list.length === 0 ? (
          <div className="empty">没有找到相关内容，换个关键词试试</div>
        ) : (
          <>
            <p className="result-count">为你找到 {list.length} 部</p>
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
          没想好看什么？去<a href={href({ name: 'channel', channel: 'short' })}>短剧</a>、
          <a href={href({ name: 'channel', channel: 'movie' })}>电影</a>里逛逛，发现更多精彩。
        </p>
      </div>
    </div>
  )
}
