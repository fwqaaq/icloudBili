import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import {
  BiliError,
  createBilibiliService,
  type BilibiliService,
} from './bilibili.ts'
import {
  buildShortcutApiPayload,
  DEFAULT_SHORTCUT_CONFIG,
  mergeShortcutEnvOverrides,
  validateShortcutConfig,
  type ShortcutConfig,
  type ShortcutEnvOverrides,
  type ShortcutStore,
} from './shortcut.ts'
import { renderShortcutPage } from './ui.ts'

export type AppEnv = {
  Bindings: ShortcutEnvOverrides & {
    SESSION?: string
    API_TOKEN?: string
    ADMIN_TOKEN?: string
    PUBLIC_BASE_URL?: string
  }
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a)
  const bytesB = new TextEncoder().encode(b)
  const maxLen = Math.max(bytesA.length, bytesB.length)
  let diff = bytesA.length ^ bytesB.length
  for (let i = 0; i < maxLen; i++) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0)
  }
  return diff === 0
}

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.slice(0, 80) || 'bilibili-video'
}

function formatQualityLabel(quality: number): string {
  switch (quality) {
    case 120:
      return '4K'
    case 116:
      return '1080P60'
    case 112:
      return '1080P+'
    case 80:
      return '1080P'
    case 74:
      return '720P60'
    case 64:
      return '720P'
    case 32:
      return '480P'
    case 16:
      return '360P'
    default:
      return quality > 0 ? `${quality}P` : ''
  }
}

function buildContentDisposition(
  title: string,
  bvid: string,
  page: number,
  inline: boolean,
): string {
  const suffix = page > 1 ? `_p${page}` : ''
  const asciiFallback = `${bvid}${suffix}.mp4`
  const utf8Name = `${sanitizeFilename(title)}${suffix}.mp4`
  const dispositionType = inline ? 'inline' : 'attachment'
  return `${dispositionType}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(utf8Name)}`
}

function resolvePublicOrigin(c: Context<AppEnv>): string {
  const requestUrl = new URL(c.req.url)
  const configured = c.env?.PUBLIC_BASE_URL?.trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // Ignore malformed PUBLIC_BASE_URL and fall back to headers/request URL
    }
  }

  const forwardedHost = c.req
    .header('x-forwarded-host')
    ?.split(',')[0]
    ?.trim()
  if (forwardedHost && !/[\s/@\\]/.test(forwardedHost)) {
    const rawProto = c.req
      .header('x-forwarded-proto')
      ?.split(',')[0]
      ?.trim()
      ?.toLowerCase()
    const proto =
      rawProto === 'http' || rawProto === 'https'
        ? rawProto
        : requestUrl.protocol.replace(':', '')
    try {
      return new URL(`${proto}://${forwardedHost}`).origin
    } catch {
      // Ignore invalid forwarded host
    }
  }

  return requestUrl.origin
}

function getRequestToken(
  c: Context<AppEnv>,
  headerName?: string,
): string | undefined {
  if (headerName) {
    const custom = c.req.header(headerName)?.trim()
    if (custom) return custom
  }
  const queryToken = c.req.query('token')?.trim()
  if (queryToken) return queryToken

  const auth = c.req.header('authorization')
  if (auth && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim()
  }
  return undefined
}

function ensureAuthorized(c: Context<AppEnv>) {
  const expected = c.env?.API_TOKEN?.trim()
  if (!expected) return
  const provided = getRequestToken(c)
  if (!provided || !timingSafeEqualStrings(provided, expected)) {
    throw new BiliError(401, '未授权访问：缺少或无效的 API_TOKEN')
  }
}

function ensureAdminAuthorized(c: Context<AppEnv>) {
  const expected =
    c.env?.ADMIN_TOKEN?.trim() || c.env?.API_TOKEN?.trim() || ''
  if (!expected) {
    throw new BiliError(
      403,
      '未配置 ADMIN_TOKEN，已禁用网页端修改；请在 .env 设置 ADMIN_TOKEN 或直接编辑 shortcut.json',
    )
  }
  const provided = getRequestToken(c, 'x-admin-token')
  if (!provided || !timingSafeEqualStrings(provided, expected)) {
    throw new BiliError(401, '管理口令错误：请检查 ADMIN_TOKEN')
  }
}

