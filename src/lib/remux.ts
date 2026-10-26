import muxjs from 'mux.js'

type Gate = {
  wait: () => Promise<void>
  readonly stopped: boolean
}

const CLOCK = 90_000

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset)
}

function writeU32(bytes: Uint8Array, offset: number, value: number) {
  const ticks = Math.max(0, Math.min(0xffffffff, Math.round(value)))
  bytes[offset] = (ticks >>> 24) & 0xff
  bytes[offset + 1] = (ticks >>> 16) & 0xff
  bytes[offset + 2] = (ticks >>> 8) & 0xff
  bytes[offset + 3] = ticks & 0xff
}

/** mux.js 把时长写成未知。按实际时间填回 mvhd / tkhd / mdhd，播放器才能显示正确长度。 */
function patchDurations(init: Uint8Array, seconds: number) {
  const walk = (start: number, end: number) => {
    let offset = start
    while (offset + 8 <= end) {
      const size = readU32(init, offset)
      if (size < 8 || offset + size > end) return
      const type = String.fromCharCode(init[offset + 4], init[offset + 5], init[offset + 6], init[offset + 7])
      const payload = offset + 8
      if (type === 'mvhd' && init[payload] === 0) writeU32(init, payload + 16, seconds * CLOCK)
      if (type === 'tkhd' && init[payload] === 0) writeU32(init, payload + 20, seconds * CLOCK)
      if (type === 'mdhd' && init[payload] === 0) writeU32(init, payload + 16, seconds * readU32(init, payload + 12))
      if (type === 'moov' || type === 'trak' || type === 'mdia') walk(payload, offset + size)
      offset += size
    }
  }
  walk(0, init.length)
}

/** 把按顺序排好的 MPEG-TS 片段装成一个 mp4。装不了时返回 null，调用方仍保存 ts。 */
export async function remuxTsBlobs(chunks: Blob[], gate: Gate): Promise<Blob | null> {
  const transmuxer = new muxjs.mp4.Transmuxer()
  const pieces: Uint8Array[] = []
  let init: Uint8Array | null = null
  let opened = false
  let firstPts = 0
  let lastPts = 0
  const span = (info: { start: number; end: number }) => {
    if (!opened) {
      opened = true
      firstPts = info.start
    }
    if (info.end > lastPts) lastPts = info.end
  }
  transmuxer.on('data', (segment) => {
    if (!init) init = segment.initSegment
    pieces.push(segment.data)
  })
  transmuxer.on('videoTimingInfo', span)
  transmuxer.on('audioTimingInfo', span)

  for (const chunk of chunks) {
    await gate.wait()
    if (gate.stopped) return null
    transmuxer.push(new Uint8Array(await chunk.arrayBuffer()))
    transmuxer.flush()
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  }

  if (!init || pieces.length === 0) return null
  if (lastPts > firstPts) patchDurations(init, (lastPts - firstPts) / CLOCK)
  return new Blob([init, ...pieces], { type: 'video/mp4' })
}
