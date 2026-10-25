import { useCallback, useEffect, useState } from 'react'
import { BottomNav } from './components/BottomNav'
import { ChannelNav } from './components/ChannelNav'
import { Header } from './components/Header'
import { addSearchHistory } from './lib/storage'
import { href, parseHash, type Route } from './lib/router'
import { ChannelPage } from './pages/ChannelPage'
import { DetailPage } from './pages/DetailPage'
import { HomePage } from './pages/HomePage'
import { LibraryPage } from './pages/LibraryPage'
import { PlayPage } from './pages/PlayPage'
import { SearchPage } from './pages/SearchPage'

function readRoute(): Route {
  return parseHash(window.location.hash)
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [libraryVersion, setLibraryVersion] = useState(0)
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
    const base = import.meta.env.VITE_APP_TITLE || '观影jun.sun'
    document.title = route.name === 'home' ? base : `${pageTitle(route)} - ${base.replace(/ · .+$/, '')}`
  }, [route])

  const onSearch = (keyword: string) => {
    const text = keyword.trim()
    if (text) addSearchHistory(text)
    bump()
    window.location.hash = href({ name: 'search', q: text })
  }

  const playing = route.name === 'play'

  return (
    <div className={playing ? 'app playing' : 'app'}>
      <Header />
      {playing ? null : <ChannelNav route={route} />}
      <main>
        {route.name === 'home' ? <HomePage onSearch={onSearch} /> : null}
        {route.name === 'channel' ? <ChannelPage channel={route.channel} /> : null}
        {route.name === 'search' ? (
          <SearchPage keyword={route.q} libraryVersion={libraryVersion} onLibraryChange={bump} onSearch={onSearch} />
        ) : null}
        {route.name === 'detail' ? (
          <DetailPage id={route.id} libraryVersion={libraryVersion} onLibraryChange={bump} />
        ) : null}
        {route.name === 'play' ? <PlayPage id={route.id} ep={route.ep} onLibraryChange={bump} /> : null}
        {route.name === 'favorite' ? (
          <LibraryPage mode="favorite" libraryVersion={libraryVersion} onLibraryChange={bump} />
        ) : null}
        {route.name === 'history' ? (
          <LibraryPage mode="history" libraryVersion={libraryVersion} onLibraryChange={bump} />
        ) : null}
      </main>
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
      return route.q ? route.q : '寻一部'
    case 'detail':
      return '故事'
    case 'play':
      return '观看'
    case 'favorite':
      return '收藏'
    case 'history':
      return '足迹'
  }
}
