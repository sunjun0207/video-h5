/** 播放器把缓冲余量报到这里，下载按它让路，免得和正在播的画面抢带宽。 */
type Playback = {
  playing: boolean
  /** 当前位置往后已缓冲的秒数。 */
  ahead: number
  stalled: boolean
}

let state: Playback = { playing: false, ahead: 0, stalled: false }

export function reportPlayback(next: Playback) {
  state = next
}

/** 下载此刻可以开几路。没在播时全速；在播时缓冲越少让得越多。 */
export function downloadLanes(max: number): number {
  if (!state.playing) return max
  if (state.stalled || state.ahead < 8) return 1
  if (state.ahead < 16) return Math.min(max, 2)
  return Math.min(max, 4)
}
