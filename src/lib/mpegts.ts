/** MPEG-TS 的最小解析：读首帧时间、视频参数，或把整段时间戳一起平移。时间单位都是 90kHz。 */

const PACKET = 188
const WRAP = 2 ** 33

export type TsHead = {
  video: number | null
  audio: number | null
  /** 编码名，例如 avc / hevc、aac / mp3；空串表示没有这一路。 */
  videoCodec: string
  audioCodec: string
  /** 视频 SPS 的十六进制。同一次编码的片段相同，插进来的广告通常不同。 */
  sps: string
}

const VIDEO_TYPES: Record<number, string> = { 0x1b: 'avc', 0x24: 'hevc', 0x01: 'mpeg2', 0x02: 'mpeg2', 0x10: 'mpeg4' }
const AUDIO_TYPES: Record<number, string> = { 0x0f: 'aac', 0x11: 'latm', 0x03: 'mp3', 0x04: 'mp3', 0x81: 'ac3', 0x87: 'eac3' }

function aligned(bytes: Uint8Array, at: number): boolean {
  if (bytes[at] !== 0x47) return false
  return at + PACKET >= bytes.length || bytes[at + PACKET] === 0x47
}

function syncFrom(bytes: Uint8Array, from: number): number {
  for (let at = from; at + PACKET <= bytes.length; at += 1) {
    if (aligned(bytes, at)) return at
  }
  return -1
}

type Visit = (pid: number, unitStart: boolean, payload: number, end: number) => boolean | void

/** 逐包回调；返回 false 停止。遇到错位会重新找同步字节。 */
function eachPacket(bytes: Uint8Array, visit: Visit) {
  let at = syncFrom(bytes, 0)
  while (at >= 0 && at + PACKET <= bytes.length) {
    if (bytes[at] !== 0x47) {
      at = syncFrom(bytes, at + 1)
      continue
    }
    const pid = ((bytes[at + 1] & 0x1f) << 8) | bytes[at + 2]
    const control = (bytes[at + 3] >> 4) & 3
    let payload = at + 4
    if (control & 2) payload += 1 + bytes[at + 4]
    const end = at + PACKET
    if (control & 1 && payload < end && visit(pid, (bytes[at + 1] & 0x40) !== 0, payload, end) === false) return
    at = end
  }
}

function hasPesHeader(streamId: number): boolean {
  return ![0xbc, 0xbe, 0xbf, 0xf0, 0xf1, 0xf2, 0xf8, 0xff].includes(streamId)
}

function readTime(bytes: Uint8Array, at: number): number {
  const low = (bytes[at + 1] << 22) | ((bytes[at + 2] >> 1) << 15) | (bytes[at + 3] << 7) | (bytes[at + 4] >> 1)
  return ((bytes[at] >> 1) & 0x07) * 2 ** 30 + low
}

function writeTime(bytes: Uint8Array, at: number, value: number) {
  const time = ((value % WRAP) + WRAP) % WRAP
  const high = Math.floor(time / 2 ** 30)
  const low = time - high * 2 ** 30
  bytes[at] = (bytes[at] & 0xf0) | (high << 1) | 1
  bytes[at + 1] = (low >>> 22) & 0xff
  bytes[at + 2] = (((low >>> 15) & 0x7f) << 1) | 1
  bytes[at + 3] = (low >>> 7) & 0xff
  bytes[at + 4] = ((low & 0x7f) << 1) | 1
}

type PesHeader = { streamId: number; pts: number; ptsAt: number; dtsAt: number; data: number }

function pesHeader(bytes: Uint8Array, payload: number, end: number): PesHeader | null {
  if (payload + 9 > end || bytes[payload] !== 0 || bytes[payload + 1] !== 0 || bytes[payload + 2] !== 1) return null
  const streamId = bytes[payload + 3]
  if (!hasPesHeader(streamId)) return null
  const flags = bytes[payload + 7] >> 6
  const data = payload + 9 + bytes[payload + 8]
  if (data > end) return null
  const ptsAt = flags & 2 ? payload + 9 : -1
  const dtsAt = flags === 3 ? payload + 14 : -1
  if (ptsAt < 0 || ptsAt + 5 > end || dtsAt + 5 > end) return { streamId, pts: -1, ptsAt: -1, dtsAt: -1, data }
  return { streamId, pts: readTime(bytes, ptsAt), ptsAt, dtsAt, data }
}

function tableStart(bytes: Uint8Array, payload: number, end: number): number {
  const start = payload + 1 + bytes[payload]
  return start + 3 <= end ? start : -1
}

function sectionEnd(bytes: Uint8Array, start: number, end: number): number {
  const length = ((bytes[start + 1] & 0x0f) << 8) | bytes[start + 2]
  return Math.min(end, start + 3 + length - 4)
}

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

