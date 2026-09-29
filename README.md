# Clopos Telegram Management System

Управление рестораном или магазином через Telegram-бота и веб-панель с интеграцией **Clopos Open API**.

| Часть | Стек | Хостинг |
|---|---|---|
| Backend API + Telegram-бот | Node.js 20, TypeScript, Fastify 5, Telegraf 4, Prisma 6, Zod, JWT | Render (Web Service) |
| Плановые отчёты | тот же код, `worker/scheduled-reports.ts` | Render (Cron Job) |
| База данных | PostgreSQL 16 | Render PostgreSQL |
| Веб-панель | Next.js 15, React 19, Tailwind CSS 4, компоненты в стиле shadcn/ui, Recharts | Vercel |

```
┌──────────────┐    HTTPS + JWT    ┌─────────────────────────┐   x-token   ┌────────────────────┐
│ Next.js      │ ────────────────▶ │ Fastify API             │ ──────────▶ │ Clopos Open API    │
│ (Vercel)     │                   │ + Telegraf bot (webhook)│             │ integrations.      │
└──────────────┘                   │ + Prisma                │             │ clopos.com/open-api│
                                   └───────────┬─────────────┘             └────────────────────┘
┌──────────────┐  webhook + secret             │
│ Telegram     │ ─────────────────────────────▶│            ┌──────────────────────┐
└──────────────┘ ◀──── отчёты (cron, UTC) ─────┼────────────│ Cron: scheduled      │
                                        ┌──────▼─────┐      │ reports (idempotent) │
                                        │ PostgreSQL │◀─────└──────────────────────┘
                                        └────────────┘
```

Браузер **никогда** не обращается к Clopos напрямую и не получает ни одного секрета: все ключи Clopos хранятся на сервере в зашифрованном виде (AES-256-GCM).

---

## Содержание

