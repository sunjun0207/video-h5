import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { channelName, suggestVideos } from '../lib/api'
import { href } from '../lib/router'
import { Cover } from './Cover'
import { ensureLibrary, searchRemote } from '../lib/source'
import type { VideoItem } from '../lib/types'

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}

export function SearchBox({ value, onChange, onSubmit }: Props) {
  const listId = useId()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const closeTimer = useRef(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<VideoItem[]>([])
  const [active, setActive] = useState(0)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    void ensureLibrary().catch(() => undefined)
  }, [])

  useEffect(() => {
    const q = value.trim()
    if (!open || q.length < 1) {
      setItems([])
      setPending(false)
      return
    }
    let live = true
    setItems(suggestVideos(q))
    setActive(0)
    setPending(true)
    const timer = window.setTimeout(() => {
      searchRemote(q)
        .then((remote) => {
          if (!live) return
          const local = suggestVideos(q)
          const seen = new Set<string>()
          const merged = [...remote, ...local].filter((item) => {
            if (seen.has(item.id)) return false
            seen.add(item.id)
            return true
          })
          setItems(merged.slice(0, 8))
          setActive(0)
        })
        .catch(() => undefined)
        .finally(() => {
          if (live) setPending(false)
        })
    }, 140)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [value, open])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setOpen(false)
    onSubmit()
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !items.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => (index + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => (index - 1 + items.length) % items.length)
    } else if (event.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="search-box" ref={boxRef}>
      <form className="search-pill" onSubmit={submit} role="search">
        <span aria-hidden>⌕</span>
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onFocus={() => {
            window.clearTimeout(closeTimer.current)
            setOpen(true)
          }}
          onBlur={() => {
            closeTimer.current = window.setTimeout(() => setOpen(false), 180)
          }}
          onKeyDown={onKey}
          placeholder="搜索影片"
          aria-label="搜索影片"
          aria-expanded={open && (items.length > 0 || pending)}
          aria-controls={listId}
          autoComplete="off"
        />
        <small>输入片名或演员</small>
      </form>
      {open && (items.length > 0 || pending) ? (
        <ul className="suggest" id={listId} role="listbox" aria-busy={pending}>
          {items.map((item, index) => (
            <li key={item.id}>
              <a
                className={index === active ? 'on' : ''}
                role="option"
                aria-selected={index === active}
                href={href({ name: 'detail', id: item.id })}
              >
                <span className="suggest-art" style={{ background: `linear-gradient(160deg, ${item.tone[0]}, ${item.tone[1]})` }}>
                  {item.cover ? <Cover src={item.cover} /> : <i>{item.mark}</i>}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {[channelName(item.channel), item.year || '', item.actors[0] || ''].filter(Boolean).join(' · ')}
                  </small>
                </span>
              </a>
            </li>
          ))}
          {pending ? (
            <li className="suggest-pending">
              <span className="pending-dots" aria-hidden>
                <i />
                <i />
                <i />
              </span>
              正在联想…
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  )
}