function startCode(data: Uint8Array, at: number): boolean {
  return data[at] === 0 && data[at + 1] === 0 && data[at + 2] === 1
}

function spsOf(data: Uint8Array, codec: string): string {
  for (let at = 0; at + 4 < data.length; at += 1) {
    if (!startCode(data, at)) continue
    const header = data[at + 3]
    const isSps = codec === 'hevc' ? ((header >> 1) & 0x3f) === 33 : (header & 0x1f) === 7
    if (!isSps) continue
    let stop = at + 3
    while (stop + 3 <= data.length && !startCode(data, stop)) stop += 1
    if (stop + 3 > data.length) stop = data.length
    else if (data[stop - 1] === 0) stop -= 1
    return hex(data.subarray(at + 3, Math.min(stop, at + 3 + 64)))
  }
  return ''
}

/** 读一个片段开头：首个视频/音频 PTS、视频编码和 SPS。只需片段前几十 KB。 */
export function probeTs(bytes: Uint8Array): TsHead {
  const head: TsHead = { video: null, audio: null, videoCodec: '', audioCodec: '', sps: '' }
  const types = new Map<number, number>()
  let pmt = -1
  let videoPid = -1
  let spsDone = false
  const es: Uint8Array[] = []
  let esBytes = 0
  const finishSps = () => {
    if (spsDone) return
    spsDone = true
    const data = new Uint8Array(esBytes)
    let offset = 0
    for (const part of es) {
      data.set(part, offset)
      offset += part.byteLength
    }
    head.sps = spsOf(data, head.videoCodec)
  }

  eachPacket(bytes, (pid, unitStart, payload, end) => {
    if (pid === 0 && unitStart) {
      const start = tableStart(bytes, payload, end)
      if (start < 0 || bytes[start] !== 0x00) return
      const stop = sectionEnd(bytes, start, end)
      for (let at = start + 8; at + 4 <= stop; at += 4) {
        if (((bytes[at] << 8) | bytes[at + 1]) === 0) continue
        pmt = ((bytes[at + 2] & 0x1f) << 8) | bytes[at + 3]
        break
      }
      return
    }
    if (pid === pmt && unitStart) {
      const start = tableStart(bytes, payload, end)
      if (start < 0 || start + 12 > end || bytes[start] !== 0x02) return
      const stop = sectionEnd(bytes, start, end)
      let at = start + 12 + (((bytes[start + 10] & 0x0f) << 8) | bytes[start + 11])
      while (at + 5 <= stop) {
        types.set(((bytes[at + 1] & 0x1f) << 8) | bytes[at + 2], bytes[at])
        at += 5 + (((bytes[at + 3] & 0x0f) << 8) | bytes[at + 4])
      }
      return
    }
    if (pid === videoPid && !spsDone) {
      if (unitStart) {
        finishSps()
      } else {
        es.push(bytes.subarray(payload, end))
        esBytes += end - payload
        if (esBytes >= 4096) finishSps()
      }
    }
    if (!unitStart) return
    const pes = pesHeader(bytes, payload, end)
    if (!pes || pes.pts < 0) return
    const type = types.get(pid)
    const isVideo = type !== undefined ? type in VIDEO_TYPES : pes.streamId >= 0xe0 && pes.streamId <= 0xef
    const isAudio = type !== undefined ? type in AUDIO_TYPES : pes.streamId >= 0xc0 && pes.streamId <= 0xdf
    if (isVideo && head.video === null) {
      head.video = pes.pts
      head.videoCodec = type !== undefined ? VIDEO_TYPES[type] : 'avc'
      videoPid = pid
      es.push(bytes.subarray(pes.data, end))
      esBytes += end - pes.data
    } else if (isAudio && head.audio === null) {
      head.audio = pes.pts
      head.audioCodec = type !== undefined ? AUDIO_TYPES[type] : 'aac'
    }
    if (head.video !== null && head.audio !== null && spsDone) return false
  })
  if (head.video !== null) finishSps()
  return head
}

/** 把片段里所有 PES 的 PTS/DTS 加上 delta，原地改写。返回改写的 PES 数。 */
export function shiftTimestamps(bytes: Uint8Array, delta: number): number {
  if (!delta) return 0
  let count = 0
  eachPacket(bytes, (_pid, unitStart, payload, end) => {
    if (!unitStart) return
    const pes = pesHeader(bytes, payload, end)
    if (!pes || pes.ptsAt < 0) return
    writeTime(bytes, pes.ptsAt, pes.pts + delta)
    if (pes.dtsAt >= 0) writeTime(bytes, pes.dtsAt, readTime(bytes, pes.dtsAt) + delta)
    count += 1
  })
  return count
}
