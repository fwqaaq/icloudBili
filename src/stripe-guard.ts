import type { Context, MiddlewareHandler } from 'hono'

export type StripeLicenseConfig = {
  baseUrl: string
  productId: string
  defaultCheckoutPlan?: string
  cacheTtlMs?: number
}

export type LicenseVerifyResult =
  | {
      valid: true
      code: 'OK'
      productId: string
      planCode: string
      entitlements: string[]
      status: string
      mode: string
      email: string
      expiresAt: string | null
      cancelAtPeriodEnd: boolean
      activations: { used: number; max: number | null }
    }
  | {
      valid: false
      code: string
      message: string
      httpStatus?: number
      activations?: { used: number; max: number | null }
    }

export type StripeCheckoutUrls = {
  landingUrl: string
  directCheckoutUrl: string
}

export type StripeLicenseClient = {
  readonly productId: string
  readonly baseUrl: string
  verify: (params: {
    licenseKey?: string
    instanceId?: string
    requiredEntitlement?: string
  }) => Promise<LicenseVerifyResult>
  activate: (params: {
    licenseKey?: string
    instanceId?: string
    instanceName?: string
  }) => Promise<LicenseVerifyResult>
  deactivate: (params: {
    licenseKey?: string
    instanceId?: string
  }) => Promise<{ ok: boolean; deactivated?: boolean; code?: string; message?: string; httpStatus?: number }>
  getCheckoutUrls: (options?: {
    planCode?: string
    email?: string
    ref?: string
  }) => StripeCheckoutUrls
}

export type LicenseGateDenial = {
  ok: false
  status: 402 | 502
  code: string
  error: string
  productId: string
  requiredEntitlement?: string
  checkoutUrl: string
  directCheckoutUrl: string
  activations?: { used: number; max: number | null }
}

const LICENSE_ERROR_MESSAGES: Record<string, string> = {
  PAYMENT_REQUIRED: '该功能需要开通会员，请购买或输入授权码（License Key）',
  MISSING_PARAMETERS: '缺少有效的会员授权码或设备标识',
  PRODUCT_NOT_FOUND: 'Stripe 产品配置不存在或未启用',
  NOT_A_LICENSE_PRODUCT: '该 Stripe 产品未开启授权码发放模式',
  LICENSE_NOT_FOUND: '未找到该授权码，请检查是否输入有误',
  LICENSE_REVOKED: '该授权码已被撤销或产生退款争议，请重新购买',
  LICENSE_REFUNDED: '该授权码对应订单已退款，无法继续使用',
  SUBSCRIPTION_PAST_DUE: '订阅扣款逾期，请前往 Stripe 账单页更新付款方式',
  SUBSCRIPTION_EXPIRED: '会员订阅已过期，请续费后继续使用',
  ENTITLEMENT_MISSING: '当前套餐不包含所需会员权益（需支持 4K / 高画质套餐）',
  INSTANCE_REQUIRED: '当前授权限制设备数量，请更新至最新客户端后自动绑定设备',
  INSTANCE_NOT_ACTIVATED: '当前设备尚未激活此授权码，请先点击激活授权',
  ACTIVATION_LIMIT_REACHED: '该授权码已达到最大激活设备数上限，请先解绑其他设备或购买新授权',
  STRIPE_UNAVAILABLE: '暂时无法连接 Stripe 授权服务，请稍后重试',
}

export function formatLicenseErrorMessage(code: string, fallback?: string): string {
  return LICENSE_ERROR_MESSAGES[code] ?? (fallback || '会员授权校验未通过')
}

function createSignal(timeoutMs = 12_000): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(timeoutMs)
    : undefined
}

