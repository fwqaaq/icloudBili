import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertSafeCdnUrl,
  encWbi,
  extractRawLinkOrId,
  normalizeQn,
  parseVideoTarget,
} from '../src/bilibili.ts'
import { createApp } from '../src/index.ts'
import { md5Hex } from '../src/md5.ts'
import {
  DEFAULT_SHORTCUT_CONFIG,
  type ShortcutConfig,
  type ShortcutStore,
} from '../src/shortcut.ts'
import { parseDotEnv } from '../scripts/env-parser.ts'

describe('md5Hex', () => {
  it('matches RFC 1321 standard test vectors', () => {
    assert.equal(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e')
    assert.equal(md5Hex('a'), '0cc175b9c0f1b6a831c399e269772661')
    assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72')
    assert.equal(md5Hex('message digest'), 'f96b697d7cb7938d525a2f31aaf161d0')
    assert.equal(
      md5Hex('abcdefghijklmnopqrstuvwxyz'),
      'c3fcd3d76192e4007dfb496cca67e13b',
    )
  })
})

describe('WBI & parameter helpers', () => {
  it('encWbi generates 32-char lowercase hex w_rid', () => {
    const query = encWbi(
      {
        bvid: 'BV1q3yyzUEiD',
        cid: '43920657912',
        qn: '80',
        fnval: 1,
        fnver: 0,
        fourk: 1,
      },
      '7cd084941338484aae1ad9425b84077c',
      '4932caff0ff746eab6f01bf08b70ac45',
      1700000000,
    )
    const match = query.match(/&w_rid=([0-9a-f]{32})$/)
    assert.ok(match, `expected valid 32-char hex w_rid in: ${query}`)
  })

  it('normalizeQn accepts exact supported qualities and defaults to non-VIP 80', () => {
    for (const qn of ['32', '64', '74', '80', '112', '116', '120']) {
      assert.equal(normalizeQn(qn), qn)
    }
    assert.equal(normalizeQn('999'), '80')
    assert.equal(normalizeQn(undefined), '80')
  })

  it('extractRawLinkOrId parses share copy, URLs, and bare BV/av IDs', () => {
    assert.equal(
      extractRawLinkOrId(
        '【测试标题-哔哩哔哩】 https://b23.tv/abc123，快来看！',
      ),
      'https://b23.tv/abc123',
    )
    assert.equal(extractRawLinkOrId('BV1q3yyzUEiD'), 'BV1q3yyzUEiD')
    assert.equal(extractRawLinkOrId('AV170001'), 'av170001')
    assert.throws(
      () => extractRawLinkOrId('https://evil.example.com/BV1q3yyzUEiD'),
      /有效的 Bilibili 链接/,
    )
  })

  it('parseVideoTarget handles ?p= pages and av numbers', () => {
    const p2 = parseVideoTarget(
      'https://www.bilibili.com/video/av170001?p=3&spm_id_from=333',
    )
    assert.equal(p2.idType, 'aid')
    assert.equal(p2.id, '170001')
    assert.equal(p2.page, 3)
    assert.equal(
      p2.canonicalUrl,
      'https://www.bilibili.com/video/av170001/?p=3',
    )

    const override = parseVideoTarget(
      'https://www.bilibili.com/video/BV1q3yyzUEiD/?p=1',
      '2',
    )
    assert.equal(override.page, 2)
  })

  it('assertSafeCdnUrl rejects unsafe hosts', () => {
    assert.throws(() => assertSafeCdnUrl('http://127.0.0.1/video.mp4'))
    assert.throws(() => assertSafeCdnUrl('http://localhost/video.mp4'))
    assert.throws(() => assertSafeCdnUrl('file:///etc/passwd'))
    assert.equal(
      assertSafeCdnUrl('https://cn-sccd-ct-02-12.bilivideo.com/test.mp4'),
      'https://cn-sccd-ct-02-12.bilivideo.com/test.mp4',
    )
  })

  it('parseDotEnv parses quoted and unquoted lines', () => {
    const parsed = parseDotEnv(
      '# comment\nSESSION="abc=123"\nAPI_TOKEN=secret\n',
    )
    assert.deepEqual(parsed, { SESSION: 'abc=123', API_TOKEN: 'secret' })
  })
})

function createMockFetcher() {
  const calls: Array<{ url: string; headers: Headers; method: string }> = []
  let playurlCount = 0

  const fetcher: typeof fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url
    const headers = new Headers(init?.headers)
    const method = init?.method ?? 'GET'
    calls.push({ url, headers, method })

    if (url.startsWith('https://b23.tv/')) {
      return new Response(null, {
        status: 302,
        headers: {
          location:
            'https://www.bilibili.com/video/BV1q3yyzUEiD/?p=2&share_source=copy',
        },
      })
    }

    if (url.startsWith('https://b23.tv-bad/')) {
      throw new Error('network failed')
    }

    if (url.startsWith('https://api.bilibili.com/x/web-interface/view')) {
      return Response.json({
        code: 0,
        data: {
          bvid: 'BV1q3yyzUEiD',
          aid: 117677876052236,
          title: '测试视频标题',
          pages: [
            { cid: 111, page: 1, part: 'P1' },
            { cid: 222, page: 2, part: 'P2' },
          ],
        },
      })
    }

    if (url.startsWith('https://api.bilibili.com/x/web-interface/nav')) {
      return Response.json({
        code: -101,
        data: {
          wbi_img: {
            img_url:
              'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
            sub_url:
              'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
          },
        },
      })
    }

    if (url.startsWith('https://api.bilibili.com/x/player/wbi/playurl')) {
      playurlCount++
      const parsed = new URL(url)
      assert.match(parsed.searchParams.get('w_rid') ?? '', /^[0-9a-f]{32}$/)
      return Response.json({
        code: 0,
        data: {
          quality: Number(parsed.searchParams.get('qn') ?? '112'),
          durl: [
            {
              url: 'https://primary-cdn.bilivideo.com/video.mp4?token=1',
              backup_url: [
                'https://backup-cdn.bilivideo.com/video.mp4?token=2',
              ],
            },
          ],
        },
      })
    }

    if (url.startsWith('https://primary-cdn.bilivideo.com/')) {
      assert.equal(headers.get('referer'), 'https://www.bilibili.com/')
      return new Response('blocked', { status: 567 })
    }

    if (url.startsWith('https://backup-cdn.bilivideo.com/')) {
      assert.equal(headers.get('referer'), 'https://www.bilibili.com/')
      const range = headers.get('range')
      if (range === 'bytes=0-3') {
        return new Response('FAKE', {
          status: 206,
          headers: {
            'content-type': 'video/mp4',
            'content-length': '4',
            'content-range': 'bytes 0-3/12',
            'accept-ranges': 'bytes',
          },
        })
      }
      return new Response(method === 'HEAD' ? null : 'FAKE_MP4_DATA', {
        status: 200,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '13',
          'accept-ranges': 'bytes',
        },
      })
    }

    return new Response('not found', { status: 404 })
  }

  return { fetcher, calls, getPlayurlCount: () => playurlCount }
}

