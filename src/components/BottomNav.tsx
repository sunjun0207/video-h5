import { href, type Route } from '../lib/router'

type Props = {
  route: Route
}

export function BottomNav({ route }: Props) {
  const homeOn = route.name === 'home' || route.name === 'channel' || route.name === 'detail' || route.name === 'play'
  return (
    <nav className="bottom-nav" aria-label="主导航">
      <div className="bottom-nav-inner">
        <a className={homeOn ? 'on' : ''} href={href({ name: 'home' })}>
          <HomeIcon />
          首页
        </a>
        <a className={route.name === 'search' ? 'on' : ''} href={href({ name: 'search', q: '' })}>
          <SearchIcon />
          搜索
        </a>
        <a className={route.name === 'favorite' ? 'on' : ''} href={href({ name: 'favorite' })}>
          <HeartIcon />
          收藏
        </a>
        <a className={route.name === 'history' ? 'on' : ''} href={href({ name: 'history' })}>
          <ClockIcon />
          足迹
        </a>
      </div>
    </nav>
  )
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 16.5 20 20.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M12 19s-7-4.2-7-8.2A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.8C19 14.8 12 19 12 19Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8.5V12l2.5 2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}