export function createStripeLicenseClient(
  config: StripeLicenseConfig,
  deps?: { fetcher?: typeof fetch; now?: () => number },
): StripeLicenseClient {
  const baseUrl = config.baseUrl.trim().replace(/\/+$/, '')
  const productId = config.productId.trim()
  const fetcher = deps?.fetcher ?? fetch
  const now = deps?.now ?? (() => Date.now())
  const cacheTtlMs = config.cacheTtlMs ?? 60_000
  const verifyCache = new Map<string, { value: Extract<LicenseVerifyResult, { valid: true }>; expiresAt: number }>()

  function invalidateKeyCache(upperKey: string) {
    const prefix = `${productId}:${upperKey}:`
    for (const cacheKey of verifyCache.keys()) {
      if (cacheKey.startsWith(prefix)) {
        verifyCache.delete(cacheKey)
      }
    }
  }

  async function postJson<T>(path: string, body: Record<string, unknown>): Promise<{ status: number; data: T }> {
    const res = await fetcher(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: createSignal(),
    })
    const text = await res.text()
    try {
      return { status: res.status, data: JSON.parse(text) as T }
    } catch {
      throw new Error(`Stripe 授权服务响应格式异常 (HTTP ${res.status})`)
    }
  }

  async function verify(params: {
    licenseKey?: string
    instanceId?: string
    requiredEntitlement?: string
  }): Promise<LicenseVerifyResult> {
    const key = params.licenseKey?.trim().toUpperCase() ?? ''
    if (!key) {
      return {
        valid: false,
        code: 'PAYMENT_REQUIRED',
        message: formatLicenseErrorMessage('PAYMENT_REQUIRED'),
        httpStatus: 402,
      }
    }

    const instanceId = params.instanceId?.trim() || undefined
    const requiredEntitlement = params.requiredEntitlement?.trim() || undefined
    const cacheKey = `${productId}:${key}:${instanceId ?? ''}:${requiredEntitlement ?? ''}`
    const cached = verifyCache.get(cacheKey)
    if (cached && now() < cached.expiresAt) {
      return cached.value
    }
    if (cached) verifyCache.delete(cacheKey)

    try {
      const { status, data } = await postJson<LicenseVerifyResult>('/v1/licenses/verify', {
        productId,
        licenseKey: key,
        ...(instanceId ? { instanceId } : {}),
        ...(requiredEntitlement ? { requiredEntitlement } : {}),
      })

      if (data.valid) {
        let ttl = cacheTtlMs
        if (data.expiresAt) {
          const msLeft = new Date(data.expiresAt).getTime() - now()
          if (Number.isFinite(msLeft)) {
            ttl = Math.max(0, Math.min(ttl, msLeft))
          }
        }
        if (ttl > 0) {
          if (verifyCache.size >= 500) {
            const oldest = verifyCache.keys().next().value
            if (oldest !== undefined) verifyCache.delete(oldest)
          }
          verifyCache.set(cacheKey, { value: data, expiresAt: now() + ttl })
        }
        return data
      }

      return { ...data, httpStatus: status }
    } catch (err) {
      return {
        valid: false,
        code: 'STRIPE_UNAVAILABLE',
        message: err instanceof Error ? err.message : formatLicenseErrorMessage('STRIPE_UNAVAILABLE'),
        httpStatus: 502,
      }
    }
  }

  async function activate(params: {
    licenseKey?: string
    instanceId?: string
    instanceName?: string
  }): Promise<LicenseVerifyResult> {
    const key = params.licenseKey?.trim().toUpperCase() ?? ''
    const instanceId = params.instanceId?.trim() ?? ''
    if (!key || !instanceId) {
      return {
        valid: false,
        code: 'MISSING_PARAMETERS',
        message: formatLicenseErrorMessage('MISSING_PARAMETERS'),
        httpStatus: 400,
      }
    }

    try {
      const { status, data } = await postJson<LicenseVerifyResult>('/v1/licenses/activate', {
        productId,
        licenseKey: key,
        instanceId,
        ...(params.instanceName?.trim() ? { instanceName: params.instanceName.trim().slice(0, 80) } : {}),
      })
      invalidateKeyCache(key)
      return data.valid ? data : { ...data, httpStatus: status }
    } catch (err) {
      return {
        valid: false,
        code: 'STRIPE_UNAVAILABLE',
        message: err instanceof Error ? err.message : formatLicenseErrorMessage('STRIPE_UNAVAILABLE'),
        httpStatus: 502,
      }
    }
  }

  async function deactivate(params: { licenseKey?: string; instanceId?: string }) {
    const key = params.licenseKey?.trim().toUpperCase() ?? ''
    const instanceId = params.instanceId?.trim() ?? ''
    if (!key || !instanceId) {
      return {
        ok: false,
        code: 'MISSING_PARAMETERS',
        message: formatLicenseErrorMessage('MISSING_PARAMETERS'),
        httpStatus: 400,
      }
    }
    try {
      const { status, data } = await postJson<{
        ok: boolean
        deactivated?: boolean
        code?: string
        message?: string
      }>('/v1/licenses/deactivate', {
        productId,
        licenseKey: key,
        instanceId,
      })
      invalidateKeyCache(key)
      return { ...data, httpStatus: status }
    } catch (err) {
      return {
        ok: false,
        code: 'STRIPE_UNAVAILABLE',
        message: err instanceof Error ? err.message : formatLicenseErrorMessage('STRIPE_UNAVAILABLE'),
        httpStatus: 502,
      }
    }
  }

  function getCheckoutUrls(options?: {
    planCode?: string
    email?: string
    ref?: string
  }): StripeCheckoutUrls {
    const encodedId = encodeURIComponent(productId)
    const landingUrl = `${baseUrl}/p/${encodedId}`
    const plan = options?.planCode?.trim() || config.defaultCheckoutPlan?.trim()
    const direct = new URL(
      plan
        ? `${baseUrl}/v1/checkout/${encodedId}/${encodeURIComponent(plan)}`
        : `${baseUrl}/v1/checkout/${encodedId}`,
    )
    if (options?.email?.trim()) direct.searchParams.set('email', options.email.trim())
    if (options?.ref?.trim()) direct.searchParams.set('ref', options.ref.trim())
    return {
      landingUrl,
      directCheckoutUrl: direct.toString(),
    }
  }

  return {
    productId,
    baseUrl,
    verify,
    activate,
    deactivate,
    getCheckoutUrls,
  }
}

