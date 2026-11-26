import { createApp } from '../src/index.ts'
import {
  DEFAULT_SHORTCUT_CONFIG,
  parseShortcutConfigJson,
  type ShortcutConfig,
  type ShortcutStore,
} from '../src/shortcut.ts'
import { parseDotEnv, RUNTIME_ENV_KEYS } from './env-parser.ts'

declare const Deno: {
  readTextFileSync: (path: string) => string
  writeTextFileSync: (path: string, data: string) => void
  env: { get: (key: string) => string | undefined }
  serve: (
    options: { port: number; onListen?: (addr: { port: number }) => void },
    handler: (request: Request) => Response | Promise<Response>
  ) => void
}

function loadLocalEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const file of ['.env', '.dev.vars']) {
    try {
      Object.assign(env, parseDotEnv(Deno.readTextFileSync(file)))
    } catch {
      // Ignore missing local env files
    }
  }
  for (const key of RUNTIME_ENV_KEYS) {
    const val = Deno.env.get(key)
    if (val) env[key] = val
  }
  return env
}

const shortcutStore: ShortcutStore = {
  load(): ShortcutConfig {
    let text: string
    try {
      text = Deno.readTextFileSync('shortcut.json')
    } catch {
      return DEFAULT_SHORTCUT_CONFIG
    }
    return parseShortcutConfigJson(text)
  },
  save(config: ShortcutConfig) {
    Deno.writeTextFileSync(
      'shortcut.json',
      JSON.stringify(config, null, 2) + '\n',
    )
  },
}

const app = createApp({ shortcutStore })
const port = Number(Deno.env.get('PORT') ?? '8787')
const localEnv = loadLocalEnv()

Deno.serve(
  {
    port,
    onListen: ({ port: listeningPort }) => {
      console.log(
        `bdownloader (Deno) listening on http://127.0.0.1:${listeningPort}`,
      )
    },
  },
  (request) => app.fetch(request, localEnv),
)