function isShortcutWritable(
  c: Context<AppEnv>,
  store: ShortcutStore,
): boolean {
  const hasAdminSecret = Boolean(
    c.env?.ADMIN_TOKEN?.trim() || c.env?.API_TOKEN?.trim(),
  )
  return Boolean(store.save) && hasAdminSecret
}

async function handleProxyDownload(
  c: Context<AppEnv>,
  service: BilibiliService,
): Promise<Response> {
  const link = c.req.query('bilibili')
  if (!link) {
    throw new BiliError(400, '缺少 bilibili 参数')
  }

  const qn = c.req.query('qn')
  const page = c.req.query('p')
  const inline = c.req.query('inline') === '1'
  const session = c.env?.SESSION?.trim() || undefined

  const { upstream, info } = await service.fetchVideoStream(link, {
    session,
    qn,
    page,
    method: c.req.method,
    rangeHeader: c.req.header('range'),
    ifRangeHeader: c.req.header('if-range'),
  })

  const responseHeaders = new Headers()
  responseHeaders.set(
    'Content-Type',
    upstream.headers.get('content-type') || 'video/mp4',
  )
  responseHeaders.set(
    'Accept-Ranges',
    upstream.headers.get('accept-ranges') || 'bytes',
  )

  const passthroughHeaders = [
    'content-length',
    'content-range',
    'etag',
    'last-modified',
  ]
  for (const name of passthroughHeaders) {
    const val = upstream.headers.get(name)
    if (val) responseHeaders.set(name, val)
  }

  responseHeaders.set(
    'Content-Disposition',
    buildContentDisposition(
      info.title,
      info.bvid || `av${info.aid}`,
      info.page,
      inline,
    ),
  )
  responseHeaders.set('Cache-Control', 'no-store')
  responseHeaders.set('Access-Control-Allow-Origin', '*')
  responseHeaders.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Content-Disposition',
  )

  if (c.req.method.toUpperCase() === 'HEAD') {
    await upstream.body?.cancel()
    return new Response(null, {
      status: upstream.status,
      headers: responseHeaders,
    })
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  })
}