export type ProxyTicketPayload = {
  target: string
  qn: string
  page: number
  exp: number
}

export type ProxyTicketSigner = {
  sign: (payload: ProxyTicketPayload) => Promise<string>
  verify: (payload: ProxyTicketPayload, signature: string, nowSec?: number) => Promise<boolean>
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function timingSafeEqualAscii(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < maxLen; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  }
  return diff === 0
}

/** HMAC-SHA256 signer built on WebCrypto so proxy tickets work across Workers, Node, and Deno. */
export function createProxyTicketSigner(secret: string): ProxyTicketSigner {
  const encoder = new TextEncoder()
  const keyPromise = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  async function computeSig(payload: ProxyTicketPayload): Promise<string> {
    const key = await keyPromise
    const canonical = `${payload.target}\n${payload.qn}\n${payload.page}\n${payload.exp}`
    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(canonical))
    return toBase64Url(new Uint8Array(mac))
  }

  return {
    sign: computeSig,
    async verify(payload, signature, nowSec = Math.floor(Date.now() / 1000)) {
      if (!signature || !Number.isFinite(payload.exp) || payload.exp <= nowSec) {
        return false
      }
      const expected = await computeSig(payload)
      return timingSafeEqualAscii(signature, expected)
    },
  }
}

export async function evaluateLicenseGate(
  client: StripeLicenseClient,
  params: {
    licenseKey?: string
    instanceId?: string
    requiredEntitlement?: string
    checkoutPlanCode?: string
  },
): Promise<{ allowed: true; result: Extract<LicenseVerifyResult, { valid: true }> } | { allowed: false; denial: LicenseGateDenial }> {
  const result = await client.verify({
    licenseKey: params.licenseKey,
    instanceId: params.instanceId,
    requiredEntitlement: params.requiredEntitlement,
  })

  if (result.valid) {
    return { allowed: true, result }
  }

  const urls = client.getCheckoutUrls({ planCode: params.checkoutPlanCode })
  const status: 402 | 502 = result.code === 'STRIPE_UNAVAILABLE' ? 502 : 402
  return {
    allowed: false,
    denial: {
      ok: false,
      status,
      code: result.code,
      error: formatLicenseErrorMessage(result.code, result.message),
      productId: client.productId,
      ...(params.requiredEntitlement ? { requiredEntitlement: params.requiredEntitlement } : {}),
      checkoutUrl: urls.landingUrl,
      directCheckoutUrl: urls.directCheckoutUrl,
      ...(result.activations ? { activations: result.activations } : {}),
    },
  }
}

