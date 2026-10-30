import { useEffect, useState } from 'react'
import { channelFacets, channelName, listByChannel, queryChannel } from '../lib/api'
import { CHANNELS } from '../lib/catalog'
import { useCatalog } from '../lib/source'
import type { ChannelId, SortKey } from '../lib/types'
import { PosterCard } from '../components/PosterCard'
import { Pending } from '../components/Pending'

type Props = {
  channel: ChannelId
}

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'hot', label: '最热' },
  { id: 'new', label: '最新' },
  { id: 'score', label: '好评' },
]

export function ChannelPage({ channel }: Props) {
  const { ready, loading, error } = useCatalog()
  const [genre, setGenre] = useState('全部')
  const [region, setRegion] = useState('全部')
  const [year, setYear] = useState('全部')
  const [sort, setSort] = useState<SortKey>('hot')
  const facets = channelFacets(channel)

  useEffect(() => {
    setGenre('全部')
    setRegion('全部')
    setYear('全部')
    setSort('hot')
  }, [channel])

  const list = queryChannel({ channel, genre, region, year, sort })

  if (error) return <div className="wrap empty">{error}</div>
  if (!ready || (loading && !listByChannel(channel).length)) {
    return (
      <div className="wrap">
        <Pending text="正在为你加载精彩内容…" />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="wrap">
        <div className="page-head">
          <h1 className="page-title">{channelName(channel)}</h1>
          <p>{CHANNELS.find((entry) => entry.id === channel)?.desc}</p>
        </div>
        <div className="filters">
          <FilterRow label="类型" value={genre} options={['全部', ...facets.genres]} onChange={setGenre} />
          <FilterRow label="地区" value={region} options={['全部', ...facets.regions]} onChange={setRegion} />
          <FilterRow label="年份" value={year} options={['全部', ...facets.years]} onChange={setYear} />
          <FilterRow label="排序" value={sort} options={SORTS.map((item) => item.id)} labels={SORTS} onChange={setSort} />
        </div>
        <p className="result-count">共 {list.length} 部</p>
        {list.length === 0 ? (
          <div className="empty">暂时还没有内容，换个条件，发现更多精彩吧</div>
        ) : (
          <div className="poster-grid">
            {list.map((item) => (
              <PosterCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterRow<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  value: T
  options: T[]
  labels?: { id: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="filter-row">
      <span>{label}</span>
      <div>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={option === value ? 'on' : ''}
            onClick={() => onChange(option)}
          >
            {labels?.find((item) => item.id === option)?.label ?? option}
          </button>
        ))}
      </div>
    </div>
  )
}
