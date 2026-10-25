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
          <h1 className="page-title">收藏</h1>
          {favorites.length === 0 ? (
            <div className="empty">还没有留下的故事。遇见喜欢的，就把它放在这里。</div>
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
          <h1 className="page-title">最近观看</h1>
          {watched.length ? (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                clearHistory()
                onLibraryChange()
              }}
            >
              忘掉它们
            </button>
          ) : null}
        </div>
        {watched.length === 0 ? (
          <div className="empty">还没有看过的片子。先挑一部，让画面慢慢开始。</div>
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
                      停在 {item.episodes[entry.ep]?.title ?? `第${entry.ep + 1}段`}
                      {entry.time > 1 ? ` · ${formatClock(entry.time)}` : ''}
                    </small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function formatClock(value: number): string {
  const total = Math.floor(value)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