/** Reusable Hono middleware factory for protecting paid routes in any project backed by stripe-v2. */
export function createStripeEntitlementMiddleware<E extends { Bindings?: Record<string, unknown> }>(options: {
  getClient: (c: Context<E>) => StripeLicenseClient | null
  requiredEntitlement?: (c: Context<E>) => string | undefined
  shouldRequire?: (c: Context<E>) => boolean
  extractCredentials?: (c: Context<E>) => { licenseKey?: string; instanceId?: string }
}): MiddlewareHandler<E> {
  return async (c, next) => {
    if (options.shouldRequire && !options.shouldRequire(c)) {
      await next()
      return
    }

    const client = options.getClient(c)
    if (!client) {
      await next()
      return
    }

    const creds = options.extractCredentials
      ? options.extractCredentials(c)
      : {
          licenseKey:
            c.req.header('x-license-key')?.trim() || c.req.query('licenseKey')?.trim(),
          instanceId:
            c.req.header('x-instance-id')?.trim() || c.req.query('instanceId')?.trim(),
        }

    const gate = await evaluateLicenseGate(client, {
      licenseKey: creds.licenseKey,
      instanceId: creds.instanceId,
      requiredEntitlement: options.requiredEntitlement?.(c),
    })

    if (!gate.allowed) {
      return c.json(gate.denial, gate.denial.status)
    }

    await next()
  }
}

export type StripeGateEnv = {
  STRIPE_LICENSE_URL?: string
  STRIPE_PRODUCT_ID?: string
  STRIPE_VIP_ENTITLEMENT?: string
  STRIPE_DEFAULT_PLAN?: string
  LICENSE_SERVER_URL?: string
  LICENSE_PRODUCT_ID?: string
  LICENSE_DEFAULT_PLAN?: string
  LICENSE_PRO_QNS?: string
  LICENSE_REQUIRED_ENTITLEMENT?: string
  PROXY_SIGNING_SECRET?: string
}

export type ResolvedStripeGateConfig = {
  enabled: boolean
  baseUrl: string
  productId: string
  defaultPlan: string
  requiredEntitlement: string
  proQns: Set<string>
  landingUrl: string
  directCheckoutUrl: string
  portalUrl: string
}

const DEFAULT_PRO_QNS = ['112', '116', '120']

export function parseStripeGateConfig(env?: StripeGateEnv): ResolvedStripeGateConfig {
  const rawServer = (env?.STRIPE_LICENSE_URL ?? env?.LICENSE_SERVER_URL ?? '').trim()
  const productId = (env?.STRIPE_PRODUCT_ID ?? env?.LICENSE_PRODUCT_ID ?? '').trim()
  const defaultPlan = (env?.STRIPE_DEFAULT_PLAN ?? env?.LICENSE_DEFAULT_PLAN ?? '').trim()
  const requiredEntitlement = (env?.STRIPE_VIP_ENTITLEMENT ?? env?.LICENSE_REQUIRED_ENTITLEMENT ?? '').trim()

  const rawProQns = env?.LICENSE_PRO_QNS
  const proList =
    rawProQns !== undefined
      ? rawProQns
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : DEFAULT_PRO_QNS
  const proQns = new Set(proList)

  let baseUrl = ''
  if (rawServer) {
    try {
      const parsed = new URL(rawServer)
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        baseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '')
      }
    } catch {
      baseUrl = ''
    }
  }

  const enabled = Boolean(baseUrl && productId)
  const encodedId = encodeURIComponent(productId)
  const landingUrl = enabled ? `${baseUrl}/p/${encodedId}` : ''
  const directCheckoutUrl = enabled
    ? defaultPlan
      ? `${baseUrl}/v1/checkout/${encodedId}/${encodeURIComponent(defaultPlan)}`
      : `${baseUrl}/v1/checkout/${encodedId}`
    : ''
  const portalUrl = enabled ? `${baseUrl}/p/${encodedId}/portal` : ''

  return {
    enabled,
    baseUrl,
    productId,
    defaultPlan,
    requiredEntitlement,
    proQns,
    landingUrl,
    directCheckoutUrl,
    portalUrl,
  }
}

