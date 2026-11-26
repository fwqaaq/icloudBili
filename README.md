# bilibili 视频下载快捷指令（Cloudflare Workers 版）

基于 **Hono + Cloudflare Workers** 重写的 Bilibili 视频解析与流式代理下载服务，内置 `Referer` 伪装、主备 CDN 自动回退、`Range` 断点续传，以及本地 Node / Deno 运行支持。

## 功能特性

- **代理下载绕过防盗链**：`/api/proxy` 由服务端附带 `Referer: https://www.bilibili.com/` 与浏览器 `User-Agent` 流式转发视频，支持 `Range` / `206` 断点续传及 `HEAD` 请求。
- **兼容快捷指令与直接下载**：
  - `GET /api/download?bilibili=...` 默认返回纯文本代理链接（`https://<你的域名>/api/proxy?...`），旧 iCloud 快捷指令只需修改域名即可直接保存视频。
  - 附加 `&raw=file` 参数可直接流式返回 MP4 视频文件。
- **解析增强**：自动从 B 站 App 分享文案提取链接，支持 `b23.tv` / `bili2233.cn` 短链重定向（保留 `?p=` 分 P）、`BV` 号与 `av` 号。
- **防盗刷与 SSRF 防护**：`/api/proxy` 仅接受 B 站视频参数由服务端解析官方 CDN 候选地址并做主机安全校验，不透传任意外部 `url=`；可选配置 `API_TOKEN` 进行访问鉴权。

> [!WARNING]
> Cloudflare Workers 位于海外边缘节点，部分 B 站海外 CDN 可能会因机房 IP 触发 `403` / `567` 拦截（代码已内置 `url + backup_url` 多节点自动重试）；此外 Workers 无法运行 `ffmpeg`，使用单流 MP4（未登录最高 `720P`，配置 `SESSION` 后部分视频支持 `1080P` MP4）。若遇到节点拦截，可使用下方本地 Node / Deno 启动方式。

---

## 部署到 Cloudflare Workers

### 1. 使用 Wrangler CLI 部署

```bash
pnpm install
npx wrangler login
npx wrangler deploy
```

如需下载 1080P（单流 MP4）或开启接口鉴权，通过 Wrangler Secrets 设置密钥（不要将密钥提交到仓库）：

```bash
# 填入 B 站 Cookie 中的 SESSDATA（可选）
npx wrangler secret put SESSION

# 启用 API 访问令牌（可选，配置后请求需带 ?token= 或 Authorization: Bearer <token>）
npx wrangler secret put API_TOKEN
```

### 2. 使用 GitHub Actions 自动部署

仓库中的 [deploy.yaml](file:///Users/fwqaaq/Project/icloudBili/.github/workflows/deploy.yaml) 已配置好自动测试与部署。在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 中添加：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

推送到 `main` 分支即会自动运行类型检查、单元测试并部署 Worker `bdownloader`。

---

## 自建服务器 / NAS Docker Compose 部署（推荐国内网络）

如果 Cloudflare Workers 节点触发 B 站 `412` 风控，推荐使用 [docker-compose.yml](file:///Users/fwqaaq/Project/icloudBili/docker-compose.yml) 在本地或 NAS 上部署：

```bash
cp .dev.vars.example .env
docker compose up -d --build
```

默认监听 `8787` 端口（若冲突可在 `.env` 设置 `HOST_PORT=8686`）：

```bash
curl -sG --data-urlencode "bilibili=https://www.bilibili.com/video/BV1q3yyzUEiD/" \
  "http://nas.wzszz.top:8787/api/download"
```

---

## 本地运行与开发

复制环境变量示例文件（可选，填入 `SESSION` / `API_TOKEN`）：

```bash
cp .dev.vars.example .dev.vars
```

三种本地运行方式（均默认监听 `8787` 端口）：

```bash
# 1. Cloudflare Workers 本地仿真环境
pnpm dev

# 2. 本地 Node.js（推荐用于国内直连环境）
pnpm dev:node

# 3. 本地 Deno
pnpm dev:deno
```

运行类型检查与单元测试：

```bash
pnpm typecheck
pnpm test
```

---

## 接口说明

| 接口 | 说明 | 参数 |
| --- | --- | --- |
| `GET /` | Apple 快捷指令安装与覆盖更新引导页（含折叠下载测试与管理弹窗） | — |
| `GET /api/shortcut` | 供 Apple Shortcut 自动检查更新的 JSON 接口 | — |
| `PUT /api/shortcut` | 热更新 `shortcut.json` 配置（需 `.env` 配置 `ADMIN_TOKEN`） | JSON Body、`X-Admin-Token` |
| `GET /api/health` | 服务健康检查 JSON | — |
| `GET /api/download` | 默认返回代理下载链接文本；传 `raw=file` 直接返回 MP4 文件 | `bilibili`（必填，分享文案/链接/BV/av）、`qn`（可选 `32\|64\|74\|80\|112\|116\|120`）、`p`（可选分 P）、`raw=file`、`token` |
| `GET /api/proxy` | 流式代理下载 MP4（支持 `Range` 与 `HEAD`） | `bilibili`（必填）、`qn`、`p`、`inline=1`、`token` |
| `GET /api/getreal` | 提取分享文案中的链接并还原 `b23.tv` 短链 | `bilibili`（必填） |

### Apple Shortcut 源码（Cherri）与构建
项目已在 [`shortcuts/bilibili.cherri`](shortcuts/bilibili.cherri) 提供完整的 Apple 快捷指令源码，并已预编译签名为 [`shortcuts/bilibili-downloader.shortcut`](shortcuts/bilibili-downloader.shortcut)，内置：
1. **启动自动检查更新**：请求 `GET /api/shortcut`，同时比对 `build > currentBuild` 与 `version != currentVersion`，若服务端版本不一致或更高则弹出更新说明并跳转更新引导页（`updatePageUrl`）。
2. **多渠道输入获取**：依次读取共享表单 `ShortcutInput`、剪贴板中的 B 站链接 / BV / av / 分享文案、或弹窗手动输入。
3. **解析与一键保存到相册**：请求 `GET /api/download?bilibili=...` 获取代理视频地址并下载保存到系统相册。

如需在修改 `currentVersion`、`currentBuild` 或 `baseUrl` 后重新编译签名（需已安装 `cherri` CLI）：

```bash
pnpm run shortcut:build
```

原 iCloud 快捷指令参考：[bilibili 视频下载](https://www.icloud.com/shortcuts/0069853090354b429da8677b1681ec39)
