# Runbook проверяющего — Verde Marea

Подробное руководство: роли и экраны, установка на macOS / Linux / Windows, команды, сценарий ручной проверки,
карта «требование → код → проверка», частые проблемы. Краткое описание проекта и быстрый запуск — в [README](../README.md).

**Содержание**
1. [Что умеет система](#1-что-умеет-система)
2. [Демо-аккаунты](#2-демо-аккаунты)
3. [Требования](#3-требования)
4. [Запуск: macOS](#4-запуск-macos) · [Linux](#5-запуск-linux-ubuntu--debian) · [Windows](#6-запуск-windows)
5. [Команды](#7-команды)
6. [Сценарий проверки для ревьюера (~20 минут)](#8-сценарий-проверки-для-ревьюера-20-минут)
7. [Где в коде выполнено каждое требование](#9-где-в-коде-выполнено-каждое-требование)
8. [Правила окон, выбор стола и машина состояний](#10-правила-окон-выбор-стола-и-машина-состояний)
9. [Частые проблемы](#11-частые-проблемы)
10. [Обновление после изменений](#12-безопасное-обновление-после-изменений)
11. [Структура и документы](#13-структура-и-документы)

---

## 1. Что умеет система

### Роли

| Роль | Кто | Что может |
|------|-----|-----------|
| Гость без входа | посетитель сайта | смотреть главную, зарегистрироваться, войти. Защищённые страницы перенаправляют на `/login` |
| `user` | гость ресторана | смотреть свободные окна и план зала, бронировать стол на себя (выбрать на плане или доверить автоподбору), видеть свои бронирования, назначенный стол, статус и уведомления, отменять своё бронирование **не позднее чем за 3 часа** до начала |
| `admin` | хостес, администратор зала | всё, что `user`, плюс административный контур: подтверждать, отменять, отмечать «Состоялось» и «Неявка», фильтровать по статусу и дате, закрывать и открывать окна и целые дни, смотреть пользователей (только чтение) и историю |
| `super_admin` | владелец | всё, что `admin`, плюс повышать `user` → `admin` и понижать обратно. Роль владельца через интерфейс не выдаётся и не снимается никем |

Матрица прав в коде одна — `lib/permissions.ts`. По ней интерфейс показывает кнопки и плашку «Ваша роль», а Server Actions делают первую проверку. Окончательную проверку делает функция PostgreSQL по роли из базы.

### Экраны

| Адрес | Кто видит | Что делать |
|-------|-----------|------------|
| `/` | все | легенда ресторана, фото, бегущая строка, режим работы со счётчиками, кнопка «Забронировать стол» |
| `/register` | без входа | регистрация: имя (2–60 символов), почта, пароль (от 8 символов). После неё — сразу на `/book` |
| `/login` | без входа | вход по почте и паролю. `user` попадает на `/book`, `admin`/`super_admin` — на `/admin` |
| `/book` | user, admin, super_admin | выбрать дату (12 кнопок: 14 дней без понедельников) и число гостей (1–8). Появится полоса окон дня с бейджем «N свободно» — сколько столов можно выбрать на плане. Под ней SVG-план зала и веранды: свободные столы обведены зелёным, занятые заштрихованы, неподходящие по числу мест — бледные. Клик (или Tab + Enter) по свободному столу открывает карточку стола (справа, на телефоне — нижним листом) с кнопкой «Забронировать этот стол». Рядом — «Подобрать автоматически»: самый маленький подходящий стол, как в версии 1. Если стол заняли между показом и кликом — понятная ошибка, план обновляется. Если окон нет — «На эту дату нет свободных окон» и подсказка |
| `/account` | user, admin, super_admin | «Мои бронирования»: дата, стол, зона, гости, статус. «Отменить» → «Да, отменить» / «Не надо», пока до начала больше 3 часов. Ниже — уведомления о каждом изменении статуса, «Прочитано» и «Отметить все прочитанными» |
| `/admin` | admin, super_admin (у `user` — «Нет доступа») | все бронирования: гость, гостей, стол, статус. Фильтры по статусу и дате, «Сегодня», «Сбросить фильтры». Кнопки — только допустимые сейчас переходы. Слева — вкладки и плашка «Ваша роль» со списком доступного и того, что только владельцу |
| `/admin/slots` | admin, super_admin | 14 дней: у каждого окна «занято N из 8», «прошло», «открыто», «закрыто: причина». Можно закрыть окно или весь день с причиной и открыть обратно. Закрытие не отменяет уже созданные бронирования |
| `/admin/users` | admin (чтение), super_admin | список пользователей с ролями. super_admin видит кнопки «Сделать администратором» и «Снять права администратора», admin — пояснение, что роли меняет только владелец |
| `/admin/audit` | admin, super_admin | история: создание, подтверждение, отмена, «Состоялось», неявка, смена роли, закрытие и открытие окна — с автором и временем. Последние 200 записей |

Интерфейс на русском, работает от ширины 375 px без горизонтальной прокрутки: на телефоне таблицы превращаются в карточки. Визуальная система описана в `design.md`.

### Фото и анимации

На главной и на страницах входа и регистрации — три фото ресторана (Unsplash, ссылки — в README) с тихими эффектами `design.md`, раздел 4а: плавное появление, медленный наезд камеры, проявление блоков при прокрутке.

Версия 2 добавляет на главную выразительное движение (`design.md`, раздел 4б; `app/components/home-motion.tsx`): инерционная прокрутка Lenis (не на сенсорных экранах), заголовок первого экрана по строкам из-под маски (GSAP SplitText), проявление фото «Кухня и зал» через `clip-path` с параллаксом внутри кадра, параллакс главного кадра, бегущая строка (CSS), счётчики «90 минут», «14 дней», «8 столов». На плане зала — смена статусов цветом, «вспыхивание» изменившихся столов, пульсация кольца выбранного стола, переезжающий индикатор окна.

Рабочие экраны (кабинет, админка) без фото и без GSAP. Если в системе включено «уменьшение движения», всё статично: Lenis и GSAP не запускаются, бегущая строка стоит.

## 2. Демо-аккаунты

> **Учебные данные seed для локального запуска.** Значения берутся из `.env.example` и создаются командой `npm run db:seed`. Это не настоящие пароли. Если `.env` скопирован из `.env.example` без изменений, пароли такие:

| Роль | Почта | Пароль | Что проверять |
|------|-------|--------|---------------|
| `super_admin` | `owner@verde-marea.test` | `VerdeMarea-Owner-2026` | `/admin/users`: повысить пользователя до admin и понизить обратно; `/admin/audit` — запись «Сменил роль»; плашка «Ваша роль: Владелец» |
| `admin` | `admin@verde-marea.test` | `VerdeMarea-Demo-2026` | `/admin`: фильтры, подтверждение, отмена, «Состоялось» и «Неявка» (в том числе у вчерашнего неподтверждённого бронирования); `/admin/slots` — закрыть и открыть день; `/admin/users` — без кнопок, с пояснением |
| `user` | `anna@verde-marea.test` | `VerdeMarea-Demo-2026` | `/book` → бронирование; `/account` — бронирования во всех статусах, уведомления, отмена в два нажатия; `/admin` — «Нет доступа» |
| `user` | `pavel@verde-marea.test` | `VerdeMarea-Demo-2026` | второй гость: подтверждённое бронирование, неявка, вчерашнее неподтверждённое бронирование |

Seed при каждом запуске приводит пароли владельца и демо-пользователей к значениям из `.env`. Если вы поменяли пароль в `.env`, запустите `npm run db:seed` ещё раз.

Как получить ещё одного пользователя каждой роли:
- **user** — зарегистрироваться на `/register`;
- **admin** — зарегистрироваться, затем войти владельцем → «Пользователи» → «Сделать администратором»;
- **super_admin** — только через seed: укажите другую почту в `SEED_SUPER_ADMIN_EMAIL` и запустите `npm run db:seed`. Через интерфейс и функции базы роль владельца не выдаётся.

## 3. Требования

- **Node.js 20.9+** (проверено на 24.19) и **npm**.
- **PostgreSQL 15+** (проверено на 18.6) с расширением **`btree_gist`**. Оно входит в contrib: в Postgres.app, Homebrew и установщике EDB для Windows оно есть сразу, в Linux ставится пакетом `postgresql-contrib`. Миграция включает расширение сама (`CREATE EXTENSION IF NOT EXISTS btree_gist`). Нужен пользователь с правом создавать расширения: владелец базы или суперпользователь.
- **Интернет при первой сборке.** Шрифты Cormorant Garamond и Manrope скачиваются через `next/font/google` во время `npm run build` или `npm run dev`. Если сети нет — см. «Частые проблемы».
- Свободный порт 3000 (`npm run dev`, `npm run start`) или 3010 (`npm run start:local`).

## 4. Запуск: macOS

**PostgreSQL — один из двух вариантов.**

Вариант А: [Postgres.app](https://postgresapp.com). Установите, нажмите Initialize, затем добавьте утилиты в PATH:

```bash
sudo mkdir -p /etc/paths.d && echo /Applications/Postgres.app/Contents/Versions/latest/bin | sudo tee /etc/paths.d/postgresapp
# откройте новый терминал
```

Вариант Б: Homebrew.

```bash
brew install postgresql@17
brew services start postgresql@17
echo 'export PATH="$(brew --prefix postgresql@17)/bin:$PATH"' >> ~/.zshrc && source ~/.zshrc
```

**Проект:**

```bash
cd verde-marea
npm install                          # зависимости + prisma generate
cp .env.example .env
createdb verde_marea
createdb verde_marea_shadow
```

Откройте `.env` и замените `USER:PASSWORD` в двух строках подключения. В Postgres.app и Homebrew пользователь — ваш логин macOS (`whoami`), пароля нет:

```
DATABASE_URL="postgresql://ваш_логин@localhost:5432/verde_marea?schema=public"
SHADOW_DATABASE_URL="postgresql://ваш_логин@localhost:5432/verde_marea_shadow?schema=public"
```

```bash
npm run db:deploy                    # миграции
npm run db:seed                      # демо-данные
npm run build
npm run start:local                  # http://localhost:3010
```

## 5. Запуск: Linux (Ubuntu / Debian)

```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib    # contrib содержит btree_gist
sudo systemctl enable --now postgresql

# Node.js 20+ (если в системе старее): https://nodejs.org или nvm
node -v
```

Создайте роль и две базы, владельцем которых будет эта роль. Тогда миграция сможет включить `btree_gist`.

```bash
sudo -u postgres psql -c "CREATE ROLE verde LOGIN PASSWORD 'придумайте_пароль' CREATEDB;"
sudo -u postgres createdb -O verde verde_marea
sudo -u postgres createdb -O verde verde_marea_shadow
```

```bash
cd verde-marea
npm install
cp .env.example .env
```

В `.env`:

```
DATABASE_URL="postgresql://verde:придумайте_пароль@localhost:5432/verde_marea?schema=public"
SHADOW_DATABASE_URL="postgresql://verde:придумайте_пароль@localhost:5432/verde_marea_shadow?schema=public"
```

```bash
npm run db:deploy
npm run db:seed
npm run build
npm run start:local                  # http://localhost:3010
```

Если `db:deploy` пишет `permission denied to create extension "btree_gist"`, включите расширение один раз от суперпользователя:

```bash
sudo -u postgres psql -d verde_marea -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
sudo -u postgres psql -d verde_marea_shadow -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
```

## 6. Запуск: Windows

1. Установите **Node.js 20+ LTS** с [nodejs.org](https://nodejs.org).
2. Установите **PostgreSQL** установщиком EDB с [postgresql.org/download/windows](https://www.postgresql.org/download/windows/). Компоненты по умолчанию подходят: `btree_gist` уже внутри. Запомните пароль пользователя `postgres` и порт (обычно 5432).
3. Откройте **PowerShell** в папке проекта:

```powershell
npm install
Copy-Item .env.example .env

# утилиты PostgreSQL: подставьте свою версию вместо 17
$pg = "C:\Program Files\PostgreSQL\17\bin"
& "$pg\createdb.exe" -U postgres verde_marea
& "$pg\createdb.exe" -U postgres verde_marea_shadow
# пароль postgres спросят при каждом вызове; можно задать один раз: $env:PGPASSWORD = "ваш_пароль"
```

4. Откройте `.env` (например, `notepad .env`) и впишите пароль пользователя `postgres`:

```
DATABASE_URL="postgresql://postgres:ваш_пароль@localhost:5432/verde_marea?schema=public"
SHADOW_DATABASE_URL="postgresql://postgres:ваш_пароль@localhost:5432/verde_marea_shadow?schema=public"
```

Если в пароле есть `@ : / # ? %`, закодируйте их: `@` → `%40`, `#` → `%23`, `%` → `%25`.

5. Запуск:

```powershell
npm run db:deploy
npm run db:seed
npm run build
npm run start:local      # http://localhost:3010
```

Путь к проекту лучше держать без кириллицы и пробелов, например `C:\projects\verde-marea`.

## 7. Команды

| Команда | Что делает |
|---------|------------|
| `npm install` | ставит зависимости и выполняет `prisma generate` (клиент базы) |
| `npm run db:deploy` | `prisma migrate deploy`: применяет к базе из `DATABASE_URL` все ещё не применённые миграции — `init` (таблицы), `booking_rules` (CHECK, EXCLUDE, триггеры, функции `vm_*`), `pending_after_start` (переходы `pending` после начала окна), `floor_plan` (поля плана у столов, `vm_table_availability`, `vm_day_availability`, `vm_create_booking` с выбором стола). Данные не удаляет; базе версии 1 миграция сама проставляет раскладку столов T1…T8 |
| `npm run db:seed` | `tsx prisma/seed.ts`: владелец из `.env`, admin, два гостя, 8 столов с раскладкой на плане зала, бронирования во всех статусах (включая вчерашнее неподтверждённое), закрытие дня («Банкет») и одного окна. Можно запускать повторно: не падает и не дублирует, пароли демо-аккаунтов приводит к `.env` |
| `npm run db:reset` | `prisma migrate reset --force`: **удаляет все данные** в базе из `DATABASE_URL`, заново применяет миграции и запускает seed. Только для локальной разработки |
| `npm run db:status` | показывает, все ли миграции применены |
| `npm run dev` | режим разработки на http://localhost:3000 |
| `npm run build` | продакшен-сборка (проверка типов внутри) |
| `npm run start` / `npm run start:local` | запускает собранное приложение на порту 3000 / 3010 |
| `npm run typecheck` / `npm run lint` | TypeScript без сборки / ESLint |
| `npm run check:rules` | 122 проверки правил `spec.md` (разделы 4–6, 10, 10а) **на живой базе**: окна, подбор стола, дубли, гонка двух запросов, дедлайн 3 часа, все пары переходов до и после начала окна, роли, история и уведомления, bcrypt; план зала — раскладка без пересечений, правило `guests ≤ capacity ≤ guests + 2` в `rules.ts` и в базе, статусы столов, выбор стола с `p_table_id` (меньше/больше допустимого, занятый, неактивный, закрытое и начавшееся окно), гонка двух гостей за один стол. Работает на тестовых данных 2031 года, удаляет их и в конце сверяет, что данные seed не изменились |
| `npm run check:http` | сквозной HTTP-сценарий на **запущенном** приложении (по умолчанию `http://localhost:3010`, иначе задайте `SMOKE_BASE_URL`). Отправляет формы как браузер без JavaScript: регистрация → вход → бронирование → план зала (выбор стола и бронирование именно его, второй гость на тот же стол получает понятную ошибку и обновлённый план) → `/account` → admin → super_admin → история → отмена. Проверяет «Нет доступа», редиректы, отсутствие `passwordHash` и bcrypt-хешей в HTML. Тестового пользователя удаляет |

## 8. Сценарий проверки для ревьюера (~20 минут)

Подготовка: `npm run db:deploy && npm run db:seed && npm run build && npm run start:local`, затем откройте http://localhost:3010. Можно сузить окно браузера до 375 px — горизонтальной прокрутки быть не должно.

| # | Действие | Что должно получиться |
|---|----------|-----------------------|
| 1 | Без входа откройте http://localhost:3010/book и `/admin` | перенаправление на `/login` |
| 2 | `/register`: имя «Я», почта «abc», пароль «123» | ошибки под каждым полем, без перезагрузки формы |
| 3 | Зарегистрируйтесь с корректными данными | попадаете на `/book`, в шапке «Мои бронирования» и «Выйти» |
| 4 | `/book`: выберите завтра и 4 гостя | 12 дат без понедельников, полоса окон с бейджами «N свободно», план зала. У сегодняшнего дня нет уже начавшихся окон. Подпись: «можно выбрать стол на 4–6 мест» — столы на 2 и на 8 бледные |
| 4а | Нажмите Tab до плана: фокус ходит только по свободным столам; Enter на столе | открывается карточка стола, фокус — на «Забронировать этот стол»; Esc закрывает карточку и возвращает фокус на стол. Скринридер читает «Стол T3, зал, 4 места, свободен» |
| 4б | Переключите окно в полосе | индикатор переезжает к выбранному окну, изменившиеся столы коротко «вспыхивают» |
| 4в | На 375 px | план повёрнут вертикально (зал сверху, море снизу), без горизонтальной прокрутки; карточка стола — нижний лист |
| 5 | Выберите дату, закрытую в seed (третий рабочий день после дня запуска seed, причина «Банкет» видна в «Окнах записи») | «На эту дату нет свободных окон» и подсказка |
| 6 | Выберите свободный стол → «Забронировать этот стол» | `/account`, зелёная плашка, статус «Ожидает подтверждения», выбранный стол, уведомление «…создано» |
| 6а | Снова `/book`, другое окно → «Подобрать автоматически» | бронирование на самый маленький подходящий стол (как в версии 1) |
| 7 | Вернитесь на `/book` с той же датой | ваших окон в полосе больше нет (второе активное бронирование на то же время запрещено) |
| 7а | Гонка: откройте один и тот же стол в двух браузерах под разными гостями и нажмите «Забронировать этот стол» в обоих | первый получает бронь, второй — «Этот стол только что заняли… План обновлён», стол на плане заштрихован |
| 8 | `/account` → «Отменить» → «Не надо» → «Отменить» → «Да, отменить» | статус «Отменено», уведомление об отмене. Кнопки во время запроса заблокированы |
| 9 | Создайте бронирование ещё раз и откройте `/admin` под этим пользователем | «Нет доступа» с вашей ролью |
| 10 | Выйдите и войдите `admin@verde-marea.test` / `VerdeMarea-Demo-2026` | открывается `/admin`, слева вкладки и плашка «Ваша роль: Администратор»: что доступно и что только владельцу |
| 11 | Фильтр «Ожидает подтверждения» + дата вашего бронирования | видно ваше бронирование со столом; «Подтвердить» → статус «Подтверждено» |
| 12 | Сбросьте фильтры и найдите вчерашнее (последний рабочий день до запуска seed) бронирование Павла Орлова «Ожидает подтверждения» | кнопки «Подтвердить» нет, есть «Отменить», «Состоялось», «Неявка» — `pending` не «зависает» после начала окна |
| 13 | У этого бронирования: «Неявка» → «Да, неявка» | статус «Неявка», кнопок больше нет — статус терминальный; Павлу пришло уведомление |
| 14 | «Окна записи»: у завтрашнего дня «Весь день», причина «Проверка» → «Закрыть», потом «Открыть день» | день закрыт и открыт; на `/book` в закрытый день окон нет |
| 15 | «Пользователи» | список без кнопок смены роли и пояснение «Роли меняет только владелец» |
| 16 | Выйдите и войдите `owner@verde-marea.test` / `VerdeMarea-Owner-2026` → «Пользователи» | у пользователя из шага 3 — «Сделать администратором», у владельца — «—». После нажатия он видит `/admin`. «Снять права администратора» возвращает роль `user` |
| 17 | «История» | создание, отмена, подтверждение, неявка, «Состоялось» (из seed), смена роли, закрытие и открытие окна — с автором и временем |
| 18 | Ctrl+U на любой странице | в HTML нет `passwordHash` и `$2b$` |

Автоматически то же самое проверяют `npm run check:rules` и (при запущенном приложении) `npm run check:http`. Полный чек-лист приёмки — `docs/acceptance-checklist.md`.

## 9. Где в коде выполнено каждое требование

| Требование | Где | Как проверить |
|------------|-----|---------------|
| Сущности User, Session, Table, SlotClosure, Booking, Notification, AuditLog | `prisma/schema.prisma`, миграция `prisma/migrations/*_init` | `npm run db:deploy`, `npm run db:status` |
| Окна не хранятся, считаются по правилам; `SlotClosure` — исключения | `lib/booking/rules.ts` (`SLOT_TIMES`, `bookableDates`, `checkSlot`); SQL `vm_available_slots`, `vm_is_closed` в `*_booking_rules` | `/book`; `check:rules`, раздел 3 |
| Подбор наименьшего свободного стола | SQL `vm_pick_table`, `vm_create_booking` (перебор столов по `capacity`, `code`) | бронирование на 4 гостей → стол на 4 места; `check:rules`: «T1,T2,T6,T3» |
| Новое бронирование — `pending` | `vm_create_booking`, `app/actions/booking.ts` → `createBookingAction` | `/account` после бронирования |
| Один стол не отдаётся дважды; у гостя нет двух активных броней на одно время | EXCLUDE `Booking_table_no_overlap`, `Booking_user_no_overlap` в `*_booking_rules` | `check:rules`: прямые вставки, гонка двух запросов |
| Вместимость стола, 90 минут, гости 1–8 | триггер `vm_booking_before_write`, CHECK `Booking_duration_90`, `Booking_guests_range` | `check:rules`, раздел 5 |
| Переходы статусов и терминальные статусы | `lib/booking/rules.ts` → `staffCanTransition`, `staffTransitions`; SQL `vm_change_booking_status` и триггер `vm_booking_before_write` (миграция `*_pending_after_start`); кнопки в `app/admin/page.tsx` | `/admin`; `check:rules`, раздел 7 (все 25 пар × до/после начала) |
| Дедлайн отмены гостем — 3 часа | `canOwnerCancel` в `rules.ts`, `cancelOwnBookingAction`, `vm_change_booking_status` (`VM_CANCEL_DEADLINE`) | `/account`; `check:rules`, раздел 6 (граница ровно 3 ч) |
| Одна матрица ролей для интерфейса и Server Actions | `lib/permissions.ts` (`can`, `canChangeRole`, `describeRole`); `app/actions/*.ts`; плашка `app/components/role-panel.tsx` | плашка «Ваша роль»; `check:rules`: матрица = таблица spec, раздел 6 |
| Окончательная проверка прав — в БД по роли из базы | `vm_actor_role`, `vm_is_staff` во всех `vm_*` | `check:rules`: «права в permissions.ts совпадают с ответом БД» |
| Роль `super_admin` никто не меняет | `vm_set_user_role` + триггер `vm_user_role_guard` | `/admin/users`; `check:rules`, раздел 8 |
| История и уведомления в той же транзакции; действие без автора невозможно | триггеры `vm_booking_after_write`, `vm_user_role_audit`, `vm_slot_closure_audit`; автор — `vm.actor_id` из функций `vm_*` | `/admin/audit`, `/account`; `check:rules`: `VM_ACTOR_REQUIRED` |
| Уведомление нельзя привязать к чужому пользователю | составной FK `Notification(bookingId, userId) → Booking(id, userId)` | `check:rules` |
| Пароли — bcryptjs, 12 раундов | `lib/auth.ts` (`hashPassword`, `authenticate`) | `check:rules`: хеш `$2b$12$` |
| Серверная сессия в httpOnly-cookie | `lib/session.ts` (в базе только SHA-256 токена), `lib/guard.ts` (cookie, `requireUser`, `gate`) | `check:http`: атрибуты cookie, выход отзывает сессию |
| `passwordHash` не уходит в интерфейс | `publicUserSelect` в `lib/db.ts`, все запросы `lib/booking/queries.ts` | `check:http`: поиск по всем HTML-ответам |
| Без сессии → `/login`, `user` в `/admin` → «Нет доступа» | `lib/guard.ts` → `gate`; `app/admin/layout.tsx`; `NoAccess` в `app/components/ui.tsx` | шаги 1 и 9 сценария; `check:http` |
| «Окно заняли между показом и нажатием» | `createBookingAction`: понятная ошибка + `revalidatePath("/book")` | `check:rules`: гонка; `check:http`: повторное бронирование |
| План зала: поля `shape`, `planX`, `planY`, `planW`, `planH`, раскладка без пересечений | `prisma/schema.prisma`, миграция `*_floor_plan` (CHECK формы и границ), `prisma/seed.ts` (`TABLES`), `lib/booking/floor-plan.ts` (геометрия, ориентиры) | `check:rules`, раздел 9 |
| Статусы столов `free`/`busy`/`unsuitable`/`closed` и «N свободно» по окнам | SQL `vm_table_availability`, `vm_day_availability` (`*_floor_plan`); `lib/booking/service.ts` → `dayPlan`; `app/book/floor-plan.tsx` | `/book`; `check:rules`: статусы = `tableStatus()` из `rules.ts`, полоса окон = `vm_available_slots` |
| Выбор стола: `guests ≤ capacity ≤ guests + 2`, `VM_TABLE_UNAVAILABLE` | `rules.ts` → `TABLE_SLACK`, `tableFitsGuests`; SQL `vm_table_fits`, `vm_create_booking(…, p_table_id)`; `createBookingAction` (поле `tableId`) | `check:rules`, раздел 9; `check:http`: шаги «план» |
| Гонка двух гостей за один стол | EXCLUDE `Booking_table_no_overlap`, `vm_create_booking` переводит его в `VM_TABLE_UNAVAILABLE` | `check:rules`: параллельные запросы; `check:http`: второй гость получает ошибку и обновлённый план |
| План с клавиатуры и для скринридера; 375 px | `app/book/floor-plan.tsx`: свободные столы — ссылки SVG с `aria-label`, остальные — `role="img"`; Esc; книжный вариант плана | шаги 4а и 4в |
| Движение design.md 4б и reduced-motion | `app/components/home-motion.tsx` (GSAP, ScrollTrigger, SplitText, Lenis, очистка `ctx.revert()`, `lenis.destroy()`), скрипт `data-motion` в `app/layout.tsx`, CSS в `globals.css` | главная; системная настройка «уменьшить движение» |
| Визуальная система, 375 px, пустые состояния, отмена в два нажатия | `app/globals.css` (токены `design.md`), `app/components/*` (`RowAction`, `EmptyState`) | узкое окно браузера; `docs/check-log.md` |
| Миграции на чистую базу, seed, проверка правил | `prisma/migrations`, `prisma/seed.ts`, `scripts/check-rules.ts` | `npm run db:deploy && npm run db:seed && npm run check:rules` |

## 10. Правила окон, выбор стола и машина состояний

Полностью — `spec.md`, разделы 4–5. Кратко:

- Время ресторана — Europe/Moscow (UTC+3), в базе всё хранится в UTC.
- Бронировать можно на сегодня и ещё 13 дней. Вторник–воскресенье, понедельник закрыт.
- Окна по 90 минут: 12:00, 13:30, 15:00, 16:30, 18:00, 19:30 (последнее заканчивается в 21:00).
- Окно показывается, только если оно ещё не началось, не закрыто (`SlotClosure` на окно или весь день), есть активный стол с `capacity ≥ guests`, свободный в это окно, и у пользователя нет активного бронирования на это время.
- «Подобрать автоматически» назначает самый маленький подходящий стол (по `capacity`, затем по `code`). Гостей — от 1 до 8.
- На плане можно выбрать только активный стол, свободный в это окно, с `guests ≤ capacity ≤ guests + 2` (двое не занимают стол на восемь). Иначе база отвечает `VM_TABLE_UNAVAILABLE`.
- Статусы стола на плане: `free` — можно выбрать; `busy` — занят в это окно; `unsuitable` — не подходит по числу мест; `closed` — окно недоступно (закрыто, началось, у вас уже есть бронь на это время) или стол не обслуживается.

```
pending ──(до начала)──────────────▶ confirmed
pending ──(в любое время)──────────▶ cancelled      (гость — только за ≥ 3 ч до начала)
confirmed ──(до начала)────────────▶ cancelled      (гость — только за ≥ 3 ч до начала)
pending / confirmed ──(после начала)──▶ completed | no_show
cancelled, completed, no_show — терминальные, переходов нет
```

| Из → в | Кто | Когда |
|--------|-----|-------|
| `pending` → `confirmed` | admin, super_admin | до начала окна |
| `pending`/`confirmed` → `cancelled` | владелец брони | не позднее чем за 3 часа до начала |
| `pending` → `cancelled` | admin, super_admin | в любое время |
| `confirmed` → `cancelled` | admin, super_admin | до начала окна |
| `pending`/`confirmed` → `completed` / `no_show` | admin, super_admin | после начала окна |

`cancelled`, `completed`, `no_show` — терминальные статусы: триггер базы отклоняет любую их смену.

## 11. Частые проблемы

| Симптом | Причина и решение |
|---------|-------------------|
| `EADDRINUSE: address already in use :::3010` (или `:3000`) | порт занят. macOS/Linux: `lsof -i :3010`; Windows: `netstat -ano \| findstr :3010`. Освободите порт или запустите на другом: `npx next start -p 3020`. Для `check:http` тогда задайте `SMOKE_BASE_URL=http://localhost:3020` |
| `extension "btree_gist" is not available` | нет пакета contrib. Linux: `sudo apt install postgresql-contrib`. macOS и Windows: переустановите PostgreSQL штатным установщиком (Postgres.app, Homebrew, EDB) |
| `permission denied to create extension "btree_gist"` | у пользователя из `DATABASE_URL` нет прав. Выполните `CREATE EXTENSION IF NOT EXISTS btree_gist;` в обеих базах от суперпользователя (см. раздел Linux) |
| `P1001: Can't reach database server` | PostgreSQL не запущен или неверный хост/порт. macOS: запустите Postgres.app или `brew services start postgresql@17`; Linux: `sudo systemctl start postgresql`; Windows: служба `postgresql-x64-<версия>` в «Службах» |
| `P1000: Authentication failed` / `password authentication failed` | неверные пользователь или пароль в `DATABASE_URL`. Спецсимволы в пароле нужно закодировать (`@` → `%40`) |
| `P1003: Database does not exist` | не созданы базы `verde_marea` и `verde_marea_shadow` (см. раздел для вашей ОС) |
| `Не задана переменная окружения SEED_…` при seed | нет `.env` или в нём не хватает строк — скопируйте `.env.example` |
| Сборка падает на `Failed to fetch font` / `next/font` | при первой сборке нет интернета (Google Fonts). Подключитесь к сети и повторите `npm run build`. Без сети можно временно убрать импорты `Cormorant_Garamond`/`Manrope` из `app/layout.tsx` — CSS сам переключится на запасные Georgia и system-ui (`--font-display`, `--font-sans` в `globals.css`) |
| Windows: `createdb` не найден | вызывайте с полным путём `& "C:\Program Files\PostgreSQL\17\bin\createdb.exe"` или добавьте папку `bin` в PATH |
| Windows: ошибки путей и `ENOENT` | держите проект в пути без кириллицы и пробелов, например `C:\projects\verde-marea`; команды запускайте из PowerShell в папке проекта |
| Вход демо-пароли не принимает | seed запускался с другими значениями в `.env`. Проверьте строки `SEED_*` и выполните `npm run db:seed` — пароли обновятся |
| `npm run db:reset` отказывается работать, сообщение про AI agent | защита Prisma 6.19 от запуска ИИ-агентами. Человеку в своём терминале команда работает |
| `check:rules` пишет `Environment variable not found: DATABASE_URL` | нет файла `.env` в корне проекта (скрипт читает его через `--env-file=.env`) — скопируйте `.env.example` |

## 12. Безопасное обновление после изменений

**Схема данных** (`prisma/schema.prisma`):
1. Измените схему и создайте **новую** миграцию: `npm run db:migrate -- --name <что_изменили>`. Уже применённые миграции не редактируются.
2. Правила, которые Prisma не выражает (CHECK, EXCLUDE, триггеры, функции `vm_*`), добавляйте отдельной SQL-миграцией: `npx prisma migrate dev --create-only --name <имя>`, затем `CREATE OR REPLACE FUNCTION …` и `npm run db:migrate`. Так сделана миграция `*_pending_after_start`.
3. Проверьте, что миграции и схема совпадают. Ожидаемый вывод — `No difference detected.`:
   ```bash
   npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL"
   ```
4. Перед изменением рабочей базы сделайте копию: `pg_dump verde_marea > .backups/verde_marea-$(date +%F).sql` (папка `.backups/` в `.gitignore`), затем `npm run db:deploy`.

**Правила и серверная логика** (окна, переходы, права): правило меняется сразу в трёх местах — `lib/booking/rules.ts` или `lib/permissions.ts` → функция PostgreSQL в новой миграции → интерфейс (`AGENTS.md`). После изменения прогоните `npm run typecheck && npm run lint && npm run check:rules && npm run build`, затем `npm run check:http` на запущенном приложении. Результат запишите в `docs/check-log.md`.

## 13. Структура и документы

```
app/                     страницы: book, account, admin/{slots,users,audit}, login, register
  actions/               Server Actions: auth.ts, booking.ts, admin.ts
  book/floor-plan.tsx    план зала: полоса окон, SVG-план, карточка стола
  components/            общие компоненты: формы, бейджи, вкладки, плашка роли, шапка, home-motion (GSAP + Lenis)
lib/
  booking/rules.ts       правила окон, переходов и выбора стола (общие для интерфейса и сервера)
  booking/floor-plan.ts  геометрия плана: стулья, пересечения, ориентиры
  booking/service.ts     вызовы функций vm_*
  booking/queries.ts     чтение для страниц (без passwordHash)
  booking/errors.ts      коды VM_* → понятный текст
  permissions.ts         матрица ролей
  auth.ts, session.ts    пароли и регистрация; серверные сессии
  guard.ts               cookie, текущий пользователь, доступ к страницам
prisma/                  schema.prisma, migrations (init, booking_rules, pending_after_start, floor_plan), seed.ts
scripts/                 check-rules.ts, smoke-http.ts
docs/                    runbook.md, acceptance-checklist.md, check-log.md, screenshots/
```

Документы проекта:
- [`spec.md`](../spec.md) — спецификация: роли, сущности, статусы, правила, критерии готовности;
- [`design.md`](../design.md) — визуальная система Verde Marea;
- [`AGENTS.md`](../AGENTS.md) — правила работы ИИ над проектом;
- [`Plan.md`](../Plan.md) — этапы, решения и журнал;
- [`docs/acceptance-checklist.md`](acceptance-checklist.md) — чек-лист приёмки;
- [`docs/check-log.md`](check-log.md) — журнал проверок и исправлений;
- [`.env.example`](../.env.example) — переменные окружения с пояснениями.
