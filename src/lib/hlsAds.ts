/** 片源往正片里插广告的几种做法，以及怎么把它们挑出来。 */

/** 每个 DISCONTINUITY 之间的一组分片。 */
type Block = { lines: string[]; uris: string[]; duration: number; marked: boolean }

const SEGMENT_TAGS = ['#EXTINF', '#EXT-X-BYTERANGE', '#EXT-X-PROGRAM-DATE-TIME', '#EXT-X-GAP', '#EXT-X-BITRATE', '#EXT-X-DATERANGE']
/** 重复分片判成广告的组，单组不超过这么长。 */
const REPEAT_MAX = 180

function isDiscontinuity(row: string): boolean {
  return row === '#EXT-X-DISCONTINUITY'
}

function blocksOf(text: string): Block[] {
  const blocks: Block[] = [{ lines: [], uris: [], duration: 0, marked: false }]
  let markNext = false
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim()
    if (/ppvod-ad-injected/i.test(row)) {
      markNext = true
      continue
    }
    let block = blocks[blocks.length - 1]
    if (isDiscontinuity(row)) {
      block = { lines: [], uris: [], duration: 0, marked: markNext }
      markNext = false
      blocks.push(block)
    } else if (row.startsWith('#EXTINF:')) {
      block.duration += Number.parseFloat(row.slice(8)) || 0
    } else if (row && !row.startsWith('#')) {
      block.uris.push(row)
    }
    block.lines.push(line)
  }
  return blocks
}

/** 删掉一组时只去掉分片本身，KEY / MAP 这类会影响后面分片的标签留着。 */
function keptOfDropped(lines: string[]): string[] {
  return lines.filter((line) => {
    const row = line.trim()
    if (!row.startsWith('#EXT')) return false
    if (isDiscontinuity(row)) return false
    return !SEGMENT_TAGS.some((tag) => row.startsWith(tag))
  })
}

/**
 * 去掉播放列表里能直接认出来的广告组：
 * `# ppvod-ad-injected` 标记后的一组、路径带 /adjump/ 的组、分片地址在列表里重复出现的组。
 */
export function stripInjectedAds(text: string): string {
  if (!text.includes('#EXTINF')) return text
  const blocks = blocksOf(text)
  const counts = new Map<string, number>()
  if (!text.includes('#EXT-X-BYTERANGE')) {
    for (const block of blocks) for (const uri of block.uris) counts.set(uri, (counts.get(uri) || 0) + 1)
  }
  const repeated = (block: Block) =>
    block.duration <= REPEAT_MAX && block.uris.filter((uri) => (counts.get(uri) || 0) > 1).length * 2 > block.uris.length
  const total = blocks.reduce((sum, block) => sum + block.uris.length, 0)
  const repeatedParts = blocks.filter(repeated).reduce((sum, block) => sum + block.uris.length, 0)
  const useRepeats = repeatedParts * 2 < total
  const drop = blocks.map(
    (block) => block.uris.length > 0 && (block.marked || block.uris.some((uri) => uri.includes('/adjump/')) || (useRepeats && repeated(block))),
  )
  const kept = blocks.reduce((sum, block, index) => sum + (drop[index] ? 0 : block.uris.length), 0)
  if (!drop.includes(true) || kept === 0) return text

  const out: string[] = []
  let emitted = false
  blocks.forEach((block, index) => {
    if (drop[index]) {
      out.push(...keptOfDropped(block.lines))
      return
    }
    for (const line of block.lines) {
      const row = line.trim()
      if (isDiscontinuity(row) && !emitted) continue
      if (row && !row.startsWith('#')) emitted = true
      out.push(line)
    }
  })
  return out.join('\n')
}

/** 下载时每组第一个分片读出来的信息。 */
export type GroupHead = {
  /** 第一帧视频的时间，秒；读不出来是 null。 */
  start: number | null
  /** 这一组 EXTINF 之和，秒。 */
  duration: number
  parts: number
  sps: string
  audio: boolean
}

/** 中插广告一次最长多久。 */
const BREAK_MAX = 120
/** 片头、片尾广告最长多久。 */
const EDGE_MAX = 60

function near(start: number, expected: number, parts: number): boolean {
  return Math.abs(start - expected) <= 1 + parts * 0.01
}

type Chain = { groups: number[]; duration: number; sps: string; audio: boolean }

/**
 * 按时间线认广告。正片各组首尾相接；广告各自从头计时。
 * 一段跳走的时间线之后正片又接着上一段正片往下走，中间这段就是中插广告；
 * 首尾单独成段、很短、而且编码或音轨和正片不一样的，是片头片尾广告。
 */
export function findAdGroups(groups: GroupHead[]): Set<number> {
  const ads = new Set<number>()
  const chains: Chain[] = []
  let chain: Chain | null = null
  let expected: number | null = null
  let since = 0
  const extend = (index: number) => {
    const group = groups[index]
    if (!chain) {
      chain = { groups: [], duration: 0, sps: group.sps, audio: false }
      chains.push(chain)
    }
    chain.groups.push(index)
    chain.duration += group.duration
    chain.audio ||= group.audio
    if (!chain.sps) chain.sps = group.sps
    if (group.start === null) {
      if (expected !== null) expected += group.duration
      since += group.parts
    } else {
      expected = group.start + group.duration
      since = group.parts
    }
  }

  for (let index = 0; index < groups.length; index += 1) {
    const start = groups[index].start
    if (start === null || expected === null || near(start, expected, since)) {
      extend(index)
      continue
    }
    let bridge = -1
    let span = 0
    for (let next = index; next < groups.length; next += 1) {
      const head = groups[next].start
      if (next > index && head !== null && near(head, expected, since)) {
        bridge = next
        break
      }
      span += groups[next].duration
      if (span > BREAK_MAX) break
    }
    if (bridge > 0) {
      for (let ad = index; ad < bridge; ad += 1) ads.add(ad)
      extend(bridge)
      index = bridge
      continue
    }
    chain = null
    extend(index)
  }

  if (chains.length < 2) return ads
  const main = chains.reduce((best, item) => (item.duration > best.duration ? item : best))
  const foreign = (item: Chain) =>
    item !== main &&
    item.duration <= EDGE_MAX &&
    main.duration >= item.duration * 4 &&
    ((Boolean(item.sps) && Boolean(main.sps) && item.sps !== main.sps) || (main.audio && !item.audio))
  const edges = [...chains]
  while (edges.length > 1 && foreign(edges[0])) for (const index of edges.shift()!.groups) ads.add(index)
  while (edges.length > 1 && foreign(edges[edges.length - 1])) for (const index of edges.pop()!.groups) ads.add(index)
  return ads
}
