declare module 'mux.js' {
  export interface TransmuxerSegment {
    initSegment: Uint8Array
    data: Uint8Array
  }

  export interface TimingInfo {
    start: number
    end: number
  }

  export class Transmuxer {
    on(event: 'data', listener: (segment: TransmuxerSegment) => void): void
    on(event: 'videoTimingInfo', listener: (info: TimingInfo) => void): void
    on(event: 'audioTimingInfo', listener: (info: TimingInfo) => void): void
    push(data: Uint8Array): void
    flush(): void
  }

  const muxjs: {
    mp4: { Transmuxer: typeof Transmuxer }
  }

  export default muxjs
}
