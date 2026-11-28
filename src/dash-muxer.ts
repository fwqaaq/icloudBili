import { execFile, spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { BiliError, type DashMediaTrack, type DashMuxInput, type DashMuxOutput, type DashMuxer } from './bilibili.ts'

const execFileAsync = promisify(execFile)

type CachedMuxFile = {
  filePath: string
  size: number
  expiresAt: number
}

export type ByteRangeResult =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' }

/** Parse a single HTTP Range header (`bytes=start-end`) against known file size. */
export function parseByteRange(rangeHeader: string | null | undefined, totalSize: number): ByteRangeResult {
  if (!rangeHeader) return { kind: 'full' }
  const trimmed = rangeHeader.trim()
  if (!trimmed) return { kind: 'full' }

  const match = trimmed.match(/^bytes=(\d*)-(\d*)$/i)
  if (!match) return { kind: 'unsatisfiable' }

  const [, rawStart, rawEnd] = match
  if (!rawStart && !rawEnd) return { kind: 'unsatisfiable' }

  if (!rawStart) {
    const suffixLen = Number(rawEnd)
    if (!Number.isSafeInteger(suffixLen) || suffixLen <= 0 || totalSize <= 0) {
      return { kind: 'unsatisfiable' }
    }
    const start = Math.max(0, totalSize - suffixLen)
    return { kind: 'partial', start, end: totalSize - 1 }
  }

  const start = Number(rawStart)
  if (!Number.isSafeInteger(start) || start < 0 || start >= totalSize) {
    return { kind: 'unsatisfiable' }
  }

  if (!rawEnd) {
    return { kind: 'partial', start, end: totalSize - 1 }
  }

  const end = Number(rawEnd)
  if (!Number.isSafeInteger(end) || end < start) {
    return { kind: 'unsatisfiable' }
  }

  return { kind: 'partial', start, end: Math.min(end, totalSize - 1) }
}

async function writeResponseToFile(res: Response, destPath: string): Promise<void> {
  if (!res.body) {
    throw new BiliError(502, '上游视频流响应体为空')
  }
  const readable = Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0])
  await pipeline(readable, createWriteStream(destPath))
  const fileStat = await stat(destPath)
  if (fileStat.size === 0) {
    throw new BiliError(502, '上游视频流内容为空')
  }
}

export type CommandRunner = (cmd: string, args: string[]) => Promise<void>

