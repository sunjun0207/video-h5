import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { channelName, suggestVideos } from '../lib/api'
import { href } from '../lib/router'
import { Cover } from './Cover'
import { searchRemote, warmSearchToken } from '../lib/source'
import { addSearchHistory } from '../lib/storage'
import type { VideoItem } from '../lib/types'

/** 停止输入这么久再去片库联想；拼音还没选字时不搜。 */
const SUGGEST_DELAY_MS = 250

type Props = {
  value: string
  onChange: (value: string) => void
  onSubmit: (keyword: string) => void
  /** 输入框聚焦时为 true。失焦晚一点再报，方便点历史和热搜。 */
  onActiveChange?: (active: boolean) => void
  /** 联想列表放进这个节点，跟搜索历史、热搜榜一起滚，不再盖住它们。 */
  suggestHost?: HTMLElement | null
}

export function SearchBox({ value, onChange, onSubmit, onActiveChange, suggestHost }: Props) {
  const listId = useId()
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const closeTimer = useRef(0)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<VideoItem[]>([])
  const [active, setActive] = useState(0)
  const [pending, setPending] = useState(false)
  const [composing, setComposing] = useState(false)

  useEffect(() => {
    const q = value.trim()
    if (!open || q.length < 1) {
      setItems([])
      setPending(false)
      return
    }
    if (composing) return
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
    }, SUGGEST_DELAY_MS)
    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [value, open, composing])

  const typedText = () => (inputRef.current?.value ?? value).trim()

  const remember = (keyword: string) => {
    const text = keyword.trim()
    if (text) addSearchHistory(text)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = typedText()
    setOpen(false)
    onActiveChange?.(false)
    if (text !== value) onChange(text)
    remember(text)
    onSubmit(text)
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

  const suggest = open && (items.length > 0 || pending) ? (
    <ul className="suggest flow" id={listId} role="listbox" aria-busy={pending}>
      {items.map((item, index) => (
          <li key={item.id}>
            <a
              className={index === active ? 'on' : ''}
              role="option"
              aria-selected={index === active}
              href={href({ name: 'detail', id: item.id })}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                remember(typedText())
                remember(item.title)
              }}
            >
            <span className="suggest-art" style={{ background: `linear-gradient(160deg, ${item.tone[0]}, ${item.tone[1]})` }}>
              {item.cover ? <Cover src={item.cover} /> : <i>{item.mark}</i>}
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>
                {[item.guessed ? '' : channelName(item.channel), item.year || '', item.actors[0] || ''].filter(Boolean).join(' · ')}
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
  ) : null

  return (
    <div className="search-box" ref={boxRef}>
      <form className="search-pill" onSubmit={submit} role="search">
        <span aria-hidden>⌕</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setOpen(true)
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onFocus={() => {
            window.clearTimeout(closeTimer.current)
            setOpen(true)
            onActiveChange?.(true)
            warmSearchToken()
            window.setTimeout(() => boxRef.current?.scrollIntoView({ block: 'start' }), 60)
          }}
          onBlur={() => {
            closeTimer.current = window.setTimeout(() => {
              setOpen(false)
              onActiveChange?.(false)
            }, 200)
          }}
          onKeyDown={onKey}
          placeholder="搜一搜，发现更多精彩"
          aria-label="搜索片名或演员"
          aria-expanded={open && (items.length > 0 || pending)}
          aria-controls={listId}
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="submit">开始探索</button>
      </form>
      {suggestHost ? (suggest ? createPortal(suggest, suggestHost) : null) : suggest}
    </div>
  )
}
