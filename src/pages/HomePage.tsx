import { useMemo, useState } from 'react'
import { BRAND, CHANNELS } from '../lib/catalog'
import { homeLayout } from '../lib/api'
import { href } from '../lib/router'
import { useCatalog, useVideos } from '../lib/source'
import { getHistory } from '../lib/storage'
import { HeroBanner } from '../components/HeroBanner'
import { RankList } from '../components/RankList'
import { SearchBox } from '../components/SearchBox'
import { SectionRow } from '../components/SectionRow'
import { Pending } from '../components/Pending'

type Props = {
  onSearch: (keyword: string) => void
}

export function HomePage({ onSearch }: Props) {
  const { ready, error } = useCatalog()
  const version = useVideos()
  const [keyword, setKeyword] = useState('')
  const layout = useMemo(() => homeLayout(getHistory().map((entry) => entry.id)), [version])
  if (error) return <div className="wrap empty">{error}</div>
  if (!ready) {
    return (
      <div className="wrap">
        <Pending text="正在为你加载精彩内容…" />
      </div>
    )
  }
  return (
    <div className="page">
      <div className="wrap">
        <section className="intro-card">
          <h1>
            精彩好剧，<em>一眼心动</em>
          </h1>
          <p>热门短剧、精彩影视、潮流视频，每一次打开都有新发现。让精彩，马上发生。</p>
          <SearchBox value={keyword} onChange={setKeyword} onSubmit={() => onSearch(keyword)} />
        </section>
      </div>
      <div className="wrap home-top">
        <HeroBanner items={layout.hero} />
        <RankList items={layout.rank} />
      </div>
      <div className="wrap">
        <SectionRow title="猜你喜欢" desc="懂你的喜好，推荐你的精彩" items={layout.picks} />
        <SectionRow title="最新上线" desc="新鲜内容，抢先一步发现" items={layout.fresh} />
        {layout.channels.map(({ channel, items }) => {
          const copy = CHANNELS.find((entry) => entry.id === channel)
          if (!copy) return null
          return (
            <SectionRow
              key={channel}
              title={copy.row}
              desc={copy.desc}
              more={href({ name: 'channel', channel })}
              moreText={`更多${copy.name}`}
              items={items}
            />
          )
        })}
        <SectionRow title="高分推荐" desc="好内容值得反复回味" items={layout.top} />
        <section className="brand-intro">
          <h2>发现精彩，从这里开始</h2>
          <p>
            欢迎来到 {BRAND}！这里是一个汇聚精彩视频内容的娱乐天地。无论你喜欢扣人心弦的短剧、精彩纷呈的影视作品，还是轻松有趣的热门视频，都能在这里发现属于自己的快乐。
          </p>
          <p>我们希望用丰富的内容、有趣的故事和舒适的观看体验，为每一位用户带来更多精彩时刻。</p>
          <p>好内容，值得被发现；好时光，值得被分享。打开 {BRAND}，探索更多精彩，让每一次观看都充满惊喜！</p>
          <strong>精彩不止，快乐不散场。</strong>
        </section>
      </div>
    </div>
  )
}