async function defaultFfmpegRunner(ffmpegPath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8')
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`))
      }
    })
  })
}

export function createNodeDashMuxer(options?: {
  ffmpegPath?: string
  cacheDir?: string
  ttlMs?: number
  maxEntries?: number
  now?: () => number
  probeRunner?: (ffmpegPath: string) => Promise<boolean>
  muxRunner?: CommandRunner
}): DashMuxer {
  const ffmpegPath = options?.ffmpegPath?.trim() || 'ffmpeg'
  const cacheDir = options?.cacheDir ?? join(tmpdir(), 'bdownloader-mux')
  const ttlMs = options?.ttlMs ?? 10 * 60 * 1000
  const maxEntries = options?.maxEntries ?? 8
  const now = options?.now ?? (() => Date.now())
  const muxRunner = options?.muxRunner ?? defaultFfmpegRunner

  const fileCache = new Map<string, CachedMuxFile>()
  const inFlight = new Map<string, Promise<{ filePath: string; size: number }>>()
  let availablePromise: Promise<boolean> | null = null

  async function isAvailable(): Promise<boolean> {
    if (!availablePromise) {
      availablePromise = options?.probeRunner
        ? options.probeRunner(ffmpegPath).catch(() => false)
        : execFileAsync(ffmpegPath, ['-version'], { timeout: 5000 })
            .then(() => true)
            .catch(() => false)
    }
    return availablePromise
  }

  async function pruneCache(): Promise<void> {
    const current = now()
    for (const [key, entry] of fileCache.entries()) {
      if (current >= entry.expiresAt) {
        fileCache.delete(key)
        await unlink(entry.filePath).catch(() => {})
      }
    }
    while (fileCache.size > maxEntries) {
      const oldestKey = fileCache.keys().next().value
      if (oldestKey === undefined) break
      const oldest = fileCache.get(oldestKey)
      fileCache.delete(oldestKey)
      if (oldest) {
        await unlink(oldest.filePath).catch(() => {})
      }
    }
  }

  async function buildMuxedFile(
    cacheKey: string,
    input: DashMuxInput,
    fetchCandidateStream: (candidates: string[]) => Promise<Response>,
  ): Promise<{ filePath: string; size: number }> {
    await mkdir(cacheDir, { recursive: true })
    await pruneCache()

    const safeTag = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_')
    const jobId = `${safeTag}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const videoPath = join(cacheDir, `${jobId}.video.m4s`)
    const audioPath = join(cacheDir, `${jobId}.audio.m4s`)
    const tmpOutPath = join(cacheDir, `${jobId}.tmp.mp4`)
    const finalPath = join(cacheDir, `${safeTag}.mp4`)

    const trackFetches: Promise<void>[] = [
      fetchCandidateStream(input.video.candidates).then((res) => writeResponseToFile(res, videoPath)),
    ]
    if (input.audio) {
      const audioTrack: DashMediaTrack = input.audio
      trackFetches.push(
        fetchCandidateStream(audioTrack.candidates).then((res) => writeResponseToFile(res, audioPath)),
      )
    }

    try {
      await Promise.all(trackFetches)

      const ffmpegArgs = input.audio
        ? ['-y', '-i', videoPath, '-i', audioPath, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', tmpOutPath]
        : ['-y', '-i', videoPath, '-c', 'copy', '-movflags', '+faststart', tmpOutPath]

      await muxRunner(ffmpegPath, ffmpegArgs)
      await rename(tmpOutPath, finalPath)
      const info = await stat(finalPath)

      fileCache.set(cacheKey, {
        filePath: finalPath,
        size: info.size,
        expiresAt: now() + ttlMs,
      })
      await pruneCache()

      return { filePath: finalPath, size: info.size }
    } catch (err) {
      await unlink(tmpOutPath).catch(() => {})
      if (err instanceof BiliError) throw err
      throw new BiliError(502, `DASH 音视频混流失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      await unlink(videoPath).catch(() => {})
      await unlink(audioPath).catch(() => {})
    }
  }

  async function ensureMuxedFile(
    input: DashMuxInput,
    fetchCandidateStream: (candidates: string[]) => Promise<Response>,
  ): Promise<{ filePath: string; size: number }> {
    const audioId = input.audio?.id ?? 0
    const cacheKey = `${input.videoKey}_${input.cid}_${input.quality}_${input.video.codecid}_${audioId}`

    const cached = fileCache.get(cacheKey)
    if (cached && now() < cached.expiresAt) {
      try {
        const st = await stat(cached.filePath)
        return { filePath: cached.filePath, size: st.size }
      } catch {
        fileCache.delete(cacheKey)
      }
    }

    const pending = inFlight.get(cacheKey)
    if (pending) return pending

    const job = buildMuxedFile(cacheKey, input, fetchCandidateStream).finally(() => {
      inFlight.delete(cacheKey)
    })
    inFlight.set(cacheKey, job)
    return job
  }

  async function muxAndServe(
    input: DashMuxInput,
    options: {
      method: string
      rangeHeader?: string | null
      fetchCandidateStream: (candidates: string[]) => Promise<Response>
    },
  ): Promise<DashMuxOutput> {
    if (!(await isAvailable())) {
      throw new BiliError(501, '未检测到可用 ffmpeg，无法处理 4K / 高帧率 DASH 混流')
    }

    const { filePath, size } = await ensureMuxedFile(input, options.fetchCandidateStream)
    const range = parseByteRange(options.rangeHeader, size)
    const isHead = options.method.toUpperCase() === 'HEAD'

    if (range.kind === 'unsatisfiable') {
      return {
        stream: null,
        status: 416,
        contentRange: `bytes */${size}`,
      }
    }

    if (range.kind === 'partial') {
      const length = range.end - range.start + 1
      return {
        status: 206,
        contentLength: length,
        contentRange: `bytes ${range.start}-${range.end}/${size}`,
        stream: isHead
          ? null
          : (Readable.toWeb(createReadStream(filePath, { start: range.start, end: range.end })) as ReadableStream<Uint8Array>),
      }
    }

    return {
      status: 200,
      contentLength: size,
      stream: isHead ? null : (Readable.toWeb(createReadStream(filePath)) as ReadableStream<Uint8Array>),
    }
  }

  // Clean orphaned temp artifacts if directory existed across crashes (best-effort)
  readdir(cacheDir)
    .then((entries) =>
      Promise.all(
        entries
          .filter((name) => name.endsWith('.m4s') || name.endsWith('.tmp.mp4'))
          .map((name) => rm(join(cacheDir, name), { force: true }).catch(() => {})),
      ),
    )
    .catch(() => {})

  return {
    isAvailable,
    muxAndServe,
  }
}
