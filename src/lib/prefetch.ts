/**
 * 分片预取。hls.js 一个分片拉完才拉下一个，这些片源单条连接慢、每次还要等响应头，
 * 缓冲涨得慢，网络稍一抖就卡。这里在 hls.js 要第 n 个分片时，提前并行拉后面几个。
 */
export type Prefetched = {
  promise: Promise<ArrayBuffer>
  controller: AbortController
  startedAt: number
  /** 收到响应头的时间，0 表示还没收到。 */
  firstAt: number
  /** 拉完的时间，0 表示还在拉。 */
  endAt: number
}

export type Prefetcher = {
  /** 交出已经在拉的分片，之后由调用方负责。 */
  take(url: string): Prefetched | undefined
  /** 让 urls 里 from 起的 count 个分片都在拉；from 起 ahead 个以外、还没交出去的取消。 */
  plan(urls: string[], from: number, count: number): void
  clear(): void
}

export function createPrefetcher(ahead: number, credentials: RequestCredentials): Prefetcher {
  const entries = new Map<string, Prefetched>()

  const start = (url: string): Prefetched => {
    const controller = new AbortController()
    const entry: Prefetched = { controller, startedAt: performance.now(), firstAt: 0, endAt: 0, promise: Promise.resolve(new ArrayBuffer(0)) }
    entry.promise = (async () => {
      const response = await fetch(url, { credentials, signal: controller.signal, priority: 'low' })
      entry.firstAt = performance.now()
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.arrayBuffer()
      if (!data.byteLength) throw new Error('空分片')
      entry.endAt = performance.now()
      return data
    })()
    entry.promise.catch(() => {
      if (entries.get(url) === entry) entries.delete(url)
    })
    return entry
  }

  return {
    take(url) {
      const entry = entries.get(url)
      if (entry) entries.delete(url)
      return entry
    },
    plan(urls, from, count) {
      const kept = new Set(urls.slice(from, from + ahead))
      for (const [url, entry] of entries) {
        if (kept.has(url)) continue
        entry.controller.abort()
        entries.delete(url)
      }
      for (const url of urls.slice(from, from + Math.min(count, ahead))) if (!entries.has(url)) entries.set(url, start(url))
    },
    clear() {
      for (const entry of entries.values()) entry.controller.abort()
      entries.clear()
    },
  }
}
