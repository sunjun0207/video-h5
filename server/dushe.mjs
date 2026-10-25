import { createHash } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'

/** 可播放片库来自毒舌电影。其余地址是发布页或网盘搜索，不是同一套 HLS。 */
export const ENTRIES = [
  { role: '视频源站', url: 'https://www.dushe05.com/' },
  { role: '主站', url: 'https://x6y5.cn' },
  { role: '分站', url: 'https://z1z11.com' },
  { role: '备用', url: 'https://x2y3.cn' },
  { role: '备用一', url: 'https://www.nmme.one' },
  { role: '备用二', url: 'http://kpzei.cn/app/index.html?id=2022kpzei' },
  { role: '备用三', url: 'http://mmkk2.cn/app/index.html?id=test' },
  { role: '备用四', url: 'http://z.rtshear.com/app/index.html?id=test' },
  { role: '备用五', url: 'http://m.vipray.cn' },
  { role: '备用六', url: 'http://ssr021.cn/' },
]

const ORIGIN = 'https://www.dushe05.com'
const CHANNELS = [
  { id: 'movie', name: '电影', path: '/channel/1.html' },
  { id: 'tv', name: '连续剧', path: '/channel/2.html' },
  { id: 'anime', name: '动漫', path: '/channel/3.html' },
  { id: 'variety', name: '综艺纪录', path: '/channel/4.html' },
  { id: 'short', name: '短剧', path: '/channel/6.html' },
]
const CHANNEL_BY_NO = Object.fromEntries(CHANNELS.map((item, index) => [String([1, 2, 3, 4, 6][index]), item.id]))

const allowedHosts = new Set([
  'www.dushe05.com',
  'dushe05.com',
  'vf.wkcyvs.cn',
  'vres.wkcyvs.cn',
  '103.39.111.180:51050',
  '103.39.111.184:51050',
])
const IMAGE_HOSTS = ['https://vres.wkcyvs.cn', 'https://103.39.111.180:51050', 'https://103.39.111.184:51050']
let cookie = ''
let cookieAt = 0
let searchToken = ''
let homeCache = null
let homeAt = 0

function decode(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim()
}

function tone(id) {
  let n = 0
  for (const ch of id) n = (n * 33 + ch.charCodeAt(0)) >>> 0
  const hue = n % 360
  return [`hsl(${hue} 42% 28%)`, `hsl(${(hue + 32) % 360} 48% 42%)`]
}

function coverUrl(raw) {
  if (!raw || raw.includes('logo_placeholder')) return ''
  if (raw.startsWith('http')) return `/source/img?v=2&url=${encodeURIComponent(raw)}`
  if (raw.startsWith('/')) return `/source/img?v=2&path=${encodeURIComponent(raw)}`
  return ''
}

function request(url, { headers = {}, binary = false } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request(
      target,
      {
        method: 'GET',
        timeout: 20000,
        rejectUnauthorized: false,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          accept: binary ? '*/*' : 'text/html,application/xhtml+xml',
          referer: `${ORIGIN}/`,
          cookie,
          ...headers,
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks)
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: binary ? body : body.toString('utf8'),
          })
        })
      },
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`超时 ${url}`))
    })
    req.end()
  })
}

function solveChallenge(html) {
  const prefix = html.match(/'([0-9A-F]{40})'/)?.[1]
  if (!prefix) return ''
  const index = Number.parseInt(prefix[0], 16)
  let i = 0
  while (i < 5_000_000) {
    const digest = createHash('sha1').update(prefix + i).digest()
    if (digest[index] === 0xb0 && digest[index + 1] === 0x0b) {
      return `cdndefend_js_cookie=${prefix}${i}`
    }
    i += 1
  }
  return ''
}

