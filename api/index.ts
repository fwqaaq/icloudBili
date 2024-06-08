import { Hono } from 'hono'
import { load } from 'dotenv'
import { getVideoUrl } from './link.ts'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const app = new Hono().basePath('/api')

app.get('/download', async (c) => {
  const link = c.req.query('bilibili')
  if (!link) {
    return c.text('缺少 bilibili 参数', 400, headers)
  }
  const qn = c.req.query('qn') ?? '112'

  // session DATA
  const env = await load()
  const session = env['SESSION'] ?? undefined

  let source = ''
  if (link.includes('b23.tv')) {
    try {
      source = await handleShortLink(link)
    } catch {
      c.text('请检查该链接是否可以打开', 400, headers)
    }
  } else if (link.includes('bilibili')) {
    source = link
  } else {
    return c.text('请检查链接是否正确', 400, headers)
  }

  try {
    const videoUrl = await getVideoUrl(source, session, qn)
    return c.text(videoUrl, { headers })
  } catch (e) {
    return c.text((e as Error).toString(), { headers })
  }
})

app.get('/getreal', async (c) => {
  const link = c.req.query('bilibili')
  if (!link) {
    return c.text('缺少 link 参数', 400, headers)
  }
  if (link.includes('bilibili')) return c.text(link, 200, headers)
  try {
    const realLink = await handleShortLink(link)
    return c.text(realLink, 200, headers)
  } catch {
    return c.text('请检查该链接是否可以打开', 400, headers)
  }
})

async function handleShortLink(link: string) {
  const res = await fetch(link, { redirect: 'manual' })
  const location = res.headers.get('location')
  if (!location) return '[ERROR]: location 标头是空的'
  const source = new URL(location)
  return source.origin + source.pathname
}

export default app
