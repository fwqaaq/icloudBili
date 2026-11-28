import { md5Hex } from './md5.ts'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const MOBILE_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

const BILIBILI_REFERER = 'https://www.bilibili.com/'
const BILIBILI_ORIGIN = 'https://www.bilibili.com'

const VALID_QN_SET = new Set(['32', '64', '74', '80', '112', '116', '120'])
export const VIP_QN_SET = new Set(['112', '116', '120'])

export function isVipQn(qn?: string): boolean {
  return VIP_QN_SET.has(normalizeQn(qn))
}

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]

const WBI_CACHE_TTL_MS = 10 * 60 * 1000
const SPI_CACHE_TTL_MS = 30 * 60 * 1000
const PLAY_CACHE_TTL_MS = 5 * 60 * 1000
const PLAY_CACHE_MAX_ENTRIES = 100
const MAX_SHORT_LINK_HOPS = 4

export type ErrorStatus = 400 | 401 | 402 | 403 | 404 | 501 | 502 | 504

export class BiliError extends Error {
  readonly status: ErrorStatus

  constructor(status: ErrorStatus, message: string) {
    super(message)
    this.name = 'BiliError'
    this.status = status
  }
}

export type VideoTarget = {
  idType: 'bvid' | 'aid'
  id: string
  page: number
  hasExplicitPage: boolean
  canonicalUrl: string
}

export type VideoInfo = {
  bvid: string
  aid: number
  cid: number
  title: string
  part: string
  page: number
  totalPages: number
}

export type DashMediaTrack = {
  id: number
  codecid: number
  codecs: string
  bandwidth: number
  candidates: string[]
}

export type DashMuxInput = {
  videoKey: string
  cid: number
  title: string
  part: string
  page: number
  totalPages: number
  quality: number
  qn: string
  video: DashMediaTrack
  audio: DashMediaTrack | null
}

export type DashMuxOutput = {
  stream: ReadableStream<Uint8Array> | null
  status: 200 | 206 | 416
  contentLength?: number
  contentRange?: string
}

export type DashMuxer = {
  isAvailable: () => Promise<boolean>
  muxAndServe: (
    input: DashMuxInput,
    options: {
      method: string
      rangeHeader?: string | null
      fetchCandidateStream: (candidates: string[]) => Promise<Response>
    },
  ) => Promise<DashMuxOutput>
}

export type ResolvedPlayInfo = {
  bvid: string
  aid: number
  cid: number
  title: string
  part: string
  page: number
  totalPages: number
  quality: number
  qn: string
  candidates: string[]
  dash?: {
    video: DashMediaTrack
    audio: DashMediaTrack | null
  }
}

export type StreamResult = {
  upstream: Response
  info: ResolvedPlayInfo
}

type WbiKeys = {
  imgKey: string
  subKey: string
  expiresAt: number
}

type CachedPlayEntry = {
  value: ResolvedPlayInfo
  expiresAt: number
}

type BiliApiEnvelope<T> = {
  code: number
  message?: string
  data?: T
}

type ViewPageItem = {
  cid: number
  page: number
  part?: string
}

type ViewData = {
  bvid: string
  aid: number
  cid?: number
  title?: string
  pages?: ViewPageItem[]
}

type NavData = {
  wbi_img?: {
    img_url?: string
    sub_url?: string
  }
}

type SpiData = {
  b_3?: string
  b_4?: string
}

type PlayUrlDashItem = {
  id?: number
  baseUrl?: string
  base_url?: string
  backupUrl?: string[] | null
  backup_url?: string[] | null
  bandwidth?: number
  codecs?: string
  codecid?: number
}

type PlayUrlData = {
  quality?: number
  durl?: Array<{
    url?: string
    backup_url?: string[] | null
  }>
  dash?: {
    video?: PlayUrlDashItem[]
    audio?: PlayUrlDashItem[]
  }
}

function collectSafeTrackCandidates(item: PlayUrlDashItem): string[] {
  const raw = [
    item.baseUrl,
    item.base_url,
    ...(item.backupUrl ?? []),
    ...(item.backup_url ?? []),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of raw) {
    if (!url) continue
    try {
      const safe = assertSafeCdnUrl(url)
      if (!seen.has(safe)) {
        seen.add(safe)
        out.push(safe)
      }
    } catch {
      // Skip unsafe CDN candidates
    }
  }
  return out
}

function videoCodecRank(codecid: number, targetId: number): number {
  // iOS Photos (savePhoto) handles HEVC and AVC natively; AV1 fails on older iOS hardware.
  // For 4K (120+), HEVC is standard on Bilibili; for <=1080P60, AVC/HEVC both work well.
  if (targetId >= 120) {
    if (codecid === 12) return 0
    if (codecid === 7) return 1
    if (codecid === 13) return 2
    return 3
  }
  if (codecid === 7) return 0
  if (codecid === 12) return 1
  if (codecid === 13) return 2
  return 3
}

