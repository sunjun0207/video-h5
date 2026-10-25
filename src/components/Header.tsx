import { href } from '../lib/router'

export function Header() {
  return (
    <header className="site-header">
      <a className="logo" href={href({ name: 'home' })}>
        <strong>观影jun.sun</strong>
        <small>把想看的故事，慢慢看完</small>
      </a>
    </header>
  )
}
