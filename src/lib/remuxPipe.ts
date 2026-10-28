import type { RemuxReply, RemuxRequest } from './remux.worker'

export type RemuxPipe = {
  /** 按播放顺序交片段。 */
  push: (chunk: Blob) => void
  /** 装完返回 mp4；装不了返回 null。 */
  finish: () => Promise<Blob | null>
  close: () => void
}

type Local = { push: (chunk: Blob) => void; finish: () => Promise<Blob | null> }

/** 起不了 Worker 时在页面里装，每段之间让出主线程。 */
async function openLocal(chunks: Blob[]): Promise<Local> {
  const { TsRemuxer } = await import('./remux')
  const remuxer = new TsRemuxer()
  let broken = false
  let queue = Promise.resolve()
  const push = (chunk: Blob) => {
    queue = queue.then(async () => {
      if (broken) return
      try {
        remuxer.push(new Uint8Array(await chunk.arrayBuffer()))
      } catch {
        broken = true
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }
  chunks.forEach(push)
  return {
    push,
    async finish() {
      await queue
      if (broken) return null
      try {
        return remuxer.finish()
      } catch {
        return null
      }
    },
  }
}

/** 在后台线程把 ts 片段边下边装成 mp4，不占播放所在的主线程。 */
export function openRemux(): RemuxPipe {
  const fed: Blob[] = []
  let worker: Worker | null = null
  let local: Promise<Local> | null = null
  let settle: ((blob: Blob | null) => void) | null = null
  let closed = false

  const finishLocal = () => {
    const done = settle
    settle = null
    if (!done || !local) return
    local.then((item) => item.finish()).then(done, () => done(null))
  }

  const goLocal = () => {
    worker?.terminate()
    worker = null
    if (closed) return
    if (!local) local = openLocal(fed.slice())
    finishLocal()
  }

  try {
    worker = new Worker(new URL('./remux.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<RemuxReply>) => {
      const done = settle
      settle = null
      done?.(event.data.blob)
    }
    worker.onerror = (event) => {
      event.preventDefault()
      goLocal()
    }
  } catch {
    goLocal()
  }

  const send = (request: RemuxRequest) => worker?.postMessage(request)

  return {
    push(chunk) {
      if (closed) return
      fed.push(chunk)
      if (worker) send({ chunk })
      else void local?.then((item) => item.push(chunk))
    },
    finish() {
      return new Promise((resolve) => {
        if (closed) {
          resolve(null)
          return
        }
        settle = resolve
        if (worker) send({ done: true })
        else finishLocal()
      })
    },
    close() {
      closed = true
      worker?.terminate()
      worker = null
      fed.length = 0
      const done = settle
      settle = null
      done?.(null)
    },
  }
}
