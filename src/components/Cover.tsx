import { useEffect, useState } from 'react'
import { nextCover } from '../lib/mediaProxy'

type Props = {
  src?: string
}

export function Cover({ src }: Props) {
  const [url, setUrl] = useState(src || '')

  useEffect(() => {
    setUrl(src || '')
  }, [src])

  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      onError={() => {
        const next = nextCover(url)
        setUrl(next && next !== url ? next : '')
      }}
    />
  )
}
