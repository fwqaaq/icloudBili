import { BiliError } from './bilibili.ts'

export type HighlightTone = 'pink' | 'blue' | 'amber'

export type ShortcutHighlight = {
  title: string
  subtitle: string
  badge?: string
  tone?: HighlightTone
}

export type ShortcutConfig = {
  name: string
  badgePrefix: string
  version: string
  build: number
  updatedAt: string
  subtitle: string
  icloudUrl: string
  apiBaseUrl?: string
  highlights: ShortcutHighlight[]
  notes: string[]
  helpGuideUrl: string
}

export type ShortcutStore = {
  load: () => Promise<ShortcutConfig> | ShortcutConfig
  save?: (config: ShortcutConfig) => Promise<void> | void
}

export type ShortcutEnvOverrides = {
  SHORTCUT_NAME?: string
  SHORTCUT_VERSION?: string
  SHORTCUT_BUILD?: string
  SHORTCUT_UPDATED_AT?: string
  SHORTCUT_ICLOUD_URL?: string
  SHORTCUT_API_BASE_URL?: string
}

export const DEFAULT_SHORTCUT_CONFIG: ShortcutConfig = {
  name: 'bilibili 视频下载',
  badgePrefix: '新版本',
  version: '3.0.1',
  build: 6,
  updatedAt: '2026-11-28',
  subtitle: '免费畅享 1080P，NAS 会员解锁真 4K DASH 混流与 Stripe 自动激活',
  icloudUrl: 'https://www.icloud.com/shortcuts/6baca692067a48ea98766d4fc81531d3',
  apiBaseUrl: '',
  highlights: [
    {
      title: '真 4K DASH 混流',
      subtitle: 'HEVC / H.264 兼容相册',
      badge: 'NEW',
      tone: 'pink',
    },
    {
      title: 'Stripe 会员闭环',
      subtitle: '支付回调一键激活设备',
      badge: 'NEW',
      tone: 'blue',
    },
    {
      title: '多 P 与双保存',
      subtitle: '选集 · 相册 / 文件',
      badge: '',
      tone: 'amber',
    },
  ],
  notes: [
    '新增首页网页版 Bilibili 下载程序，共用同一 Stripe 会员授权与设备激活流程',
    '修复含点号视频标题保存系统相册时丢失 .mp4 扩展名问题，并兼容字典空格格式的激活响应判定',
    '保留 NAS 端 4K DASH 无损混流、1080P60/1080P+ 及 shortcuts:// 一键激活设备',
  ],
  helpGuideUrl: '',
}

const VALID_TONES = new Set<HighlightTone>(['pink', 'blue', 'amber'])
const DEFAULT_TONES: HighlightTone[] = ['pink', 'blue', 'amber']

export function validateShortcutUrl(rawUrl: string, allowEmpty = false): string {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    if (allowEmpty) return ''
    throw new BiliError(400, '快捷指令链接不能为空')
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new BiliError(400, '快捷指令链接格式无效')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BiliError(400, '快捷指令链接仅支持 http 或 https 协议')
  }

  return parsed.toString()
}

