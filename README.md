# Zovfy

## Стек

- ASP.NET Core 9, EF Core 9, PostgreSQL и Npgsql
- ASP.NET Identity с GUID-ключами, JWT Bearer
- MinIO с S3 API для файлов
- SignalR для realtime-событий
- Swagger в Development
- React 19, TypeScript, Vite и обычный CSS
- Docker Compose для локальной инфраструктуры

## Быстрый запуск

Нужен Docker Desktop с Compose v2.

```powershell
Copy-Item .env.example .env
docker compose up -d postgres minio api
cd src/Zovfy.Web
npm ci
npm run dev
```

После запуска:

- Frontend (Vite): http://localhost:5173
- Swagger: http://localhost:8081/swagger
- MinIO Console: http://localhost:9001
- API health: http://localhost:8081/api/health

Во время разработки frontend работает отдельно от Docker; Vite проксирует `/api` и `/hubs` на API по адресу `http://localhost:8081`.

Локальные учётные данные MinIO заданы в `.env.example`. Для любой общей или production-среды замените их и `JWT_KEY`.
Перед регистрацией первого администратора укажите его email в `ADMIN_EMAIL`; остальные новые аккаунты получают роль `User`.

Остановить сервисы: `docker compose down`. Данные PostgreSQL и MinIO сохраняются в Docker volumes. Для полного удаления данных: `docker compose down -v`.

## Весь стек в Docker

```powershell
docker compose --profile containerized up --build
```

Frontend в контейнере доступен по адресу http://localhost:8080.

## Production: Docker и GitHub Actions

### Что публикуется

Workflow `.github/workflows/publish-images.yml` при push в `master` собирает и публикует два образа в GitHub Container Registry (GHCR): `ghcr.io/yawsvitere/zovfy-api` и `ghcr.io/yawsvitere/zovfy-web`. Для каждого создаются теги `latest` и `sha-<commit>`. PostgreSQL и MinIO не собираются из исходников: production Compose запускает их отдельными контейнерами и хранит данные в Docker volumes.

Workflow публикует образы, но сам сервер не обновляет. После push дождитесь успешного GitHub Actions run, затем выполните на сервере шаги обновления ниже.

### Установка на Ubuntu

Инструкция рассчитана на чистый сервер Ubuntu 22.04/24.04 с публичным IP и доменом, указывающим на этот IP.

1. Установите Docker Engine и Compose plugin:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo docker run --rm hello-world
```

2. Разрешите входящие SSH и HTTP/HTTPS в firewall или панели хостинга. Порт `3000` будет точкой входа приложения, если не поставить перед ним HTTPS reverse proxy. PostgreSQL и MinIO API наружу не публикуются; MinIO Console слушает только `127.0.0.1:9001`.

3. Настройте чтение образов. Если пакеты GHCR приватные, создайте GitHub Personal Access Token (classic) со scope `read:packages` и войдите в GHCR на сервере. Для публичных пакетов этот шаг не нужен.

```bash
sudo docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

На запрос пароля вставьте токен. Не добавляйте токен в команду или `.env`. Чтобы сделать образы публичными, после первой успешной публикации откройте настройки каждого пакета `zovfy-api` и `zovfy-web` в GitHub Packages и измените Package visibility на Public.

4. Получите Compose-файлы. Для публичного репозитория:

```bash
sudo mkdir -p /opt/zovfy
sudo chown "$USER":"$USER" /opt/zovfy
git clone https://github.com/yawsvitere/zovfy.git /opt/zovfy
cd /opt/zovfy
```

Для приватного репозитория настройте SSH deploy key или другой способ аутентификации Git и клонируйте его по SSH. Исходники на сервере нужны только для Compose-файла и env-шаблона; приложения запускаются из GHCR-образов.

5. Создайте и заполните production env-файл:

```bash
cp .env.production.example .env
openssl rand -hex 32
openssl rand -hex 24
openssl rand -hex 24
nano .env
```

Вставьте три случайных значения соответственно в `JWT_KEY`, `POSTGRES_PASSWORD` и `MINIO_ROOT_PASSWORD`. HEX-значения не содержат символов, которые ломают строку подключения PostgreSQL. Задайте `PUBLIC_ORIGIN` равным origin сайта, например `https://music.example.com` за HTTPS proxy или `http://SERVER_IP:3000` для временного теста. При необходимости укажите `ADMIN_EMAIL`. Не публикуйте `.env` и не коммитьте его.

6. Скачайте образы и запустите сервисы:

```bash
sudo docker compose -f compose.production.yaml pull
sudo docker compose -f compose.production.yaml up -d
sudo docker compose -f compose.production.yaml ps
```

Приложение будет доступно на `http://SERVER_IP:3000`. Внутренний Nginx раздаёт web и проксирует `/api` и `/hubs` к API. Для постоянного публичного размещения настройте TLS на внешнем reverse proxy или load balancer и направьте его на `127.0.0.1:3000` (для этого замените публикацию порта в Compose на `127.0.0.1:${APP_PORT:-3000}:80`). Укажите HTTPS-origin в `PUBLIC_ORIGIN`, затем пересоздайте API: `sudo docker compose -f compose.production.yaml up -d --force-recreate api`.

### Обновление после push

После успешного workflow в GitHub Actions:

```bash
cd /opt/zovfy
git pull
sudo docker compose -f compose.production.yaml pull
sudo docker compose -f compose.production.yaml up -d
sudo docker compose -f compose.production.yaml ps
```

Compose использует тег `latest`. Для установки конкретного коммита задайте в `.env` `IMAGE_TAG=sha-<полный-commit-sha>` и снова выполните `pull` и `up -d`.

Логи: `sudo docker compose -f compose.production.yaml logs -f web api`. Перезапуск: `sudo docker compose -f compose.production.yaml restart`. Для консоли MinIO создайте SSH-туннель `ssh -L 9001:127.0.0.1:9001 USER@SERVER`, затем откройте `http://localhost:9001`. Не выполняйте `docker compose down -v` при обычном обновлении: эта команда удалит volumes PostgreSQL и MinIO вместе с данными.

## API

- `POST /api/auth/register` — регистрация (`email`, `password`)
- `POST /api/auth/login` — вход, возвращает JWT
- `POST /api/tracks/{id}/listen` — учёт прослушивания после 30 секунд фактического воспроизведения (90% для треков короче 30 секунд)
- `GET /api/chart` — недельный чарт, пересчитываемый каждый понедельник по событиям за последние 7 дней
- `GET /api/artists/{name}` — профиль артиста, релизы и суммарные прослушивания
- `PUT /api/artists/{name}` — описание, аватар и баннер артиста (Admin/Moderator)
- `GET/PUT /api/users/me` — просмотр и обновление профиля пользователя
- `GET /api/users/me/likes` — лайкнутые альбомы и треки
- `/api/admin/users` — управление ролями (Admin)
- `GET /api/health` — проверка доступности
- `POST /api/files` — multipart-загрузка файла, требует Bearer JWT
- `/hubs/updates` — защищённый SignalR hub, JWT передаётся как `access_token`

Локальная схема Identity создаётся при старте для быстрого старта. Перед переносом реальных данных добавьте EF Core migrations и замените `EnsureCreated` на `Migrate`.

## Структура

```text
src/
  Zovfy.Api/       ASP.NET Core API
  Zovfy.Web/       React приложение и nginx
compose.yaml       PostgreSQL, MinIO, API и опциональный frontend-контейнер
```
