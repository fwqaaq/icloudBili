import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { createApp } from '../src/index.ts'
import {
  DEFAULT_SHORTCUT_CONFIG,
  parseShortcutConfigJson,
  type ShortcutConfig,
  type ShortcutStore,
} from '../src/shortcut.ts'
import { parseDotEnv, RUNTIME_ENV_KEYS } from './env-parser.ts'

function loadLocalEnv(): Record<string, string> {
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
  return env
}

const shortcutFilePath = resolve(process.cwd(), 'shortcut.json')

const shortcutStore: ShortcutStore = {
  load(): ShortcutConfig {
    if (!existsSync(shortcutFilePath)) {
      return DEFAULT_SHORTCUT_CONFIG
    }
    return parseShortcutConfigJson(readFileSync(shortcutFilePath, 'utf8'))
  },
  save(config: ShortcutConfig) {
    const tmpPath = `${shortcutFilePath}.tmp`
    writeFileSync(tmpPath, JSON.stringify(config, null, 2) + '\n', 'utf8')
    renameSync(tmpPath, shortcutFilePath)
  },
}

const app = createApp({ shortcutStore })
const port = Number(process.env.PORT ?? '8787')
const hostname = process.env.HOST ?? '0.0.0.0'
const localEnv = loadLocalEnv()

serve(
  {
    port,
    hostname,
    fetch: (request) => app.fetch(request, localEnv),
  },
  (info) => {
    console.log(
      `bdownloader (Node) listening on http://${hostname}:${info.port}`,
    )
  },
)
