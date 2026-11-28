import type { HighlightTone, ShortcutConfig } from './shortcut.ts'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeJsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

const APP_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" fill="none">
  <defs>
    <linearGradient id="bg" x1="12" y1="8" x2="108" y2="112" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ff6b9b"/>
      <stop offset="55%" stop-color="#fb7299"/>
      <stop offset="100%" stop-color="#00aeec"/>
    </linearGradient>
    <linearGradient id="gloss" x1="60" y1="0" x2="60" y2="62" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="120" height="120" rx="28" fill="url(#bg)"/>
  <rect width="120" height="60" rx="28" fill="url(#gloss)"/>
  <path d="M40 28L50 38M80 28L70 38" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round"/>
  <rect x="24" y="38" width="72" height="54" rx="16" stroke="#ffffff" stroke-width="5.5"/>
  <path d="M60 51V73M50.5 64.5L60 74L69.5 64.5" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

const APP_ICON_DATA_URI = `data:image/svg+xml,${encodeURIComponent(APP_ICON_SVG)}`

function renderHighlightIcon(idx: number): string {
  if (idx === 0) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z"/><path d="M9 12.2l2 2 4-4"/></svg>'
  }
  if (idx === 1) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l9 4.5-9 4.5-9-4.5L12 3z"/><path d="M3 12l9 4.5 9-4.5"/><path d="M3 16.5L12 21l9-4.5"/></svg>'
  }
  return '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 2L4 13.5h6.5L9.5 22 20 9.5h-6.5L13.5 2z"/></svg>'
}

function toneClass(tone?: HighlightTone, idx = 0): string {
  if (tone === 'pink') return 'c1'
  if (tone === 'blue') return 'c2'
  if (tone === 'amber') return 'c3'
  return `c${(idx % 3) + 1}`
}

export type RenderShortcutPageOptions = {
  origin: string
  editable: boolean
  requiresApiToken: boolean
  stripePaywall?: boolean
  checkoutUrl?: string
  portalUrl?: string
  productId?: string
  dash4k?: boolean
}

const QUALITY_OPTIONS = [
  { value: '80', title: '自动最高', meta: '免费 1080P / 720P', vip: false },
  { value: '64', title: '720P 高清', meta: '免费 MP4 直下', vip: false },
  { value: '32', title: '480P 清晰', meta: '省流单流 MP4', vip: false },
  { value: '120', title: '4K 超清', meta: '会员 DASH 混流', vip: true },
  { value: '116', title: '1080P60', meta: '会员高帧率', vip: true },
  { value: '112', title: '1080P+', meta: '会员高码率', vip: true },
] as const