/** Pick the highest compatible DASH video & AAC audio tracks up to targetQn while prioritizing iOS-compatible codecs. */
export function selectBestDashTracks(
  dash: NonNullable<PlayUrlData['dash']>,
  targetQn: string,
): { video: DashMediaTrack; audio: DashMediaTrack | null; quality: number } {
  const targetId = Number(normalizeQn(targetQn))
  const videoTracks: DashMediaTrack[] = []
  for (const item of dash.video ?? []) {
    if (typeof item.id !== 'number') continue
    const candidates = collectSafeTrackCandidates(item)
    if (candidates.length === 0) continue
    videoTracks.push({
      id: item.id,
      codecid: item.codecid ?? 0,
      codecs: item.codecs ?? '',
      bandwidth: item.bandwidth ?? 0,
      candidates,
    })
  }

  if (videoTracks.length === 0) {
    throw new BiliError(502, '未能从 Bilibili DASH 接口获取到可用的视频流地址')
  }

  const withinCap = videoTracks.filter((t) => t.id <= targetId)
  const bestId =
    withinCap.length > 0
      ? Math.max(...withinCap.map((t) => t.id))
      : Math.min(...videoTracks.map((t) => t.id))

  const matchingRes = videoTracks
    .filter((t) => t.id === bestId)
    .sort((a, b) => {
      const rankDiff = videoCodecRank(a.codecid, bestId) - videoCodecRank(b.codecid, bestId)
      if (rankDiff !== 0) return rankDiff
      return b.bandwidth - a.bandwidth
    })

  const video = matchingRes[0]

  const audioTracks: DashMediaTrack[] = []
  for (const item of dash.audio ?? []) {
    if (typeof item.id !== 'number') continue
    const candidates = collectSafeTrackCandidates(item)
    if (candidates.length === 0) continue
    audioTracks.push({
      id: item.id,
      codecid: item.codecid ?? 0,
      codecs: item.codecs ?? '',
      bandwidth: item.bandwidth ?? 0,
      candidates,
    })
  }
  audioTracks.sort((a, b) => b.id - a.id || b.bandwidth - a.bandwidth)

  return {
    video,
    audio: audioTracks[0] ?? null,
    quality: video.id,
  }
}

function getBiliApiHeaders(session?: string, fingerprintCookie = ''): HeadersInit {
  const headers: Record<string, string> = {
    'User-Agent': USER_AGENT,
    Referer: BILIBILI_REFERER,
    Origin: BILIBILI_ORIGIN,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
  }
  const cookies: string[] = []
  if (session) cookies.push(`SESSDATA=${session}`)
  if (fingerprintCookie) cookies.push(fingerprintCookie)
  if (cookies.length > 0) {
    headers['Cookie'] = cookies.join('; ')
  }
  return headers
}

function isWafBlocked(httpStatus: number, biliCode?: number): boolean {
  return (
    httpStatus === 412 ||
    httpStatus === 403 ||
    biliCode === -412 ||
    biliCode === -352 ||
    biliCode === -403
  )
}

function createApiSignal(timeoutMs = 25_000): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' &&
    typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined
}

/** Normalize requested quality code; falls back to 80 (non-VIP max MP4) for unsupported values. */
export function normalizeQn(qn?: string): string {
  const trimmed = (qn ?? '').trim()
  return VALID_QN_SET.has(trimmed) ? trimmed : '80'
}

export function isAllowedBilibiliHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'bilibili.com' ||
    host.endsWith('.bilibili.com') ||
    host === 'b23.tv' ||
    host.endsWith('.b23.tv') ||
    host === 'bili2233.cn' ||
    host.endsWith('.bili2233.cn')
  )
}

export function isShortLinkHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'b23.tv' ||
    host.endsWith('.b23.tv') ||
    host === 'bili2233.cn' ||
    host.endsWith('.bili2233.cn')
  )
}

/** Reject non-HTTP(S), IP literals, credentials, and loopback/internal hosts before fetching CDN URLs. */
export function assertSafeCdnUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new BiliError(502, '上游返回的 CDN 地址格式无效')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BiliError(502, '上游返回的 CDN 协议不受支持')
  }
  if (parsed.username || parsed.password) {
    throw new BiliError(502, '上游返回的 CDN 地址包含非法凭据')
  }

  const host = parsed.hostname.toLowerCase()
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)
  const isIpv6 = host.startsWith('[') || host.includes(':')
  if (
    !host ||
    !host.includes('.') ||
    isIpv4 ||
    isIpv6 ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    throw new BiliError(502, `拒绝访问不安全的上游主机: ${host}`)
  }

  return parsed.toString()
}

function parsePositivePage(rawPage?: string | null): number | undefined {
  if (!rawPage) return undefined
  const trimmed = rawPage.trim()
  if (!/^[1-9]\d*$/.test(trimmed)) return undefined
  const num = Number(trimmed)
  return Number.isSafeInteger(num) ? num : undefined
}

function convertBiliSchemeUrl(rawUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return null
  }
  if (parsed.protocol !== 'bilibili:') return null

  const page = parsePositivePage(parsed.searchParams.get('p'))
  const querySuffix = page && page > 1 ? `/?p=${page}` : '/'

  const qBv = parsed.searchParams.get('bvid')
  if (qBv && /^BV[0-9A-Za-z]{10,}$/.test(qBv)) {
    return `https://www.bilibili.com/video/${qBv}${querySuffix}`
  }
  const qAid = parsed.searchParams.get('aid')
  if (qAid && /^\d+$/.test(qAid)) {
    return `https://www.bilibili.com/video/av${qAid}${querySuffix}`
  }

  if (parsed.hostname.toLowerCase() === 'video') {
    const path = parsed.pathname.replace(/^\/+/, '')
    const bvMatch = path.match(/^(BV[0-9A-Za-z]{10,})(?:\.html|\/|$)/)
    if (bvMatch) {
      return `https://www.bilibili.com/video/${bvMatch[1]}${querySuffix}`
    }
    const avMatch = path.match(/^(?:av)?(\d+)(?:\.html|\/|$)/i)
    if (avMatch) {
      return `https://www.bilibili.com/video/av${avMatch[1]}${querySuffix}`
    }
  }
  return null
}