async function ensureCookie() {
  if (cookie && Date.now() - cookieAt < 8 * 60 * 1000) return
  const first = await request(`${ORIGIN}/`)
  if (typeof first.body === 'string' && first.status === 200 && first.body.includes('/detail/')) {
    cookieAt = Date.now()
    return
  }
  const solved = typeof first.body === 'string' ? solveChallenge(first.body) : ''
  if (!solved) throw new Error('源站浏览器校验没有通过')
  cookie = solved
  cookieAt = Date.now()
}

async function requestFollow(url, options, hops = 0) {
  const response = await request(url, options)
  const location = response.headers.location
  if (response.status >= 300 && response.status < 400 && location && hops < 4) {
    const next = new URL(location, url)
    allowedHosts.add(next.host)
    return requestFollow(next.href, options, hops + 1)
  }
  return { ...response, finalUrl: url }
}

function openRequest(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const lib = target.protocol === 'http:' ? http : https
    const req = lib.request(
      target,
      {
        method: 'GET',
        timeout: 60000,
        rejectUnauthorized: false,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          accept: '*/*',
          referer: `${ORIGIN}/`,
          cookie,
        },
      },
      (res) => resolve({ status: res.statusCode || 0, headers: res.headers, stream: res }),
    )
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`超时 ${url}`))
    })
    req.end()
  })
}

async function openFollow(url, hops = 0) {
  const opened = await openRequest(url)
  const location = opened.headers.location
  if (opened.status >= 300 && opened.status < 400 && location && hops < 4) {
    opened.stream.resume()
    const next = new URL(location, url)
    allowedHosts.add(next.host)
    return openFollow(next.href, hops + 1)
  }
  return { ...opened, finalUrl: url }
}

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = []
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

async function fetchHtml(path) {
  await ensureCookie()
  const response = await request(new URL(path, ORIGIN).href)
  if (typeof response.body !== 'string') throw new Error('源站没有返回页面')
  if (response.status === 850 || response.body.includes('cdndefend_js_cookie')) {
    cookie = ''
    cookieAt = 0
    await ensureCookie()
    const retry = await request(new URL(path, ORIGIN).href)
    if (typeof retry.body !== 'string' || retry.status !== 200) throw new Error(`源站 ${retry.status}`)
    return retry.body
  }
  if (response.status !== 200) throw new Error(`源站 ${response.status}`)
  const token = response.body.match(/name="t" value="([^"]+)"/)?.[1]
  if (token) searchToken = token
  return response.body
}

function visibleTitle(block) {
  const titles = [...block.matchAll(/<div class="v-item-title"([^>]*)>([^<]*)<\/div>/g)]
  for (const match of titles) {
    if (/display:\s*none/.test(match[1])) continue
    const text = decode(match[2])
    if (!text || /可可影视|kkys/i.test(text)) continue
    return text
  }
  return ''
}

function parseCards(html, channel) {
  const items = []
  const re = /<a href="\/detail\/(\d+)\.html" class="v-item">([\s\S]*?)<\/a>/g
  let index = 0
  for (const match of html.matchAll(re)) {
    const id = match[1]
    const block = match[2]
    const title = visibleTitle(block)
    if (!title) continue
    const cover = block
      .match(/data-original="([^"]+)"/g)
      ?.map((item) => item.slice(15, -1))
      .find((item) => item.includes('/vod1/') || item.includes('/cover/'))
    const scoreText = block.match(/豆瓣:\s*([0-9.]+)/)?.[1]
    const badge = decode((block.match(/<div class="v-item-bottom">[\s\S]*?<span>\s*([^<]+?)\s*<\/span>/) || [])[1] || '')
    items.push(blankItem({
      id,
      title,
      channel,
      cover: coverUrl(cover || ''),
      score: scoreText ? Number(scoreText) : 0,
      hot: 1000 - index,
      badge: badge || undefined,
      updateText: badge || '正片',
      featured: false,
    }))
    index += 1
  }
  return items
}

