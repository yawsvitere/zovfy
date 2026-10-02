#!/usr/bin/env bash
set -euo pipefail
umask 077

APP_DIR=/opt/zovfy
RAW_BASE=https://raw.githubusercontent.com/yawsvitere/zovfy/master

if [ "$(id -u)" -ne 0 ]; then
  echo "Запусти от root: sudo bash install.sh" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update
    apt-get install -y ca-certificates curl
  else
    echo "Установи curl и запусти скрипт повторно." >&2
    exit 1
  fi
fi

if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

if ! docker compose version >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y docker-compose-plugin
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin не найден." >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "Установи openssl и запусти скрипт повторно." >&2
  exit 1
fi

mkdir -p "$APP_DIR"
cd "$APP_DIR"

download_file() {
  local name="$1"
  local destination="$2"
  curl -fsSL "$RAW_BASE/$name" -o "$destination.tmp"
  mv "$destination.tmp" "$destination"
}

download_file compose.production.yaml compose.production.yaml
download_file .env.production.example .env.production.example

if [ ! -f .env ]; then
  if [ ! -r /dev/tty ]; then
    echo "Нужен интерактивный терминал для первоначальной настройки .env." >&2
    exit 1
  fi

  read -rp "Origin сайта (https://music.example.com или http://IP:3000): " PUBLIC_ORIGIN </dev/tty
  read -rp "Email администратора (можно оставить пустым): " ADMIN_EMAIL </dev/tty

  case "$PUBLIC_ORIGIN" in
    http://*|https://*) ;;
    *)
      echo "Origin должен начинаться с http:// или https://" >&2
      exit 1
      ;;
  esac

  cp .env.production.example .env

  set_env() {
    local key="$1"
    local value="$2"
    local escaped
    escaped=$(printf '%s' "$value" | sed 's/[\\&|]/\\&/g')
    sed -i "s|^${key}=.*|${key}=${escaped}|" .env
  }

  set_env JWT_KEY "$(openssl rand -hex 32)"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env MINIO_ROOT_PASSWORD "$(openssl rand -hex 24)"
  set_env PUBLIC_ORIGIN "$PUBLIC_ORIGIN"
  set_env ADMIN_EMAIL "$ADMIN_EMAIL"
fi

chmod 600 .env

if ! docker compose -f compose.production.yaml pull; then
  echo "Если образы в GHCR приватные, выполни docker login ghcr.io и запусти скрипт повторно." >&2
  exit 1
fi

docker compose -f compose.production.yaml up -d
docker compose -f compose.production.yaml ps