/** Extract a Bilibili URL or bare BV/av ID from raw query text or share copy. */
export function extractRawLinkOrId(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new BiliError(400, '缺少 bilibili 参数')
  }

  const stripTrailingPunct = (raw: string) =>
    raw.replace(/[.,;!?'")\]}>]+$/, '')

  const urlMatches = trimmed.match(/https?:\/\/[^\s<>'"\u0080-\uffff]+/gi)
  if (urlMatches && urlMatches.length > 0) {
    const cleaned = urlMatches.map(stripTrailingPunct)
    for (const candidate of cleaned) {
      try {
        const parsed = new URL(candidate)
        if (isAllowedBilibiliHost(parsed.hostname)) {
          return parsed.toString()
        }
      } catch {
        // Ignore malformed URL candidate and keep checking
      }
    }
    throw new BiliError(400, '请检查链接是否为有效的 Bilibili 链接')
  }

  const schemeMatch = trimmed.match(/bilibili:\/\/[^\s<>'"\u0080-\uffff]+/i)
  if (schemeMatch) {
    const converted = convertBiliSchemeUrl(stripTrailingPunct(schemeMatch[0]))
    if (converted) return converted
    throw new BiliError(400, '无法从链接中提取有效的 BV 号或 av 号')
  }

  const schemelessMatch = trimmed.match(
    /(?:^|[\s(>'"【「（])((?:(?:www|m)\.)?bilibili\.com\/[^\s<>'"\u0080-\uffff]+|(?:b23\.tv|bili2233\.cn)\/[^\s<>'"\u0080-\uffff]+)/i
  )
  if (schemelessMatch) {
    const candidate = `https://${stripTrailingPunct(schemelessMatch[1])}`
    try {
      const parsed = new URL(candidate)
      if (isAllowedBilibiliHost(parsed.hostname)) {
        return parsed.toString()
      }
    } catch {
      // Fall through to ID matching
    }
  }

  const bvMatch = trimmed.match(/(?:^|[^0-9A-Za-z])(BV[0-9A-Za-z]{10,})(?:$|[^0-9A-Za-z])/)
  if (bvMatch) {
    return bvMatch[1]
  }

  const avMatch = trimmed.match(/(?:^|[^0-9A-Za-z])av(\d+)(?:$|[^0-9A-Za-z])/i)
  if (avMatch) {
    return `av${avMatch[1]}`
  }

  throw new BiliError(400, '无法从输入中识别 Bilibili 视频链接或 BV/av 号')
}

function canonicalizeBilibiliUrl(url: URL): string {
  const page = parsePositivePage(url.searchParams.get('p'))
  const base = `${url.origin}${url.pathname}`
  return page && page > 1 ? `${base}?p=${page}` : base
}

/** Sign Bilibili WBI query parameters using lowercase hex MD5. */
export function encWbi(
  params: Record<string, string | number>,
  imgKey: string,
  subKey: string,
  timestampSeconds: number = Math.round(Date.now() / 1000)
): string {
  const combined = imgKey + subKey
  const mixinKey = MIXIN_KEY_ENC_TAB.map((idx) => combined[idx] ?? '')
    .join('')
    .slice(0, 32)
  const chrFilter = /[!'()*]/g

  const signedParams: Record<string, string | number> = {
    ...params,
    wts: timestampSeconds,
  }

  const query = Object.keys(signedParams)
    .sort()
    .map((key) => {
      const value = String(signedParams[key]).replace(chrFilter, '')
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    })
    .join('&')

  const wRid = md5Hex(query + mixinKey)
  return `${query}&w_rid=${wRid}`
}

/** Parse a canonical URL or bare ID into structured video target and page number. */
export function parseVideoTarget(
  resolvedInput: string,
  overridePage?: string
): VideoTarget {
  const normalizedInput = /^bilibili:\/\//i.test(resolvedInput)
    ? (convertBiliSchemeUrl(resolvedInput) ?? resolvedInput)
    : resolvedInput

  let page = 1
  let hasExplicitPage = false
  if (overridePage !== undefined && overridePage.trim() !== '') {
    const parsedOverride = parsePositivePage(overridePage)
    if (!parsedOverride) {
      throw new BiliError(400, '分 P 参数 p 必须是大于 0 的整数')
    }
    page = parsedOverride
    hasExplicitPage = true
  }

  if (/^https?:\/\//i.test(normalizedInput)) {
    let url: URL
    try {
      url = new URL(normalizedInput)
    } catch {
      throw new BiliError(400, '请检查链接格式是否正确')
    }
    if (!isAllowedBilibiliHost(url.hostname)) {
      throw new BiliError(400, '请检查链接是否为有效的 Bilibili 链接')
    }
    if (!hasExplicitPage) {
      const urlPage = parsePositivePage(url.searchParams.get('p'))
      if (urlPage !== undefined) {
        page = urlPage
        hasExplicitPage = true
      }
    }

    const pathBv = url.pathname.match(
      /(?:^|\/)(BV[0-9A-Za-z]{10,})(?:\.html|\/|$)/
    )
    const queryBv = url.searchParams.get('bvid')
    const bvid =
      pathBv?.[1] ??
      (queryBv && /^BV[0-9A-Za-z]{10,}$/.test(queryBv) ? queryBv : undefined)

    if (bvid) {
      return {
        idType: 'bvid',
        id: bvid,
        page,
        hasExplicitPage,
        canonicalUrl: `https://www.bilibili.com/video/${bvid}/${page > 1 ? `?p=${page}` : ''}`,
      }
    }

    const pathAv = url.pathname.match(/(?:^|\/)av(\d+)(?:\.html|\/|$)/i)
    const queryAv = url.searchParams.get('aid')
    const aid =
      pathAv?.[1] ?? (queryAv && /^\d+$/.test(queryAv) ? queryAv : undefined)
    if (aid) {
      return {
        idType: 'aid',
        id: aid,
        page,
        hasExplicitPage,
        canonicalUrl: `https://www.bilibili.com/video/av${aid}/${page > 1 ? `?p=${page}` : ''}`,
      }
    }

    throw new BiliError(400, '无法从链接中提取有效的 BV 号或 av 号')
  }

  if (/^BV[0-9A-Za-z]{10,}$/.test(normalizedInput)) {
    return {
      idType: 'bvid',
      id: normalizedInput,
      page,
      hasExplicitPage,
      canonicalUrl: `https://www.bilibili.com/video/${normalizedInput}/${page > 1 ? `?p=${page}` : ''}`,
    }
  }

  const avMatch = normalizedInput.match(/^av(\d+)$/i)
  if (avMatch) {
    const aid = avMatch[1]
    return {
      idType: 'aid',
      id: aid,
      page,
      hasExplicitPage,
      canonicalUrl: `https://www.bilibili.com/video/av${aid}/${page > 1 ? `?p=${page}` : ''}`,
    }
  }

  throw new BiliError(400, '无法从输入中识别有效的 BV 号或 av 号')
}

export type BilibiliService = {
  resolveLink: (rawInput: string) => Promise<string>
  resolveVideo: (
    rawInput: string,
    options?: {
      session?: string
      qn?: string
      page?: string
      forceRefresh?: boolean
    }
  ) => Promise<{ target: VideoTarget; info: ResolvedPlayInfo }>
  fetchVideoStream: (
    rawInput: string,
    options?: {
      session?: string
      qn?: string
      page?: string
      method?: string
      rangeHeader?: string | null
      ifRangeHeader?: string | null
    }
  ) => Promise<StreamResult>
}

export function createBilibiliService(deps?: {
  fetcher?: typeof fetch
  now?: () => number
  dashMuxer?: DashMuxer
}): BilibiliService {
  const fetcher: typeof fetch = deps?.fetcher ?? fetch
  const now: () => number = deps?.now ?? (() => Date.now())
  const dashMuxer = deps?.dashMuxer

  let wbiCache: WbiKeys | null = null
  let spiCookieCache: { cookie: string; expiresAt: number } | null = null
  const playCache = new Map<string, CachedPlayEntry>()

  async function getFingerprintCookie(): Promise<string> {
    if (spiCookieCache && now() < spiCookieCache.expiresAt) {
      return spiCookieCache.cookie
    }

    const bNut = Math.floor(now() / 1000)
    let cookie = `b_nut=${bNut}`

    try {
      const response = await fetcher(
        'https://api.bilibili.com/x/frontend/finger/spi',
        {
          headers: getBiliApiHeaders(),
          signal: createApiSignal(10_000),
        }
      )
      if (response.ok) {
        const payload = (await response.json()) as BiliApiEnvelope<SpiData>
        const parts: string[] = []
        if (payload.data?.b_3) parts.push(`buvid3=${payload.data.b_3}`)
        if (payload.data?.b_4) parts.push(`buvid4=${payload.data.b_4}`)
        parts.push(`b_nut=${bNut}`)
        cookie = parts.join('; ')
      } else {
        await response.body?.cancel()
      }
    } catch {
      // Non-fatal fallback: continue without buvid3 if spi endpoint is unavailable
    }

    spiCookieCache = {
      cookie,
      expiresAt: now() + SPI_CACHE_TTL_MS,
    }
    return cookie
  }

  function setPlayCache(key: string, value: ResolvedPlayInfo) {
    if (playCache.size >= PLAY_CACHE_MAX_ENTRIES) {
      const oldestKey = playCache.keys().next().value
      if (oldestKey !== undefined) {
        playCache.delete(oldestKey)
      }
    }
    playCache.set(key, {
      value,
      expiresAt: now() + PLAY_CACHE_TTL_MS,
    })
  }

  function extractTargetFromHtml(html: string, baseUrl: string): string | null {
    const snippet = html
      .slice(0, 65_536)
      .replace(/\\u002F/gi, '/')
      .replace(/\\\//g, '/')
    const patterns = [
      /<meta[^>]+property=["'](?:og:url|twitter:url)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["'](?:og:url|twitter:url)["']/i,
      /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
      /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i,
      /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"'\s>]+)/i,
      /window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i,
      /window\.location\.replace\(\s*["']([^"']+)["']\s*\)/i,
      /(https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\/[^\s"'<>\\]+)/i,
    ]

    for (const pattern of patterns) {
      const match = snippet.match(pattern)
      const rawCandidate = match?.[1]?.trim()
      if (!rawCandidate) continue

      const candidate = rawCandidate.replace(/&amp;/g, '&')
      if (/^bilibili:\/\//i.test(candidate)) {
        const converted = convertBiliSchemeUrl(candidate)
        if (converted) return converted
        continue
      }

      try {
        const resolved = new URL(candidate, baseUrl)
        if (
          (resolved.protocol === 'https:' || resolved.protocol === 'http:') &&
          isAllowedBilibiliHost(resolved.hostname)
        ) {
          return resolved.toString()
        }
      } catch {
        // Ignore malformed redirect candidates in HTML
      }
    }
    return null
  }

  function resolveRedirectTarget(
    rawLocation: string,
    currentUrl: string
  ): { done: boolean; url: string } {
    if (/^bilibili:\/\//i.test(rawLocation)) {
      const converted = convertBiliSchemeUrl(rawLocation)
      if (!converted) {
        throw new BiliError(400, '短链接跳转到了非 Bilibili 域名')
      }
      return { done: true, url: canonicalizeBilibiliUrl(new URL(converted)) }
    }

    let nextUrl: URL
    try {
      nextUrl = new URL(rawLocation, currentUrl)
    } catch {
      throw new BiliError(400, '短链接重定向地址格式无效')
    }

    if (!isAllowedBilibiliHost(nextUrl.hostname)) {
      throw new BiliError(400, '短链接跳转到了非 Bilibili 域名')
    }

    if (!isShortLinkHost(nextUrl.hostname)) {
      return { done: true, url: canonicalizeBilibiliUrl(nextUrl) }
    }

    return { done: false, url: nextUrl.toString() }
  }

  async function fetchShortLinkHop(
    url: string,
    userAgent: string
  ): Promise<Response> {
    try {
      return await fetcher(url, {
        method: 'GET',
        redirect: 'manual',
        signal: createApiSignal(),
        headers: {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml',
        },
      })
    } catch {
      throw new BiliError(502, '请检查该短链接是否可以打开')
    }
  }

  async function readHtmlExtract(res: Response, currentUrl: string): Promise<string | null> {
    const contentType = res.headers.get('content-type') ?? ''
    if (contentType && !/html|text|json|xml/i.test(contentType)) {
      await res.body?.cancel()
      return null
    }
    const html = await res.text()
    return extractTargetFromHtml(html, currentUrl)
  }

  async function resolveShortLink(shortUrl: string): Promise<string> {
    let current = shortUrl

    for (let hop = 0; hop < MAX_SHORT_LINK_HOPS; hop++) {
      let currentParsed: URL
      try {
        currentParsed = new URL(current)
      } catch {
        throw new BiliError(400, '请检查短链接格式是否正确')
      }

      if (!isAllowedBilibiliHost(currentParsed.hostname)) {
        throw new BiliError(400, '拒绝跳转至非 Bilibili 域名')
      }

      let usedMobileUa = false
      let res = await fetchShortLinkHop(current, USER_AGENT)
      if (res.status === 403 || res.status === 412) {
        await res.body?.cancel()
        usedMobileUa = true
        res = await fetchShortLinkHop(current, MOBILE_USER_AGENT)
      }

      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        await res.body?.cancel()
        if (!location) {
          throw new BiliError(400, '短链接缺少 location 跳转地址')
        }
        const step = resolveRedirectTarget(location, current)
        if (step.done) return step.url
        current = step.url
        continue
      }

      if (res.ok) {
        let htmlTarget = await readHtmlExtract(res, current)
        if (!htmlTarget && !usedMobileUa) {
          const mobileRes = await fetchShortLinkHop(current, MOBILE_USER_AGENT)
          if (mobileRes.status >= 300 && mobileRes.status < 400) {
            const location = mobileRes.headers.get('location')
            await mobileRes.body?.cancel()
            if (location) {
              const step = resolveRedirectTarget(location, current)
              if (step.done) return step.url
              current = step.url
              continue
            }
          } else if (mobileRes.ok) {
            htmlTarget = await readHtmlExtract(mobileRes, current)
          } else {
            await mobileRes.body?.cancel()
          }
        }
        if (htmlTarget) {
          const step = resolveRedirectTarget(htmlTarget, current)
          if (step.done) return step.url
          current = step.url
          continue
        }
      } else {
        await res.body?.cancel()
      }

      throw new BiliError(400, '短链接未能重定向到有效视频地址')
    }

    throw new BiliError(400, '短链接重定向次数过多')
  }

  async function resolveLink(rawInput: string): Promise<string> {
    const extracted = extractRawLinkOrId(rawInput)
    if (!/^https?:\/\//i.test(extracted)) {
      return parseVideoTarget(extracted).canonicalUrl
    }

    const parsed = new URL(extracted)
    if (isShortLinkHost(parsed.hostname)) {
      return resolveShortLink(parsed.toString())
    }
    return canonicalizeBilibiliUrl(parsed)
  }

  async function getWbiKeys(session?: string): Promise<WbiKeys> {
    if (wbiCache && now() < wbiCache.expiresAt) {
      return wbiCache
    }

    const fingerprintCookie = await getFingerprintCookie()
    const response = await fetcher(
      'https://api.bilibili.com/x/web-interface/nav',
      {
        headers: getBiliApiHeaders(session, fingerprintCookie),
        signal: createApiSignal(),
      }
    )
    if (!response.ok) {
      throw new BiliError(
        502,
        `获取 WBI 密钥失败，HTTP 状态码 ${response.status}`
      )
    }

    const payload = (await response.json()) as BiliApiEnvelope<NavData>
    const imgUrl = payload.data?.wbi_img?.img_url
    const subUrl = payload.data?.wbi_img?.sub_url
    if (!imgUrl || !subUrl) {
      throw new BiliError(502, '获取 WBI 密钥失败，响应缺少 wbi_img')
    }

    const extractKey = (url: string) => {
      const lastSlash = url.lastIndexOf('/')
      const lastDot = url.lastIndexOf('.')
      if (lastSlash === -1 || lastDot <= lastSlash) {
        throw new BiliError(502, '解析 WBI 密钥文件名失败')
      }
      return url.slice(lastSlash + 1, lastDot)
    }

    wbiCache = {
      imgKey: extractKey(imgUrl),
      subKey: extractKey(subUrl),
      expiresAt: now() + WBI_CACHE_TTL_MS,
    }
    return wbiCache
  }

  async function getVideoInfoFromPagelist(
    target: VideoTarget,
    headers: HeadersInit
  ): Promise<VideoInfo> {
    const param =
      target.idType === 'bvid'
        ? `bvid=${encodeURIComponent(target.id)}`
        : `aid=${encodeURIComponent(target.id)}`
    const response = await fetcher(
      `https://api.bilibili.com/x/player/pagelist?${param}`,
      {
        headers,
        signal: createApiSignal(),
      }
    )
    if (!response.ok) {
      throw new BiliError(
        502,
        `获取视频信息失败，HTTP 状态码 ${response.status}`
      )
    }

    const payload = (await response.json()) as BiliApiEnvelope<ViewPageItem[]>
    const pages = Array.isArray(payload.data) ? payload.data : []
    if (payload.code !== 0 || pages.length === 0) {
      const status: ErrorStatus = payload.code === -404 ? 404 : 502
      throw new BiliError(
        status,
        `获取视频分 P 信息失败（code ${payload.code}）: ${payload.message ?? '未知错误'}`
      )
    }

    const matched = pages.find((item) => item.page === target.page)
    if (!matched) {
      throw new BiliError(
        400,
        `分 P ${target.page} 不存在，该视频共有 ${pages.length} P`
      )
    }

    const fallbackId =
      target.idType === 'bvid' ? target.id : `av${target.id}`
    return {
      bvid: target.idType === 'bvid' ? target.id : '',
      aid: target.idType === 'aid' ? Number(target.id) : 0,
      cid: matched.cid,
      title: matched.part?.trim() || fallbackId,
      part: matched.part ?? '',
      page: target.page,
      totalPages: pages.length,
    }
  }

  async function getVideoInfo(
    target: VideoTarget,
    session?: string
  ): Promise<VideoInfo> {
    const fingerprintCookie = await getFingerprintCookie()
    const headers = getBiliApiHeaders(session, fingerprintCookie)
    const param =
      target.idType === 'bvid'
        ? `bvid=${encodeURIComponent(target.id)}`
        : `aid=${encodeURIComponent(target.id)}`
    const response = await fetcher(
      `https://api.bilibili.com/x/web-interface/view?${param}`,
      {
        headers,
        signal: createApiSignal(),
      }
    )
    if (!response.ok) {
      if (isWafBlocked(response.status)) {
        await response.body?.cancel()
        return getVideoInfoFromPagelist(target, headers)
      }
      throw new BiliError(
        502,
        `获取视频信息失败，HTTP 状态码 ${response.status}`
      )
    }

    const payload = (await response.json()) as BiliApiEnvelope<ViewData>
    if (payload.code !== 0 || !payload.data) {
      if (isWafBlocked(response.status, payload.code)) {
        return getVideoInfoFromPagelist(target, headers)
      }
      const status: ErrorStatus = payload.code === -404 ? 404 : 502
      throw new BiliError(
        status,
        `获取视频信息失败（code ${payload.code}）: ${payload.message ?? '未知错误'}`
      )
    }

    const data = payload.data
    const pages = Array.isArray(data.pages) ? data.pages : []
    let cid: number | undefined
    let part = ''

    if (pages.length > 0) {
      const matched = pages.find((item) => item.page === target.page)
      if (!matched) {
        throw new BiliError(
          400,
          `分 P ${target.page} 不存在，该视频共有 ${pages.length} P`
        )
      }
      cid = matched.cid
      part = matched.part ?? ''
    } else if (target.page === 1 && data.cid) {
      cid = data.cid
    }

    if (!cid || !data.bvid) {
      throw new BiliError(502, '获取视频信息失败，缺少 cid 或 bvid')
    }

    return {
      bvid: data.bvid,
      aid: data.aid,
      cid,
      title: data.title ?? data.bvid,
      part,
      page: target.page,
      totalPages: pages.length || 1,
    }
  }

  async function fetchPlayCandidates(
    videoInfo: VideoInfo,
    qn: string,
    session?: string,
    forceRefresh = false,
    prefetchedWbi?: Promise<WbiKeys>
  ): Promise<ResolvedPlayInfo> {
    const useDash = isVipQn(qn)
    if (useDash && (!dashMuxer || !(await dashMuxer.isAvailable()))) {
      throw new BiliError(
        501,
        '当前运行环境不支持 4K / 高帧率 DASH 混流（未检测到可用 ffmpeg），请切换至 NAS Docker 节点或选择 1080P 及以下清晰度'
      )
    }

    const videoKey = videoInfo.bvid || `av${videoInfo.aid}`
    const cacheKey = `${videoKey}:${videoInfo.cid}:${qn}:${useDash ? 'dash' : 'mp4'}:${session ? 'auth' : 'anon'}`
    if (!forceRefresh) {
      const cached = playCache.get(cacheKey)
      if (cached && now() < cached.expiresAt) {
        return cached.value
      }
      if (cached) {
        playCache.delete(cacheKey)
      }
    }

    const fingerprintCookie = await getFingerprintCookie()
    const headers = getBiliApiHeaders(session, fingerprintCookie)
    const idParams: Record<string, string | number> = videoInfo.bvid
      ? { bvid: videoInfo.bvid }
      : { avid: String(videoInfo.aid) }

    const baseParams: Record<string, string | number> = {
      ...idParams,
      cid: String(videoInfo.cid),
      qn,
      fnval: useDash ? 144 : 1,
      fnver: 0,
      fourk: 1,
      platform: 'pc',
    }

    let payload: BiliApiEnvelope<PlayUrlData> | null = null
    let lastHttpStatus = 200

    try {
      const { imgKey, subKey } = await (prefetchedWbi ?? getWbiKeys(session))
      const signedQuery = encWbi(
        baseParams,
        imgKey,
        subKey,
        Math.round(now() / 1000)
      )
      const wbiRes = await fetcher(
        `https://api.bilibili.com/x/player/wbi/playurl?${signedQuery}`,
        {
          headers,
          signal: createApiSignal(),
        }
      )
      lastHttpStatus = wbiRes.status
      if (wbiRes.ok) {
        const parsed = (await wbiRes.json()) as BiliApiEnvelope<PlayUrlData>
        if (!isWafBlocked(wbiRes.status, parsed.code)) {
          payload = parsed
        }
      } else if (!isWafBlocked(wbiRes.status)) {
        throw new BiliError(
          502,
          `获取视频播放地址失败，HTTP 状态码 ${wbiRes.status}`
        )
      } else {
        await wbiRes.body?.cancel()
      }
    } catch (err) {
      if (err instanceof BiliError && !err.message.includes('WBI')) {
        throw err
      }
    }

    if (!payload) {
      const plainQuery = new URLSearchParams(
        Object.entries(baseParams).map(([k, v]) => [k, String(v)])
      ).toString()
      const plainRes = await fetcher(
        `https://api.bilibili.com/x/player/playurl?${plainQuery}`,
        {
          headers,
          signal: createApiSignal(),
        }
      )
      lastHttpStatus = plainRes.status
      if (!plainRes.ok) {
        throw new BiliError(
          502,
          `获取视频播放地址失败，HTTP 状态码 ${lastHttpStatus}`
        )
      }
      payload = (await plainRes.json()) as BiliApiEnvelope<PlayUrlData>
    }

    if (payload.code !== 0 || !payload.data) {
      throw new BiliError(
        502,
        `获取视频播放地址失败（code ${payload.code}）: ${payload.message ?? '未知错误'}`
      )
    }

    if (useDash && payload.data.dash) {
      const selected = selectBestDashTracks(payload.data.dash, qn)
      const resolved: ResolvedPlayInfo = {
        bvid: videoInfo.bvid,
        aid: videoInfo.aid,
        cid: videoInfo.cid,
        title: videoInfo.title,
        part: videoInfo.part,
        page: videoInfo.page,
        totalPages: videoInfo.totalPages,
        quality: selected.quality,
        qn,
        candidates: [],
        dash: {
          video: selected.video,
          audio: selected.audio,
        },
      }
      setPlayCache(cacheKey, resolved)
      return resolved
    }

    const firstDurl = payload.data.durl?.[0]
    if (!firstDurl?.url) {
      throw new BiliError(502, '未能从 Bilibili 接口获取到可用的 MP4 播放地址')
    }

    const rawList = [firstDurl.url, ...(firstDurl.backup_url ?? [])]
    const seen = new Set<string>()
    const candidates: string[] = []
    for (const item of rawList) {
      if (!item) continue
      const safe = assertSafeCdnUrl(item)
      if (!seen.has(safe)) {
        seen.add(safe)
        candidates.push(safe)
      }
    }

    if (candidates.length === 0) {
      throw new BiliError(502, '没有通过安全校验的视频 CDN 节点')
    }

    const resolved: ResolvedPlayInfo = {
      bvid: videoInfo.bvid,
      aid: videoInfo.aid,
      cid: videoInfo.cid,
      title: videoInfo.title,
      part: videoInfo.part,
      page: videoInfo.page,
      totalPages: videoInfo.totalPages,
      quality: payload.data.quality ?? Number(qn),
      qn,
      candidates,
    }
    setPlayCache(cacheKey, resolved)
    return resolved
  }

  async function resolveVideo(
    rawInput: string,
    options?: {
      session?: string
      qn?: string
      page?: string
      forceRefresh?: boolean
    }
  ): Promise<{ target: VideoTarget; info: ResolvedPlayInfo }> {
    const resolvedLink = await resolveLink(rawInput)
    const target = parseVideoTarget(resolvedLink, options?.page)
    const qn = normalizeQn(options?.qn)
    const wbiPromise = getWbiKeys(options?.session)
    // Prevent unhandled rejection if getVideoInfo rejects first.
    wbiPromise.catch(() => {})
    const videoInfo = await getVideoInfo(target, options?.session)
    const canonicalTarget: VideoTarget = videoInfo.bvid
      ? {
          idType: 'bvid',
          id: videoInfo.bvid,
          page: videoInfo.page,
          hasExplicitPage: target.hasExplicitPage,
          canonicalUrl: `https://www.bilibili.com/video/${videoInfo.bvid}/${videoInfo.page > 1 ? `?p=${videoInfo.page}` : ''}`,
        }
      : target
    const info = await fetchPlayCandidates(
      videoInfo,
      qn,
      options?.session,
      options?.forceRefresh ?? false,
      wbiPromise
    )
    return { target: canonicalTarget, info }
  }

  async function tryCdnCandidates(
    candidates: string[],
    method: string,
    rangeHeader?: string | null,
    ifRangeHeader?: string | null
  ): Promise<Response | null> {
    const reqMethod = method.toUpperCase() === 'HEAD' ? 'HEAD' : 'GET'

    for (const cdnUrl of candidates) {
      const headers = new Headers({
        Referer: BILIBILI_REFERER,
        Origin: BILIBILI_ORIGIN,
        'User-Agent': USER_AGENT,
      })
      if (rangeHeader) headers.set('Range', rangeHeader)
      if (ifRangeHeader) headers.set('If-Range', ifRangeHeader)

      try {
        let upstream = await fetcher(cdnUrl, {
          method: reqMethod,
          headers,
          redirect: 'follow',
        })

        // Some CDN mirrors reject HEAD with 405; probe headers using GET without reading the whole body.
        if (reqMethod === 'HEAD' && upstream.status === 405) {
          await upstream.body?.cancel()
          upstream = await fetcher(cdnUrl, {
            method: 'GET',
            headers,
            redirect: 'follow',
          })
          if (upstream.ok) {
            await upstream.body?.cancel()
            return new Response(null, {
              status: upstream.status,
              headers: upstream.headers,
            })
          }
        }

        // 416 Range Not Satisfiable is a valid client-range response, not a CDN failure.
        if (upstream.ok || upstream.status === 416) {
          return upstream
        }

        await upstream.body?.cancel()
      } catch {
        // Network / TLS error on this CDN mirror, continue to next candidate
      }
    }

    return null
  }

  async function fetchVideoStream(
    rawInput: string,
    options?: {
      session?: string
      qn?: string
      page?: string
      method?: string
      rangeHeader?: string | null
      ifRangeHeader?: string | null
    }
  ): Promise<StreamResult> {
    const method = options?.method ?? 'GET'
    const resolvedLink = await resolveLink(rawInput)
    const target = parseVideoTarget(resolvedLink, options?.page)
    const qn = normalizeQn(options?.qn)
    const wbiPromise = getWbiKeys(options?.session)
    wbiPromise.catch(() => {})
    const videoInfo = await getVideoInfo(target, options?.session)

    const videoKey = videoInfo.bvid || `av${videoInfo.aid}`
    const useDash = isVipQn(qn)
    const cacheKey = `${videoKey}:${videoInfo.cid}:${qn}:${useDash ? 'dash' : 'mp4'}:${options?.session ? 'auth' : 'anon'}`
    const hadCached = playCache.has(cacheKey)

    const fetchTrackStream = async (candidates: string[]): Promise<Response> => {
      const res = await tryCdnCandidates(candidates, 'GET')
      if (!res) {
        throw new BiliError(
          502,
          '所有 Bilibili CDN 节点均返回拦截或不可用（可能受当前节点 IP 风控限制）'
        )
      }
      return res
    }

    const resolveUpstream = async (info: ResolvedPlayInfo): Promise<Response | null> => {
      if (info.dash) {
        if (!dashMuxer || !(await dashMuxer.isAvailable())) {
          throw new BiliError(
            501,
            '当前运行环境不支持 4K / 高帧率 DASH 混流（未检测到可用 ffmpeg）'
          )
        }
        const muxed = await dashMuxer.muxAndServe(
          {
            videoKey,
            cid: videoInfo.cid,
            title: videoInfo.title,
            part: videoInfo.part,
            page: videoInfo.page,
            totalPages: videoInfo.totalPages,
            quality: info.quality,
            qn: info.qn,
            video: info.dash.video,
            audio: info.dash.audio,
          },
          {
            method,
            rangeHeader: options?.rangeHeader,
            fetchCandidateStream: fetchTrackStream,
          }
        )
        const headers = new Headers({
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
        })
        if (muxed.contentLength !== undefined) {
          headers.set('Content-Length', String(muxed.contentLength))
        }
        if (muxed.contentRange) {
          headers.set('Content-Range', muxed.contentRange)
        }
        return new Response(muxed.stream, { status: muxed.status, headers })
      }

      return tryCdnCandidates(
        info.candidates,
        method,
        options?.rangeHeader,
        options?.ifRangeHeader
      )
    }

    let info = await fetchPlayCandidates(
      videoInfo,
      qn,
      options?.session,
      false,
      wbiPromise
    )

    let upstream: Response | null = null
    try {
      upstream = await resolveUpstream(info)
    } catch (err) {
      if (!hadCached || !(err instanceof BiliError) || err.status !== 502) {
        throw err
      }
    }

    if (!upstream && hadCached) {
      info = await fetchPlayCandidates(videoInfo, qn, options?.session, true)
      upstream = await resolveUpstream(info)
    }

    if (!upstream) {
      throw new BiliError(
        502,
        '所有 Bilibili CDN 节点均返回拦截或不可用（可能受当前节点 IP 风控限制）'
      )
    }

    return { upstream, info }
  }

  return {
    resolveLink,
    resolveVideo,
    fetchVideoStream,
  }
}
