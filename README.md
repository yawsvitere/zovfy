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
