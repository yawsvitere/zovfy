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

Workflow `.github/workflows/publish-images.yml` собирает и публикует API и web в GHCR при изменениях в `src/Zovfy.Api` или `src/Zovfy.Web` и push в `master`. Настройки API подаются при запуске контейнера через environment; секреты не встраиваются в Docker-образ.

На Ubuntu скачай скрипт и запусти от root:

```bash
curl -fsSLo install.sh https://raw.githubusercontent.com/yawsvitere/zovfy/master/install.sh
sudo bash install.sh
```

Скрипт установит Docker при необходимости, скачает только `compose.production.yaml` и `.env.production.example` в `/opt/zovfy`, один раз спросит origin сайта и email администратора, сгенерирует секреты, затем скачает образы и запустит приложение на порту `3000`. Повторный запуск обновит Compose и образы, но сохранит существующий `.env` и данные базы/MinIO.

GHCR-пакеты по умолчанию приватные. Чтобы скрипт скачивал образы без входа, после первого успешного workflow измени visibility пакетов `zovfy-api` и `zovfy-web` на Public в GitHub Packages. Либо запусти скрипт один раз: если `pull` завершится ошибкой доступа, выполни `sudo docker login ghcr.io -u YOUR_GITHUB_USERNAME` с GitHub token scope `read:packages` в качестве пароля и повтори `sudo bash install.sh`.

Для постоянного публичного сайта настрой HTTPS reverse proxy перед `SERVER_IP:3000` и при первом запуске укажи HTTPS origin. Не удаляй volumes через `docker compose down -v`, если нужно сохранить данные.

После успешного GitHub Actions run повтори `sudo bash install.sh` на сервере, чтобы получить новые образы.

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
