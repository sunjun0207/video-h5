import http from 'node:http'
import https from 'node:https'

const PLAY = /^\/api-video-pomelo7-server\/play\/(https?)\/([^/]+)\/(\d+)(\/.*)$/
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function blocked(host) {
  const name = host.toLowerCase()
  if (name === 'localhost' || name.endsWith('.local') || name.endsWith('.internal')) return true
  if (/^(127\.|10\.|0\.|192\.168\.|169\.254\.)/.test(name)) return true
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(name)
}

function playPath(target) {
  const scheme = target.protocol === 'https:' ? 'https' : 'http'
  const port = target.port || (scheme === 'https' ? '443' : '80')
  return `/api-video-pomelo7-server/play/${scheme}/${target.hostname}/${port}${target.pathname}${target.search}`
}

const SEGMENT_TAGS = ['#EXTINF', '#EXT-X-BYTERANGE', '#EXT-X-PROGRAM-DATE-TIME', '#EXT-X-GAP', '#EXT-X-BITRATE', '#EXT-X-DATERANGE']
const REPEAT_MAX = 180

function blocksOf(text) {
  const blocks = [{ lines: [], uris: [], duration: 0, marked: false }]
  let markNext = false
  for (const line of text.split(/\r?\n/)) {
    const row = line.trim()
    if (/ppvod-ad-injected/i.test(row)) {
      markNext = true
      continue
    }
    let block = blocks[blocks.length - 1]
    if (row === '#EXT-X-DISCONTINUITY') {
      block = { lines: [], uris: [], duration: 0, marked: markNext }
      markNext = false
      blocks.push(block)
    } else if (row.startsWith('#EXTINF:')) {
      block.duration += Number.parseFloat(row.slice(8)) || 0
    } else if (row && !row.startsWith('#')) {
      block.uris.push(row)
    }
    block.lines.push(line)
  }
  return blocks
}

function keptOfDropped(lines) {
  return lines.filter((line) => {
    const row = line.trim()
    if (!row.startsWith('#EXT') || row === '#EXT-X-DISCONTINUITY') return false
    return !SEGMENT_TAGS.some((tag) => row.startsWith(tag))
  })
}

/** 与 src/lib/hlsAds.ts 的 stripInjectedAds 保持一致。 */
function stripInjectedAds(text) {
  if (!text.includes('#EXTINF')) return text
  const blocks = blocksOf(text)
  const counts = new Map()
  if (!text.includes('#EXT-X-BYTERANGE')) {
    for (const block of blocks) for (const uri of block.uris) counts.set(uri, (counts.get(uri) || 0) + 1)
  }
  const repeated = (block) =>
    block.duration <= REPEAT_MAX && block.uris.filter((uri) => (counts.get(uri) || 0) > 1).length * 2 > block.uris.length
  const total = blocks.reduce((sum, block) => sum + block.uris.length, 0)
  const repeatedParts = blocks.filter(repeated).reduce((sum, block) => sum + block.uris.length, 0)
  const useRepeats = repeatedParts * 2 < total
  const drop = blocks.map(
    (block) => block.uris.length > 0 && (block.marked || block.uris.some((uri) => uri.includes('/adjump/')) || (useRepeats && repeated(block))),
  )
  const kept = blocks.reduce((sum, block, index) => sum + (drop[index] ? 0 : block.uris.length), 0)
  if (!drop.includes(true) || kept === 0) return text
  const out = []
  let emitted = false
  blocks.forEach((block, index) => {
    if (drop[index]) {
      out.push(...keptOfDropped(block.lines))
      return
    }
    for (const line of block.lines) {
      const row = line.trim()
      if (row === '#EXT-X-DISCONTINUITY' && !emitted) continue
      if (row && !row.startsWith('#')) emitted = true
      out.push(line)
    }
  })
  return out.join('\n')
}

function playProxy(req, res, next) {
  const raw = req.url || ''
  const queryAt = raw.indexOf('?')
  const path = queryAt >= 0 ? raw.slice(0, queryAt) : raw
  const search = queryAt >= 0 ? raw.slice(queryAt) : ''
  const matched = path.match(PLAY)
  if (!matched) {
    next()
    return
  }
  const scheme = matched[1]
  const host = matched[2]
  const port = matched[3]
  const upstreamPath = matched[4]
  if (blocked(host) || Number(port) < 1 || Number(port) > 65535) {
    res.statusCode = 403
    res.end()
    return
  }
  const lib = scheme === 'https' ? https : http
  const headers = { ...req.headers }
  delete headers.cookie
  delete headers.origin
  delete headers.referer
  delete headers.host
  headers.host = port === '80' || port === '443' ? host : `${host}:${port}`
  headers.referer = 'https://www.dushe05.com/'
  headers['user-agent'] = UA
  delete headers['accept-encoding']
  const upstream = lib.request(
    {
      hostname: host,
      port: Number(port),
      method: req.method,
      path: `${upstreamPath}${search}`,
      headers,
      rejectUnauthorized: false,
      timeout: 60000,
    },
    (incoming) => {
      const location = incoming.headers.location
      if (incoming.statusCode && incoming.statusCode >= 300 && incoming.statusCode < 400 && location) {
        const nextUrl = new URL(location, `${scheme}://${host}:${port}${upstreamPath}`)
        res.statusCode = incoming.statusCode
        res.setHeader('Location', playPath(nextUrl))
        incoming.resume()
        res.end()
        return
      }
      const playlist = upstreamPath.endsWith('.m3u8') || String(incoming.headers['content-type'] || '').includes('mpegurl')
      if (playlist) {
        const chunks = []
        incoming.on('data', (chunk) => chunks.push(chunk))
        incoming.on('end', () => {
          if (res.writableEnded) return
          let text = Buffer.concat(chunks).toString('utf8')
          if (text.includes('#EXTM3U')) text = stripInjectedAds(text)
          const out = { ...incoming.headers }
          delete out['set-cookie']
          delete out['content-length']
          delete out['content-encoding']
          res.writeHead(incoming.statusCode || 502, out)
          res.end(text)
        })
        res.on('close', () => incoming.destroy())
        return
      }
      const out = { ...incoming.headers }
      delete out['set-cookie']
      res.writeHead(incoming.statusCode || 502, out)
      incoming.pipe(res)
      res.on('close', () => incoming.destroy())
    },
  )
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502)
    res.end()
  })
  upstream.on('timeout', () => upstream.destroy())
  req.pipe(upstream)
}

export function playProxyPlugin() {
  return {
    name: 'video-play-proxy',
    configureServer(server) {
      server.middlewares.use(playProxy)
    },
    configurePreviewServer(server) {
      server.middlewares.use(playProxy)
    },
  }
}
