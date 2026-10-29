import { dropGroups, findAdGroups, groupSpans, mayHideAds, stripInjectedAds, type GroupHead } from './hlsAds'
import { playProxy, useProxy } from './mediaProxy'
import { probeTs, type TsHead } from './mpegts'

/** 每组第一个分片最多读这么多；视频、音频的起始时间和 SPS 都读到就提前停。 */
const HEAD_LIMIT = 256 * 1024
const PROBE_STEP = 32 * 1024
/** 组太多时一组组读开头太慢，这种列表只按标记去广告。 */
const MAX_GROUPS = 40
/** 读各组开头最多等这么久，播放器在等；没读到的组当正片留着。 */
const SCAN_MS = 6000
const CLOCK = 90_000
const KEEP = 8

const scans = new Map<string, Promise<string>>()

function joined(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

async function readHead(url: string, signal: AbortSignal): Promise<TsHead> {
  const response = await fetch(playProxy(url), { credentials: useProxy ? 'same-origin' : 'omit', signal })
  if (!response.ok || !response.body) throw new Error('片段没有回应')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let probed = 0
  let head: TsHead | null = null
  try {
    while (total < HEAD_LIMIT) {
      const step = await reader.read()
      if (step.done) break
      chunks.push(step.value)
      total += step.value.length
      if (total - probed < PROBE_STEP) continue
      probed = total
      head = probeTs(joined(chunks, total))
      if (head.video !== null && head.audio !== null && head.sps) break
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
  return head && probed === total ? head : probeTs(joined(chunks, total))
}

async function scan(text: string, url: string): Promise<string> {
  if (!text.includes('#EXT-X-ENDLIST') || /#EXT-X-(STREAM-INF|BYTERANGE|MAP)/.test(text)) return text
  if (/#EXT-X-KEY:(?![^\n]*METHOD=NONE)/.test(text)) return text
  const spans = groupSpans(text)
  if (spans.length < 2 || spans.length > MAX_GROUPS || !mayHideAds(spans)) return text
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), SCAN_MS)
  const heads = await Promise.all(
    spans.map((span) => readHead(new URL(span.first, url).href, controller.signal).catch(() => null)),
  ).finally(() => window.clearTimeout(timer))
  const groups: GroupHead[] = spans.map((span, index) => {
    const head = heads[index]
    const start = head ? (head.video ?? head.audio) : null
    return {
      start: start === null ? null : start / CLOCK,
      duration: span.duration,
      parts: span.parts,
      sps: head?.sps || '',
      audio: Boolean(head && head.audio !== null),
    }
  })
  const ads = findAdGroups(groups)
  return ads.size ? dropGroups(text, spans, ads) : text
}

/**
 * 去掉播放列表里的广告：先按标记去，再读每组第一个分片的开头按时间线认没有标记的片头、中插、片尾广告。
 * 同一份列表只查一次，选线时先开始查，播放器拿列表时直接用结果。
 */
export function cleanAds(text: string, url: string): Promise<string> {
  const stripped = stripInjectedAds(text)
  let task = scans.get(stripped)
  if (!task) {
    task = scan(stripped, url).catch(() => stripped)
    scans.set(stripped, task)
    for (const key of scans.keys()) {
      if (scans.size <= KEEP) break
      scans.delete(key)
    }
  }
  return task
}
