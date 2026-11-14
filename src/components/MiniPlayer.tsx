import { useEffect, useRef, useState } from 'react'
import { getVideo } from '../lib/api'
import { playbackNow, subscribePlayback, togglePlayback } from '../lib/playbackSession'
import { Cover } from './Cover'

type Props = {
  id: string
  ep: number
  onOpen: () => void
  onQueue: () => void
  onClose: () => void
}

const RING = 2 * Math.PI * 17

export function MiniPlayer({ id, ep, onOpen, onQueue, onClose }: Props) {
  const screenRef = useRef<HTMLSpanElement | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => subscribePlayback(() => setRevision((value) => value + 1)), [])
  useEffect(() => {
    const node = screenRef.current
    if (!node) return
    const place = () => {
      const box = node.getBoundingClientRect()
      if (box.width < 8 || box.height < 8) return
      const root = document.documentElement
      root.style.setProperty('--mini-x', `${Math.round(box.left)}px`)
      root.style.setProperty('--mini-y', `${Math.round(box.top)}px`)
      root.style.setProperty('--mini-w', `${Math.round(box.width)}px`)
      root.style.setProperty('--mini-h', `${Math.round(box.height)}px`)
    }
    place()
    const frame = window.requestAnimationFrame(place)
    const observer = new ResizeObserver(place)
    observer.observe(node)
    const bar = node.closest('.mini-player')
    if (bar) observer.observe(bar)
    const app = document.querySelector('.app')
    const classObserver = new MutationObserver(place)
    if (app) classObserver.observe(app, { attributes: true, attributeFilter: ['class'] })
    const viewport = window.visualViewport
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    viewport?.addEventListener('resize', place)
    viewport?.addEventListener('scroll', place)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      classObserver.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      viewport?.removeEventListener('resize', place)
      viewport?.removeEventListener('scroll', place)
      const root = document.documentElement
      root.style.removeProperty('--mini-x')
      root.style.removeProperty('--mini-y')
      root.style.removeProperty('--mini-w')
      root.style.removeProperty('--mini-h')
    }
  }, [])
  void revision
  const now = playbackNow()
  const synced = now?.id === id && now.ep === ep
  const video = getVideo(id)
  const episode = video?.episodes[synced && now ? now.ep : ep]
  const title = (synced ? now?.title : '') || video?.title || '正在播放'
  const subtitle = (synced ? now?.subtitle : '') || episode?.title || `第 ${ep + 1} 集`
  const cover = (synced ? now?.cover : '') || video?.cover
  const mark = video?.mark || ''
  const tone = video?.tone || (['#a67c52', '#c4a27a'] as [string, string])
  const playing = Boolean(synced && now?.playing)
  const progress = synced && now && now.duration > 0 ? Math.min(1, Math.max(0, now.current / now.duration)) : 0

  return (
    <div className="mini-player" role="button" tabIndex={0} aria-label={`回到播放：${title}`} onClick={onOpen}>
      <span className="mini-screen" ref={screenRef} style={{ background: `linear-gradient(160deg, ${tone[0]}, ${tone[1]})` }}>
        {cover ? <Cover src={cover} /> : <i>{mark}</i>}
      </span>
      <span className="mini-meta">
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
      <span className="mini-actions">
        <button
          type="button"
          className="mini-btn mini-toggle"
          aria-label={playing ? '暂停' : '继续播放'}
          onClick={(event) => {
            event.stopPropagation()
            togglePlayback()
          }}
        >
          <svg className="mini-ring" viewBox="0 0 40 40" aria-hidden>
            <circle cx="20" cy="20" r="17" />
            <circle cx="20" cy="20" r="17" strokeDasharray={RING} strokeDashoffset={RING * (1 - progress)} />
          </svg>
          {playing ? <PauseGlyph /> : <PlayGlyph />}
        </button>
        <button
          type="button"
          className="mini-btn"
          aria-label="播放列表"
          onClick={(event) => {
            event.stopPropagation()
            onQueue()
          }}
        >
          <ListGlyph />
        </button>
        <button
          type="button"
          className="mini-btn"
          aria-label="关闭当前播放"
          onClick={(event) => {
            event.stopPropagation()
            onClose()
          }}
        >
          <CloseGlyph />
        </button>
      </span>
    </div>
  )
}

function PlayGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M9 7.5v9l8-4.5-8-4.5Z" fill="currentColor" />
    </svg>
  )
}

function PauseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 6h3v12H8V6Zm5 0h3v12h-3V6Z" fill="currentColor" />
    </svg>
  )
}

function ListGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M8 7h11M8 12h11M8 17h11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
