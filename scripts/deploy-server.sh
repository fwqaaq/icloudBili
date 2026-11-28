#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CONFIG_FILE="$ROOT_DIR/.deploy.env"
CLI_SKIP_CHECK=false
CLI_SYNC_ENV=""
CLI_KEEP_SHORTCUT=""
DRY_RUN=false

log_info() { printf '[INFO] %s\n' "$*"; }
log_warn() { printf '[WARN] %s\n' "$*" >&2; }
log_err()  { printf '[ERROR] %s\n' "$*" >&2; }

usage() {
  cat <<'EOF'
用法: bash scripts/deploy-server.sh [选项]

从本机通过 SSH 将项目同步至远程服务器 / NAS，并执行 Docker Compose 重建与健康检查。

选项:
  -c, --config <path>   指定部署配置文件（默认: ./.deploy.env）
  --skip-check          跳过本地 TypeScript 类型检查与单元测试
  --sync-env            本次强制将本地 .env 同步覆盖到服务器
  --keep-shortcut       本次同步时保留服务器现有的 shortcut.json
  --dry-run             仅执行本地检查并输出部署计划，不修改远程服务器
  -h, --help            显示此帮助信息
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -c|--config)
      if [ $# -lt 2 ]; then
        log_err "选项 $1 需要指定配置文件路径"
        exit 1
      fi
      CONFIG_FILE="$2"
      shift 2
      ;;
    --skip-check)
      CLI_SKIP_CHECK=true
      shift
      ;;
    --sync-env)
      CLI_SYNC_ENV="true"
      shift
      ;;
    --keep-shortcut)
      CLI_KEEP_SHORTCUT="true"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_err "未知参数: $1"
      usage
      exit 1
      ;;
  esac
done

DEPLOY_HOST=""
DEPLOY_USER=""
DEPLOY_PORT="22"
DEPLOY_SSH_KEY=""
DEPLOY_DIR=""
DEPLOY_COMPOSE_CMD=""
DEPLOY_SYNC_ENV="false"
DEPLOY_ENV_FILE=".env"
DEPLOY_KEEP_REMOTE_SHORTCUT="false"
DEPLOY_HEALTH_URL=""
DEPLOY_HEALTH_TIMEOUT="45"

trim_ws() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

is_true() {
  case "$(trim_ws "$1")" in
    true|TRUE|True|1|yes|YES|Yes) return 0 ;;
    *) return 1 ;;
  esac
}

parse_deploy_env() {
  local file="$1"
  local raw_line line key val len
  while IFS= read -r raw_line || [ -n "$raw_line" ]; do
    line="${raw_line%$'\r'}"
    line="$(trim_ws "$line")"
    [ -z "$line" ] && continue
    case "$line" in
      \#*) continue ;;
    esac
    case "$line" in
      *=*)
        key="$(trim_ws "${line%%=*}")"
        val="$(trim_ws "${line#*=}")"
        len="${#val}"
        if [ "$len" -ge 2 ]; then
          case "$val" in
            \"*\") val="${val:1:$((len - 2))}" ;;
            \'*\') val="${val:1:$((len - 2))}" ;;
          esac
        fi
        case "$key" in
          DEPLOY_HOST|DEPLOY_USER|DEPLOY_PORT|DEPLOY_SSH_KEY|DEPLOY_DIR|DEPLOY_COMPOSE_CMD|DEPLOY_SYNC_ENV|DEPLOY_ENV_FILE|DEPLOY_KEEP_REMOTE_SHORTCUT|DEPLOY_HEALTH_URL|DEPLOY_HEALTH_TIMEOUT)
            printf -v "$key" '%s' "$val"
            ;;
        esac
        ;;
    esac
  done < "$file"
}

if [ ! -f "$CONFIG_FILE" ]; then
  log_err "未找到部署配置文件: $CONFIG_FILE"
  log_err "请先执行: cp .deploy.env.example .deploy.env 并填写服务器信息"
  exit 1
fi

parse_deploy_env "$CONFIG_FILE"

[ -n "$CLI_SYNC_ENV" ] && DEPLOY_SYNC_ENV="$CLI_SYNC_ENV"
[ -n "$CLI_KEEP_SHORTCUT" ] && DEPLOY_KEEP_REMOTE_SHORTCUT="$CLI_KEEP_SHORTCUT"

if [ -z "$DEPLOY_HOST" ] || [ "$DEPLOY_HOST" = "your-nas-or-server" ]; then
  log_err "请在 $CONFIG_FILE 中配置有效的 DEPLOY_HOST"
  exit 1
fi

if [ -z "$DEPLOY_DIR" ] || [ "$DEPLOY_DIR" = "/" ] || [ "$DEPLOY_DIR" = "." ]; then
  log_err "DEPLOY_DIR 必须是非根目录的明确部署路径（如 /opt/bdownloader）"
  exit 1