function requireText(
  value: unknown,
  field: string,
  maxLen: number,
  fallback?: string
): string {
  if (typeof value !== 'string') {
    if (fallback !== undefined) return fallback
    throw new BiliError(400, `${field} 必须是字符串`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    if (fallback !== undefined) return fallback
    throw new BiliError(400, `${field} 不能为空`)
  }
  return trimmed.slice(0, maxLen)
}

export function validateShortcutConfig(raw: unknown): ShortcutConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BiliError(400, '快捷指令配置必须是 JSON 对象')
  }

  const record = raw as Record<string, unknown>

  const name = requireText(record.name, '快捷指令名称', 60)
  const badgePrefix = requireText(record.badgePrefix, '徽章前缀', 20, '新版本')
  const version = requireText(record.version, '版本号', 30)
  const updatedAt = requireText(record.updatedAt, '更新日期', 32)
  const subtitle = requireText(record.subtitle, '副标题', 140)

  const buildNum =
    typeof record.build === 'number'
      ? record.build
      : typeof record.build === 'string' && /^\d+$/.test(record.build.trim())
        ? Number(record.build.trim())
        : NaN
  if (!Number.isSafeInteger(buildNum) || buildNum < 1 || buildNum > 999999) {
    throw new BiliError(400, 'build 必须是 1 到 999999 之间的整数')
  }

  if (typeof record.icloudUrl !== 'string') {
    throw new BiliError(400, 'icloudUrl 必须是字符串')
  }
  const icloudUrl = validateShortcutUrl(record.icloudUrl, false)

  const apiBaseRaw =
    typeof record.apiBaseUrl === 'string'
      ? validateShortcutUrl(record.apiBaseUrl, true)
      : ''
  const apiBaseUrl = apiBaseRaw ? new URL(apiBaseRaw).origin : ''

  const helpGuideUrl =
    typeof record.helpGuideUrl === 'string'
      ? validateShortcutUrl(record.helpGuideUrl, true)
      : ''

  if (!Array.isArray(record.highlights) || record.highlights.length === 0) {
    throw new BiliError(400, 'highlights 至少需要 1 项特性')
  }
  const highlights: ShortcutHighlight[] = record.highlights
    .slice(0, 3)
    .map((item, idx) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new BiliError(400, `highlights[${idx}] 格式无效`)
      }
      const h = item as Record<string, unknown>
      const toneRaw =
        typeof h.tone === 'string' ? (h.tone.trim() as HighlightTone) : undefined
      const tone =
        toneRaw && VALID_TONES.has(toneRaw)
          ? toneRaw
          : DEFAULT_TONES[idx % DEFAULT_TONES.length]
      return {
        title: requireText(h.title, `highlights[${idx}].title`, 24),
        subtitle: requireText(h.subtitle, `highlights[${idx}].subtitle`, 40),
        badge:
          typeof h.badge === 'string' ? h.badge.trim().slice(0, 10) : '',
        tone,
      }
    })

  if (!Array.isArray(record.notes)) {
    throw new BiliError(400, 'notes 必须是字符串数组')
  }
  const notes = record.notes
    .map((n) => (typeof n === 'string' ? n.trim().slice(0, 160) : ''))
    .filter(Boolean)
    .slice(0, 12)
  if (notes.length === 0) {
    throw new BiliError(400, 'notes 至少需要 1 条更新说明')
  }

  return {
    name,
    badgePrefix,
    version,
    build: buildNum,
    updatedAt,
    subtitle,
    icloudUrl,
    apiBaseUrl,
    highlights,
    notes,
    helpGuideUrl,
  }
}

export function parseShortcutConfigJson(text: string): ShortcutConfig {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new BiliError(502, 'shortcut.json 格式错误，请检查 JSON 语法')
  }
  return validateShortcutConfig(raw)
}

export function mergeShortcutEnvOverrides(
  config: ShortcutConfig,
  env?: ShortcutEnvOverrides
): ShortcutConfig {
  if (!env) return config

  const next: ShortcutConfig = { ...config }
  if (env.SHORTCUT_NAME?.trim()) {
    next.name = env.SHORTCUT_NAME.trim().slice(0, 60)
  }
  if (env.SHORTCUT_VERSION?.trim()) {
    next.version = env.SHORTCUT_VERSION.trim().slice(0, 30)
  }
  if (env.SHORTCUT_UPDATED_AT?.trim()) {
    next.updatedAt = env.SHORTCUT_UPDATED_AT.trim().slice(0, 32)
  }
  if (env.SHORTCUT_BUILD?.trim() && /^[1-9]\d*$/.test(env.SHORTCUT_BUILD.trim())) {
    const parsed = Number(env.SHORTCUT_BUILD.trim())
    if (Number.isSafeInteger(parsed) && parsed <= 999999) {
      next.build = parsed
    }
  }
  if (env.SHORTCUT_ICLOUD_URL?.trim()) {
    try {
      next.icloudUrl = validateShortcutUrl(env.SHORTCUT_ICLOUD_URL, false)
    } catch {
      // Ignore invalid env override rather than breaking page load
    }
  }
  if (env.SHORTCUT_API_BASE_URL?.trim()) {
    try {
      const validated = validateShortcutUrl(env.SHORTCUT_API_BASE_URL, false)
      next.apiBaseUrl = new URL(validated).origin
    } catch {
      // Ignore invalid env override rather than breaking page load
    }
  }
  return next
}

export function buildShortcutApiPayload(
  config: ShortcutConfig,
  origin: string,
  editable: boolean
) {
  const cleanApiBase = config.apiBaseUrl?.trim()
    ? config.apiBaseUrl.trim().replace(/\/+$/, '')
    : origin
  return {
    ...config,
    apiBaseUrl: cleanApiBase,
    changelog: config.notes.map((line, idx) => `${idx + 1}. ${line}`).join('\n'),
    updatePageUrl: `${origin}/`,
    editable,
  }
}
