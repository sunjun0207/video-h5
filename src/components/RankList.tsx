import { href } from '../lib/router'
import type { VideoItem } from '../lib/types'
import { channelName } from '../lib/api'

type Props = {
  items: VideoItem[]
  title?: string
  desc?: string
}

export function RankList({ items, title = '热门推荐', desc = '大家都在看，精彩不容错过' }: Props) {
  if (!items.length) return null
  return (
    <aside className="rank">
      <div className="rank-head">
        <div className="block-title">
          <h2>{title}</h2>
          <p>{desc}</p>
        </div>
        <span className="rank-tag">HOT</span>
      </div>
      <ol>
        {items.map((item, index) => (
          <li key={item.id}>
            <a href={href({ name: 'detail', id: item.id })}>
              <em className={index < 3 ? 'top' : ''}>{index + 1}</em>
              <span>
                <strong>{item.title}</strong>
                <small>{item.guessed ? item.updateText : `${channelName(item.channel)} · ${item.updateText}`}</small>
              </span>
              <b>{item.score > 0 ? item.score.toFixed(1) : ''}</b>
            </a>
          </li>
        ))}
      </ol>
    </aside>
  )
}
