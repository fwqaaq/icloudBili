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

export function renderShortcutPage(
  config: ShortcutConfig,
  options: {
    origin: string
    editable: boolean
    requiresApiToken: boolean
    stripePaywall?: boolean
    checkoutUrl?: string
    dash4k?: boolean
  }
): string {
  const safeName = escapeHtml(config.name)
  const safeVersion = escapeHtml(config.version)
  const safeBadge = escapeHtml(config.badgePrefix)
  const safeDate = escapeHtml(config.updatedAt)
  const safeSubtitle = escapeHtml(config.subtitle)
  const safeIcloudUrl = escapeHtml(config.icloudUrl)
  const safeApiCheckUrl = escapeHtml(`${options.origin}/api/shortcut`)
  const safeHelpGuideUrl = config.helpGuideUrl
    ? escapeHtml(config.helpGuideUrl)
    : ''

  const titleSegments = config.name.split(' ')
  const headingHtml =
    titleSegments.length > 1
      ? `<span>${escapeHtml(titleSegments[0])}</span> ${escapeHtml(titleSegments.slice(1).join(' '))}`
      : `<span>${safeName}</span>`

  const featuresHtml = config.highlights
    .map((item, idx) => {
      const badgeHtml = item.badge
        ? `<span class="tag">${escapeHtml(item.badge)}</span>`
        : ''
      return `<div class="feat">
        <div class="ic ${toneClass(item.tone, idx)}">${renderHighlightIcon(idx)}</div>
        <b>${escapeHtml(item.title)}${badgeHtml}</b>
        <small>${escapeHtml(item.subtitle)}</small>
      </div>`
    })
    .join('')

  const notesHtml = config.notes
    .map((note) => `<li>${escapeHtml(note)}</li>`)
    .join('')

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
          2. 若系统提示安全限制，请前往 <b>设置 → 快捷指令 → 高级</b> 检查相应共享与访问权限；<br>
          3. 若仍走旧服务域名，请编辑快捷指令中的请求地址为：<code>${escapeHtml(options.origin)}/api/download</code>。
        </div>
      </details>`

  const initialPayload = escapeJsonForScript({
    ...config,
    editable: options.editable,
    requiresApiToken: options.requiresApiToken,
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
<title>${safeName} · 快捷指令</title>
<style>
  :root{
    color-scheme:light dark;
    --brand:#fb7299;
    --brand-2:#ff8fb0;
    --brand-deep:#e04b78;
    --bili-blue:#00aeec;
    --bg:#f5f6fa;
    --card:rgba(255,255,255,.8);
    --card-solid:#ffffff;
    --line:rgba(24,25,28,.08);
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
      --card:rgba(26,29,38,.78);
      --card-solid:#181b24;
      --line:rgba(255,255,255,.09);
      --text:#f1f2f6;
      --muted:#9aa0ad;
      --ios-blue:#0a84ff;
      --ios-red:#ff453a;
      --ios-green:#30d158;
      --shadow:0 1px 2px rgba(0,0,0,.35),0 12px 38px rgba(0,0,0,.42);
    }
  }
  *{box-sizing:border-box;margin:0;padding:0}
  html{-webkit-text-size-adjust:100%}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","PingFang SC","Helvetica Neue",sans-serif;
    background:var(--bg);color:var(--text);line-height:1.55;
    -webkit-font-smoothing:antialiased;min-height:100dvh;overflow-x:hidden;
  }
  .glow{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
  .glow i{position:absolute;border-radius:50%;filter:blur(82px);opacity:.42}
  .glow i:nth-child(1){width:400px;height:400px;background:#ff85ab;top:-150px;left:-120px;animation:float 15s ease-in-out infinite}
  .glow i:nth-child(2){width:360px;height:360px;background:#59d2ff;top:110px;right:-150px;opacity:.34;animation:float 19s ease-in-out infinite reverse}
  .glow i:nth-child(3){width:300px;height:300px;background:#ffa76d;bottom:-130px;left:18%;opacity:.22;animation:float 22s ease-in-out infinite}
  @media (prefers-color-scheme:dark){.glow i{opacity:.22}.glow i:nth-child(2){opacity:.16}.glow i:nth-child(3){opacity:.12}}
  @keyframes float{0%,100%{transform:translate(0,0)}50%{transform:translate(26px,36px)}}

  .wrap{
    max-width:520px;margin:0 auto;
    padding:calc(44px + env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) calc(40px + env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left));
  }

  .hero{text-align:center;animation:rise .6s cubic-bezier(.2,.8,.2,1) both}
  .icon{
    width:104px;height:104px;border-radius:24px;display:block;margin:0 auto 20px;
    box-shadow:0 14px 32px rgba(251,114,153,.35),0 4px 12px rgba(0,174,236,.22);
  }
  .badge{
    display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;
    color:var(--brand-deep);background:rgba(251,114,153,.13);padding:5px 13px;border-radius:999px;margin-bottom:14px;
    font-variant-numeric:tabular-nums;
  }
  @media (prefers-color-scheme:dark){.badge{color:#ff94b5;background:rgba(251,114,153,.18)}}
  .badge::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 3px rgba(251,114,153,.22);animation:pulse 2s infinite}
  @keyframes pulse{50%{box-shadow:0 0 0 6px rgba(251,114,153,0)}}

  h1{font-size:31px;font-weight:800;letter-spacing:-.02em;line-height:1.18}
  h1 span{
    background:linear-gradient(120deg,var(--brand-deep),var(--brand) 52%,var(--bili-blue));
    -webkit-background-clip:text;background-clip:text;color:transparent;
  }
  @media (prefers-color-scheme:dark){
    h1 span{background:linear-gradient(120deg,#ff90b3,#70dcff);-webkit-background-clip:text;background-clip:text}
  }
  .sub{color:var(--muted);font-size:15px;margin-top:10px}

  .cta{
    display:flex;align-items:center;justify-content:center;gap:10px;margin:28px auto 12px;
    height:54px;max-width:340px;border-radius:16px;text-decoration:none;
    color:#fff;font-size:17px;font-weight:700;letter-spacing:.01em;
    background:linear-gradient(135deg,var(--brand) 0%,var(--brand-deep) 55%,#0099db 100%);
    box-shadow:0 10px 24px rgba(251,114,153,.34),inset 0 1px 0 rgba(255,255,255,.28);
    transition:transform .14s ease,box-shadow .2s ease;position:relative;overflow:hidden;
  }
  .cta::after{
    content:"";position:absolute;top:0;left:-60%;width:40%;height:100%;
    background:linear-gradient(100deg,transparent,rgba(255,255,255,.32),transparent);
    transform:skewX(-20deg);animation:shine 3.4s ease-in-out infinite;
  }
  @keyframes shine{0%,62%{left:-60%}100%{left:130%}}
  .cta:active{transform:scale(.97);box-shadow:0 4px 12px rgba(251,114,153,.3)}
  .cta svg{width:20px;height:20px}
  .meta{font-size:12.5px;color:var(--muted);text-align:center}

  .card{
    background:var(--card);border:1px solid var(--line);border-radius:var(--radius);
    box-shadow:var(--shadow);padding:22px;margin-top:18px;
    animation:rise .6s cubic-bezier(.2,.8,.2,1) both;
  }
  @supports (backdrop-filter:blur(20px)) or (-webkit-backdrop-filter:blur(20px)){
    .card{backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px)}
  }
  .card:nth-of-type(1){animation-delay:.06s}.card:nth-of-type(2){animation-delay:.12s}
  .card:nth-of-type(3){animation-delay:.18s}.card:nth-of-type(4){animation-delay:.24s}
  @keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}

  .card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
  .card-h h2{font-size:17px;font-weight:700}
  .card-h time{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}

  .features{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
  .feat{
    background:var(--card-solid);border:1px solid var(--line);border-radius:16px;
    padding:15px 8px 13px;text-align:center;
  }
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

  .guide-tip{font-size:14.5px;color:var(--muted);margin-bottom:16px}
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

  .copy{
    margin-top:10px;display:flex;align-items:center;gap:8px;background:var(--card-solid);
    border:1px solid var(--line);border-radius:12px;padding:6px 6px 6px 12px;
  }
  .copy code{flex:1;min-width:0;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .copy button,.btn-mini{
    flex:none;border:0;cursor:pointer;font:600 13px/1 inherit;font-family:inherit;color:#fff;
    background:var(--brand-deep);padding:9px 14px;border-radius:9px;transition:background .2s,transform .1s;min-height:34px;
  }
  .copy button:active,.btn-mini:active{transform:scale(.95)}
  .copy button.ok{background:var(--ios-green)}

  details.test-card summary{
    list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;
    font-size:16px;font-weight:700;user-select:none;
  }
  details.test-card summary::-webkit-details-marker{display:none}
  details.test-card summary span{font-size:12.5px;font-weight:500;color:var(--muted)}
  .test-body{margin-top:16px;padding-top:16px;border-top:1px solid var(--line);display:grid;gap:10px}
  .field-row{display:grid;grid-template-columns:1fr 90px;gap:8px}
  .input,select,textarea{
    width:100%;border:1px solid var(--line);border-radius:12px;background:var(--card-solid);
    color:var(--text);font:14px/1.45 inherit;padding:10px 12px;outline:none;
  }
  .input:focus,select:focus,textarea:focus{border-color:var(--bili-blue)}
  textarea{resize:vertical;min-height:74px}
  .actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .btn{
    border:0;border-radius:12px;padding:11px 14px;font:600 14px/1.2 inherit;cursor:pointer;
    transition:transform .12s ease,opacity .2s ease;min-height:44px;
  }
  .btn:active{transform:scale(.97)}
  .btn:disabled{opacity:.55;cursor:not-allowed}
  .btn-primary{background:linear-gradient(135deg,var(--brand),var(--brand-deep));color:#fff}
  .btn-secondary{background:rgba(0,174,236,.14);color:var(--bili-blue)}
  .test-status{font-size:13px;color:var(--muted);min-height:18px;word-break:break-all}
  .test-status.err{color:var(--ios-red)}

  footer{
    text-align:center;font-size:12px;color:var(--muted);margin-top:28px;
    display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 14px;
  }
  .foot-btn{
    background:none;border:0;color:var(--muted);font:inherit;cursor:pointer;text-decoration:underline;
    padding:4px 2px;
  }
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

  @media (max-width:380px){
    h1{font-size:27px}
    .features{gap:8px}
    .feat small{font-size:10.5px}
    .actions,.form-2,.field-row{grid-template-columns:1fr}
  }
  @media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}
  @media (prefers-reduced-transparency:reduce){.card{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:var(--card-solid)}}
</style>
</head>
<body>
<div class="glow" aria-hidden="true"><i></i><i></i><i></i></div>

<main class="wrap">
  <header class="hero">
    <div class="icon" aria-hidden="true">${APP_ICON_SVG}</div>
    <div class="badge">${safeBadge} · v${safeVersion} · ${safeDate} 更新</div>
    <h1>${headingHtml}</h1>
    <p class="sub">${safeSubtitle}</p>

    <a class="cta" id="ctaLink" href="${safeIcloudUrl}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/></svg>
      立即获取快捷指令
    </a>
    <p class="meta">适用于 iPhone / iPad · 需在 Safari 中打开</p>
  </header>

  <section class="card">
    <div class="card-h">
      <h2>本次更新</h2>
      <time datetime="${safeDate}">v${safeVersion} · ${safeDate}</time>
    </div>
    <div class="features">${featuresHtml}</div>
    <ul class="notes">${notesHtml}</ul>
  </section>

  <section class="card">
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
  </section>

  <section class="card">
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
  </section>

  <details class="card test-card">
    <summary>
      网页端快速下载测试
      <span>支持分享文案 / BV / av / 分P</span>
    </summary>
    <div class="test-body">
      <textarea id="testInput" placeholder="粘贴 B 站视频链接、b23.tv 短链、App 分享文案或 BV 号（例如 https://www.bilibili.com/video/BV1q3yyzUEiD/）"></textarea>
      <div class="field-row">
        <select id="testQn">
          <option value="80">自动最高 · 免费 (1080P/720P)</option>
          <option value="64">720P 高清 · 免费 (64)</option>
          <option value="32">480P 清晰 · 省流 (32)</option>
          <option value="112">1080P+ 高码率 · 会员 (112)</option>
          <option value="116">1080P60 高帧率 · 会员 (116)</option>
          <option value="120">4K 超清 · 会员 (120)${options.dash4k === false ? ' [当前节点未启用 ffmpeg]' : ''}</option>
        </select>
        <input class="input" id="testPage" type="number" min="1" placeholder="分P">
      </div>
      <input class="input" id="testLicenseKey" type="text" placeholder="会员 License Key（1080P+ / 1080P60 / 4K 需要，可留空）" style="${options.stripePaywall ? '' : 'display:none'}">
      <input class="input" id="testToken" type="password" placeholder="API_TOKEN（未配置可留空）" style="${options.requiresApiToken ? '' : 'display:none'}">
      <div class="actions">
        <button type="button" class="btn btn-secondary" id="btnResolve">解析代理链接</button>
        <button type="button" class="btn btn-primary" id="btnDirectDl">直接下载 MP4</button>
      </div>
      <div class="copy" id="proxyResultBox" style="display:none;margin-top:2px">
        <code id="proxyResultCode"></code>
        <button type="button" data-copy-target="proxyResultCode">复制</button>
      </div>
      <div class="test-status" id="testStatus"></div>
    </div>
  </details>

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
    <div class="test-status" id="adminStatus"></div>
    <button type="submit" class="btn btn-primary" id="saveAdminBtn">保存并立即生效</button>
  </form>
</dialog>

<script id="initialConfig" type="application/json">${initialPayload}</script>
<script>
(function(){
  var cfg = JSON.parse(document.getElementById('initialConfig').textContent);

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

  var licInput = document.getElementById('testLicenseKey');
  try {
    var savedLic = localStorage.getItem('bdownloader_license_key');
    if (savedLic && licInput) licInput.value = savedLic;
  } catch (_) {}
  if (licInput) {
    licInput.addEventListener('input', function(){
      try { localStorage.setItem('bdownloader_license_key', licInput.value.trim()); } catch (_) {}
    });
  }

  function buildDownloadUrl(raw, formatJson){
    var input = document.getElementById('testInput').value.trim();
    if(!input) throw new Error('请先输入 B 站视频链接、分享文案或 BV 号');
    var url = new URL('/api/download', window.location.origin);
    url.searchParams.set('bilibili', input);
    url.searchParams.set('qn', document.getElementById('testQn').value);
    var page = document.getElementById('testPage').value.trim();
    if(page) url.searchParams.set('p', page);
    var token = document.getElementById('testToken').value.trim();
    if(token) url.searchParams.set('token', token);
    var lic = licInput ? licInput.value.trim() : '';
    if(lic) url.searchParams.set('license_key', lic);
    if(raw) url.searchParams.set('raw', 'file');
    if(formatJson) url.searchParams.set('format', 'json');
    return url.toString();
  }

  var statusEl = document.getElementById('testStatus');
  var resultBox = document.getElementById('proxyResultBox');
  var resultCode = document.getElementById('proxyResultCode');

  function showCheckoutHint(msg, checkoutUrl){
    statusEl.classList.add('err');
    statusEl.textContent = msg + ' ';
    if(checkoutUrl && /^https?:\/\//i.test(checkoutUrl)){
      var a = document.createElement('a');
      a.href = checkoutUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'link';
      a.textContent = '前往 Stripe 开通会员 →';
      statusEl.appendChild(a);
    }
  }

  document.getElementById('btnResolve').addEventListener('click', async function(){
    statusEl.classList.remove('err');
    resultBox.style.display = 'none';
    try{
      var url = buildDownloadUrl(false, true);
      statusEl.textContent = '正在解析视频地址...';
      var res = await fetch(url);
      var data = await res.json();
      if(!res.ok || !data.ok){
        if(data && data.checkoutUrl){
          showCheckoutHint(data.error || '需要会员授权', data.checkoutUrl);
          return;
        }
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }
      resultCode.textContent = data.proxyUrl;
      resultBox.style.display = 'flex';
      statusEl.textContent = '解析成功：' + (data.title || '') + (data.qualityLabel ? '（' + data.qualityLabel + '）' : '');
    } catch(err){
      statusEl.classList.add('err');
      statusEl.textContent = err.message || String(err);
    }
  });

  document.getElementById('btnDirectDl').addEventListener('click', async function(){
    statusEl.classList.remove('err');
    try{
      var url = buildDownloadUrl(false, true);
      statusEl.textContent = '正在准备下载...';
      var res = await fetch(url);
      var data = await res.json();
      if(!res.ok || !data.ok){
        if(data && data.checkoutUrl){
          showCheckoutHint(data.error || '需要会员授权', data.checkoutUrl);
          return;
        }
        throw new Error((data && data.error) || ('HTTP ' + res.status));
      }
      statusEl.textContent = '已触发下载：' + (data.title || '') + (data.qualityLabel ? '（' + data.qualityLabel + '）' : '') + '，若视频较大请稍候...';
      window.location.href = data.proxyUrl;
    } catch(err){
      statusEl.classList.add('err');
      statusEl.textContent = err.message || String(err);
    }
  });

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

  document.getElementById('closeAdminBtn').addEventListener('click', function(){
    modal.close();
  });

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
})();
</script>
</body>
</html>`
}