export function createApp(deps?: {
  fetcher?: typeof fetch
  now?: () => number
  shortcutStore?: ShortcutStore
}): Hono<AppEnv> {
  const service = createBilibiliService(deps)
  const shortcutStore: ShortcutStore = deps?.shortcutStore ?? {
    load: () => DEFAULT_SHORTCUT_CONFIG,
  }

  const app = new Hono<AppEnv>()

  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
      exposeHeaders: ['Content-Length', 'Content-Range', 'Content-Disposition'],
      maxAge: 86400,
    }),
  )

  app.use('/api/*', async (c, next) => {
    const path = c.req.path
    if (
      c.req.method !== 'OPTIONS' &&
      path !== '/api/health' &&
      path !== '/api/shortcut'
    ) {
      ensureAuthorized(c)
    }
    await next()
  })

  app.onError((err, c) => {
    if (err instanceof BiliError) {
      return c.text(err.message, err.status)
    }
    const message = err instanceof Error ? err.message : String(err)
    return c.text(`服务内部错误: ${message}`, 502)
  })

  async function loadEffectiveConfig(
    c: Context<AppEnv>,
  ): Promise<ShortcutConfig> {
    const base = await shortcutStore.load()
    return mergeShortcutEnvOverrides(base, c.env)
  }

  app.get('/', async (c) => {
    const config = await loadEffectiveConfig(c)
    const html = renderShortcutPage(config, {
      origin: resolvePublicOrigin(c),
      editable: isShortcutWritable(c, shortcutStore),
      requiresApiToken: Boolean(c.env?.API_TOKEN?.trim()),
    })
    return c.html(html, 200)
  })

  app.get('/api/health', (c) => {
    return c.json({
      name: 'bdownloader',
      status: 'ok',
      endpoints: [
        '/api/download?bilibili=<url|share_text|bvid>&qn=80&p=1[&raw=file]',
        '/api/proxy?bilibili=<url|share_text|bvid>&qn=80&p=1[&inline=1]',
        '/api/getreal?bilibili=<url|share_text|bvid>',
        '/api/shortcut',
      ],
    })
  })

  app.get('/api/shortcut', async (c) => {
    const config = await loadEffectiveConfig(c)
    return c.json(
      buildShortcutApiPayload(
        config,
        resolvePublicOrigin(c),
        isShortcutWritable(c, shortcutStore),
      ),
    )
  })

  app.put('/api/shortcut', async (c) => {
    ensureAdminAuthorized(c)
    if (!shortcutStore.save) {
      throw new BiliError(
        502,
        '当前运行环境不支持在线写入文件，请更新 shortcut.json 后重新部署',
      )
    }

    let rawBody: unknown
    try {
      rawBody = await c.req.json()
    } catch {
      throw new BiliError(400, '请求体必须是有效的 JSON')
    }

    const validated = validateShortcutConfig(rawBody)
    await shortcutStore.save(validated)

    return c.json(
      buildShortcutApiPayload(validated, resolvePublicOrigin(c), true),
      200,
    )
  })

  app.get('/api/getreal', async (c) => {
    const link = c.req.query('bilibili')
    if (!link) {
      throw new BiliError(400, '缺少 bilibili 参数')
    }
    const realLink = await service.resolveLink(link)
    return c.text(realLink, 200)
  })

  async function resolveDownloadPayload(
    c: Context<AppEnv>,
    input: { link?: string; qn?: string; page?: string },
  ) {
    const link = input.link?.trim()
    if (!link) {
      throw new BiliError(400, '缺少 bilibili 参数')
    }

    const session = c.env?.SESSION?.trim() || undefined
    const { target, info } = await service.resolveVideo(link, {
      session,
      qn: input.qn,
      page: input.page,
    })

    const proxyUrl = new URL('/api/proxy', resolvePublicOrigin(c))
    proxyUrl.searchParams.set('bilibili', target.canonicalUrl)
    proxyUrl.searchParams.set('qn', info.qn)
    if (info.page > 1) {
      proxyUrl.searchParams.set('p', String(info.page))
    }

    const configuredToken = c.env?.API_TOKEN?.trim()
    if (configuredToken) {
      proxyUrl.searchParams.set('token', configuredToken)
    }

    const suffix = info.page > 1 ? `_p${info.page}` : ''
    return {
      proxyUrl: proxyUrl.toString(),
      canonicalUrl: target.canonicalUrl,
      bvid: info.bvid || `av${info.aid}`,
      title: info.title,
      part: info.part,
      fileName: `${sanitizeFilename(info.title)}${suffix}`,
      qn: info.qn,
      quality: info.quality,
      qualityLabel: formatQualityLabel(info.quality),
      page: info.page,
      totalPages: info.totalPages,
      hasExplicitPage: target.hasExplicitPage,
    }
  }

  async function respondDownload(
    c: Context<AppEnv>,
    input: { link?: string; qn?: string; page?: string },
    wantJson: boolean,
  ): Promise<Response> {
    if (!wantJson) {
      const payload = await resolveDownloadPayload(c, input)
      return c.text(payload.proxyUrl, 200)
    }

    try {
      const payload = await resolveDownloadPayload(c, input)
      return c.json({ ok: true, ...payload }, 200)
    } catch (err) {
      const status = err instanceof BiliError ? err.status : 502
      const error =
        err instanceof BiliError
          ? err.message
          : `解析失败: ${err instanceof Error ? err.message : String(err)}`
      return c.json({ ok: false, status, error }, 200)
    }
  }

  app.get('/api/download', async (c) => {
    const rawMode = c.req.query('raw')
    if (rawMode === 'file') {
      return handleProxyDownload(c, service)
    }

    const wantJson = c.req.query('format')?.toLowerCase() === 'json'
    return respondDownload(
      c,
      {
        link: c.req.query('bilibili'),
        qn: c.req.query('qn'),
        page: c.req.query('p'),
      },
      wantJson,
    )
  })

  app.post('/api/download', async (c) => {
    let body: Record<string, unknown>
    try {
      const parsed = await c.req.json()
      body =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {}
    } catch {
      return c.json(
        { ok: false, status: 400, error: '请求体必须是有效的 JSON' },
        200,
      )
    }

    const asText = (v: unknown) => (typeof v === 'string' ? v : undefined)
    const wantJson = asText(body.format)?.toLowerCase() !== 'text'
    return respondDownload(
      c,
      {
        link: asText(body.bilibili),
        qn: asText(body.qn),
        page: body.p !== undefined ? String(body.p) : undefined,
      },
      wantJson,
    )
  })

  app.get('/api/proxy', (c) => handleProxyDownload(c, service))
  app.on('HEAD', '/api/proxy', (c) => handleProxyDownload(c, service))

  return app
}

const app = createApp()
export default app
