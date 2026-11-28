import { createWriteStream, existsSync, readFileSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { serve } from '@hono/node-server'
import { createNodeDashMuxer } from '../src/dash-muxer.ts'
import { createApp } from '../src/index.ts'
import { parseDotEnv, RUNTIME_ENV_KEYS } from './env-parser.ts'

function loadEnvWithoutPaywall(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const file of ['.env', '.dev.vars']) {
    const fullPath = resolve(process.cwd(), file)
    if (existsSync(fullPath)) {
      Object.assign(env, parseDotEnv(readFileSync(fullPath, 'utf8')))
    }
  }
  for (const key of RUNTIME_ENV_KEYS) {
    const val = process.env[key]
    if (val) env[key] = val
  }
  // Only bypass paywall in memory for local playback smoke testing; .dev.vars on disk stays untouched.
  delete env.STRIPE_LICENSE_URL
  delete env.STRIPE_PRODUCT_ID
  delete env.STRIPE_VIP_ENTITLEMENT
  delete env.STRIPE_DEFAULT_PLAN
  delete env.LICENSE_SERVER_URL
  delete env.LICENSE_PRODUCT_ID
  return env
}

async function preflightBilibiliNetwork(): Promise<void> {
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/nav', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Referer: 'https://www.bilibili.com/',
      },
      signal: AbortSignal.timeout(6000),
    })
    await res.body?.cancel()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const causeMsg =
      err instanceof Error && err.cause instanceof Error ? err.cause.message : ''
    console.error(`[FAIL] 本机无法连接 api.bilibili.com: ${msg} ${causeMsg}`.trim())
    console.error(
      '[HINT] 请检查 Shadowrocket / 系统代理是否把 api.bilibili.com、bilivideo.com、hdslb.com 与 b23.tv 设为 DIRECT（直连）并开启 always-real-ip，随后关闭重开 VPN 开关后再试。',
    )
    process.exit(1)
  }
}

async function downloadSample(
  origin: string,
  targetVideo: string,
  qn: string,
  outPath: string,
): Promise<{ size: number; qualityLabel: string; title: string; totalPages: number }> {
  const res = await fetch(
    `${origin}/api/download?bilibili=${encodeURIComponent(targetVideo)}&qn=${encodeURIComponent(qn)}&format=json`,
  )
  const meta = (await res.json()) as {
    ok: boolean
    status?: number
    error?: string
    proxyUrl?: string
    qualityLabel?: string
    title?: string
    totalPages?: number
  }
  if (!res.ok || !meta.ok || !meta.proxyUrl) {
    throw new Error(`解析 qn=${qn} 失败: ${meta.error || `HTTP ${res.status}`}`)
  }

  const streamRes = await fetch(meta.proxyUrl, { signal: AbortSignal.timeout(120_000) })
  if (!streamRes.ok || !streamRes.body) {
    throw new Error(`下载流 qn=${qn} 失败: HTTP ${streamRes.status}`)
  }

  await pipeline(
    Readable.fromWeb(streamRes.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(outPath),
  )
  const info = await stat(outPath)
  if (info.size < 1024) {
    throw new Error(`下载文件过小 (${info.size} bytes)，可能未成功写入视频流`)
  }
  return {
    size: info.size,
    qualityLabel: meta.qualityLabel || qn,
    title: meta.title || targetVideo,
    totalPages: meta.totalPages ?? 1,
  }
}

async function main() {
  const targetVideo = process.argv[2]?.trim() || 'BV1q3yyzUEiD'
  console.log(`[1/4] 检测本机到 Bilibili 接口的网络连通性（目标: ${targetVideo}）...`)
  await preflightBilibiliNetwork()

  const env = loadEnvWithoutPaywall()
  const dashMuxer = createNodeDashMuxer({ ffmpegPath: env.FFMPEG_PATH })
  const ffmpegOk = await dashMuxer.isAvailable()
  console.log(`[2/4] 环境自检: ffmpeg=${ffmpegOk ? '可用' : '不可用'}, SESSION=${env.SESSION ? '已配置' : '未配置'}`)

  const app = createApp({ dashMuxer })
  let resolveOrigin!: (url: string) => void
  const originPromise = new Promise<string>((r) => {
    resolveOrigin = r
  })
  const server = serve(
    {
      port: 0,
      hostname: '127.0.0.1',
      fetch: (request) => app.fetch(request, env),
    },
    (info) => {
      resolveOrigin(`http://127.0.0.1:${info.port}`)
    },
  )

  try {
    const origin = await originPromise
    const outDir = resolve(process.cwd(), 'tmp-demo')
    await mkdir(outDir, { recursive: true })

    console.log(`[3/4] 测试免费清晰度 qn=80（1080P/720P）下载...`)
    const file80 = resolve(outDir, 'sample_free_1080p.mp4')
    const r80 = await downloadSample(origin, targetVideo, '80', file80)
    console.log(
      `[OK] 免费清晰度下载完成: 《${r80.title}》 [${r80.qualityLabel}, ${r80.totalPages}P] -> ${file80} (${(r80.size / 1024 / 1024).toFixed(2)} MB)`,
    )

    if (ffmpegOk && env.SESSION) {
      console.log(`[4/4] 测试 4K DASH + ffmpeg 混流下载（qn=120）...`)
      const file120 = resolve(outDir, 'sample_vip_4k.mp4')
      const r120 = await downloadSample(origin, targetVideo, '120', file120)
      console.log(
        `[OK] 4K 混流下载完成: 《${r120.title}》 [${r120.qualityLabel}] -> ${file120} (${(r120.size / 1024 / 1024).toFixed(2)} MB)`,
      )
    } else {
      console.log(
        '[4/4] 跳过 4K 测试（需本机可用 ffmpeg 且在 .dev.vars 配置大会员 SESSION）',
      )
    }

    console.log('\n你可以直接执行以下命令用 QuickTime 试播下载好的示例视频：')
    console.log(`open "${outDir}"`)
  } finally {
    server.close()
  }
}

main().catch((err) => {
  console.error('[ERROR]', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
