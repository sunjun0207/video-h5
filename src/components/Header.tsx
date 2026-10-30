import { BRAND, SLOGAN } from '../lib/catalog'
import { href } from '../lib/router'

export function Header() {
  return (
    <header className="site-header">
      <a className="logo" href={href({ name: 'home' })}>
        <strong>{BRAND}</strong>
        <small>{SLOGAN}</small>
      </a>
    </header>
  )
}
