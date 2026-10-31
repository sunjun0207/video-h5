import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { BottomNav } from './components/BottomNav'
import { ChannelNav } from './components/ChannelNav'
import { Header } from './components/Header'
import { BRAND, SLOGAN } from './lib/catalog'
import { addSearchHistory } from './lib/storage'
import { href, parseHash, type Route } from './lib/router'
import { ChannelPage } from './pages/ChannelPage'
import { DetailPage } from './pages/DetailPage'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { SearchPage } from './pages/SearchPage'
import { Pending } from './components/Pending'

const loadPlayPage = () => import('./pages/PlayPage')
const PlayPage = lazy(() => loadPlayPage().then((mod) => ({ default: mod.PlayPage })))
/** 播放页连同播放器较大：详情页一打开就先下载，其它页面空闲一会儿再下载。 */
const PLAY_CHUNK_IDLE_MS = 4000

function readRoute(): Route {
  return parseHash(window.location.hash)
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [libraryVersion, setLibraryVersion] = useState(0)
  const [searchActive, setSearchActive] = useState(false)
  const bump = useCallback(() => setLibraryVersion((value) => value + 1), [])

  useEffect(() => {
    const sync = () => {
      setRoute(readRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', sync)
    if (!window.location.hash) window.location.hash = '#/'
    return () => window.removeEventListener('hashchange', sync)
  }, [])

  useEffect(() => {
    if (route.name === 'play') return
    const timer = window.setTimeout(() => {
      void loadPlayPage().catch(() => undefined)
    }, route.name === 'detail' ? 0 : PLAY_CHUNK_IDLE_MS)
    return () => window.clearTimeout(timer)
  }, [route.name])

  useEffect(() => {
    document.title = route.name === 'home' ? `${BRAND} - ${SLOGAN}` : `${pageTitle(route)} - ${BRAND}`
  }, [route])

  useEffect(() => {
    setSearchActive(false)
  }, [route])

  useEffect(() => {
    if (!searchActive) {
      document.documentElement.style.removeProperty('--vvh')
      return
    }
    const viewport = window.visualViewport
    if (!viewport) return
    const sync = () => {
      document.documentElement.style.setProperty('--vvh', `${Math.round(viewport.height)}px`)
    }
    sync()
    viewport.addEventListener('resize', sync)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', sync)
      viewport.removeEventListener('scroll', sync)
      document.documentElement.style.removeProperty('--vvh')
    }
  }, [searchActive])

  const onSearch = (keyword: string) => {
    const text = keyword.trim()
    if (text) addSearchHistory(text)
    bump()
    window.location.hash = href({ name: 'search', q: text })
  }

  const playing = route.name === 'play'

  return (
    <div className={playing ? 'app playing' : searchActive ? 'app searching' : 'app'}>
      <Header />
      {playing ? null : <ChannelNav route={route} />}
      <main>
        {route.name === 'home' ? <HomePage onSearch={onSearch} onSearchActive={setSearchActive} /> : null}
        {route.name === 'channel' ? <ChannelPage channel={route.channel} /> : null}
        {route.name === 'search' ? (
          <SearchPage
            keyword={route.q}
            libraryVersion={libraryVersion}
            onLibraryChange={bump}
            onSearch={onSearch}
            onSearchActive={setSearchActive}
          />
        ) : null}
        {route.name === 'detail' ? (
          <DetailPage id={route.id} libraryVersion={libraryVersion} onLibraryChange={bump} />
        ) : null}
        {route.name === 'play' ? (
          <Suspense
            fallback={
              <div className="wrap">
                <Pending text="正在为你加载精彩内容…" />
              </div>
            }
          >
            <PlayPage id={route.id} ep={route.ep} onLibraryChange={bump} />
          </Suspense>
        ) : null}
        {route.name === 'favorite' ? (
          <LibraryPage mode="favorite" libraryVersion={libraryVersion} onLibraryChange={bump} />
        ) : null}
        {route.name === 'history' ? (
          <LibraryPage mode="history" libraryVersion={libraryVersion} onLibraryChange={bump} />
        ) : null}
      </main>
      {playing ? null : (
        <footer className="site-footer">
          <strong>{BRAND}</strong>
          <span>年轻人的精彩视频世界。精彩不设限，快乐不打烊。</span>
        </footer>
      )}
      <BottomNav route={route} />
    </div>
  )
}

function pageTitle(route: Route): string {
  switch (route.name) {
    case 'home':
      return '首页'
    case 'channel':
      return '频道'
    case 'search':
      return route.q ? route.q : '搜一搜'
    case 'detail':
      return '详情'
    case 'play':
      return '正在观看'
    case 'favorite':
      return '收藏'
    case 'history':
      return '足迹'
  }
}
