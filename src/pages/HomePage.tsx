import { useState } from 'react'
import { CHANNELS } from '../lib/catalog'
import { heroVideos, hotVideos, listByChannel, rankVideos } from '../lib/api'
import { href } from '../lib/router'
import { useCatalog } from '../lib/source'
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
  const [keyword, setKeyword] = useState('')
  if (error) return <div className="wrap empty">{error}</div>
  if (!ready) {
    return (
      <div className="wrap">
        <Pending text="片单还在轻轻赶来，稍等一会儿。" />
      </div>
    )
  }
  return (
    <div className="page">
      <div className="wrap">
        <section className="intro-card">
          <h1>观影jun.sun</h1>
          <p>有些片子，只适合在灯火安静下来的时候遇见。来这里寻一部，让画面跟着故事慢慢展开，把零碎的夜晚，看成一段温柔而从容的停留。</p>
          <SearchBox value={keyword} onChange={setKeyword} onSubmit={() => onSearch(keyword)} />
        </section>
      </div>
      <div className="wrap home-top">
        <HeroBanner items={heroVideos()} />
        <RankList items={rankVideos(8)} />
      </div>
      <div className="wrap">
        <SectionRow title="此刻想看" items={hotVideos(12)} />
        {CHANNELS.map((channel) => {
          const items = listByChannel(channel.id).slice(0, 12)
          if (!items.length) return null
          return (
            <SectionRow
              key={channel.id}
              title={channel.name}
              more={href({ name: 'channel', channel: channel.id })}
              items={items}
            />
          )
        })}
      </div>
    </div>
  )
}