1. [Требования](#1-требования)
2. [Установка](#2-установка)
3. [Переменные окружения](#3-переменные-окружения)
4. [PostgreSQL](#4-postgresql)
5. [Telegram-бот](#5-telegram-бот)
6. [Clopos Developer](#6-clopos-developer)
7. [OAuth / подключение Clopos](#7-oauth--подключение-clopos)
8. [Локальная разработка](#8-локальная-разработка)
9. [Тестирование](#9-тестирование)
10. [Деплой на Render](#10-деплой-на-render)
11. [Деплой на Vercel](#11-деплой-на-vercel)
12. [Cron и плановые отчёты](#12-cron-и-плановые-отчёты)
13. [Чек-лист для продакшена](#13-чек-лист-для-продакшена)
14. [Troubleshooting](#14-troubleshooting)
15. [Справка: API, роли, структура, TODO](#15-справка)

---

## 1. Требования

- Node.js **20.11+** (`.nvmrc`), pnpm **10** (`corepack enable`)
- PostgreSQL **16** (локально, в Docker или на Render)
- Telegram-бот от [@BotFather](https://t.me/BotFather)
- Учётные данные Clopos Open API (`client_id`, `client_secret`, `brand`, `integrator_id`) — выдаёт Clopos
- Для деплоя: аккаунты Render и Vercel, репозиторий на GitHub

## 2. Установка

```bash
git clone https://github.com/Sariofficial23/CLOPOSBOT.git
cd CLOPOSBOT
corepack enable
pnpm install
cp .env.example .env                      # backend
cp apps/web/.env.example apps/web/.env.local   # frontend
```

Сгенерируйте секреты:

```bash
openssl rand -hex 32      # JWT_SECRET
openssl rand -base64 32   # ENCRYPTION_KEY (ровно 32 байта)
openssl rand -hex 32      # TELEGRAM_WEBHOOK_SECRET
```

## 3. Переменные окружения

`.env*` игнорируется git, в репозитории хранится только `.env.example`. Секреты бэкенда и фронтенда разделены.

### Backend (`.env`, Render)

| Переменная | Обяз. | Описание |
|---|---|---|
| `NODE_ENV` | да | `production` на Render |
| `PORT` | prod | На Render задаётся автоматически. Сервер слушает `0.0.0.0:$PORT`; локально по умолчанию `3001` |
| `DATABASE_URL` | да | строка подключения PostgreSQL |
| `JWT_SECRET` | да | не короче 32 символов |
| `JWT_EXPIRES_IN` | нет | время жизни сессии, по умолчанию `12h` |
| `ENCRYPTION_KEY` | да | 32 байта (base64 или 64 hex-символа). Шифрует секреты и токены Clopos. **Не меняйте после запуска**, иначе сохранённые ключи не расшифруются |
| `TELEGRAM_BOT_TOKEN` | для бота | токен от BotFather |
| `TELEGRAM_BOT_USERNAME` | нет | для справки и виджета входа |
| `TELEGRAM_MODE` | нет | `webhook` (prod), `polling` (локально) или `off` |
| `TELEGRAM_WEBHOOK_SECRET` | webhook | 16–256 символов, только `A-Z a-z 0-9 _ -` |
| `CLOPOS_API_URL` | да | `https://integrations.clopos.com/open-api` (базовый URL из официальной документации) |
| `CLOPOS_CLIENT_ID` | нет* | значение по умолчанию для подключения |
| `CLOPOS_CLIENT_SECRET` | нет* | значение по умолчанию для подключения (никогда не логируется) |
| `CLOPOS_INTEGRATOR_ID` | нет* | значение по умолчанию для подключения |
| `CLOPOS_REDIRECT_URI` | нет | зарезервирована, см. [раздел 7](#7-oauth--подключение-clopos) |
| `CLOPOS_ADAPTER` | да | `real` (обязательно в production) или `mock` (только разработка) |
| `FRONTEND_URL` | да | разрешённые CORS-origin через запятую |
| `BACKEND_URL` | да | публичный URL бэкенда, из него собирается адрес Telegram-webhook |
| `TIMEZONE` | нет | часовой пояс компании при seed, по умолчанию `Asia/Tashkent` |
| `RATE_LIMIT_MAX` | нет | запросов в минуту с одного IP, по умолчанию 300 |
| `REPORT_MAX_LAG_MINUTES` | нет | сколько минут после запланированного времени отчёт ещё отправляется, по умолчанию 180 |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_TELEGRAM_ID` | seed | первый SUPER_ADMIN |
| `TEST_DATABASE_URL` | тесты | отдельная БД, тесты её очищают |

\* Если не переданы в форме подключения, берутся из окружения.

> Предупреждение: в задании указано `CLOPOS_API_URL=https://open-api.clopos.com`, но официальная документация (API v2) даёт базовый URL **`https://integrations.clopos.com/open-api`**. Он и стоит по умолчанию. Если Clopos выдал вам другой URL, задайте его в переменной.

### Frontend (`apps/web/.env.local`, Vercel)

| Переменная | Описание |
|---|---|
| `NEXT_PUBLIC_API_URL` | URL бэкенда, например `https://clopos-api.onrender.com` |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | необязательна, включает «Войти через Telegram» |

Во фронтенде нет ни одной приватной переменной. Всё, что начинается с `NEXT_PUBLIC_`, видно в браузере, поэтому секреты туда не кладите.

## 4. PostgreSQL

Локально через Docker:

```bash
docker compose up -d db
```

Или на установленном Postgres:

```sql
CREATE USER clopos WITH PASSWORD 'clopos' CREATEDB;
CREATE DATABASE clopos OWNER clopos;
CREATE DATABASE clopos_test OWNER clopos;
```

Миграции и начальные данные:

```bash
pnpm db:migrate     # prisma migrate dev (создать/применить миграции при разработке)
pnpm db:deploy      # prisma migrate deploy (production, выполняется при старте на Render)
pnpm db:seed        # компания, SUPER_ADMIN, демо-сотрудники, расписания отчётов
```

Seed в режиме разработки: `admin@example.com` / `ChangeMe123!`, а также демо-пользователи `admin|manager|accountant|employee.demo@example.com` с паролем `DemoPassword123!`. В production обязательно задайте `SEED_ADMIN_EMAIL` и `SEED_ADMIN_PASSWORD`.

Схема: `apps/api/prisma/schema.prisma`, миграции: `apps/api/prisma/migrations/`. Связи `Company → Users, Employees, SalaryRecords, Incomings, ReportSchedules, AuditLogs, CloposConnection`. Индексы есть на `telegramId`, `companyId`, `createdAt`, `employeeId` и `period`.

## 5. Telegram-бот

1. Откройте [@BotFather](https://t.me/BotFather), выполните `/newbot` и скопируйте токен в `TELEGRAM_BOT_TOKEN`.
2. Для веб-входа через Telegram выполните `/setdomain` и укажите домен Vercel.
3. **Локально:** `TELEGRAM_MODE=polling`, webhook не нужен.
4. **Production:** `TELEGRAM_MODE=webhook` и `TELEGRAM_WEBHOOK_SECRET`. При старте сервер сам вызывает `setWebhook` на `${BACKEND_URL}/api/telegram/webhook` с `secret_token`. Запросы без правильного заголовка `X-Telegram-Bot-Api-Secret-Token` отклоняются с ответом 401. Вручную webhook можно установить так: `pnpm --filter @cpos/api bot:set-webhook`.
5. **Доступ.** Бот отвечает только пользователям, чей Telegram ID привязан к активному пользователю системы. Человек отправляет боту `/id` и передаёт ID администратору. Администратор добавляет его в разделе «Настройки → Пользователи» с нужной ролью. Бот работает только в личных чатах, в группы приходят лишь плановые отчёты.

**Меню:** 📊 Dashboard · 📦 Приход товара · 📈 Отчёты · 💰 Зарплата · 📦 Остатки · 💵 Продажи · ⚙️ Настройки. Каждая роль видит только разрешённые ей пункты.
**Команды:** `/menu /incoming /today /yesterday /week /month /cancel /id /help`.

Каждое изменяющее действие в боте проходит валидацию, требует подтверждения и имеет кнопку «❌ Отмена». Ошибки показываются пользователю без внутренних деталей, само действие пишется в журнал аудита. Состояние многошаговых сценариев хранится в Postgres (`BotSession`), поэтому переживает рестарт. Незавершённый сценарий истекает через час.

## 6. Clopos Developer

Документация: <https://developer.clopos.com/>. Учётные данные (`client_id`, `client_secret`, `brand`, `integrator_id`) выдаёт Clopos: dev@clopos.com или ваш менеджер интеграций.

### Что используется из официального API (v2)

| Операция | Endpoint | Статус |
|---|---|---|
| Аутентификация | `POST /v2/auth`, тело `{client_id, client_secret, brand, integrator_id}`, ответ `{token, expires_in, expires_at}` | ✅ по документации |
| Заголовок авторизации | `x-token: <JWT>` | ✅ по документации |
| Список товаров | `GET /v2/products` | ✅ по документации |
| Чек по ID | `GET /v2/receipts/{id}` | ✅ по документации |
| Список чеков (продажи) | `GET /v2/receipts` | ⚠️ операция есть в навигации документации, путь взят по конвенции v2: **проверить** |
| Категории | `GET /v2/categories` | ⚠️ проверить путь |
| Заведения | `GET /v2/venues` | ⚠️ проверить путь |

Все пути собраны в одном месте, в `packages/clopos/endpoints.ts`. Непроверенные помечены `verified: false`, и «Проверить соединение» в настройках явно их перечисляет.

### Чего нет в документации Clopos и что не придумывалось

Для этих операций **не найдено документированных endpoints**. Вместо выдуманных URL адаптер выбрасывает `CloposNotSupportedError` с описанием того, что нужно:

| Функция (`inventory.ts`) | Что нужно от Clopos |
|---|---|
| `getStorages()` | GET: список складов (id, name) |
| `getSuppliers()` | GET: список поставщиков (id, name) |
| `getStock()` | GET: остатки по товарам и складам (количество, единица, себестоимость) |
| `createIncoming()` | POST: создание приходной складской операции (склад, поставщик, позиции: товар, количество, цена) |
| `getIncomingOperations()` | GET: список приходных операций |
| себестоимость в чеках | COGS в списке чеков (иначе валовая прибыль недоступна) |

**Справочники (обходной путь).** Пока у Clopos нет этих endpoints, склады и поставщики ведутся локально в веб-панели («Справочники», `GET/POST/PATCH /api/warehouses` и `/api/suppliers`, право `catalog:manage`). Товары по-прежнему берутся из Clopos. Если Clopos начнёт отдавать склады и поставщиков, приход автоматически переключится на них.

**Импорт остатков из Excel.** Пока у Clopos нет endpoint остатков, текущие остатки загружаются из выгрузки Clopos (.xlsx/.csv): файл отправляется Telegram-боту как документ или загружается на странице «Остатки» (право `catalog:manage`). Колонки определяются по заголовкам (ru/uz/az/en: «Товар/Наименование/Mahsulot», «Остаток/Количество/Qoldiq», «Склад», «Ед.», «Себестоимость», «Сумма»). После превью и подтверждения последний импорт становится текущими остатками в боте, дашборде и отчётах (`GET /api/stock`, `POST /api/stock/import`, `POST /api/stock/import/:id/confirm`).

Как это влияет на работу с `CLOPOS_ADAPTER=real`:
- в «Остатках» показывается список товаров и пояснение «остатки недоступны»;
- приход работает через бота и веб-панель по локальным справочникам и сохраняется со статусом `LOCAL_ONLY`: в отчёты и расходы попадает, в сам Clopos не отправляется;
- себестоимость и валовая прибыль показываются как «нет данных».

Когда Clopos опубликует нужные endpoints, добавьте их в `ENDPOINTS` с `verified: true`, реализуйте функцию в `inventory.ts` и включите флаг в `REAL_CAPABILITIES` (`real.ts`). UI и бот подхватят изменения автоматически.

### Scopes

В документации Clopos **не описаны OAuth-scope строки**. Токен ограничен `brand`, `venue_id` и `integrator_id`, которые закодированы в JWT. Функция `validateTokenScope` (`packages/clopos/auth.ts`) проверяет, что они совпадают с настройками компании, и не даёт использовать токен чужого бренда или заведения. Какие права нужны от Clopos: чтение товаров, категорий, заведений и чеков, а для полного функционала ещё чтение складов, поставщиков и остатков и создание приходов. См. [раздел 15](#remaining-todos).

### Mock и Real

```ts
interface CloposService {
  getProducts(); getCategories(); getVenues(); getStorages(); getSuppliers(); getStock();
  createIncoming(data); getIncomingOperations(range?); getSalesReport(range); testConnection();
}
```

- `RealCloposService` (`packages/clopos/real.ts`) работает только с официальным API.
- `MockCloposService` (`packages/clopos/mock.ts`) генерирует детерминированные синтетические данные. Названия помечены `[MOCK]`, ответы помечены `source: 'mock'`, а в UI и отчётах видна плашка **MOCK DATA / ТЕСТОВЫЕ ДАННЫЕ**. Сервер **не запустится** с `CLOPOS_ADAPTER=mock` при `NODE_ENV=production`.

## 7. OAuth / подключение Clopos

В документации Clopos v2 описан обмен учётных данных на токен (`POST /v2/auth`), который по сути работает как client credentials. **Браузерный authorization-code flow (authorize URL → redirect → code exchange) в документации не найден.** Поэтому:

- `POST /api/clopos/connect` (роль с правом `clopos:manage`) принимает `brand` и, при необходимости, `clientId`, `clientSecret`, `integratorId` и `venueId`. Недостающие значения берутся из окружения. Сервер получает токен через `/v2/auth`, проверяет его scope (brand, venue, integrator) и сохраняет секрет и токен **в зашифрованном виде**. В ответах API и в логах секреты не появляются никогда.
- Токен обновляется автоматически за 60 секунд до `expires_at` путём повторной аутентификации: refresh-token в документации не описан. При ответе 401 происходит повторная аутентификация и запрос повторяется один раз.
- `GET /api/clopos/callback` отвечает `501 CLOPOS_OAUTH_REDIRECT_NOT_SUPPORTED`, а `CLOPOS_REDIRECT_URI` пока зарезервирована. Если Clopos подтвердит redirect-flow, реализуйте его в `packages/clopos/auth.ts` и в этом маршруте. Место отмечено `TODO(clopos-verify)`.
- В UI это «Настройки → Clopos»: подключение, статус, возможности адаптера, «Проверить соединение» и отключение (сохранённые ключи при этом стираются).

## 8. Локальная разработка

```bash
# 1. База
docker compose up -d db          # или свой Postgres

# 2. Backend
cp .env.example .env             # заполните JWT_SECRET, ENCRYPTION_KEY; CLOPOS_ADAPTER=mock
pnpm db:deploy && pnpm db:seed
pnpm dev:api                     # http://localhost:3001  (бот: TELEGRAM_MODE=polling)

# 3. Frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > apps/web/.env.local
pnpm dev:web                     # http://localhost:3000  → admin@example.com / ChangeMe123!

# 4. Плановые отчёты (нужен TELEGRAM_BOT_TOKEN)
pnpm --filter @cpos/api build && node apps/api/dist/worker/scheduled-reports.js --loop
```

Весь стек в Docker:

```bash
docker compose up --build                     # db + api + web
docker compose --profile worker up --build    # плюс воркер отчётов
```

Структура монорепозитория:

```
apps/api         Fastify API, Telegraf-бот, Prisma, cron-воркер
apps/web         Next.js-панель
packages/clopos  интеграция Clopos (auth, client, inventory, sales, Real/Mock)
packages/shared  роли и права, формулы, периоды и часовые пояса, Zod-схемы (общие для API, бота и UI)
```

## 9. Тестирование

```bash
export TEST_DATABASE_URL=postgresql://clopos:clopos@localhost:5432/clopos_test
pnpm typecheck      # tsc во всех пакетах
pnpm test           # vitest во всех пакетах
```

| Набор | Что проверяет |
|---|---|
| `packages/clopos/tests/auth.test.ts` | запрос `/v2/auth`, `expires_at`/`expires_in`, 401, отсутствие секретов в ошибках, кэш и обновление токена, single-flight, scope-проверка |
| `packages/clopos/tests/client.test.ts` | `x-token`, повторная аутентификация на 401, ретраи 5xx, пагинация и фильтр чеков, **отсутствие вызовов** для недокументированных операций |
| `packages/shared/tests/*` | формула зарплаты, права всех ролей, периоды в часовом поясе, расписания (UTC ↔ локальное время), формат сумм |
| `apps/api/tests/report.calc.test.ts` | суммы, оплаты, себестоимость и прибыль, группировка по дням в часовом поясе, топ товаров, формат отчёта для Telegram |
| `apps/api/tests/incoming.flow.test.ts` | сценарий `/incoming`, парсинг чисел, валидация, лимит callback_data в 64 байта, Zod-схема прихода |
| `apps/api/tests/security.test.ts` | AES-GCM, подпись Telegram Login, очистка секретов в аудите, формат ошибок без утечек, конфиг production |
| `apps/api/tests/routes.test.ts` | все маршруты API на реальном Postgres: авторизация, матрица ролей, изоляция компаний, идемпотентность, аудит |
| `apps/api/tests/clopos-real.test.ts` | реальный адаптер через API на поддельном Clopos: подключение, шифрование, продажи, `LOCAL_ONLY` |
| `apps/api/tests/schedule.test.ts` | cron: время, получатели, идемпотентность при параллельных запусках, ретраи, секрет webhook |
| `apps/api/tests/bot.test.ts` | обработчики Telegram end-to-end: доступ, меню по ролям, `/today`, `/incoming`, зарплата, настройки |
| `apps/web/tests/utils.test.ts` | форматирование, API-клиент ходит только на бэкенд |

Тестовые данные собраны в `apps/api/prisma/seed-data.ts`: компания, пользователи всех ролей и сотрудники Aziz, Madina и Sardor. Без `TEST_DATABASE_URL` тесты, требующие БД, пропускаются. CI находится в `.github/workflows/ci.yml` и запускается с Postgres-сервисом.

## 10. Деплой на Render

В репозитории есть `render.yaml` (Blueprint), он создаёт:
1. **clopos-db**: PostgreSQL 16;
2. **clopos-api**: Web Service (Node). Сервер слушает `0.0.0.0:$PORT`, при старте применяет `prisma migrate deploy`, health-check на `/api/health`;
3. **clopos-report-cron**: Cron Job, `*/15 * * * *` (UTC);
4. группу переменных **clopos-shared** с `JWT_SECRET` и `ENCRYPTION_KEY`, которые генерируются автоматически и общие для API и cron.

Порядок действий:
1. Render → **New → Blueprint** → выберите репозиторий.
2. Заполните переменные с `sync: false`: `TELEGRAM_BOT_TOKEN` (в обоих сервисах), `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`), `CLOPOS_CLIENT_ID`, `CLOPOS_CLIENT_SECRET`, `CLOPOS_INTEGRATOR_ID`, `FRONTEND_URL` (URL из Vercel), `BACKEND_URL` (`https://clopos-api.onrender.com`).
3. После первого деплоя создайте администратора. В Shell сервиса выполните: `cd apps/api && SEED_ADMIN_EMAIL=you@firm.uz SEED_ADMIN_PASSWORD='…' SEED_ADMIN_TELEGRAM_ID=123 npx tsx prisma/seed.ts`.
4. Откройте `https://<api>/api/health`, там должно быть `"db":"ok"` и `"cloposAdapter":"real"`.
5. В веб-панели: «Настройки → Clopos → Подключить».

Альтернатива: собрать образ из `Dockerfile` в корне и запустить на любой платформе, где задан `PORT`.

## 11. Деплой на Vercel

1. Vercel → **Add New Project** → репозиторий.
2. **Root Directory:** `apps/web`. Framework определится как Next.js, `apps/web/vercel.json` ставит зависимости монорепозитория через pnpm.
3. Environment Variables: `NEXT_PUBLIC_API_URL=https://clopos-api.onrender.com` и, при желании, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`.
4. Deploy. Затем пропишите домен Vercel в `FRONTEND_URL` на Render (для CORS) и в `/setdomain` у BotFather.

Фронтенд отдаёт заголовки CSP, X-Frame-Options, nosniff, Referrer-Policy и Permissions-Policy. `connect-src` разрешает только ваш API.

## 12. Cron и плановые отчёты

- Модель `ReportSchedule` хранит расписания DAILY, WEEKLY и MONTHLY: время в **часовом поясе компании**, день недели или месяца, период (текущий или предыдущий), дополнительный чат. Значения по умолчанию: ежедневно в 23:00 (текущий день), по понедельникам в 09:00 (прошлая неделя), 1-го числа в 09:00 (прошлый месяц). Изначально расписания выключены, включаются в веб-панели или в боте (⚙️).
- Render Cron работает **в UTC**. Воркер запускается каждые 15 минут и для каждого расписания вычисляет последнее срабатывание в часовом поясе компании (Luxon). Например, 23:00 в Asia/Tashkent соответствует 18:00 UTC. Отчёт отправляется, если с момента срабатывания прошло не больше `REPORT_MAX_LAG_MINUTES`.
- **Идемпотентность.** Каждое срабатывание фиксируется строкой `ReportDelivery` с уникальным ключом `(scheduleId, occurrenceKey)`. Повторный или параллельный запуск тот же отчёт не отправит. Неудачная отправка повторяется при следующих запусках, всего до 3 попыток. Зависшая доставка (краш воркера) считается брошенной через 10 минут.
- Получатели: все активные пользователи с правом `reports:view` и указанным Telegram ID, плюс `extraChatId` (группа).
- Воркер также чистит старые сессии бота (старше 30 дней) и записи доставок (старше 180 дней).

## 13. Чек-лист для продакшена

- [ ] `NODE_ENV=production`, `CLOPOS_ADAPTER=real` (mock запрещён конфигом)
- [ ] Сильные `JWT_SECRET` и `ENCRYPTION_KEY`, резервная копия `ENCRYPTION_KEY` в менеджере секретов
- [ ] `TELEGRAM_MODE=webhook` и `TELEGRAM_WEBHOOK_SECRET` (hex); `getWebhookInfo` показывает правильный URL
- [ ] `FRONTEND_URL` содержит точный домен Vercel, без `*`
- [ ] Выполнен seed SUPER_ADMIN с надёжным паролем; демо-пользователи в production не создаются
- [ ] Clopos подключён, «Проверить соединение» зелёный; **пути с пометкой ⚠️ проверены по документации**
- [ ] Включены нужные расписания отчётов, Cron Job на Render активен
- [ ] Бэкапы Render PostgreSQL включены
- [ ] `pnpm typecheck && pnpm test` зелёные, CI проходит
- [ ] Логи не содержат токенов: pino redaction для `authorization`, `x-token`, `*.password`, `*.secret` и `*.token`

## 14. Troubleshooting

| Симптом | Причина и решение |
|---|---|
| `Invalid environment configuration: - PORT…` | в production нужен `PORT`: Render задаёт его сам, в Docker передайте `-e PORT=…` |
| `MockCloposService is not allowed in production` | установите `CLOPOS_ADAPTER=real` |
| `409 CLOPOS_NOT_CONNECTED` | подключите Clopos в «Настройках» |
| `502 CLOPOS_AUTH_FAILED` | неверные `client_id`, `client_secret`, `brand` или `integrator_id`; проверьте у Clopos |
| `400 CLOPOS_SCOPE_MISMATCH` | токен выдан для другого brand или venue |
| `501 CLOPOS_NOT_SUPPORTED` | у Clopos нет документированного endpoint для операции, см. [раздел 6](#чего-нет-в-документации-clopos-и-что-не-придумывалось) |
| Продажи пустые или неполные | проверьте путь и параметры `GET /v2/receipts` в `packages/clopos/endpoints.ts` (`RECEIPTS_LIST_QUERY`) |
| Бот молчит | `getWebhookInfo`: последняя ошибка и URL; секрет должен совпадать; `TELEGRAM_MODE` |
| «⛔ Нет доступа» в боте | Telegram ID не привязан к активному пользователю; узнайте его через `/id` |
| CORS-ошибка в браузере | `FRONTEND_URL` должен совпадать с origin (схема, домен, без `/` в конце) |
| Отчёты не приходят | расписание включено? У получателей заполнен Telegram ID? Посмотрите логи Cron Job (JSON-сводка) и таблицу `ReportDelivery` |
| Время отчёта «съехало» | проверьте часовой пояс компании в «Настройках» (IANA, например `Asia/Tashkent`) |
| После смены `ENCRYPTION_KEY` Clopos перестал работать | переподключите Clopos, чтобы секрет зашифровался новым ключом |

---

## 15. Справка

### API

Все ответы имеют вид `{ success: true, data }` или `{ success: false, error: { code, message, details? } }`. Стектрейсы клиенту не отдаются никогда.

| Метод | Путь | Право |
|---|---|---|
| GET | `/api/health` | публичный |
| POST | `/api/auth/login`, `/api/auth/telegram` | публичный (10 запросов в минуту) |
| GET | `/api/auth/me` | любой вошедший |
| GET | `/api/dashboard?preset=\|from&to` | `dashboard:view` |
| GET | `/api/sales` | `sales:view` |
| GET | `/api/inventory` | `stock:view` |
| GET | `/api/incoming` | `incoming:view` |
| GET | `/api/incoming/options` | `incoming:create` |
| POST | `/api/incoming` (поддерживает заголовок `Idempotency-Key`) | `incoming:create` |
| GET | `/api/reports/daily\|weekly\|monthly?previous=&format=text` | `reports:view` |
| GET / POST | `/api/employees` | `employees:view` / `employees:manage` |
| PATCH | `/api/employees/:id` | `employees:manage` |
| GET | `/api/salary?period=YYYY-MM` | `salary:view` |
| POST | `/api/salary` (расчёт), `/api/salary/calculate-all` | `salary:manage` |
| PATCH | `/api/salary/:id` | `salary:manage` |
| POST | `/api/salary/:id/adjust` (бонус, штраф, аванс), `/api/salary/:id/pay` | `salary:manage` |
| GET | `/api/audit` | `audit:view` |
| POST | `/api/clopos/connect` | `clopos:manage` |
| GET | `/api/clopos/callback` | 501, см. раздел 7 |
| GET / POST / DELETE | `/api/clopos/status`, `/api/clopos/test`, `/api/clopos/connection` | `clopos:manage` |
| GET / PATCH | `/api/settings` | любой / `settings:manage` |
| GET / PUT | `/api/report-schedules` | `reports:schedule` |
| GET / POST / PATCH | `/api/users` | `users:manage` |
| DELETE | `/api/companies/:id` | `company:delete` (только SUPER_ADMIN) |
| POST | `/api/telegram/webhook` | секрет Telegram |

### Роли (`packages/shared/src/roles.ts`)

| Роль | Права |
|---|---|
| SUPER_ADMIN | всё |
| ADMIN | всё, кроме удаления компании |
| MANAGER | дашборд, продажи, остатки, приходы, отчёты |
| ACCOUNTANT | дашборд, финансы, приходы (просмотр), отчёты, сотрудники (просмотр), зарплата |
| EMPLOYEE | только бот: остатки и регистрация прихода |

Права проверяются на каждом защищённом endpoint (`app.guard(...)`) и в каждом обработчике бота. Роль перечитывается из БД при каждом запросе, так что отключение пользователя или смена роли действуют сразу. Назначить роль выше своей нельзя.

### Зарплата

`total = baseSalary + bonus − penalty − advance` (`packages/shared/src/salary.ts`). Период задаётся как календарный месяц `YYYY-MM`. Статусы: `DRAFT` и `PAID`; выплаченная запись неизменяема. Параллельные изменения защищены оптимистической блокировкой.

### Аудит

`AuditLog` фиксирует входы (в том числе неудачные), приходы, все изменения зарплаты и сотрудников, генерацию отчётов, настройки, расписания, подключение Clopos и пользователей. Метаданные проходят `sanitize()`: ключи, похожие на пароль, секрет или токен, заменяются на `[REDACTED]`.

### Безопасность

Helmet (строгий CSP для JSON API), CORS по белому списку, rate limiting (глобальный и отдельный для логина и подключения Clopos), Zod-валидация всех входных данных, JWT HS256 с перечитыванием пользователя, RBAC, AES-256-GCM для секретов Clopos, pino-redaction, проверка Telegram-пользователя и подписи Login Widget, секрет webhook с constant-time сравнением, bcrypt (cost 12) с защитой от timing-атак при неизвестном email, изоляция данных по `companyId`.

### Remaining TODOs

1. **Clopos: проверить по документации** пути `GET /v2/receipts`, `/v2/categories`, `/v2/venues`, а также параметры пагинации и фильтра дат списка чеков (`RECEIPTS_LIST_QUERY`) и имя поля позиций чека (`products` или `items`). Всё помечено `TODO(clopos-verify)`.
2. **Clopos: запросить endpoints** для складов, поставщиков, остатков, создания приходов, списка приходов и себестоимости в чеках (`MISSING_ENDPOINTS`, `TODO(clopos-endpoint)`).
3. **OAuth redirect-flow**: реализовать, если Clopos его подтвердит (`/api/clopos/callback`, `CLOPOS_REDIRECT_URI`).
4. **Clopos Webhooks**: в документации упомянуты, но форматы событий не получены. Можно добавить `POST /api/clopos/webhook` с проверкой подписи.
5. Повторная отправка приходов со статусом `FAILED` в Clopos (фоновая задача), когда появится endpoint.
6. Классификация способов оплаты сейчас эвристическая (по названию). Добавить сопоставление по `payment_method.id` в настройках.
7. Перенести конфиг seed из `package.json#prisma` в `prisma.config.ts` (предупреждение Prisma о Prisma 7).

### Known limitations

- Без перечисленных endpoints Clopos в режиме `real` недоступны остатки, валовая прибыль и создание прихода в Clopos (приход сохраняется локально, `LOCAL_ONLY`).
- Отчёт за длинный период (месяц и больше) загружает все чеки за период. Результат кэшируется на 60 секунд в памяти процесса; кэш не общий между инстансами.
- JWT хранится в `localStorage`, потому что фронтенд (Vercel) и API (Render) на разных доменах. CSP снижает риск XSS; для httpOnly-cookie нужен общий домен или прокси.
- Rate limit и flood-защита бота хранятся в памяти одного инстанса; при горизонтальном масштабировании нужен Redis.
- Одна компания на пользователя; SUPER_ADMIN управляет своей компанией и может удалять компании по ID.
- Приход через бота содержит одну позицию; через веб-панель можно добавить несколько.
