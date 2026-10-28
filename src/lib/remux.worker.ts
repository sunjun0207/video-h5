import { TsRemuxer } from './remux'

export type RemuxRequest = { chunk: Blob } | { done: true }
export type RemuxReply = { blob: Blob | null }

const remuxer = new TsRemuxer()
let broken = false
let queue = Promise.resolve()

self.onmessage = (event: MessageEvent<RemuxRequest>) => {
  const request = event.data
  queue = queue.then(async () => {
    if ('chunk' in request) {
      if (broken) return
      try {
        remuxer.push(new Uint8Array(await request.chunk.arrayBuffer()))
      } catch {
        broken = true
      }
      return
    }
    let blob: Blob | null = null
    try {
      if (!broken) blob = remuxer.finish()
    } catch {
      blob = null
    }
    const reply: RemuxReply = { blob }
    self.postMessage(reply)
  })
}
