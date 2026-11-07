import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { BottomNav } from './components/BottomNav'
import { MiniPlayer } from './components/MiniPlayer'
import { ChannelNav } from './components/ChannelNav'
import { Header } from './components/Header'
import { BRAND, SLOGAN } from './lib/catalog'
import { consumeNoticeOpen, pausePlayback, playPlayback, playbackNow, seekPlayback, togglePlayback } from './lib/playbackSession'
import { addSearchHistory } from './lib/storage'
import { bindScrollSaver, ensureAppDepth, goBack, href, navigate, parseHash, type Route } from './lib/router'
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
  const [kept, setKept] = useState<{ id: string; ep: number } | null>(null)
  const keptRef = useRef(kept)
  keptRef.current = kept
  const bump = useCallback(() => setLibraryVersion((value) => value + 1), [])
  const scrollMemo = useRef(new Map<string, number>())
  const routeKeyRef = useRef(href(readRoute()))
  const scrollLockRef = useRef(0)

  const rememberScroll = useCallback(() => {
    scrollMemo.current.set(routeKeyRef.current, window.scrollY)
    scrollLockRef.current = Date.now() + 500
  }, [])

  useEffect(() => {
    bindScrollSaver(rememberScroll)
    return () => bindScrollSaver(() => undefined)
  }, [rememberScroll])

  useEffect(() => {
    const onScroll = () => {
      if (Date.now() < scrollLockRef.current) return
      scrollMemo.current.set(routeKeyRef.current, window.scrollY)
    }
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href]')
      if (!link || link.getAttribute('target') === '_blank') return
      const value = link.getAttribute('href') || ''
      if (!value.startsWith('#')) return
      event.preventDefault()
      navigate(parseHash(value))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('scroll', onScroll)
      document.removeEventListener('click', onClick, true)
    }
  }, [])

  useEffect(() => {
    const sync = () => {
      const next = readRoute()
      routeKeyRef.current = href(next)
      setRoute(next)
    }
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    window.addEventListener('hashchange', sync)
    window.addEventListener('popstate', sync)
    if (!window.location.hash) window.history.replaceState({ appDepth: 1 }, '', '#/')
    ensureAppDepth()
    return () => {
      window.removeEventListener('hashchange', sync)
      window.removeEventListener('popstate', sync)
    }
  }, [])

  useEffect(() => {
    const key = href(route)
    const y = route.name === 'play' ? 0 : (scrollMemo.current.get(key) ?? 0)
    const apply = () => window.scrollTo(0, y)
    apply()
    const frame = window.requestAnimationFrame(apply)
    const timer = window.setTimeout(apply, 60)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [route])

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
    navigate({ name: 'search', q: text })
  }

  useEffect(() => {
    if (route.name === 'play') setKept({ id: route.id, ep: route.ep })
  }, [route])

  useEffect(() => {
    const onToggle = () => togglePlayback()
    const onPlay = () => playPlayback()
    const onPause = () => pausePlayback()
    const onClose = () => {
      pausePlayback()
      setKept(null)
    }
    const onSeek = (event: Event) => {
      const detail = (event as CustomEvent<number>).detail
      if (typeof detail === 'number') seekPlayback(detail / 1000)
    }
    const onOpen = () => {
      const raw = consumeNoticeOpen()
      const [nid, epText] = raw.split('\n')
      const live = playbackNow()
      const fallback = keptRef.current
      const id = nid || live?.id || fallback?.id || ''
      const ep = nid ? Number(epText) : live ? live.ep : fallback?.ep
      if (!id || ep == null || !Number.isFinite(ep)) return
      navigate({ name: 'play', id, ep })
    }
    const onFavorites = () => bump()
    window.addEventListener('app-toggle-playback', onToggle)
    window.addEventListener('app-play-playback', onPlay)
    window.addEventListener('app-pause-playback', onPause)
    window.addEventListener('app-close-playback', onClose)
    window.addEventListener('app-seek-playback', onSeek)
    window.addEventListener('app-open-playback', onOpen)
    window.addEventListener('video-h5-favorites', onFavorites)
    const pending = consumeNoticeOpen()
    if (pending) {
      const [nid, epText] = pending.split('\n')
      const ep = Number(epText)
      if (nid && Number.isFinite(ep)) navigate({ name: 'play', id: nid, ep })
    }
    return () => {
      window.removeEventListener('app-toggle-playback', onToggle)
      window.removeEventListener('app-play-playback', onPlay)
      window.removeEventListener('app-pause-playback', onPause)
      window.removeEventListener('app-close-playback', onClose)
      window.removeEventListener('app-seek-playback', onSeek)
      window.removeEventListener('app-open-playback', onOpen)
      window.removeEventListener('video-h5-favorites', onFavorites)
    }
  }, [bump])

  const playing = route.name === 'play'
  const live = playing ? { id: route.id, ep: route.ep } : kept
  const showMini = Boolean(live) && !playing

  return (
    <div className={playing ? 'app playing' : searchActive ? 'app searching' : showMini ? 'app has-mini' : 'app'}>
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
          <DetailPage
            id={route.id}
            libraryVersion={libraryVersion}
            onLibraryChange={bump}
            onBack={() => goBack({ name: 'home' })}
          />
        ) : null}
        {live ? (
          <div className={playing ? undefined : 'play-dock'}>
            <Suspense
              fallback={
                playing ? (
                  <div className="wrap">
                    <button type="button" className="detail-back" aria-label="返回" onClick={() => goBack({ name: 'home' })}>
                      <BackGlyph />
                    </button>
                    <Pending text="正在为你加载精彩内容…" />
                  </div>
                ) : null
              }
            >
              <PlayPage
                key={live.id}
                id={live.id}
                ep={live.ep}
                visible={playing}
                onLibraryChange={bump}
                onKeepEp={(ep) => setKept({ id: live.id, ep })}
                onBack={() => {
                  if (route.name === 'play') goBack({ name: 'detail', id: route.id })
                  else goBack({ name: 'home' })
                }}
              />
            </Suspense>
          </div>
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
      {showMini && live ? (
        <MiniPlayer
          id={live.id}
          ep={live.ep}
          onOpen={() => navigate({ name: 'play', id: live.id, ep: live.ep })}
          onQueue={() => window.dispatchEvent(new Event('app-open-queue'))}
          onClose={() => {
            pausePlayback()
            setKept(null)
          }}
        />
      ) : null}
      <BottomNav route={route} />
    </div>
  )
}

function BackGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M14.2 6.2 8 12l6.2 5.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