fi

case "$DEPLOY_HEALTH_TIMEOUT" in
  ''|*[!0-9]*)
    log_err "DEPLOY_HEALTH_TIMEOUT 必须是正整数: $DEPLOY_HEALTH_TIMEOUT"
    exit 1
    ;;
esac

if [ "$CLI_SKIP_CHECK" = false ]; then
  log_info "运行本地 TypeScript 类型检查与单元测试..."
  if command -v pnpm >/dev/null 2>&1; then
    pnpm run typecheck
    pnpm test
  else
    ./node_modules/.bin/tsc --noEmit
    node --test tests/*.test.ts
  fi
else
  log_warn "已跳过本地类型检查与单元测试（--skip-check）"
fi

EXCLUDES=(
  ".git"
  "node_modules"
  ".wrangler"
  ".env"
  ".env.*"
  ".dev.vars"
  ".deploy.env"
  ".deploy.*.env"
  "docker-compose.override.yml"
  "package-lock.json"
  "*.mp4"
  "*.log"
  ".DS_Store"
  "*_processed.cherri"
  "shortcuts/*.plist"
  "shortcuts/*_unsigned.shortcut"
)
if is_true "$DEPLOY_KEEP_REMOTE_SHORTCUT"; then
  EXCLUDES+=("shortcut.json")
fi

SSH_TARGET="$DEPLOY_HOST"
[ -n "$DEPLOY_USER" ] && SSH_TARGET="${DEPLOY_USER}@${DEPLOY_HOST}"

LOCAL_ENV_PATH="$DEPLOY_ENV_FILE"
case "$LOCAL_ENV_PATH" in
  /*) ;;
  *) LOCAL_ENV_PATH="$ROOT_DIR/$LOCAL_ENV_PATH" ;;
esac

if is_true "$DEPLOY_SYNC_ENV" && [ ! -f "$LOCAL_ENV_PATH" ]; then
  log_err "已启用 DEPLOY_SYNC_ENV，但找不到本地环境变量文件: $LOCAL_ENV_PATH"
  exit 1
fi

if [ "$DRY_RUN" = true ]; then
  log_info "[DRY-RUN] 目标主机: $SSH_TARGET (端口: ${DEPLOY_PORT:-22})"
  log_info "[DRY-RUN] 远程目录: $DEPLOY_DIR"
  log_info "[DRY-RUN] 同步本地 .env: $DEPLOY_SYNC_ENV ($LOCAL_ENV_PATH)"
  log_info "[DRY-RUN] 保留远程 shortcut.json: $DEPLOY_KEEP_REMOTE_SHORTCUT"
  log_info "[DRY-RUN] 排除列表: ${EXCLUDES[*]}"
  log_info "[DRY-RUN] 未对服务器执行任何修改"
  exit 0
fi

CONTROL_PATH="/tmp/bdownloader-ssh-$$.sock"
SSH_OPTS=(
  -o "ControlMaster=auto"
  -o "ControlPersist=120"
  -o "ControlPath=$CONTROL_PATH"
  -o "ConnectTimeout=10"
  -o "ServerAliveInterval=15"
)
[ -n "$DEPLOY_PORT" ] && SSH_OPTS+=(-p "$DEPLOY_PORT")

if [ -n "$DEPLOY_SSH_KEY" ]; then
  case "$DEPLOY_SSH_KEY" in
    \~/*) DEPLOY_SSH_KEY="$HOME/${DEPLOY_SSH_KEY#\~/}" ;;
  esac
  if [ ! -f "$DEPLOY_SSH_KEY" ]; then
    log_err "找不到指定的 SSH 私钥: $DEPLOY_SSH_KEY"
    exit 1
  fi
  SSH_OPTS+=(-i "$DEPLOY_SSH_KEY")
fi

cleanup() {
  ssh "${SSH_OPTS[@]}" -O exit "$SSH_TARGET" >/dev/null 2>&1 || true
  rm -f "$CONTROL_PATH"
}
trap cleanup EXIT

log_info "测试 SSH 连接并建立复用通道: $SSH_TARGET"
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "true"

REMOTE_DIR_Q=""
printf -v REMOTE_DIR_Q '%q' "$DEPLOY_DIR"

log_info "确保远程部署目录存在: $DEPLOY_DIR"
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "mkdir -p $REMOTE_DIR_Q"

if command -v rsync >/dev/null 2>&1 && ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "command -v rsync >/dev/null 2>&1"; then
  log_info "使用 rsync 增量同步项目文件..."
  RSYNC_EXCLUDES=()
  for pat in "${EXCLUDES[@]}"; do
    RSYNC_EXCLUDES+=(--exclude="$pat")
  done
  RSYNC_SSH="ssh"
  for opt in "${SSH_OPTS[@]}"; do
    RSYNC_SSH="$RSYNC_SSH $(printf '%q' "$opt")"
  done
  rsync -az --delete "${RSYNC_EXCLUDES[@]}" -e "$RSYNC_SSH" "$ROOT_DIR/" "${SSH_TARGET}:${DEPLOY_DIR}/"
else
  log_info "远程或本地未检测到 rsync，回退使用 tar 流式同步..."
  TAR_EXCLUDES=()
  for pat in "${EXCLUDES[@]}"; do
    TAR_EXCLUDES+=(--exclude="$pat")
  done
  COPYFILE_DISABLE=1 tar "${TAR_EXCLUDES[@]}" -czf - -C "$ROOT_DIR" . \
    | ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "tar -xzf - -C $REMOTE_DIR_Q"
fi

if is_true "$DEPLOY_SYNC_ENV"; then
  log_info "同步本地环境变量文件至服务器: $LOCAL_ENV_PATH -> ${DEPLOY_DIR}/.env"
  ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "cat > $REMOTE_DIR_Q/.env && chmod 600 $REMOTE_DIR_Q/.env" < "$LOCAL_ENV_PATH"
fi

REMOTE_COMPOSE_Q=""
[ -n "$DEPLOY_COMPOSE_CMD" ] && printf -v REMOTE_COMPOSE_Q '%q' "$DEPLOY_COMPOSE_CMD"

log_info "在远程服务器构建、启动容器并等待健康检查（超时 ${DEPLOY_HEALTH_TIMEOUT}s）..."
REMOTE_DEPLOY_SCRIPT=$(cat <<EOF
set -euo pipefail
export PATH="\$PATH:/usr/local/bin:/usr/sbin:/opt/bin:/opt/homebrew/bin"
cd $REMOTE_DIR_Q

if [ ! -f ".env" ] && [ -f ".dev.vars.example" ]; then
  cp .dev.vars.example .env
  echo "[WARN] 远程目录此前无 .env，已从 .dev.vars.example 初始化（请按需填入 SESSION / API_TOKEN / ADMIN_TOKEN）"
fi

COMPOSE_CMD=${REMOTE_COMPOSE_Q}
if [ -z "\$COMPOSE_CMD" ]; then
  if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
  else
    echo "[ERROR] 远程服务器未找到 docker compose 或 docker-compose" >&2
    exit 1
  fi
fi

\$COMPOSE_CMD up -d --build --force-recreate

HOST_PORT="8787"
if [ -f ".env" ]; then
  parsed_port="\$(grep -E '^[[:space:]]*HOST_PORT=' .env | tail -n 1 | cut -d '=' -f 2- | tr -d '[:space:]\"'\''\r' || true)"
  [ -n "\$parsed_port" ] && HOST_PORT="\$parsed_port"
fi

probe_local() {
  local path="\$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "http://127.0.0.1:\${HOST_PORT}\${path}"
  else
    docker exec bdownloader node -e "fetch('http://127.0.0.1:8787' + process.argv[1]).then(async r => { if (!r.ok) process.exit(1); process.stdout.write(await r.text()); }).catch(() => process.exit(1))" "\$path"
  fi
}

deadline=\$(( \$(date +%s) + $DEPLOY_HEALTH_TIMEOUT ))
while true; do
  if health_json="\$(probe_local '/api/health' 2>/dev/null)"; then
    echo "[INFO] 远程服务健康检查通过（端口 \${HOST_PORT}）: \$health_json"
    if shortcut_json="\$(probe_local '/api/shortcut' 2>/dev/null)"; then
      echo "[INFO] 当前线上快捷指令配置: \$shortcut_json"
    fi
    exit 0
  fi
  if [ "\$(date +%s)" -ge "\$deadline" ]; then
    echo "[ERROR] 等待健康检查超时，输出最近 60 行容器日志：" >&2
    \$COMPOSE_CMD logs --tail=60 bdownloader || docker logs --tail=60 bdownloader || true
    exit 1
  fi
  sleep 2
done
EOF
)
ssh "${SSH_OPTS[@]}" "$SSH_TARGET" "bash -s" <<EOF
$REMOTE_DEPLOY_SCRIPT
EOF

if [ -n "$DEPLOY_HEALTH_URL" ]; then
  EXT_URL="${DEPLOY_HEALTH_URL%/}/api/health"
  log_info "校验外部访问地址: $EXT_URL"
  if ext_resp="$(curl -fsS --max-time 10 "$EXT_URL")"; then
    log_info "外部入口校验通过: $ext_resp"
  else
    log_warn "外部地址校验失败，请检查反代或防火墙配置: $EXT_URL"
  fi
fi

log_info "部署完成。"
