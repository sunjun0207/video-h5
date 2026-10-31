import { useEffect, useMemo, useState } from 'react'
import { rankVideos } from '../lib/api'
import { useCatalog, useVideos } from '../lib/source'
import { clearSearchHistory, getSearchHistory, removeSearchHistory, subscribeSearchHistory } from '../lib/storage'
import { RankList } from './RankList'

type Props = {
  /** 新搜索写入历史后由页面带过来，用来刷新这一栏。 */
  revision: number
  onSearch: (keyword: string) => void
}

export function SearchDiscover({ revision, onSearch }: Props) {
  const { ready } = useCatalog()
  const version = useVideos()
  const [localRev, setLocalRev] = useState(0)
  const [history, setHistory] = useState(getSearchHistory)
  const hot = useMemo(() => (ready ? rankVideos(10) : []), [ready, version])
  const bump = () => setLocalRev((value) => value + 1)

  useEffect(() => {
    const sync = () => setHistory(getSearchHistory())
    sync()
    return subscribeSearchHistory(sync)
  }, [revision, localRev])

  return (
    <div className="search-discover">
      <section className="history-block">
        <div className="block-head">
          <h2>搜索历史</h2>
          {history.length ? (
            <button
              type="button"
              className="text-btn"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                clearSearchHistory()
                bump()
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
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onSearch(item)}>
                  {item}
                </button>
                <button
                  type="button"
                  aria-label={`删除 ${item}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    removeSearchHistory(item)
                    bump()
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </section>
      <RankList items={hot} title="热搜榜" desc="大家都在搜，点一下就看" />
    </div>
  )
}
