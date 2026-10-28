import muxjs, { type TimingInfo } from 'mux.js'
import { probeTs, shiftTimestamps } from './mpegts'

const CLOCK = 90_000
/** 片段开头比上一段结尾早过这个量，或者晚过 FORWARD，就当时间线断了，接到上一段结尾。 */
const BACKWARD = CLOCK / 10
const FORWARD = CLOCK

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

/**
 * 把按顺序给出的 MPEG-TS 片段装成一个 mp4。
 * 片段之间时间线跳回或跳空时，把后面的时间戳整体平移接上，成片不会倒回去重播，时长也不会虚长。
 */
export class TsRemuxer {
  private readonly transmuxer = new muxjs.mp4.Transmuxer()
  private readonly pieces: Blob[] = []
  private init: Uint8Array | null = null
  private first: number | null = null
  private videoEnd: number | null = null
  private audioEnd: number | null = null
  private shift = 0

  constructor() {
    this.transmuxer.on('data', (segment) => {
      if (!this.init) this.init = segment.initSegment
      this.pieces.push(new Blob([segment.data]))
    })
    this.transmuxer.on('videoTimingInfo', (info) => {
      this.note(info)
      this.videoEnd = Math.max(this.videoEnd ?? info.end, info.end)
    })
    this.transmuxer.on('audioTimingInfo', (info) => {
      this.note(info)
      this.audioEnd = Math.max(this.audioEnd ?? info.end, info.end)
    })
  }

  private note(info: TimingInfo) {
    if (this.first === null || info.start < this.first) this.first = info.start
  }

  private get end(): number | null {
    if (this.videoEnd === null) return this.audioEnd
    if (this.audioEnd === null) return this.videoEnd
    return Math.max(this.videoEnd, this.audioEnd)
  }

  /** 两路都接在各自上一段结尾之后，谁也不重叠。 */
  private shiftAfter(video: number | null, audio: number | null): number | null {
    const shifts: number[] = []
    if (video !== null && this.videoEnd !== null) shifts.push(this.videoEnd - video)
    if (audio !== null && this.audioEnd !== null) shifts.push(this.audioEnd - audio)
    return shifts.length ? Math.max(...shifts) : null
  }

  push(bytes: Uint8Array) {
    const head = probeTs(bytes)
    const start = head.video ?? head.audio
    const last = head.video !== null ? this.videoEnd : this.audioEnd
    if (start !== null && last !== null) {
      const at = start + this.shift
      if (at < last - BACKWARD || at > last + FORWARD) this.shift = this.shiftAfter(head.video, head.audio) ?? this.shift
    }
    if (this.shift) shiftTimestamps(bytes, this.shift)
    this.transmuxer.push(bytes)
    this.transmuxer.flush()
  }

  /** 时长按装出来的时间线算。什么都没装出来时返回 null。 */
  finish(): Blob | null {
    const end = this.end
    if (!this.init || !this.pieces.length || this.first === null || end === null) return null
    if (end > this.first) patchDurations(this.init, (end - this.first) / CLOCK)
    return new Blob([this.init, ...this.pieces], { type: 'video/mp4' })
  }
}