function parseCarousel(html) {
  const items = []
  const re = /<a href="\/detail\/(\d+)\.html" class="carousel-item">([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(re)) {
    const block = match[2]
    const title = decode((block.match(/<div class="carousel-item-title">([^<]*)<\/div>/) || [])[1] || '')
    if (!title) continue
    const summary = decode((block.match(/<div class="carousel-item-desc">([\s\S]*?)<\/div>/) || [])[1] || '')
    const cover = (block.match(/data-original="([^"]+)"/) || [])[1] || ''
    const tags = [...block.matchAll(/<span class="tag">([^<]+)<\/span>/g)].map((item) => decode(item[1]))
    items.push(blankItem({
      id: match[1],
      title,
      channel: 'movie',
      cover: coverUrl(cover),
      summary,
      badge: tags[0] || '焦点',
      updateText: tags[0] || '正片',
      featured: true,
      hot: 2000 - items.length,
    }))
  }
  return items
}

function blankItem(partial) {
  const id = partial.id
  return {
    id,
    title: partial.title,
    channel: partial.channel || 'movie',
    genres: partial.genres || [],
    region: partial.region || '',
    year: partial.year || 0,
    score: partial.score || 0,
    hot: partial.hot || 0,
    badge: partial.badge,
    updateText: partial.updateText || '正片',
    actors: partial.actors || [],
    director: partial.director || '',
    summary: partial.summary || '',
    tone: tone(id),
    mark: partial.title.slice(0, 1),
    featured: partial.featured || false,
    cover: partial.cover || '',
    episodes: partial.episodes || [],
  }
}

function parseDetail(html, id) {
  const titleBlock = html.match(/<div class="detail-title">([\s\S]*?)<\/div>/)?.[1] || ''
  const titles = [...titleBlock.matchAll(/<strong>([^<]*)<\/strong>/g)].map((item) => decode(item[1]))
  const title = titles.find((item) => item && !/[𝕜𝕜𝕪𝕤]|kkys|\.com/i.test(item)) || titles[1] || id
  const tags = [...(html.match(/<div class="detail-tags[\s\S]*?<\/div>/)?.[0] || '').matchAll(/>([^<]+)<\/a>/g)]
    .map((item) => decode(item[1]))
    .filter(Boolean)
  const yearTag = tags.find((item) => /^\d{4}$/.test(item))
  const year = Number(yearTag || (html.match(/首映:[\s\S]*?<div class="detail-info-row-main">(\d{4})/) || [])[1] || 0)
  const region = tags.find((item) => item !== yearTag && !/^\d{4}$/.test(item) && item.length <= 8) || ''
  const genres = tags.filter((item) => item !== yearTag && item !== region)
  const summary = decode((html.match(/<div class="detail-desc">[\s\S]*?<p>([\s\S]*?)<\/p>/) || [])[1] || '')
  const director = decode((html.match(/导演:[\s\S]*?<div class="detail-info-row-main">([\s\S]*?)<\/div>/) || [])[1] || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const actorBlock = (html.match(/演员:[\s\S]*?<div class="detail-info-row-main">([\s\S]*?)<\/div>/) || [])[1] || ''
  const actors = [...actorBlock.matchAll(/>([^<]+)<\/a>/g)].map((item) => decode(item[1])).filter(Boolean)
  const note = decode((html.match(/备注:[\s\S]*?<div class="detail-info-row-main">([^<]+)/) || [])[1] || '')
  const cover = (html.match(/<div class="detail-pic">[\s\S]*?data-original="([^"]+)"/) || [])[1] || ''
  const channelNo = (html.match(/\/show\/(\d+)/) || [])[1]
  const scoreText = html.match(/豆瓣[:：]\s*([0-9.]+)/)?.[1]
  const sources = [...html.matchAll(/<a href="#" class="source-item[^"]*">([\s\S]*?)<\/a>/g)].map((item) => ({
    label: decode((item[1].match(/source-item-label">([^<]+)/) || [])[1] || ''),
    note: decode((item[1].match(/source-item-sublabel">([^<]+)/) || [])[1] || ''),
  }))
  const lists = [...html.matchAll(/<div class="episode-list"[^>]*>([\s\S]*?)<\/div>/g)].map((item) =>
    [...item[1].matchAll(/<a href="(\/play\/[^"]+)"[^>]*>[\s\S]*?<span>([^<]*)<\/span>/g)].map((episode) => ({
      playPath: episode[1],
      title: decode(episode[2]),
    })),
  )
  const order = lists.map((_, index) => index).sort((a, b) => lineRank(sources[a]?.label, sources[a]?.note) - lineRank(sources[b]?.label, sources[b]?.note))
  const width = Math.max(0, ...lists.map((list) => list.length))
  const episodes = []
  for (let index = 0; index < width; index += 1) {
    const lines = order
      .filter((sourceIndex) => lists[sourceIndex][index])
      .map((sourceIndex) => ({
        label: sources[sourceIndex]?.label || `线路${sourceIndex + 1}`,
        note: sources[sourceIndex]?.note || '',
        playPath: lists[sourceIndex][index].playPath,
      }))
    if (!lines.length) continue
    const titled = order.map((sourceIndex) => lists[sourceIndex][index]).find(Boolean)
    episodes.push({
      id: String(episodes.length + 1),
      title: titled?.title || `第${episodes.length + 1}集`,
      url: '',
      playPath: lines[0].playPath,
      lines,
    })
  }
  return blankItem({
    id,
    title,
    channel: CHANNEL_BY_NO[channelNo] || 'movie',
    genres,
    region,
    year,
    score: scoreText ? Number(scoreText) : 0,
    hot: 1,
    badge: note || undefined,
    updateText: episodes.length > 1 ? `更新至${episodes.length}集` : note || '正片',
    actors,
    director,
    summary,
    cover: coverUrl(cover),
    episodes,
  })
}

const TYPE_CHANNEL = {
  电影: 'movie',
  连续剧: 'tv',
  动漫: 'anime',
  综艺纪录: 'variety',
  短剧: 'short',
}

function parseSearch(html) {
  const items = []
  const re = /<a href="\/detail\/(\d+)\.html" class="search-result-item">([\s\S]*?)<\/a>/g
  for (const match of html.matchAll(re)) {
    const block = match[2]
    const title = decode((block.match(/<div class="title">([^<]+)/) || [])[1] || '')
    if (!title) continue
    const kind = decode((block.match(/search-result-item-header">\s*<div>([^<]+)/) || [])[1] || '')
    const tagBlock = (block.match(/<div class="tags">([\s\S]*?)<\/div>/) || [])[1] || ''
    const tags = [...tagBlock.matchAll(/<span>([^<]+)<\/span>/g)].map((span) => decode(span[1]))
    const year = Number(tags.find((item) => /^\d{4}$/.test(item)) || 0)
    const region = tags.find((item) => item !== String(year) && !item.includes(',')) || ''
    const genres = tags.flatMap((item) => (item.includes(',') ? item.split(',') : [])).map((item) => item.trim()).filter(Boolean)
    const actors = decode((block.match(/<div class="actors">[\s\S]*?<span>([^<]*)<\/span>/) || [])[1] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const summary = decode((block.match(/<div class="desc">([\s\S]*?)<\/div>/) || [])[1] || '')
    const cover = [...block.matchAll(/data-original="([^"]+)"/g)].map((item) => item[1]).find((item) => item.includes('/vod1/'))
    items.push(blankItem({
      id: match[1],
      title,
      channel: TYPE_CHANNEL[kind] || 'movie',
      genres,
      region,
      year,
      actors,
      summary,
      cover: coverUrl(cover || ''),
      hot: 500 - items.length,
      updateText: kind || '正片',
    }))
  }
  return items
}

function parsePlay(html) {
  const src = html.match(/src:\s*"([^"]+\.m3u8[^"]*)"/)?.[1]
  if (!src) throw new Error('这一集没有播放地址')
  allowedHosts.add(new URL(src).host)
  return src
}

function merge(base, extra) {
  const map = new Map(base.map((item) => [item.id, item]))
  for (const item of extra) {
    const prev = map.get(item.id)
    if (!prev) {
      map.set(item.id, item)
      continue
    }
    if (!prev.cover && item.cover) prev.cover = item.cover
    if (!prev.summary && item.summary) prev.summary = item.summary
    if (!prev.score && item.score) prev.score = item.score
    if (item.featured) prev.featured = true
    if (item.hot > prev.hot) prev.hot = item.hot
    if (item.channel && prev.channel === 'movie' && item.channel !== 'movie') prev.channel = item.channel
  }
  return [...map.values()]
}

export async function loadHome() {
  if (homeCache && Date.now() - homeAt < 3 * 60 * 1000) return homeCache
  const homeHtml = await fetchHtml('/')
  let videos = [...parseCarousel(homeHtml), ...parseCards(homeHtml, 'movie')]
  const channels = await Promise.all(
    CHANNELS.map(async (channel) => {
      try {
        const html = await fetchHtml(channel.path)
        return parseCards(html, channel.id)
      } catch {
        return []
      }
    }),
  )
  for (const list of channels) videos = merge(videos, list)
  homeCache = { channels: CHANNELS.map(({ id, name }) => ({ id, name })), videos }
  homeAt = Date.now()
  return homeCache
}

export async function loadDetail(id) {
  if (!/^\d+$/.test(id)) throw new Error('无效的影片编号')
  const html = await fetchHtml(`/detail/${id}.html`)
  return parseDetail(html, id)
}

const PLAY_PATH = /^\/play\/\d+-\d+-\d+\.html$/
const playCache = new Map()

function lineRank(label = '', note = '') {
  const text = `${label} ${note}`
  if (/4K|超清/.test(text)) return 40
  if (/播放快/.test(text)) return 0
  if (/标清/.test(text)) return 1
  if (/720/.test(text)) return 2
  if (/大陆/.test(text)) return 3
  if (/高清/.test(text)) return 8
  if (/香港/.test(text)) return 10
  return 20
}

function readStreamLimited(stream, ms) {
  return new Promise((resolve) => {
    const chunks = []
    let settled = false
    let aborted = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ buf: Buffer.concat(chunks), aborted })
    }
    const timer = setTimeout(() => {
      aborted = true
      stream.destroy()
      finish()
    }, ms)
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('end', finish)
    stream.on('error', finish)
    stream.on('close', finish)
  })
}

function looksLikeMedia(buf) {
  if (buf.length < 188) return false
  if (buf[0] === 0x47) return true
  return buf.subarray(0, 32).toString('latin1').includes('ftyp')
}

async function readPlaylist(url) {
  const opened = await openFollow(url)
  const finalUrl = opened.finalUrl || url
  allowedHosts.add(new URL(finalUrl).host)
  const text = (await readStream(opened.stream)).toString('utf8')
  if (!text.includes('#EXTM3U')) throw new Error('播放列表无效')
  return { text, url: finalUrl }
}

function chooseVariant(text, playlistUrl) {
  if (!text.includes('#EXT-X-STREAM-INF')) return playlistUrl
  const rows = text.split(/\r?\n/)
  const variants = []
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXT-X-STREAM-INF')) continue
    const bandwidth = Number((rows[index].match(/BANDWIDTH=(\d+)/) || [])[1] || 0)
    const uri = (rows[index + 1] || '').trim()
    if (!uri || uri.startsWith('#')) continue
    variants.push({ bandwidth, url: new URL(uri, playlistUrl).href })
  }
  if (!variants.length) return playlistUrl
  const usable = variants.filter((item) => item.bandwidth >= 400000 && item.bandwidth <= 2_500_000)
  const pool = usable.length ? usable : variants
  const chosen = pool.sort((a, b) => a.bandwidth - b.bandwidth)[0]
  allowedHosts.add(new URL(chosen.url).host)
  return chosen.url
}

async function probeEntry(entry) {
  const html = await fetchHtml(entry.playPath)
  const master = parsePlay(html)
  const playlist = await readPlaylist(master)
  const variantUrl = chooseVariant(playlist.text, playlist.url)
  const media = variantUrl === playlist.url ? playlist : await readPlaylist(variantUrl)
  const rows = media.text.split(/\r?\n/)
  let duration = 0
  let segment = ''
  for (let index = 0; index < rows.length; index += 1) {
    if (!rows[index].startsWith('#EXTINF:')) continue
    duration = Number.parseFloat(rows[index].slice(8))
    segment = (rows[index + 1] || '').trim()
    if (segment && !segment.startsWith('#')) break
  }
  if (!segment || !duration) return null
  const segmentUrl = new URL(segment, media.url).href
  allowedHosts.add(new URL(segmentUrl).host)
  const opened = await openFollow(segmentUrl)
  const started = Date.now()
  const { buf, aborted } = await readStreamLimited(opened.stream, 8000)
  const elapsed = Math.max((Date.now() - started) / 1000, 0.05)
  const headerSize = Number(opened.headers['content-length'] || 0)
  const size = headerSize || buf.length
  if (!looksLikeMedia(buf) || !size || (aborted && !headerSize)) return null
  return {
    ...entry,
    mediaUrl: media.url,
    ratio: (buf.length * duration) / (elapsed * size),
    bitrate: size / duration,
  }
}

export async function loadPlay(entries, { only = false } = {}) {
  const list = entries.filter((entry) => PLAY_PATH.test(entry.playPath))
  if (!list.length) throw new Error('无效的播放地址')
  const key = `${only ? '1' : '0'}:${list.map((entry) => entry.playPath).join('|')}`
  const cached = playCache.get(key)
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value
  const ranked = [...list].sort((a, b) => lineRank(a.label, a.note) - lineRank(b.label, b.note))
  const picked = []
  const textOf = (entry) => `${entry.label} ${entry.note}`
  const take = (match, limit) => {
    let count = 0
    for (const entry of ranked) {
      if (only || picked.length >= 6 || count >= limit) return
      if (picked.includes(entry) || !match(textOf(entry))) continue
      picked.push(entry)
      count += 1
    }
  }
  if (only) picked.push(ranked[0])
  take((text) => /播放快|标清|720/.test(text), 2)
  take((text) => /大陆|香港/.test(text), 2)
  take(() => true, 6)
  let pool = []
  for (let offset = 0; offset < picked.length; offset += 3) {
    const found = (
      await Promise.all(picked.slice(offset, offset + 3).map((entry) => probeEntry(entry).catch(() => null)))
    ).filter(Boolean)
    pool = pool.concat(found)
    if (only || pool.some((item) => item.ratio >= 2)) break
  }
  if (!pool.length) throw new Error('这一集没有可播放的线路')
  pool.sort((a, b) => b.ratio - a.ratio)
  const best = pool[0]
  const value = {
    url: `/source/media?url=${encodeURIComponent(best.mediaUrl)}`,
    line: [best.label, best.note].filter(Boolean).join(' · '),
  }
  playCache.set(key, { at: Date.now(), value })
  return value
}

export async function loadSearch(keyword) {
  const q = keyword.trim()
  if (!q) return []
  if (!searchToken) await fetchHtml('/')
  const query = `k=${encodeURIComponent(q)}${searchToken ? `&t=${encodeURIComponent(searchToken)}` : ''}`
  const html = await fetchHtml(`/search?${query}`)
  return parseSearch(html)
}

function rewritePlaylist(text, playlistUrl) {
  const base = new URL(playlistUrl)
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line
      if (line.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${proxyMedia(uri, base)}"`)
      }
      return proxyMedia(line.trim(), base)
    })
    .join('\n')
}

function proxyMedia(uri, base) {
  const absolute = new URL(uri, base)
  allowedHosts.add(absolute.host)
  return `/source/media?url=${encodeURIComponent(absolute.href)}`
}

function sendJson(res, value, status = 200) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(value))
}

export async function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (url.pathname === '/source/meta') {
    sendJson(res, { origin: ORIGIN, entries: ENTRIES, channels: CHANNELS })
    return
  }
  if (url.pathname === '/source/home') {
    sendJson(res, await loadHome())
    return
  }
  if (url.pathname === '/source/search') {
    sendJson(res, await loadSearch(url.searchParams.get('q') || ''))
    return
  }
  const detail = url.pathname.match(/^\/source\/detail\/(\d+)$/)
  if (detail) {
    sendJson(res, await loadDetail(detail[1]))
    return
  }
  if (url.pathname === '/source/play') {
    const paths = url.searchParams.getAll('path')
    const labels = url.searchParams.getAll('label')
    const notes = url.searchParams.getAll('note')
    const entries = paths.filter(Boolean).map((playPath, index) => ({
      playPath,
      label: labels[index] || '',
      note: notes[index] || '',
    }))
    sendJson(res, await loadPlay(entries, { only: url.searchParams.get('only') === '1' }))
    return
  }
  if (url.pathname === '/source/img') {
    const path = url.searchParams.get('path')
    const raw = url.searchParams.get('url')
    const targets = path
      ? (path.startsWith('/vod') ? IMAGE_HOSTS : [ORIGIN]).map((origin) => new URL(path, origin).href)
      : raw
        ? [raw]
        : []
    if (!targets.length) throw new Error('缺少图片地址')
    const host = new URL(targets[0]).host
    if (!path?.startsWith('/vod') && !allowedHosts.has(host)) throw new Error('拒绝代理未授权的图片')
    let image = null
    const pending = targets.map((target) =>
      request(target, { binary: true, headers: { accept: 'image/*' } })
        .then((got) => {
          const type = String(got.headers['content-type'] || '')
          if (!image && got.status === 200 && type.startsWith('image/')) image = got
        })
        .catch(() => undefined),
    )
    await Promise.all(pending)
    if (!image) throw new Error('封面没有回应')
    res.statusCode = 200
    res.setHeader('content-type', image.headers['content-type'] || 'image/jpeg')
    res.setHeader('cache-control', 'public, max-age=86400')
    res.end(image.body)
    return
  }
  if (url.pathname === '/source/media') {
    const target = url.searchParams.get('url') || ''
    const parsed = new URL(target)
    if (!allowedHosts.has(parsed.host)) throw new Error('拒绝代理未授权的媒体地址')
    await ensureCookie()
    const media = await openFollow(target)
    const type = String(media.headers['content-type'] || '')
    const finalUrl = media.finalUrl || target
    allowedHosts.add(new URL(finalUrl).host)
    const isPlaylist = new URL(finalUrl).pathname.endsWith('.m3u8') || type.includes('mpegurl')
    if (isPlaylist) {
      const text = (await readStream(media.stream)).toString('utf8')
      if (!text.includes('#EXTM3U')) throw new Error('播放列表无效')
      const rewritten = rewritePlaylist(text, finalUrl)
      res.statusCode = 200
      res.setHeader('content-type', 'application/vnd.apple.mpegurl')
      res.end(rewritten)
      return
    }
    res.statusCode = media.status
    if (type) res.setHeader('content-type', type)
    const length = media.headers['content-length']
    if (length) res.setHeader('content-length', length)
    media.stream.on('error', () => {
      if (!res.writableEnded) res.destroy()
    })
    res.on('close', () => media.stream.destroy())
    media.stream.pipe(res)
    return
  }
  sendJson(res, { error: '未知接口' }, 404)
}

export const __test = { parseCards, parseCarousel, parseDetail, parsePlay, solveChallenge }
