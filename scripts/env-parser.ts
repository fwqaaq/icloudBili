export const RUNTIME_ENV_KEYS = [
  'SESSION',
  'API_TOKEN',
  'ADMIN_TOKEN',
  'PUBLIC_BASE_URL',
  'SHORTCUT_NAME',
  'SHORTCUT_VERSION',
  'SHORTCUT_BUILD',
  'SHORTCUT_UPDATED_AT',
  'SHORTCUT_ICLOUD_URL',
  'SHORTCUT_API_BASE_URL',
  'STRIPE_LICENSE_URL',
  'STRIPE_PRODUCT_ID',
  'STRIPE_VIP_ENTITLEMENT',
  'STRIPE_DEFAULT_PLAN',
  'LICENSE_SERVER_URL',
  'LICENSE_PRODUCT_ID',
  'LICENSE_DEFAULT_PLAN',
  'LICENSE_PRO_QNS',
  'LICENSE_REQUIRED_ENTITLEMENT',
  'PROXY_SIGNING_SECRET',
  'FFMPEG_PATH',
] as const

/** Parse simple KEY=VALUE lines from .dev.vars or .env files. */
export function parseDotEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const eqIndex = line.indexOf('=')
    if (eqIndex <= 0) continue

    const key = line.slice(0, eqIndex).trim()
    let value = line.slice(eqIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) {
      result[key] = value
    }
  }

  return result
}