describe('HTTP endpoints', () => {
  it('/api/getreal preserves ?p= after resolving b23.tv share text', async () => {
    const { fetcher } = createMockFetcher()
    const app = createApp({ fetcher })

    const res = await app.request(
      '/api/getreal?bilibili=' +
        encodeURIComponent('【视频】 https://b23.tv/xyz999'),
    )
    assert.equal(res.status, 200)
    assert.equal(
      await res.text(),
      'https://www.bilibili.com/video/BV1q3yyzUEiD/?p=2',
    )
  })

  it('/api/download returns proxy URL and passes qn=80 cleanly', async () => {
    const { fetcher } = createMockFetcher()
    const app = createApp({ fetcher })

    const res = await app.request(
      'https://worker.example/api/download?bilibili=' +
        encodeURIComponent('https://b23.tv/xyz999') +
        '&qn=80',
    )
    assert.equal(res.status, 200)
    const body = await res.text()
    const proxyUrl = new URL(body)
    assert.equal(proxyUrl.origin, 'https://worker.example')
    assert.equal(proxyUrl.pathname, '/api/proxy')
    assert.equal(
      proxyUrl.searchParams.get('bilibili'),
      'https://www.bilibili.com/video/BV1q3yyzUEiD/?p=2',
    )
    assert.equal(proxyUrl.searchParams.get('qn'), '80')
    assert.equal(proxyUrl.searchParams.get('p'), '2')
  })

  it('/api/proxy falls back on 567, supports Range 206, and warms cache', async () => {
    const mock = createMockFetcher()
    const app = createApp({ fetcher: mock.fetcher })

    const dlRes = await app.request(
      'https://worker.example/api/download?bilibili=BV1q3yyzUEiD&qn=64',
    )
    assert.equal(dlRes.status, 200)
    const proxyUrl = await dlRes.text()
    assert.equal(mock.getPlayurlCount(), 1)

    const rangeRes = await app.request(proxyUrl, {
      headers: { Range: 'bytes=0-3' },
    })
    assert.equal(rangeRes.status, 206)
    assert.equal(rangeRes.headers.get('content-range'), 'bytes 0-3/12')
    assert.equal(await rangeRes.text(), 'FAKE')
    assert.equal(mock.getPlayurlCount(), 1)
  })

  it('/api/download?raw=file streams MP4 directly with Content-Disposition', async () => {
    const { fetcher } = createMockFetcher()
    const app = createApp({ fetcher })

    const res = await app.request(
      'https://worker.example/api/download?bilibili=BV1q3yyzUEiD&raw=file',
    )
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('content-type'), 'video/mp4')
    assert.match(
      res.headers.get('content-disposition') ?? '',
      /^attachment; filename="BV1q3yyzUEiD\.mp4"/,
    )
    assert.equal(await res.text(), 'FAKE_MP4_DATA')
  })

  it('rejects missing/arbitrary external URLs and enforces optional API_TOKEN', async () => {
    const { fetcher } = createMockFetcher()
    const app = createApp({ fetcher })

    const badUrlRes = await app.request(
      '/api/download?bilibili=' + encodeURIComponent('https://evil.com/x.mp4'),
    )
    assert.equal(badUrlRes.status, 400)

    const unauthRes = await app.request(
      '/api/download?bilibili=BV1q3yyzUEiD',
      {},
      { API_TOKEN: 'my-secret' },
    )
    assert.equal(unauthRes.status, 401)

    const authRes = await app.request(
      'https://worker.example/api/download?bilibili=BV1q3yyzUEiD&token=my-secret',
      {},
      { API_TOKEN: 'my-secret' },
    )
    assert.equal(authRes.status, 200)
    const proxyUrl = new URL(await authRes.text())
    assert.equal(proxyUrl.searchParams.get('token'), 'my-secret')
  })

  it('rejects broken b23.tv links immediately with 400/502 instead of falling through', async () => {
    const fetcher: typeof fetch = async () => {
      throw new Error('network failed')
    }
    const app = createApp({ fetcher })

    const res = await app.request(
      '/api/download?bilibili=' + encodeURIComponent('https://b23.tv/bad'),
    )
    assert.equal(res.status, 502)
  })

  it('falls back to pagelist + plain playurl with buvid3 when view/wbi return 412', async () => {
    const sawCookies: string[] = []

    const fetcher: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      const headers = new Headers(init?.headers)

      if (url.startsWith('https://api.bilibili.com/x/frontend/finger/spi')) {
        return Response.json({
          code: 0,
          data: { b_3: 'TEST-BUVID3', b_4: 'TEST-BUVID4' },
        })
      }

      if (url.startsWith('https://api.bilibili.com/x/web-interface/view')) {
        sawCookies.push(headers.get('cookie') ?? '')
        return new Response('412 Precondition Failed', { status: 412 })
      }

      if (url.startsWith('https://api.bilibili.com/x/player/pagelist')) {
        sawCookies.push(headers.get('cookie') ?? '')
        return Response.json({
          code: 0,
          data: [{ cid: 987654, page: 1, part: '降级视频分P' }],
        })
      }

      if (url.startsWith('https://api.bilibili.com/x/web-interface/nav')) {
        return new Response('412 Precondition Failed', { status: 412 })
      }

      if (url.startsWith('https://api.bilibili.com/x/player/playurl')) {
        sawCookies.push(headers.get('cookie') ?? '')
        return Response.json({
          code: 0,
          data: {
            quality: 64,
            durl: [{ url: 'https://fallback-cdn.bilivideo.com/v.mp4' }],
          },
        })
      }

      if (url.startsWith('https://fallback-cdn.bilivideo.com/')) {
        return new Response('OK_FALLBACK', {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': '11' },
        })
      }

      return new Response('not found', { status: 404 })
    }

    const app = createApp({ fetcher })
    const res = await app.request(
      'https://worker.example/api/download?bilibili=BV1q3yyzUEiD&raw=file',
    )
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'OK_FALLBACK')
    assert.ok(sawCookies.some((c) => c.includes('buvid3=TEST-BUVID3')))
  })

  it('/api/download respects PUBLIC_BASE_URL and X-Forwarded-* headers', async () => {
    const { fetcher } = createMockFetcher()
    const app = createApp({ fetcher })

    const forwardedRes = await app.request(
      'http://127.0.0.1:8787/api/download?bilibili=BV1q3yyzUEiD',
      {
        headers: {
          'X-Forwarded-Proto': 'https',
          'X-Forwarded-Host': 'nas.wzszz.top',
        },
      },
    )
    assert.equal(forwardedRes.status, 200)
    assert.ok(
      (await forwardedRes.text()).startsWith('https://nas.wzszz.top/api/proxy?'),
    )

    const envRes = await app.request(
      'http://127.0.0.1:8787/api/download?bilibili=BV1q3yyzUEiD',
      {
        headers: {
          'X-Forwarded-Proto': 'http',
          'X-Forwarded-Host': 'ignored.example',
        },
      },
      { PUBLIC_BASE_URL: 'https://custom.wzszz.top:8443/prefix' },
    )
    assert.equal(envRes.status, 200)
    assert.ok(
      (await envRes.text()).startsWith(
        'https://custom.wzszz.top:8443/api/proxy?',
      ),
    )
  })

  it('GET / renders Apple Shortcut update UI with XSS escaping and GET /api/health works', async () => {
    let current: ShortcutConfig = {
      ...DEFAULT_SHORTCUT_CONFIG,
      name: 'B站<script>alert(1)</script>下载',
    }
    const store: ShortcutStore = {
      load: () => current,
      save: (next) => {
        current = next
      },
    }
    const app = createApp({ shortcutStore: store })

    const pageRes = await app.request('http://nas.wzszz.top:8787/')
    assert.equal(pageRes.status, 200)
    assert.match(pageRes.headers.get('content-type') ?? '', /text\/html/)
    const html = await pageRes.text()
    assert.ok(html.includes('立即获取快捷指令'))
    assert.ok(html.includes('请点击「替换」'))
    assert.ok(html.includes('value="80"'))
    assert.ok(html.includes('value="64"'))
    assert.ok(html.includes('value="32"'))
    assert.equal(html.includes('value="112"'), false)
    assert.ok(html.includes('http://nas.wzszz.top:8787/api/shortcut'))
    assert.ok(html.includes('d090f8e53b1540749c79837f99115a5c'))
    assert.equal(html.includes('<script>alert(1)</script>'), false)

    const healthRes = await app.request('http://nas.wzszz.top:8787/api/health')
    assert.equal(healthRes.status, 200)
    const healthJson = (await healthRes.json()) as { status: string }
    assert.equal(healthJson.status, 'ok')
  })

  it('GET/PUT /api/shortcut enforces ADMIN_TOKEN, validates payload, and hot-reloads', async () => {
    let current: ShortcutConfig = { ...DEFAULT_SHORTCUT_CONFIG }
    const store: ShortcutStore = {
      load: () => current,
      save: (next) => {
        current = next
      },
    }
    const app = createApp({ shortcutStore: store })

    const getRes = await app.request('http://nas.wzszz.top:8787/api/shortcut')
    assert.equal(getRes.status, 200)
    const getJson = (await getRes.json()) as {
      version: string
      build: number
      apiBaseUrl: string
      updatePageUrl: string
      changelog: string
    }
    assert.equal(getJson.version, '2.1.0')
    assert.equal(getJson.build, 4)
    assert.equal(getJson.apiBaseUrl, 'http://nas.wzszz.top:8787')
    assert.equal(getJson.updatePageUrl, 'http://nas.wzszz.top:8787/')
    assert.ok(getJson.changelog.includes('1. '))

    const overrideGetRes = await app.request(
      'http://nas.wzszz.top:8787/api/shortcut',
      {},
      { SHORTCUT_API_BASE_URL: 'https://edge.example.com/custom-path' },
    )
    assert.equal(overrideGetRes.status, 200)
    const overrideJson = (await overrideGetRes.json()) as { apiBaseUrl: string }
    assert.equal(overrideJson.apiBaseUrl, 'https://edge.example.com')

    // No ADMIN_TOKEN configured -> 403
    const noSecretRes = await app.request(
      'http://nas.wzszz.top:8787/api/shortcut',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(current),
      },
    )
    assert.equal(noSecretRes.status, 403)

    // Wrong ADMIN_TOKEN -> 401
    const wrongSecretRes = await app.request(
      'http://nas.wzszz.top:8787/api/shortcut',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': 'wrong',
        },
        body: JSON.stringify(current),
      },
      { ADMIN_TOKEN: 'admin-123' },
    )
    assert.equal(wrongSecretRes.status, 401)

    // Unsafe javascript: URL -> 400
    const badUrlRes = await app.request(
      'http://nas.wzszz.top:8787/api/shortcut',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': 'admin-123',
        },
        body: JSON.stringify({
          ...current,
          icloudUrl: 'javascript:alert(1)',
        }),
      },
      { ADMIN_TOKEN: 'admin-123' },
    )
    assert.equal(badUrlRes.status, 400)

    // Valid update -> 200 and reflected on subsequent GET / & GET /api/shortcut
    const okRes = await app.request(
      'http://nas.wzszz.top:8787/api/shortcut',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': 'admin-123',
        },
        body: JSON.stringify({
          ...current,
          version: '2.2.0',
          build: 5,
          updatedAt: '2026-11-29',
          icloudUrl: 'https://www.icloud.com/shortcuts/11112222333344445555666677778888',
          notes: ['支持全新快捷指令检查更新'],
        }),
      },
      { ADMIN_TOKEN: 'admin-123' },
    )
    assert.equal(okRes.status, 200)

    const updatedGet = await app.request('http://nas.wzszz.top:8787/api/shortcut')
    const updatedJson = (await updatedGet.json()) as {
      version: string
      build: number
      icloudUrl: string
    }
    assert.equal(updatedJson.version, '2.2.0')
    assert.equal(updatedJson.build, 5)
    assert.equal(
      updatedJson.icloudUrl,
      'https://www.icloud.com/shortcuts/11112222333344445555666677778888',
    )

    const updatedPage = await (await app.request('http://nas.wzszz.top:8787/')).text()
    assert.ok(updatedPage.includes('v2.2.0'))
    assert.ok(updatedPage.includes('11112222333344445555666677778888'))
  })

  it('extractRawLinkOrId and parseVideoTarget handle mobile .html URLs, scheme-less hosts, and bilibili:// URIs', () => {
    assert.equal(
      extractRawLinkOrId('快看这个视频 b23.tv/xyz999'),
      'https://b23.tv/xyz999',
    )
    assert.equal(
      extractRawLinkOrId('m.bilibili.com/video/BV1q3yyzUEiD.html?p=2'),
      'https://m.bilibili.com/video/BV1q3yyzUEiD.html?p=2',
    )
    assert.equal(
      extractRawLinkOrId('bilibili://video/170001?p=3'),
      'https://www.bilibili.com/video/av170001/?p=3',
    )

    const mobileHtml = parseVideoTarget(
      'https://m.bilibili.com/video/BV1q3yyzUEiD.html?p=2',
    )
    assert.equal(mobileHtml.idType, 'bvid')
    assert.equal(mobileHtml.id, 'BV1q3yyzUEiD')
    assert.equal(mobileHtml.page, 2)

    const avHtml = parseVideoTarget(
      'https://m.bilibili.com/video/av170001.html',
    )
    assert.equal(avHtml.idType, 'aid')
    assert.equal(avHtml.id, '170001')
  })

  it('resolves b23.tv 200 HTML jump pages and bilibili:// redirect targets', async () => {
    const baseMock = createMockFetcher()
    const fetcher: typeof fetch = async (input, init) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      if (url === 'https://b23.tv/htmljump') {
        return new Response(
          '<html><head><meta property="og:url" content="https://m.bilibili.com/video/BV1q3yyzUEiD.html?p=2"></head></html>',
          { status: 200, headers: { 'content-type': 'text/html' } },
        )
      }
      if (url === 'https://b23.tv/appscheme') {
        return new Response(null, {
          status: 302,
          headers: { location: 'bilibili://video/BV1q3yyzUEiD?p=2' },
        })
      }
      return baseMock.fetcher(input, init)
    }

    const app = createApp({ fetcher })

    const htmlJumpRes = await app.request(
      'https://worker.example/api/getreal?bilibili=' +
        encodeURIComponent('https://b23.tv/htmljump'),
    )
    assert.equal(htmlJumpRes.status, 200)
    assert.equal(
      await htmlJumpRes.text(),
      'https://m.bilibili.com/video/BV1q3yyzUEiD.html?p=2',
    )

    const schemeRes = await app.request(
      'https://worker.example/api/download?bilibili=' +
        encodeURIComponent('https://b23.tv/appscheme') +
        '&format=json',
    )
    assert.equal(schemeRes.status, 200)
    const schemeJson = (await schemeRes.json()) as {
      ok: boolean
      proxyUrl?: string
      bvid?: string
      title?: string
      fileName?: string
      quality?: number
      qualityLabel?: string
      page?: number
      totalPages?: number
      hasExplicitPage?: boolean
    }
    assert.equal(schemeJson.ok, true)
    assert.equal(schemeJson.bvid, 'BV1q3yyzUEiD')
    assert.equal(schemeJson.title, '测试视频标题')
    assert.equal(schemeJson.fileName, '测试视频标题_p2')
    assert.equal(schemeJson.quality, 80)
    assert.equal(schemeJson.qualityLabel, '1080P')
    assert.equal(schemeJson.page, 2)
    assert.equal(schemeJson.totalPages, 2)
    assert.equal(schemeJson.hasExplicitPage, true)
    assert.ok(schemeJson.proxyUrl?.startsWith('https://worker.example/api/proxy?'))
  })

  it('supports GET ?format=json and POST /api/download returning HTTP 200 JSON on errors', async () => {
    const { fetcher } = createMockFetcher()
    const app = createApp({ fetcher })

    const badJsonRes = await app.request(
      'https://worker.example/api/download?bilibili=' +
        encodeURIComponent('纯中文标题没有链接') +
        '&format=json',
    )
    assert.equal(badJsonRes.status, 200)
    const badJson = (await badJsonRes.json()) as {
      ok: boolean
      status: number
      error: string
    }
    assert.equal(badJson.ok, false)
    assert.equal(badJson.status, 400)
    assert.match(badJson.error, /无法从输入中识别/)

    const postRes = await app.request('https://worker.example/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bilibili: '【标题】\nhttps://b23.tv/xyz999',
        qn: '80',
      }),
    })
    assert.equal(postRes.status, 200)
    const postJson = (await postRes.json()) as {
      ok: boolean
      proxyUrl: string
      qn: string
      qualityLabel: string
      page: number
      totalPages: number
      hasExplicitPage: boolean
    }
    assert.equal(postJson.ok, true)
    assert.equal(postJson.qn, '80')
    assert.equal(postJson.qualityLabel, '1080P')
    assert.equal(postJson.page, 2)
    assert.equal(postJson.totalPages, 2)
    assert.equal(postJson.hasExplicitPage, true)
    assert.ok(postJson.proxyUrl.includes('/api/proxy?'))

    const bareRes = await app.request(
      'https://worker.example/api/download?bilibili=BV1q3yyzUEiD&format=json',
    )
    assert.equal(bareRes.status, 200)
    const bareJson = (await bareRes.json()) as {
      ok: boolean
      qn: string
      page: number
      totalPages: number
      hasExplicitPage: boolean
      fileName: string
    }
    assert.equal(bareJson.ok, true)
    assert.equal(bareJson.qn, '80')
    assert.equal(bareJson.page, 1)
    assert.equal(bareJson.totalPages, 2)
    assert.equal(bareJson.hasExplicitPage, false)
    assert.equal(bareJson.fileName, '测试视频标题')
  })
})