/** Render the Web Bilibili downloader + Apple Shortcut distribution page. */
export function renderShortcutPage(
  config: ShortcutConfig,
  options: RenderShortcutPageOptions,
): string {
  const safeName = escapeHtml(config.name)
  const safeVersion = escapeHtml(config.version)
  const safeBadge = escapeHtml(config.badgePrefix)
  const safeDate = escapeHtml(config.updatedAt)
  const safeSubtitle = escapeHtml(config.subtitle)
  const safeIcloudUrl = escapeHtml(config.icloudUrl)
  const safeApiCheckUrl = escapeHtml(`${options.origin}/api/shortcut`)
  const safeHelpGuideUrl = config.helpGuideUrl ? escapeHtml(config.helpGuideUrl) : ''
  const safeCheckoutUrl = options.checkoutUrl ? escapeHtml(options.checkoutUrl) : ''
  const safePortalUrl = options.portalUrl ? escapeHtml(options.portalUrl) : ''

  const titleSegments = config.name.split(' ')
  const headingHtml =
    titleSegments.length > 1
      ? `<span>${escapeHtml(titleSegments[0])}</span> ${escapeHtml(titleSegments.slice(1).join(' '))}`
      : `<span>${safeName}</span>`

  const featuresHtml = config.highlights
    .map((item, idx) => {
      const badgeHtml = item.badge ? `<span class="tag">${escapeHtml(item.badge)}</span>` : ''
      return `<div class="feat">
        <div class="ic ${toneClass(item.tone, idx)}">${renderHighlightIcon(idx)}</div>
        <b>${escapeHtml(item.title)}${badgeHtml}</b>
        <small>${escapeHtml(item.subtitle)}</small>
      </div>`
    })
    .join('')

  const notesHtml = config.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')

  const qualityButtonsHtml = QUALITY_OPTIONS.map((q) => {
    const disabledSuffix = q.vip && options.dash4k === false ? '（无 ffmpeg）' : ''
    const vipTag = q.vip ? '<span class="q-badge">PRO</span>' : ''
    const activeCls = q.value === '80' ? ' active' : ''
    return `<button type="button" class="q-pill${q.vip ? ' is-vip' : ''}${activeCls}" data-qn="${q.value}" aria-pressed="${q.value === '80' ? 'true' : 'false'}">
      <div class="q-top"><b>${escapeHtml(q.title)}</b>${vipTag}</div>
      <small>${escapeHtml(q.meta + disabledSuffix)}</small>
    </button>`
  }).join('')

  const qualitySelectOptionsHtml = QUALITY_OPTIONS.map((q) => {
    const note = q.vip && options.dash4k === false ? ' [当前节点未启用 ffmpeg]' : ''
    return `<option value="${q.value}">${escapeHtml(q.title)} · ${escapeHtml(q.meta)}${escapeHtml(note)}</option>`
  }).join('')

  const helpFirstBlock = safeHelpGuideUrl
    ? `<a class="help" target="_blank" rel="noopener noreferrer" href="${safeHelpGuideUrl}">
        <span class="hi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z"/><path d="M12 8v5"/><path d="M12 16.5v.01"/></svg></span>
        <div>
          <b>提示「无法打开，<em>未受信任</em>」？</b>
          <p>首次导入快捷指令需要简单授权，<span class="link">查看帮助教程 →</span></p>
        </div>
      </a>`
    : `<details class="help-details">
        <summary class="help">
          <span class="hi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z"/><path d="M12 8v5"/><path d="M12 16.5v.01"/></svg></span>
          <div>
            <b>提示「无法打开 / 权限拒绝」？</b>
            <p>首次运行需允许访问网络与照片权限 <span class="link">展开查看 →</span></p>
          </div>
        </summary>
        <div class="help-answer">
          1. 在弹窗中允许快捷指令访问当前服务器与 <b>相册（照片）</b> 权限；<br>
          2. 若系统提示安全限制，请前往 <b>设置 → 快捷指令 → 高级</b> 检查共享与访问权限；<br>
          3. 如需手动编辑地址，接口端点为：<code>${escapeHtml(options.origin)}/api/download</code>。
        </div>
      </details>`

  const initialPayload = escapeJsonForScript({
    ...config,
    editable: options.editable,
    requiresApiToken: options.requiresApiToken,
    stripePaywall: Boolean(options.stripePaywall),
    checkoutUrl: options.checkoutUrl || '',
    portalUrl: options.portalUrl || '',
    dash4k: options.dash4k !== false,
    origin: options.origin,
  })

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#fb7299">
<meta name="description" content="${safeName} · ${safeSubtitle}">
<link rel="icon" type="image/svg+xml" href="${APP_ICON_DATA_URI}">
<link rel="apple-touch-icon" href="${APP_ICON_DATA_URI}">
<title>${safeName} · 网页版下载与快捷指令</title>
<style>
  :root{
    color-scheme:light dark;
    --brand:#fb7299;
    --brand-2:#ff8fb0;
    --brand-deep:#e04b78;
    --bili-blue:#00aeec;
    --bg:#f5f6fa;
    --card:rgba(255,255,255,.86);
    --card-solid:#ffffff;
    --line:rgba(24,25,28,.09);
    --line-strong:rgba(24,25,28,.16);
    --text:#18191c;
    --muted:#61666d;
    --ios-blue:#007aff;
    --ios-red:#ff3b30;
    --ios-green:#34c759;
    --radius:22px;
    --shadow:0 1px 2px rgba(24,25,28,.04),0 10px 30px rgba(24,25,28,.07);
  }
  @media (prefers-color-scheme:dark){
    :root{
      --bg:#0d0f14;
      --card:rgba(26,29,38,.82);
      --card-solid:#181b24;
      --line:rgba(255,255,255,.09);
      --line-strong:rgba(255,255,255,.18);
      --text:#f1f2f6;
      --muted:#9aa0ad;
      --ios-blue:#0a84ff;
      --ios-red:#ff453a;
      --ios-green:#30d158;
      --shadow:0 1px 2px rgba(0,0,0,.35),0 12px 38px rgba(0,0,0,.42);
    }
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",sans-serif;
    background:var(--bg);color:var(--text);line-height:1.55;
    -webkit-font-smoothing:antialiased;min-height:100dvh;overflow-x:hidden;
  }
  .glow{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
  .glow i{position:absolute;border-radius:50%;filter:blur(82px);opacity:.38}
  .glow i:nth-child(1){width:420px;height:420px;background:#ff85ab;top:-160px;left:-120px;animation:float 15s ease-in-out infinite}
  .glow i:nth-child(2){width:380px;height:380px;background:#59d2ff;top:90px;right:-150px;opacity:.32;animation:float 19s ease-in-out infinite reverse}
  .glow i:nth-child(3){width:320px;height:320px;background:#ffa76d;bottom:-140px;left:18%;opacity:.2;animation:float 22s ease-in-out infinite}
  @media (prefers-color-scheme:dark){.glow i{opacity:.2}.glow i:nth-child(2){opacity:.15}.glow i:nth-child(3){opacity:.1}}
  @keyframes float{0%,100%{transform:translate(0,0)}50%{transform:translate(26px,36px)}}

  .wrap{
    max-width:600px;margin:0 auto;
    padding:calc(28px + env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) calc(44px + env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));
  }

  /* Compact Hero Header */
  .hero{
    display:flex;align-items:center;gap:16px;text-align:left;margin-bottom:20px;
    animation:rise .5s cubic-bezier(.2,.8,.2,1) both;
  }
  .icon-sm{
    width:64px;height:64px;border-radius:16px;flex:none;
    box-shadow:0 10px 24px rgba(251,114,153,.3),0 4px 10px rgba(0,174,236,.18);
  }
  .hero-main{flex:1;min-width:0}
  .hero-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px}
  .badge{
    display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:650;
    color:var(--brand-deep);background:rgba(251,114,153,.13);padding:3px 10px;border-radius:999px;
    font-variant-numeric:tabular-nums;
  }
  @media (prefers-color-scheme:dark){.badge{color:#ff94b5;background:rgba(251,114,153,.18)}}
  .cap-pill{
    display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;
    padding:3px 10px;border-radius:999px;background:rgba(0,174,236,.12);color:var(--bili-blue);
  }
  .cap-pill.warn{background:rgba(255,149,0,.14);color:#c26d00}
  @media (prefers-color-scheme:dark){.cap-pill.warn{color:#ffb340}}

  h1{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1.2}
  h1 span{
    background:linear-gradient(120deg,var(--brand-deep),var(--brand) 52%,var(--bili-blue));
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  @media (prefers-color-scheme:dark){
    h1 span{background:linear-gradient(120deg,#ff90b3,#70dcff);-webkit-background-clip:text;background-clip:text}
  }
  .sub{color:var(--muted);font-size:13.5px;margin-top:4px}

  /* Segmented Tab Switcher */
  .tabs{
    display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:14px;
    background:rgba(120,120,128,.12);margin-bottom:18px;
  }
  .tab-btn{
    border:0;background:transparent;color:var(--muted);font:600 14px/1 inherit;
    padding:11px 12px;border-radius:11px;cursor:pointer;transition:all .2s ease;
  }
  .tab-btn.active{
    background:var(--card-solid);color:var(--text);
    box-shadow:0 2px 8px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.04);
  }
  .tab-btn:focus-visible{outline:2px solid var(--bili-blue);outline-offset:2px}
  .panel[hidden]{display:none}

  .card{
    background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
    box-shadow:var(--shadow);padding:20px;margin-bottom:16px;min-width:0;
    animation:rise .5s cubic-bezier(.2,.8,.2,1) both;
  }
  @supports (backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px)){
    .card{backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px)}
  }
  @keyframes rise{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}

  .card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
  .card-h h2{font-size:16.5px;font-weight:700}
  .card-h time,.card-sub{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}

  /* License Status Bar */
  .lic-bar{
    display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;
    padding:12px 14px;border-radius:15px;background:var(--card-solid);border:1px solid var(--line);
    margin-bottom:16px;
  }
  .lic-info{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px}
  .lic-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--muted)}
  .lic-dot.ok{background:var(--ios-green);box-shadow:0 0 0 4px rgba(52,199,89,.18)}
  .lic-dot.wait{background:#ff9f0a}
  .lic-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .lic-drawer{
    padding:14px;border-radius:15px;background:var(--card-solid);border:1px solid var(--line);
    margin-bottom:16px;display:grid;gap:10px;
  }
  .lic-drawer[hidden]{display:none}

  /* Form Controls */
  .input-wrap{display:grid;gap:8px}
  .input-head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:650}
  .mini-links{display:flex;gap:10px}
  .chip-btn{
    border:0;background:rgba(120,120,128,.12);color:var(--text);font:600 12px/1 inherit;
    padding:6px 10px;border-radius:8px;cursor:pointer;transition:background .15s,transform .1s;
  }
  .chip-btn:hover{background:rgba(120,120,128,.2)}
  .chip-btn:active{transform:scale(.96)}

  .input,select,textarea{
    width:100%;border:1px solid var(--line-strong);border-radius:13px;background:var(--card-solid);
    color:var(--text);font:14px/1.45 inherit;padding:11px 13px;outline:none;transition:border-color .18s;
  }
  .input:focus,select:focus,textarea:focus{border-color:var(--bili-blue)}
  textarea{resize:vertical;min-height:82px}

  /* Quality Picker Grid */
  .q-section-label{font-size:13px;font-weight:650;margin-top:14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}
  .q-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
  .q-pill{
    text-align:left;padding:10px 11px;border-radius:13px;background:var(--card-solid);
    border:1.5px solid var(--line);color:var(--text);cursor:pointer;transition:all .16s ease;
  }
  .q-pill:hover{border-color:var(--line-strong)}
  .q-pill.active{
    border-color:var(--brand);background:rgba(251,114,153,.09);
    box-shadow:0 4px 12px rgba(251,114,153,.14);
  }
  .q-pill.is-vip.active{
    border-color:var(--bili-blue);background:rgba(0,174,236,.1);
    box-shadow:0 4px 12px rgba(0,174,236,.14);
  }
  .q-top{display:flex;align-items:center;justify-content:space-between;gap:4px}
  .q-top b{font-size:13.5px;font-weight:700}
  .q-pill small{display:block;font-size:11px;color:var(--muted);margin-top:2px}
  .q-badge{
    font-size:10px;font-weight:750;padding:1px 5px;border-radius:5px;
    background:linear-gradient(135deg,#ffb340,#ff7a1a);color:#fff;
  }
  .sr-select{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}

  .meta-inputs{display:grid;grid-template-columns:120px 1fr;gap:8px;margin-top:10px}
  .actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
  .btn{
    display:inline-flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;
    border:0;border-radius:13px;padding:12px 14px;font:650 14.5px/1.2 inherit;cursor:pointer;
    transition:transform .12s ease,opacity .2s ease;min-height:46px;
  }
  .btn:active{transform:scale(.98)}
  .btn:disabled{opacity:.55;cursor:not-allowed}
  .btn-primary{background:linear-gradient(135deg,var(--brand),var(--brand-deep));color:#fff;box-shadow:0 6px 18px rgba(251,114,153,.26)}
  .btn-secondary{background:rgba(0,174,236,.14);color:var(--bili-blue)}
  .btn-blue{background:linear-gradient(135deg,#1ab7ff,#008fd1);color:#fff}
  .btn-ghost{background:rgba(120,120,128,.12);color:var(--text)}
  .btn-sm{min-height:36px;padding:8px 12px;font-size:13px;border-radius:10px}

  .status-line{font-size:13px;color:var(--muted);margin-top:12px;min-height:20px;word-break:break-word}
  .status-line.err{color:var(--ios-red)}

  /* Paywall Card */
  .paywall{
    margin-top:14px;padding:16px;border-radius:16px;
    background:rgba(255,149,0,.08);border:1px solid rgba(255,149,0,.32);display:grid;gap:12px;
  }
  .paywall[hidden]{display:none}
  .paywall-title{font-size:14.5px;font-weight:700;color:var(--text)}
  .paywall-desc{font-size:13px;color:var(--muted)}
  .paywall-row{display:flex;gap:8px;flex-wrap:wrap}
  .paywall-row .input{flex:1;min-width:190px}

  /* Result & Preview Card & Single-Column Grid Containment */
  .lic-drawer,.input-wrap,.paywall,.page-picker,.result-card{
    grid-template-columns:minmax(0,1fr);min-width:0;
  }
  .result-card{
    margin-top:14px;padding:16px;border-radius:16px;background:var(--card-solid);
    border:1px solid var(--line);display:grid;gap:12px;overflow:hidden;
  }
  .result-card>*{min-width:0}
  .result-card[hidden],.page-picker[hidden]{display:none}
  .page-picker{display:grid;gap:6px}
  .res-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0}
  .res-head>div{flex:1;min-width:0}
  .res-title{font-size:15px;font-weight:700;line-height:1.4;overflow-wrap:anywhere}
  #downloadAnchor{flex:none}
  .res-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
  .res-tag{
    font-size:11.5px;font-weight:650;padding:2px 8px;border-radius:6px;
    background:rgba(0,174,236,.12);color:var(--bili-blue);font-variant-numeric:tabular-nums;
  }
  .video-frame{
    width:100%;max-width:100%;min-width:0;overflow:hidden;
    border-radius:12px;background:#000;
  }
  .res-video{
    display:block;width:100%;max-width:100%;height:auto;
    max-height:min(60dvh,360px);object-fit:contain;background:#000;outline:none;
  }
  .copy{
    display:flex;align-items:center;gap:8px;background:var(--bg);
    border:1px solid var(--line);border-radius:12px;padding:6px 6px 6px 12px;
  }
  .copy code{flex:1;min-width:0;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .copy button{
    flex:none;border:0;cursor:pointer;font:600 13px/1 inherit;color:#fff;
    background:var(--brand-deep);padding:8px 13px;border-radius:9px;min-height:34px;
  }
  .copy button.ok{background:var(--ios-green)}

  /* Shortcut Panel Styles */
  .cta{
    display:flex;align-items:center;justify-content:center;gap:10px;margin:4px auto 10px;
    height:52px;border-radius:15px;text-decoration:none;
    color:#fff;font-size:16.5px;font-weight:700;
    background:linear-gradient(135deg,var(--brand) 0%,var(--brand-deep) 55%,#0099db 100%);
    box-shadow:0 10px 24px rgba(251,114,153,.32),inset 0 1px 0 rgba(255,255,255,.28);
  }
  .cta svg{width:20px;height:20px}
  .meta-center{font-size:12.5px;color:var(--muted);text-align:center;margin-bottom:4px}

  .features{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .feat{background:var(--card-solid);border:1px solid var(--line);border-radius:16px;padding:15px 8px 13px;text-align:center}
  .feat .ic{width:42px;height:42px;border-radius:12px;margin:0 auto 10px;display:grid;place-items:center;color:#fff}
  .feat .ic svg{width:22px;height:22px}
  .feat b{display:block;font-size:13.5px;font-weight:700}
  .feat small{display:block;font-size:11.5px;color:var(--muted);margin-top:3px}
  .c1{background:linear-gradient(135deg,#ff80a8,#e04b78)}
  .c2{background:linear-gradient(135deg,#3fd0ff,#008fd1)}
  .c3{background:linear-gradient(135deg,#ffb547,#ff7a1a)}
  .tag{display:inline-block;font-size:10px;font-weight:700;color:#fff;background:var(--ios-red);border-radius:6px;padding:0 5px;margin-left:4px;vertical-align:1px;line-height:16px}

  .notes{list-style:none;margin-top:16px;border-top:1px solid var(--line);padding-top:14px}
  .notes li{display:flex;gap:10px;font-size:14px;padding:5px 0}
  .notes li::before{
    content:"";flex:none;width:18px;height:18px;margin-top:3px;border-radius:50%;
    background:linear-gradient(135deg,var(--brand),var(--bili-blue)) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5 12.5l4.5 4.5L19 7.5'/%3E%3C/svg%3E") center/12px no-repeat;
  }

  .guide-tip{font-size:14px;color:var(--muted);margin-bottom:14px}
  .guide-tip em{font-style:normal;color:var(--ios-red);font-weight:600}
  .alert{
    max-width:274px;margin:0 auto;border-radius:14px;overflow:hidden;
    background:rgba(242,242,247,.95);color:#000;text-align:center;
    box-shadow:0 10px 30px rgba(0,0,0,.12);border:1px solid var(--line);
  }
  @media (prefers-color-scheme:dark){.alert{background:rgba(44,44,46,.96);color:#fff}}
  .alert-body{padding:18px 16px 15px}
  .alert-body b{display:block;font-size:15.5px;font-weight:600;line-height:1.35}
  .alert-body p{font-size:13px;margin-top:5px;color:var(--muted)}
  .alert-btn{border-top:.5px solid rgba(60,60,67,.25);font-size:17px;padding:11px 0;color:var(--ios-blue)}
  @media (prefers-color-scheme:dark){.alert-btn{border-color:rgba(84,84,88,.6)}}
  .alert-btn.danger{color:var(--ios-red);font-weight:700;position:relative;background:rgba(255,59,48,.09)}
  .alert-btn.danger::after{
    content:"";position:absolute;inset:4px 40px;border:2px solid var(--ios-red);
    border-radius:10px;animation:blink 1.6s ease-in-out infinite;
  }
  @keyframes blink{50%{opacity:.25}}
  .finger{font-size:13px;color:var(--ios-red);text-align:center;margin-top:12px;font-weight:600}

  .help{display:flex;gap:14px;align-items:flex-start;text-decoration:none;color:inherit;cursor:pointer;list-style:none}
  .help::-webkit-details-marker{display:none}
  .help-sep{margin-top:16px;padding-top:16px;border-top:1px solid var(--line)}
  .help .hi{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:rgba(251,114,153,.13);color:var(--brand-deep)}
  @media (prefers-color-scheme:dark){.help .hi{color:#ff94b5;background:rgba(251,114,153,.18)}}
  .help .hi svg{width:19px;height:19px}
  .help b{font-size:15px;display:block}
  .help p{font-size:13.5px;color:var(--muted);margin-top:2px}
  .help p em{font-style:normal;color:var(--ios-red)}
  .link{color:var(--bili-blue);font-weight:600;text-decoration:none}
  .help-answer{
    margin:12px 0 0 50px;padding:12px 14px;border-radius:12px;
    background:var(--card-solid);border:1px solid var(--line);font-size:13px;color:var(--muted);line-height:1.65;
  }
  .help-answer code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:var(--text);word-break:break-all}

  footer{
    text-align:center;font-size:12px;color:var(--muted);margin-top:24px;
    display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 14px;
  }
  .foot-btn{background:none;border:0;color:var(--muted);font:inherit;cursor:pointer;text-decoration:underline;padding:4px 2px}
  .foot-btn:hover{color:var(--text)}

  dialog{
    margin:auto;width:min(94vw,480px);max-height:88dvh;overflow:auto;
    border:1px solid var(--line);border-radius:22px;padding:22px;
    background:var(--card-solid);color:var(--text);box-shadow:0 24px 60px rgba(0,0,0,.35);
  }
  dialog::backdrop{background:rgba(0,0,0,.48);backdrop-filter:blur(4px)}
  .dlg-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
  .dlg-h h3{font-size:18px;font-weight:700}
  .dlg-close{border:0;background:var(--line);color:var(--text);width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer}
  .form-grid{display:grid;gap:12px}
  .form-grid label{display:grid;gap:5px;font-size:13px;font-weight:600}
  .form-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .hl-group{display:grid;grid-template-columns:1fr 1fr 74px;gap:6px}
  .hint-box{font-size:12.5px;color:var(--muted);background:var(--bg);padding:10px 12px;border-radius:10px;line-height:1.5}

  @media (max-width:480px){
    .q-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
    .actions,.form-2,.meta-inputs,.features{grid-template-columns:1fr}
  }
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  @media (prefers-reduced-transparency:reduce){.card{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:var(--card-solid)}}
</style>
</head>
<body>
<div class="glow" aria-hidden="true"><i></i><i></i><i></i></div>

<main class="wrap">
  <header class="hero">
    <div class="icon-sm" aria-hidden="true">${APP_ICON_SVG}</div>
    <div class="hero-main">
      <div class="hero-top">
        <span class="badge">${safeBadge} · v${safeVersion}</span>
        <span class="cap-pill${options.dash4k === false ? ' warn' : ''}">${options.dash4k === false ? '单流 1080P 模式' : '4K DASH + ffmpeg 就绪'}</span>
      </div>
      <h1>${headingHtml}</h1>
      <p class="sub">${safeSubtitle}</p>
    </div>
  </header>

  <nav class="tabs" role="tablist" aria-label="功能切换">
    <button type="button" class="tab-btn active" id="tabWeb" role="tab" aria-selected="true" aria-controls="panelWeb">网页在线下载</button>
    <button type="button" class="tab-btn" id="tabShortcut" role="tab" aria-selected="false" aria-controls="panelShortcut">Apple 快捷指令</button>
  </nav>

  <!-- Primary Web Downloader Workbench -->
  <section class="panel" id="panelWeb" role="tabpanel" aria-labelledby="tabWeb">
    <div class="card">
      <div class="card-h">
        <h2>网页解析与直接下载</h2>
        <span class="card-sub">与快捷指令共用同一接口与会员授权</span>
      </div>

      ${options.stripePaywall ? `
      <div class="lic-bar" id="licBar">
        <div class="lic-info">
          <span class="lic-dot" id="licDot"></span>
          <span id="licSummary">未激活会员 · 1080P 及以下免费直下</span>
        </div>
        <div class="lic-actions">
          ${safeCheckoutUrl ? `<a class="btn btn-sm btn-ghost" id="headerCheckoutLink" href="${safeCheckoutUrl}" target="_blank" rel="noopener noreferrer">开通会员</a>` : ''}
          ${safePortalUrl ? `<a class="btn btn-sm btn-ghost" id="headerPortalLink" href="${safePortalUrl}" target="_blank" rel="noopener noreferrer" hidden>管理订阅</a>` : ''}
          <button type="button" class="btn btn-sm btn-secondary" id="toggleLicDrawerBtn">激活授权码</button>
        </div>
      </div>

      <div class="lic-drawer" id="licDrawer" hidden>
        <div class="paywall-row">
          <input class="input" id="testLicenseKey" type="text" placeholder="输入或粘贴授权码（如 BILI-XXXX-XXXX-XXXX-XXXX）">
          <button type="button" class="btn btn-sm btn-primary" id="btnActivateLic">激活本浏览器</button>
          <button type="button" class="btn btn-sm btn-ghost" id="btnClearLic">清除</button>
        </div>
        <div class="status-line" id="licDrawerStatus" style="margin-top:0"></div>
      </div>
      ` : '<input id="testLicenseKey" type="hidden" value="">'}

      <div class="input-wrap">
        <div class="input-head">
          <label for="testInput">B 站视频链接、分享文案或 BV / av 号</label>
          <div class="mini-links">
            <button type="button" class="chip-btn" id="btnPasteInput">粘贴</button>
            <button type="button" class="chip-btn" id="btnSampleInput">示例 BV</button>
            <button type="button" class="chip-btn" id="btnClearInput">清空</button>
          </div>
        </div>
        <textarea id="testInput" placeholder="粘贴 B 站视频链接、b23.tv 短链、App 分享文案或 BV 号（例如 https://www.bilibili.com/video/BV1q3yyzUEiD/）"></textarea>
      </div>

      <div class="q-section-label">
        <span>选择清晰度</span>
        <span class="card-sub">${options.stripePaywall ? '80/64/32 免费 · 112/116/120 需 Pro 授权' : '当前节点未开启付费限制'}</span>
      </div>
      <div class="q-grid" id="qualityGrid">
        ${qualityButtonsHtml}
      </div>
      <select id="testQn" class="sr-select" aria-hidden="true" tabindex="-1">
        ${qualitySelectOptionsHtml}
      </select>

      <div class="meta-inputs">
        <input class="input" id="testPage" type="number" min="1" placeholder="分 P（默认 1）">
        <input class="input" id="testToken" type="password" placeholder="API_TOKEN（访问令牌）" style="${options.requiresApiToken ? '' : 'display:none'}">
      </div>

      <div class="actions">
        <button type="button" class="btn btn-secondary" id="btnResolve">解析并试播</button>
        <button type="button" class="btn btn-primary" id="btnDirectDl">直接下载 MP4</button>
      </div>

      <div class="status-line" id="testStatus" role="status" aria-live="polite"></div>

      <!-- Inline Stripe Checkout & Activation Prompt on 402 -->
      <div class="paywall" id="paywallBox" hidden>
        <div class="paywall-title" id="paywallTitle">当前清晰度需要 Pro 会员授权</div>
        <div class="paywall-desc" id="paywallDesc"></div>
        <div class="paywall-row">
          <a class="btn btn-sm btn-primary" id="paywallCheckoutBtn" href="${safeCheckoutUrl || '#'}" target="_blank" rel="noopener noreferrer">前往 Stripe 开通 / 购买 Pro →</a>
          <button type="button" class="btn btn-sm btn-ghost" id="btnFallbackFree">改用免费最高画质 (1080P/720P)</button>
        </div>
        <div class="paywall-row">
          <input class="input" id="paywallKeyInput" type="text" placeholder="付款完成后复制授权码（BILI-...）粘贴到此处">
          <button type="button" class="btn btn-sm btn-blue" id="btnPaywallActivate">激活并继续下载</button>
        </div>
      </div>

      <!-- Parsed Video Result, Multi-P Picker & Preview Player -->
      <div class="result-card" id="resultCard" hidden>
        <div class="res-head">
          <div>
            <div class="res-title" id="resTitle"></div>
            <div class="res-tags" id="resTags"></div>
          </div>
          <a class="btn btn-sm btn-primary" id="downloadAnchor" href="#" download>保存 MP4</a>
        </div>
        <div class="page-picker" id="pagePickerWrap" hidden>
          <label for="pagePicker" style="font-size:12.5px;font-weight:650">切换分 P 视频</label>
          <select id="pagePicker"></select>
        </div>
        <div class="video-frame">
          <video class="res-video" id="previewPlayer" controls playsinline preload="metadata"></video>
        </div>
        <div class="copy" id="proxyResultBox">
          <code id="proxyResultCode"></code>
          <button type="button" data-copy-target="proxyResultCode">复制直链</button>
        </div>
      </div>
    </div>
  </section>

  <!-- Apple Shortcut Tab Panel -->
  <section class="panel" id="panelShortcut" role="tabpanel" aria-labelledby="tabShortcut" hidden>
    <div class="card">
      <a class="cta" id="ctaLink" href="${safeIcloudUrl}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/></svg>
        立即获取快捷指令
      </a>
      <p class="meta-center">适用于 iPhone / iPad · 需在 Safari 中打开（${safeDate} 更新）</p>
    </div>

    <div class="card">
      <div class="card-h">
        <h2>本次更新</h2>
        <time datetime="${safeDate}">v${safeVersion} · ${safeDate}</time>
      </div>
      <div class="features">${featuresHtml}</div>
      <ul class="notes">${notesHtml}</ul>
    </div>

    <div class="card">
      <div class="card-h"><h2>已安装旧版本？</h2></div>
      <p class="guide-tip">点击上方「获取」后，在系统弹窗中选择 <em>替换</em>，即可用新版覆盖旧版。</p>
      <div class="alert" aria-hidden="true">
        <div class="alert-body">
          <b>您已经有名为“${safeName}”的快捷指令。</b>
          <p>您要替换快捷指令吗？</p>
        </div>
        <div class="alert-btn danger">替换</div>
        <div class="alert-btn">保留两者</div>
        <div class="alert-btn">取消</div>
      </div>
      <p class="finger">↑ 请点击「替换」</p>
    </div>

    <div class="card">
      <div class="card-h"><h2>遇到问题 & 自动更新</h2></div>
      ${helpFirstBlock}
      <div class="help help-sep">
        <span class="hi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3.5-3.5a4 4 0 0 0-5.7-5.7L12 6.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-3.5 3.5a4 4 0 0 0 5.7 5.7l1.5-1.5"/></svg></span>
        <div style="flex:1;min-width:0">
          <b>点击获取没反应？</b>
          <p>复制下方链接，粘贴到 Safari 浏览器中打开</p>
          <div class="copy">
            <code id="icloudUrlCode">${safeIcloudUrl}</code>
            <button type="button" data-copy-target="icloudUrlCode">复制</button>
          </div>
        </div>
      </div>
      <div class="help help-sep">
        <span class="hi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg></span>
        <div style="flex:1;min-width:0">
          <b>Apple Shortcut 自动检查更新接口</b>
          <p>在快捷指令内请求下方 JSON，对比 <code>build &gt; ${config.build}</code> 时打开本页面</p>
          <div class="copy">
            <code id="apiCheckCode">${safeApiCheckUrl}</code>
            <button type="button" data-copy-target="apiCheckCode">复制</button>
          </div>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <span>${safeName} · v${safeVersion} (build ${config.build}) · 最后更新 ${safeDate}</span>
    <a class="foot-btn" href="/api/shortcut" target="_blank" rel="noopener">更新 JSON</a>
    <button type="button" class="foot-btn" id="openAdminBtn">管理更新</button>
  </footer>
</main>

<dialog id="adminModal" aria-labelledby="adminModalTitle">
  <div class="dlg-h">
    <h3 id="adminModalTitle">更新快捷指令发布页</h3>
    <button type="button" class="dlg-close" id="closeAdminBtn" aria-label="关闭">×</button>
  </div>
  <form class="form-grid" id="adminForm">
    <div class="hint-box" id="adminHint"></div>
    <div class="form-2">
      <label>快捷指令名称<input class="input" name="name" required maxlength="60"></label>
      <label>更新日期<input class="input" name="updatedAt" required maxlength="32"></label>
    </div>
    <div class="form-2">
      <label>版本号 (version)<input class="input" name="version" required maxlength="30"></label>
      <label>构建号 (build 整数)<input class="input" name="build" type="number" min="1" required></label>
    </div>
    <label>iCloud 快捷指令链接<input class="input" name="icloudUrl" type="url" required></label>
    <label>副标题<input class="input" name="subtitle" required maxlength="140"></label>
    <label>
      特性亮点（最多 3 项：标题 / 副标题 / 标签）
      <div class="hl-group"><input class="input" name="h0t" required><input class="input" name="h0s" required><input class="input" name="h0b" placeholder="NEW"></div>
      <div class="hl-group"><input class="input" name="h1t" required><input class="input" name="h1s" required><input class="input" name="h1b" placeholder="NEW"></div>
      <div class="hl-group"><input class="input" name="h2t" required><input class="input" name="h2s" required><input class="input" name="h2b" placeholder="可选"></div>
    </label>
    <label>更新要点（每行一条）<textarea name="notes" rows="4" required></textarea></label>
    <label>管理口令 (ADMIN_TOKEN)<input class="input" name="adminToken" type="password" placeholder="输入 .env 中的 ADMIN_TOKEN" required></label>
    <div class="status-line" id="adminStatus"></div>
    <button type="submit" class="btn btn-primary" id="saveAdminBtn">保存并立即生效</button>
  </form>
</dialog>

<script id="initialConfig" type="application/json">${initialPayload}</script>
<script>
(function(){
  var cfg = JSON.parse(document.getElementById('initialConfig').textContent);

  /* Tab switching (+ #shortcut / ?tab=shortcut support) */
  var tabWeb = document.getElementById('tabWeb');
  var tabShortcut = document.getElementById('tabShortcut');
  var panelWeb = document.getElementById('panelWeb');
  var panelShortcut = document.getElementById('panelShortcut');

  function activateTab(which){
    var isShortcut = which === 'shortcut';
    tabWeb.classList.toggle('active', !isShortcut);
    tabShortcut.classList.toggle('active', isShortcut);
    tabWeb.setAttribute('aria-selected', isShortcut ? 'false' : 'true');
    tabShortcut.setAttribute('aria-selected', isShortcut ? 'true' : 'false');
    panelWeb.hidden = isShortcut;
    panelShortcut.hidden = !isShortcut;
  }
  tabWeb.addEventListener('click', function(){ activateTab('web'); });
  tabShortcut.addEventListener('click', function(){ activateTab('shortcut'); });
  try {
    var initParams = new URLSearchParams(window.location.search);
    if (window.location.hash === '#shortcut' || initParams.get('tab') === 'shortcut') {
      activateTab('shortcut');
    }
  } catch (_) {}

  /* Clipboard helper */
  function copyText(text, btn){
    function markDone(){
      var prev = btn.textContent;
      btn.textContent = '已复制';
      btn.classList.add('ok');
      setTimeout(function(){ btn.textContent = prev || '复制'; btn.classList.remove('ok'); }, 1800);
    }
    if(navigator.clipboard && window.isSecureContext){
      navigator.clipboard.writeText(text).then(markDone, fallback);
    } else { fallback(); }
    function fallback(){
      var t = document.createElement('textarea');
      t.value = text; t.setAttribute('readonly', '');
      t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(t); t.select(); t.setSelectionRange(0, text.length);
      try { document.execCommand('copy'); markDone(); } catch(e){ prompt('请手动复制：', text); }
      document.body.removeChild(t);
    }
  }
  document.querySelectorAll('[data-copy-target]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var target = document.getElementById(btn.getAttribute('data-copy-target'));
      if(target) copyText(target.textContent.trim(), btn);
    });
  });

  /* Browser device ID + License Key persistence */
  var DEVICE_ID_KEY = 'bdownloader_device_id';
  var LICENSE_KEY_STORE = 'bdownloader_license_key';
  var licInput = document.getElementById('testLicenseKey');
  var licDot = document.getElementById('licDot');
  var licSummary = document.getElementById('licSummary');
  var licDrawer = document.getElementById('licDrawer');
  var licDrawerStatus = document.getElementById('licDrawerStatus');
  var toggleLicBtn = document.getElementById('toggleLicDrawerBtn');
  var headerPortalLink = document.getElementById('headerPortalLink');

  function getOrCreateDeviceId(){
    try {
      var existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing && existing.trim()) return existing.trim();
      var rand = (crypto && crypto.randomUUID)
        ? 'web-' + crypto.randomUUID().slice(0, 12)
        : 'web-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
      localStorage.setItem(DEVICE_ID_KEY, rand);
      return rand;
    } catch (_) {
      return 'web-' + Date.now().toString(36);
    }
  }
  var deviceId = getOrCreateDeviceId();

  function readSavedLicense(){
    try { return (localStorage.getItem(LICENSE_KEY_STORE) || '').trim(); } catch (_) { return ''; }
  }
  function writeSavedLicense(key){
    try {
      if (key) localStorage.setItem(LICENSE_KEY_STORE, key);
      else localStorage.removeItem(LICENSE_KEY_STORE);
    } catch (_) {}
    if (licInput) licInput.value = key || '';
    var pwInput = document.getElementById('paywallKeyInput');
    if (pwInput && key) pwInput.value = key;
  }

  function updateLicenseBanner(state, text){
    if (!licDot || !licSummary) return;
    licDot.className = 'lic-dot' + (state === 'ok' ? ' ok' : (state === 'wait' ? ' wait' : ''));
    licSummary.textContent = text;
    if (toggleLicBtn) toggleLicBtn.textContent = state === 'ok' ? '更换授权码' : '激活授权码';
    if (headerPortalLink) headerPortalLink.hidden = state !== 'ok';
  }

  function authHeaders(extra){
    var h = Object.assign({}, extra || {});
    var tok = document.getElementById('testToken').value.trim();
    if (tok) h['Authorization'] = 'Bearer ' + tok;
    return h;
  }

  async function callLicenseEndpoint(path, key){
    var cleanKey = (key || '').trim();
    if (!cleanKey) throw new Error('请输入有效的授权码');
    var res = await fetch(path, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        licenseKey: cleanKey,
        instanceId: deviceId,
        instanceName: (navigator.platform || 'Web Browser').slice(0, 60)
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' 请求未授权');
    return await res.json();
  }

  async function activateAndPersistLicense(rawKey, statusTarget){
    var key = (rawKey || '').trim().toUpperCase();
    if (statusTarget) {
      statusTarget.classList.remove('err');
      statusTarget.textContent = '正在向 Stripe 验证并激活本设备...';
    }
    var data = await callLicenseEndpoint('/api/license/activate', key);
    if (!data.ok && !data.valid) {
      throw new Error(data.error || '授权码激活失败');
    }
    writeSavedLicense(key);
    var actText = data.activations && data.activations.max
      ? ' · 设备 ' + data.activations.used + '/' + data.activations.max
      : '';
    var masked = key.length > 9 ? key.slice(0, 5) + '••••' + key.slice(-4) : key;
    updateLicenseBanner('ok', 'Pro 已激活（' + masked + actText + '）');
    if (statusTarget) statusTarget.textContent = '已成功激活并保存授权码';
    return data;
  }

  async function refreshInitialLicenseStatus(){
    if (!cfg.stripePaywall) return;
    var urlKey = '';
    try {
      var p = new URLSearchParams(window.location.search);
      urlKey = (p.get('licenseKey') || p.get('license') || '').trim();
    } catch (_) {}

    if (urlKey) {
      try {
        await activateAndPersistLicense(urlKey, licDrawerStatus);
        if (licDrawer) licDrawer.hidden = false;
        return;
      } catch (err) {
        updateLicenseBanner('wait', '授权激活失败：' + (err.message || err));
        if (licDrawer) licDrawer.hidden = false;
        if (licDrawerStatus) {
          licDrawerStatus.classList.add('err');
          licDrawerStatus.textContent = err.message || String(err);
        }
        return;
      }
    }

    var saved = readSavedLicense();
    if (saved && licInput) licInput.value = saved;
    if (!saved) {
      updateLicenseBanner('idle', '未激活会员 · 1080P 及以下免费直下');
      return;
    }
    updateLicenseBanner('wait', '正在校验本地授权码...');
    try {
      var verify = await callLicenseEndpoint('/api/license/verify', saved);
      if (verify.ok || verify.valid) {
        var actText = verify.activations && verify.activations.max
          ? ' · 设备 ' + verify.activations.used + '/' + verify.activations.max
          : '';
        var masked = saved.length > 9 ? saved.slice(0, 5) + '••••' + saved.slice(-4) : saved;
        updateLicenseBanner('ok', 'Pro 已激活（' + masked + actText + '）');
      } else {
        updateLicenseBanner('wait', verify.error || '当前浏览器授权未生效');
      }
    } catch (_) {
      updateLicenseBanner('idle', '已保存授权码（待使用时校验）');
    }
  }

  if (toggleLicBtn && licDrawer) {
    toggleLicBtn.addEventListener('click', function(){
      licDrawer.hidden = !licDrawer.hidden;
    });
  }
  var btnActivateLic = document.getElementById('btnActivateLic');
  if (btnActivateLic) {
    btnActivateLic.addEventListener('click', async function(){
      try {
        await activateAndPersistLicense(licInput ? licInput.value : '', licDrawerStatus);
      } catch (err) {
        if (licDrawerStatus) {
          licDrawerStatus.classList.add('err');
          licDrawerStatus.textContent = err.message || String(err);
        }
      }
    });
  }
  var btnClearLic = document.getElementById('btnClearLic');
  if (btnClearLic) {
    btnClearLic.addEventListener('click', function(){
      writeSavedLicense('');
      updateLicenseBanner('idle', '未激活会员 · 1080P 及以下免费直下');
      if (licDrawerStatus) {
        licDrawerStatus.classList.remove('err');
        licDrawerStatus.textContent = '已清除本地保存的授权码';
      }
    });
  }

  /* Quality grid <-> hidden select sync */
  var testQnSelect = document.getElementById('testQn');
  var qualityBtns = document.querySelectorAll('.q-pill[data-qn]');
  function setSelectedQn(qn){
    testQnSelect.value = qn;
    qualityBtns.forEach(function(btn){
      var active = btn.getAttribute('data-qn') === qn;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  qualityBtns.forEach(function(btn){
    btn.addEventListener('click', function(){ setSelectedQn(btn.getAttribute('data-qn')); });
  });
  testQnSelect.addEventListener('change', function(){ setSelectedQn(testQnSelect.value); });

  /* Input helper buttons */
  var testInput = document.getElementById('testInput');
  document.getElementById('btnPasteInput').addEventListener('click', async function(){
    if (navigator.clipboard && navigator.clipboard.readText) {
      try {
        var txt = await navigator.clipboard.readText();
        if (txt) testInput.value = txt;
        return;
      } catch (_) {}
    }
    testInput.focus();
  });
  document.getElementById('btnSampleInput').addEventListener('click', function(){
    testInput.value = 'https://www.bilibili.com/video/BV1q3yyzUEiD/';
  });
  document.getElementById('btnClearInput').addEventListener('click', function(){
    testInput.value = '';
    testInput.focus();
  });

  /* Downloader logic (same API contract as Apple Shortcut!) */
  var statusEl = document.getElementById('testStatus');
  var paywallBox = document.getElementById('paywallBox');
  var paywallTitle = document.getElementById('paywallTitle');
  var paywallDesc = document.getElementById('paywallDesc');
  var paywallCheckoutBtn = document.getElementById('paywallCheckoutBtn');
  var paywallKeyInput = document.getElementById('paywallKeyInput');
  var resultCard = document.getElementById('resultCard');
  var resTitle = document.getElementById('resTitle');
  var resTags = document.getElementById('resTags');
  var downloadAnchor = document.getElementById('downloadAnchor');
  var pagePickerWrap = document.getElementById('pagePickerWrap');
  var pagePicker = document.getElementById('pagePicker');
  var previewPlayer = document.getElementById('previewPlayer');
  var resultCode = document.getElementById('proxyResultCode');
  var lastDownloadMode = false;

  function triggerBrowserDownload(proxyUrl, fileName){
    var a = document.createElement('a');
    a.href = proxyUrl;
    a.download = (fileName || 'bilibili-video') + '.mp4';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function renderResolvedResult(data){
    paywallBox.hidden = true;
    resultCard.hidden = false;
    resTitle.textContent = data.title || data.bvid || 'B 站视频';

    resTags.innerHTML = '';
    [
      data.bvid,
      data.qualityLabel || ('qn ' + data.qn),
      data.totalPages > 1 ? ('第 ' + data.page + '/' + data.totalPages + ' P') : ''
    ].filter(Boolean).forEach(function(label){
      var sp = document.createElement('span');
      sp.className = 'res-tag';
      sp.textContent = label;
      resTags.appendChild(sp);
    });

    downloadAnchor.href = data.proxyUrl;
    downloadAnchor.setAttribute('download', (data.fileName || 'bilibili-video') + '.mp4');
    resultCode.textContent = data.proxyUrl;

    var previewUrl = data.proxyUrl + (data.proxyUrl.indexOf('?') >= 0 ? '&' : '?') + 'inline=1';
    if (previewPlayer.getAttribute('src') !== previewUrl) {
      previewPlayer.setAttribute('src', previewUrl);
    }

    if (Array.isArray(data.pages) && data.pages.length > 1) {
      pagePicker.innerHTML = '';
      data.pages.forEach(function(item){
        var opt = document.createElement('option');
        opt.value = String(item.page);
        opt.textContent = 'P' + item.page + ' · ' + (item.part || ('分 P ' + item.page));
        if (Number(item.page) === Number(data.page)) opt.selected = true;
        pagePicker.appendChild(opt);
      });
      pagePickerWrap.hidden = false;
    } else {
      pagePickerWrap.hidden = true;
    }
  }

  function showPaywallPrompt(data){
    resultCard.hidden = true;
    paywallBox.hidden = false;
    paywallTitle.textContent = '需要会员授权以解锁该清晰度';
    paywallDesc.textContent = data.error || '当前清晰度属于 Stripe 会员权益，请开通或输入授权码继续。';
    if (data.checkoutUrl && /^https?:\\/\\//i.test(data.checkoutUrl)) {
      paywallCheckoutBtn.href = data.checkoutUrl;
    }
    var curKey = (licInput ? licInput.value : '') || readSavedLicense();
    if (curKey && paywallKeyInput) paywallKeyInput.value = curKey;
  }

  async function executeDownloadRequest(autoDownload){
    lastDownloadMode = Boolean(autoDownload);
    statusEl.classList.remove('err');
    paywallBox.hidden = true;

    var rawInput = testInput.value.trim();
    if (!rawInput) {
      statusEl.classList.add('err');
      statusEl.textContent = '请先输入 B 站视频链接、分享文案或 BV 号';
      return;
    }

    var pageVal = document.getElementById('testPage').value.trim();
    var qnVal = testQnSelect.value || '80';
    var licVal = (licInput ? licInput.value.trim() : '') || readSavedLicense();

    var busyBtns = [document.getElementById('btnResolve'), document.getElementById('btnDirectDl')];
    busyBtns.forEach(function(b){ b.disabled = true; });
    statusEl.textContent = Number(qnVal) >= 112
      ? '正在向服务端请求高画质与混流地址，若为 4K 视频可能需要几秒...'
      : '正在解析视频下载地址...';

    try {
      var res = await fetch('/api/download', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          bilibili: rawInput,
          qn: qnVal,
          ...(pageVal ? { p: pageVal } : {}),
          ...(licVal ? { licenseKey: licVal } : {}),
          instanceId: deviceId
        })
      });
      var data = await res.json();

      if (!res.ok || !data.ok) {
        if (data && data.checkoutUrl) {
          showPaywallPrompt(data);
          statusEl.classList.add('err');
          statusEl.textContent = data.error || '需要 Pro 会员授权';
          return;
        }
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }

      renderResolvedResult(data);
      if (autoDownload) {
        statusEl.textContent = '已开始下载：' + (data.title || '') + (data.qualityLabel ? '（' + data.qualityLabel + '）' : '');
        triggerBrowserDownload(data.proxyUrl, data.fileName);
      } else {
        statusEl.textContent = '解析成功：' + (data.title || '') + (data.qualityLabel ? '（' + data.qualityLabel + '），可直接点击播放或保存 MP4' : '');
      }
    } catch (err) {
      statusEl.classList.add('err');
      statusEl.textContent = err.message || String(err);
    } finally {
      busyBtns.forEach(function(b){ b.disabled = false; });
    }
  }

  document.getElementById('btnResolve').addEventListener('click', function(){ executeDownloadRequest(false); });
  document.getElementById('btnDirectDl').addEventListener('click', function(){ executeDownloadRequest(true); });
  pagePicker.addEventListener('change', function(){
    document.getElementById('testPage').value = pagePicker.value;
    executeDownloadRequest(false);
  });

  document.getElementById('btnPaywallActivate').addEventListener('click', async function(){
    try {
      await activateAndPersistLicense(paywallKeyInput.value, statusEl);
      await executeDownloadRequest(lastDownloadMode);
    } catch (err) {
      statusEl.classList.add('err');
      statusEl.textContent = err.message || String(err);
    }
  });
  document.getElementById('btnFallbackFree').addEventListener('click', function(){
    setSelectedQn('80');
    executeDownloadRequest(lastDownloadMode);
  });

  /* Shortcut update admin modal */
  var modal = document.getElementById('adminModal');
  var form = document.getElementById('adminForm');
  var adminHint = document.getElementById('adminHint');
  var adminStatus = document.getElementById('adminStatus');

  function fillForm(){
    form.elements.name.value = cfg.name || '';
    form.elements.updatedAt.value = cfg.updatedAt || '';
    form.elements.version.value = cfg.version || '';
    form.elements.build.value = String(cfg.build || 1);
    form.elements.icloudUrl.value = cfg.icloudUrl || '';
    form.elements.subtitle.value = cfg.subtitle || '';
    form.elements.notes.value = (cfg.notes || []).join('\\n');
    for(var i = 0; i < 3; i++){
      var h = (cfg.highlights && cfg.highlights[i]) || { title: '', subtitle: '', badge: '' };
      form.elements['h' + i + 't'].value = h.title || '';
      form.elements['h' + i + 's'].value = h.subtitle || '';
      form.elements['h' + i + 'b'].value = h.badge || '';
    }
    if(!cfg.editable){
      adminHint.textContent = '提示：当前未配置 ADMIN_TOKEN（或处于只读环境）。若要启用网页端保存，请在服务器 .env 中添加 ADMIN_TOKEN 并重启服务；也可直接编辑 NAS 上的 shortcut.json。';
    } else {
      adminHint.textContent = '修改后点击保存将实时写入 shortcut.json，Apple Shortcut 调用 /api/shortcut 时立即生效。';
    }
  }

  document.getElementById('openAdminBtn').addEventListener('click', function(){
    adminStatus.textContent = '';
    adminStatus.classList.remove('err');
    fillForm();
    if(typeof modal.showModal === 'function') modal.showModal();
  });
  document.getElementById('closeAdminBtn').addEventListener('click', function(){ modal.close(); });

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    adminStatus.classList.remove('err');
    adminStatus.textContent = '正在保存配置...';
    var tones = ['pink', 'blue', 'amber'];
    var highlights = [];
    for(var i = 0; i < 3; i++){
      var t = form.elements['h' + i + 't'].value.trim();
      var s = form.elements['h' + i + 's'].value.trim();
      var b = form.elements['h' + i + 'b'].value.trim();
      if(t && s){
        highlights.push({
          title: t,
          subtitle: s,
          badge: b,
          tone: (cfg.highlights && cfg.highlights[i] && cfg.highlights[i].tone) || tones[i]
        });
      }
    }
    var payload = {
      name: form.elements.name.value.trim(),
      badgePrefix: cfg.badgePrefix || '新版本',
      version: form.elements.version.value.trim(),
      build: Number(form.elements.build.value),
      updatedAt: form.elements.updatedAt.value.trim(),
      subtitle: form.elements.subtitle.value.trim(),
      icloudUrl: form.elements.icloudUrl.value.trim(),
      apiBaseUrl: cfg.apiBaseUrl || '',
      highlights: highlights,
      notes: form.elements.notes.value.split(/\\r?\\n/).map(function(x){ return x.trim(); }).filter(Boolean),
      helpGuideUrl: cfg.helpGuideUrl || ''
    };
    try{
      var res = await fetch('/api/shortcut', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Token': form.elements.adminToken.value.trim()
        },
        body: JSON.stringify(payload)
      });
      var text = await res.text();
      if(!res.ok) throw new Error(text || ('HTTP ' + res.status));
      adminStatus.textContent = '保存成功，正在刷新页面...';
      setTimeout(function(){ window.location.reload(); }, 400);
    } catch(err){
      adminStatus.classList.add('err');
      adminStatus.textContent = err.message || String(err);
    }
  });

  refreshInitialLicenseStatus();
})();
</script>
</body>
</html>`
}
