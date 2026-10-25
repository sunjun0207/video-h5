import { href } from '../lib/router'
import type { VideoItem } from '../lib/types'
import { channelName } from '../lib/api'

type Props = {
  items: VideoItem[]
}

export function RankList({ items }: Props) {
  return (
    <aside className="rank">
      <div className="rank-head">
        <h2>慢慢热起来</h2>
        <span>这些天</span>
      </div>
      <ol>
        {items.map((item, index) => (
          <li key={item.id}>
            <a href={href({ name: 'detail', id: item.id })}>
              <em className={index < 3 ? 'top' : ''}>{index + 1}</em>
              <span>
                <strong>{item.title}</strong>
                <small>
                  {channelName(item.channel)} · {item.updateText}
                </small>
              </span>
              <b>{item.score > 0 ? item.score.toFixed(1) : ''}</b>
            </a>
          </li>
        ))}
      </ol>
    </aside>
  )
}
