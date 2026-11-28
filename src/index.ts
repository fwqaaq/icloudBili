import { Hono } from 'hono'
import type { Context } from 'hono'
import { cors } from 'hono/cors'
import {
  BiliError,
  createBilibiliService,
  normalizeQn,
  parseVideoTarget,
  type BilibiliService,
  type DashMuxer,
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
import {
  createProxyTicketSigner,
  createStripeLicenseClient,
  evaluateLicenseGate,
  formatLicenseErrorMessage,
  parseStripeGateConfig,
  type ProxyTicketSigner,
  type ResolvedStripeGateConfig,
  type StripeGateEnv,
  type StripeLicenseClient,
} from './stripe-guard.ts'
import { renderShortcutPage } from './ui.ts'

export type AppEnv = {
  Bindings: ShortcutEnvOverrides &
    StripeGateEnv & {
      SESSION?: string
      API_TOKEN?: string
      ADMIN_TOKEN?: string
      PUBLIC_BASE_URL?: string
      FFMPEG_PATH?: string
    }
}

const PROXY_TICKET_TTL_SECONDS = 15 * 60

function randomHexSecret(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
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

function getRequestLicense(
  c: Context<AppEnv>,
  body?: Record<string, unknown>,
): { licenseKey?: string; instanceId?: string; instanceName?: string } {
  const asText = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined
  const licenseKey =
    asText(body?.licenseKey) ??
    asText(body?.license_key) ??
    c.req.query('licenseKey')?.trim() ??
    c.req.query('license_key')?.trim() ??
    c.req.header('x-license-key')?.trim() ??
    undefined
  const instanceId =
    asText(body?.instanceId) ??
    asText(body?.device_id) ??
    c.req.query('instanceId')?.trim() ??
    c.req.query('device_id')?.trim() ??
    c.req.header('x-instance-id')?.trim() ??
    c.req.header('x-device-id')?.trim() ??
    undefined
  const instanceName =
    asText(body?.instanceName) ??
    c.req.query('instanceName')?.trim() ??
    c.req.header('x-instance-name')?.trim() ??
    undefined
  return { licenseKey, instanceId, instanceName }
}

export function createApp(deps?: {
  fetcher?: typeof fetch
  now?: () => number
  shortcutStore?: ShortcutStore
  dashMuxer?: DashMuxer
}): Hono<AppEnv> {
  const service = createBilibiliService({
    fetcher: deps?.fetcher,
    now: deps?.now,
    dashMuxer: deps?.dashMuxer,
  })
  const shortcutStore: ShortcutStore = deps?.shortcutStore ?? {
    load: () => DEFAULT_SHORTCUT_CONFIG,
  }
  const nowFn = deps?.now ?? (() => Date.now())
  const fallbackSigningSecret = randomHexSecret()
  const stripeClients = new Map<string, StripeLicenseClient>()
  const signers = new Map<string, ProxyTicketSigner>()

  function getStripeClient(gateConfig: ResolvedStripeGateConfig): StripeLicenseClient | null {
    if (!gateConfig.enabled) return null
    const cacheKey = `${gateConfig.baseUrl}|${gateConfig.productId}|${gateConfig.defaultPlan}`
    let client = stripeClients.get(cacheKey)
    if (!client) {
      client = createStripeLicenseClient(
        {
          baseUrl: gateConfig.baseUrl,
          productId: gateConfig.productId,
          defaultCheckoutPlan: gateConfig.defaultPlan || undefined,
        },
        { fetcher: deps?.fetcher, now: deps?.now },
      )
      stripeClients.set(cacheKey, client)
    }
    return client
  }

  function getTicketSigner(c: Context<AppEnv>): ProxyTicketSigner {
    const secret =
      c.env?.PROXY_SIGNING_SECRET?.trim() ||
      c.env?.ADMIN_TOKEN?.trim() ||
      c.env?.API_TOKEN?.trim() ||
      fallbackSigningSecret
    let signer = signers.get(secret)
    if (!signer) {
      signer = createProxyTicketSigner(secret)
      signers.set(secret, signer)
    }
    return signer
  }

  async function hasDash4kCapability(): Promise<boolean> {
    if (!deps?.dashMuxer) return false
    return deps.dashMuxer.isAvailable().catch(() => false)
  }

  const app = new Hono<AppEnv>()

  app.use(
    '/api/*',
    cors({
      origin: '*',
      allowMethods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-Admin-Token',
        'X-License-Key',
        'X-Instance-Id',
        'X-Device-Id',
      ],
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

  async function verifyVipAccess(
    c: Context<AppEnv>,
    qn: string,
    creds: { licenseKey?: string; instanceId?: string },
  ) {
    const gateConfig = parseStripeGateConfig(c.env)
    if (!gateConfig.enabled || !gateConfig.proQns.has(qn)) {
      return { allowed: true as const, gateConfig }
    }
    const client = getStripeClient(gateConfig)!
    const gate = await evaluateLicenseGate(client, {
      licenseKey: creds.licenseKey,
      instanceId: creds.instanceId,
      requiredEntitlement: gateConfig.requiredEntitlement || undefined,
      checkoutPlanCode: gateConfig.defaultPlan || undefined,
    })
    if (!gate.allowed) {
      return { allowed: false as const, gateConfig, denial: gate.denial }
    }
    return { allowed: true as const, gateConfig, license: gate.result }
  }

  async function handleProxyDownload(c: Context<AppEnv>): Promise<Response> {
    const link = c.req.query('bilibili')
    if (!link) {
      throw new BiliError(400, '缺少 bilibili 参数')
    }

    const qn = c.req.query('qn')
    const normalizedQn = normalizeQn(qn)
    const page = c.req.query('p')
    const gateConfig = parseStripeGateConfig(c.env)

    if (gateConfig.enabled && gateConfig.proQns.has(normalizedQn)) {
      const expRaw = c.req.query('exp')?.trim()
      const sigRaw = c.req.query('sig')?.trim()
      let ticketValid = false

      if (expRaw && sigRaw && /^\d+$/.test(expRaw)) {
        try {
          const resolvedLink = await service.resolveLink(link)
          const parsedTarget = parseVideoTarget(resolvedLink, page)
          const signer = getTicketSigner(c)
          ticketValid = await signer.verify(
            {
              target: parsedTarget.canonicalUrl,
              qn: normalizedQn,
              page: parsedTarget.page,
              exp: Number(expRaw),
            },
            sigRaw,
            Math.floor(nowFn() / 1000),
          )
        } catch {
          ticketValid = false
        }
      }

      if (!ticketValid) {
        const creds = getRequestLicense(c)
        const check = await verifyVipAccess(c, normalizedQn, creds)
        if (!check.allowed) {
          return c.json(check.denial, check.denial.status)
        }
      }
    }

    const inline = c.req.query('inline') === '1'
    const session = c.env?.SESSION?.trim() || undefined

    const { upstream, info } = await service.fetchVideoStream(link, {
      session,
      qn: normalizedQn,
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

  app.get('/', async (c) => {
    const config = await loadEffectiveConfig(c)
    const gateConfig = parseStripeGateConfig(c.env)
    const dash4k = await hasDash4kCapability()
    const html = renderShortcutPage(config, {
      origin: resolvePublicOrigin(c),
      editable: isShortcutWritable(c, shortcutStore),
      requiresApiToken: Boolean(c.env?.API_TOKEN?.trim()),
      stripePaywall: gateConfig.enabled && gateConfig.proQns.size > 0,
      checkoutUrl: gateConfig.landingUrl,
      portalUrl: gateConfig.portalUrl,
      productId: gateConfig.productId,
      dash4k,
    })
    return c.html(html, 200)
  })

  app.get('/api/health', async (c) => {
    const gateConfig = parseStripeGateConfig(c.env)
    const dash4k = await hasDash4kCapability()
    return c.json({
      name: 'bdownloader',
      status: 'ok',
      capabilities: {
        dash4k,
        stripePaywall: gateConfig.enabled && gateConfig.proQns.size > 0,
      },
      endpoints: [
        '/api/download?bilibili=<url|share_text|bvid>&qn=80&p=1[&raw=file]',
        '/api/proxy?bilibili=<url|share_text|bvid>&qn=80&p=1[&inline=1]',
        '/api/getreal?bilibili=<url|share_text|bvid>',
        '/api/license/activate',
        '/api/license/verify',
        '/api/shortcut',
      ],
    })
  })

  app.get('/api/shortcut', async (c) => {
    const config = await loadEffectiveConfig(c)
    const gateConfig = parseStripeGateConfig(c.env)
    const dash4k = await hasDash4kCapability()
    return c.json({
      ...buildShortcutApiPayload(
        config,
        resolvePublicOrigin(c),
        isShortcutWritable(c, shortcutStore),
      ),
      capabilities: {
        dash4k,
        stripePaywall: gateConfig.enabled && gateConfig.proQns.size > 0,
      },
      licenseEnabled: gateConfig.enabled && gateConfig.proQns.size > 0,
      ...(gateConfig.enabled
        ? {
            checkoutUrl: gateConfig.landingUrl,
            directCheckoutUrl: gateConfig.directCheckoutUrl,
            portalUrl: gateConfig.portalUrl,
          }
        : {}),
    })
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

  async function handleLicenseAction(
    c: Context<AppEnv>,
    action: 'activate' | 'verify',
  ): Promise<Response> {
    const gateConfig = parseStripeGateConfig(c.env)
    const strict = c.req.query('strict') === '1'
    const client = getStripeClient(gateConfig)

    if (!client) {
      return c.json(
        {
          ok: false,
          status: 400,
          code: 'STRIPE_NOT_CONFIGURED',
          error: '当前服务未配置 Stripe 授权中心',
        },
        strict ? 400 : 200,
      )
    }

    let body: Record<string, unknown> = {}
    try {
      const parsed = await c.req.json()
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>
      }
    } catch {
      // Allow query/header-only requests too
    }

    const { licenseKey, instanceId, instanceName } = getRequestLicense(c, body)
    const result =
      action === 'activate'
        ? await client.activate({ licenseKey, instanceId, instanceName })
        : await client.verify({
            licenseKey,
            instanceId,
            requiredEntitlement: gateConfig.requiredEntitlement || undefined,
          })

    if (result.valid) {
      return c.json({ ok: true, ...result }, 200)
    }

    const status = result.code === 'STRIPE_UNAVAILABLE' ? 502 : (result.httpStatus ?? 402)
    return c.json(
      {
        ok: false,
        status,
        code: result.code,
        error: formatLicenseErrorMessage(result.code, result.message),
        checkoutUrl: gateConfig.landingUrl,
        directCheckoutUrl: gateConfig.directCheckoutUrl,
        portalUrl: gateConfig.portalUrl,
        ...(result.activations ? { activations: result.activations } : {}),
      },
      strict ? (status as 400 | 402 | 404 | 409 | 502) : 200,
    )
  }

  app.post('/api/license/activate', (c) => handleLicenseAction(c, 'activate'))
  app.post('/api/license/verify', (c) => handleLicenseAction(c, 'verify'))

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
    input: {
      link?: string
      qn?: string
      page?: string
      licenseKey?: string
      instanceId?: string
    },
  ) {
    const link = input.link?.trim()
    if (!link) {
      throw new BiliError(400, '缺少 bilibili 参数')
    }

    const normalizedQn = normalizeQn(input.qn)
    const access = await verifyVipAccess(c, normalizedQn, {
      licenseKey: input.licenseKey,
      instanceId: input.instanceId,
    })
    if (!access.allowed) {
      return { ok: false as const, denial: access.denial, gateConfig: access.gateConfig }
    }

    const session = c.env?.SESSION?.trim() || undefined
    const { target, info } = await service.resolveVideo(link, {
      session,
      qn: normalizedQn,
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

    if (access.gateConfig.enabled && access.gateConfig.proQns.has(info.qn)) {
      const exp = Math.floor(nowFn() / 1000) + PROXY_TICKET_TTL_SECONDS
      const signer = getTicketSigner(c)
      const sig = await signer.sign({
        target: target.canonicalUrl,
        qn: info.qn,
        page: info.page,
        exp,
      })
      proxyUrl.searchParams.set('exp', String(exp))
      proxyUrl.searchParams.set('sig', sig)
    }

    const suffix = info.page > 1 ? `_p${info.page}` : ''
    return {
      ok: true as const,
      payload: {
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
        ...(info.pages?.length ? { pages: info.pages } : {}),
        hasExplicitPage: target.hasExplicitPage,
      },
    }
  }

  async function respondDownload(
    c: Context<AppEnv>,
    input: {
      link?: string
      qn?: string
      page?: string
      licenseKey?: string
      instanceId?: string
    },
    wantJson: boolean,
  ): Promise<Response> {
    if (!wantJson) {
      const resolved = await resolveDownloadPayload(c, input)
      if (!resolved.ok) {
        return c.json(resolved.denial, resolved.denial.status)
      }
      return c.text(resolved.payload.proxyUrl, 200)
    }

    try {
      const resolved = await resolveDownloadPayload(c, input)
      if (!resolved.ok) {
        return c.json(
          {
            ...resolved.denial,
            portalUrl: resolved.gateConfig.portalUrl,
          },
          200,
        )
      }
      return c.json({ ok: true, ...resolved.payload }, 200)
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
      return handleProxyDownload(c)
    }

    const wantJson = c.req.query('format')?.toLowerCase() === 'json'
    const { licenseKey, instanceId } = getRequestLicense(c)
    return respondDownload(
      c,
      {
        link: c.req.query('bilibili'),
        qn: c.req.query('qn'),
        page: c.req.query('p'),
        licenseKey,
        instanceId,
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
    const { licenseKey, instanceId } = getRequestLicense(c, body)
    return respondDownload(
      c,
      {
        link: asText(body.bilibili),
        qn: asText(body.qn),
        page: body.p !== undefined ? String(body.p) : undefined,
        licenseKey,
        instanceId,
      },
      wantJson,
    )
  })

  app.get('/api/proxy', (c) => handleProxyDownload(c))
  app.on('HEAD', '/api/proxy', (c) => handleProxyDownload(c))

  return app
}

const app = createApp()
export default app
