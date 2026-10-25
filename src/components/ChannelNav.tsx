import { CHANNELS } from '../lib/catalog'
import { href, type Route } from '../lib/router'

type Props = {
  route: Route
}

export function ChannelNav({ route }: Props) {
  const active = route.name === 'home' ? 'home' : route.name === 'channel' ? route.channel : ''
  return (
    <nav className="channel-nav" aria-label="频道">
      <div className="wrap channel-row">
        <a className={active === 'home' ? 'on' : ''} href={href({ name: 'home' })}>
          首页
        </a>
        {CHANNELS.map((item) => (
          <a
            key={item.id}
            className={active === item.id ? 'on' : ''}
            href={href({ name: 'channel', channel: item.id })}
          >
            {item.name}
          </a>
        ))}
      </div>
    </nav>
  )
}
