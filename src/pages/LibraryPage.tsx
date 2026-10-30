import { useEffect, useState } from 'react'
import { getVideo } from '../lib/api'
import { href } from '../lib/router'
import { ensureDetail } from '../lib/source'
import { clearHistory, getFavorites, getHistory } from '../lib/storage'
import { PosterCard } from '../components/PosterCard'

type Props = {
  mode: 'favorite' | 'history'
  libraryVersion: number
  onLibraryChange: () => void
}

export function LibraryPage({ mode, libraryVersion, onLibraryChange }: Props) {
  const [tick, setTick] = useState(0)
  void libraryVersion
  const favoriteIds = getFavorites()

  useEffect(() => {
    const ids = mode === 'favorite' ? getFavorites() : getHistory().map((entry) => entry.id)
    let live = true
    Promise.all(ids.filter((id) => !getVideo(id)?.title).map((id) => ensureDetail(id).catch(() => undefined))).then(() => {
      if (live) setTick((value) => value + 1)
    })
    return () => {
      live = false
    }
  }, [mode, libraryVersion])
  void tick
  const history = getHistory()
  const favorites = favoriteIds.map((id) => getVideo(id)).filter((item) => item != null)
  const watched = history.flatMap((entry) => {
    const item = getVideo(entry.id)
    return item ? [{ entry, item }] : []
  })

  if (mode === 'favorite') {
    return (
      <div className="page">
        <div className="wrap">
          <div className="page-head">
            <h1 className="page-title">收藏</h1>
            <p>收下的精彩，都在这里</p>
          </div>
          {favorites.length === 0 ? (
            <EmptyHint />
          ) : (
            <div className="poster-grid">
              {favorites.map((item) => (
                <PosterCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="wrap">
        <div className="block-head">
          <div className="page-head">
            <h1 className="page-title">最近观看</h1>
            <p>继续你的精彩旅程</p>
          </div>
          {watched.length ? (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                clearHistory()
                onLibraryChange()
              }}
            >
              清空记录
            </button>
          ) : null}
        </div>
        {watched.length === 0 ? (
          <EmptyHint />
        ) : (
          <ul className="history-list">
            {watched.map(({ entry, item }) => (
              <li key={item.id}>
                <a href={href({ name: 'play', id: item.id, ep: entry.ep })}>
                  <span className="history-mark" style={{ background: `linear-gradient(160deg, ${item.tone[0]}, ${item.tone[1]})` }}>
                    {item.mark}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      看到 {item.episodes[entry.ep]?.title ?? `第${entry.ep + 1}集`}
                      {entry.time > 1 ? ` · ${formatClock(entry.time)}` : ''}
                    </small>
                  </span>
                  <em className="history-go">接着看</em>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function EmptyHint() {
  return (
    <div className="empty">
      <p>暂时还没有内容，去发现更多精彩吧</p>
      <a className="btn-play" href={href({ name: 'home' })}>
        马上探索
      </a>
    </div>
  )
}

function formatClock(value: number): string {
  const total = Math.floor(value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
