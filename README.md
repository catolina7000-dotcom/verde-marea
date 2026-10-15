# Verde Marea — бронирование столов ресторана

Онлайн-бронирование для небольшого ресторана средиземноморской кухни на набережной: гость выбирает дату, число гостей и окно на 90 минут, а потом — конкретный стол на интерактивном плане зала и веранды. Хостес ведёт поток бронирований и закрывает окна, владелец назначает администраторов. Правила бронирования одинаковы в интерфейсе, на сервере и в базе — один стол нельзя отдать двоим даже при одновременных запросах.

![Главная страница](docs/screenshots/home.png)

## Возможности

- **План зала.** SVG-план зала и веранды у моря с баром, открытой кухней, входом и окнами к морю. Статусы столов для выбранного окна приходят из базы: свободен, занят, не подходит по числу мест, недоступен. Выбор стола мышью или с клавиатуры (Tab, Enter, Esc), подписи для скринридера, отдельная книжная раскладка для телефона.
- **Только реальные варианты.** Полоса окон дня с числом свободных столов; прошедшие, закрытые и занятые окна не показываются. Можно выбрать стол самому (подходят столы на `guests…guests + 2` мест) или нажать «Подобрать автоматически» — система возьмёт самый маленький подходящий.
- **Защита от гонок.** Если стол заняли между показом и кликом, гость видит понятную ошибку и обновлённый план. Окончательное слово за PostgreSQL: функции `vm_*`, триггеры, CHECK и EXCLUDE-ограничения.
- **Кабинет гостя.** Мои бронирования со столом и статусом, внутренние уведомления, отмена в два нажатия не позднее чем за 3 часа до начала.
- **Административный контур.** Поток бронирований с фильтрами и допустимыми переходами статусов («Подтвердить», «Состоялось», «Неявка», «Отменить»), закрытие окон и целых дней, пользователи и роли, история изменений с автором и временем.
- **Роли.** `user`, `admin`, `super_admin` — одна матрица прав для интерфейса и сервера, окончательная проверка в базе по роли из базы.
- **Атмосфера.** Фото ресторана, инерционная прокрутка, заголовок по строкам из-под маски, проявление фото с параллаксом, бегущая строка и счётчики на главной. При «уменьшении движения» в системе всё статично.

| План зала и карточка стола | Телефон, 375 px | Администрирование |
|---|---|---|
| ![План зала на /book](docs/screenshots/book-plan.png) | ![План на телефоне](docs/screenshots/book-plan-mobile.png) | ![Административный контур](docs/screenshots/admin.png) |

## Стек

Next.js 16 (App Router, Server Actions) · React 19 · TypeScript · Tailwind CSS 4 · Zod 4 · Prisma 6.19 · PostgreSQL (`btree_gist`) · GSAP 3 (ScrollTrigger, SplitText) · Lenis · npm.

Авторизация — собственная (auth-lite): bcryptjs с 12 раундами, серверная сессия в httpOnly-cookie, в базе только SHA-256 токена.

## Быстрый запуск

Нужны **Node.js 20.9+**, **PostgreSQL 15+** с расширением `btree_gist` (входит в contrib) и интернет при первой сборке (шрифты Google Fonts). Подробная установка PostgreSQL для каждой ОС и частые проблемы — в [docs/runbook.md](docs/runbook.md).

### macOS (Postgres.app или Homebrew)

```bash
npm install
cp .env.example .env            # в DATABASE_URL и SHADOW_DATABASE_URL: USER:PASSWORD → ваш логин macOS, без пароля
createdb verde_marea
createdb verde_marea_shadow
npm run db:deploy               # миграции
npm run db:seed                 # демо-данные
npm run build
npm run start:local             # http://localhost:3010
```

### Linux (Ubuntu / Debian)

```bash
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE ROLE verde LOGIN PASSWORD 'придумайте_пароль' CREATEDB;"
sudo -u postgres createdb -O verde verde_marea
sudo -u postgres createdb -O verde verde_marea_shadow
npm install
cp .env.example .env            # postgresql://verde:придумайте_пароль@localhost:5432/verde_marea?schema=public (и …_shadow)
npm run db:deploy && npm run db:seed && npm run build && npm run start:local
```

### Windows (PowerShell, PostgreSQL от EDB)

```powershell
npm install
Copy-Item .env.example .env     # postgresql://postgres:ваш_пароль@localhost:5432/verde_marea?schema=public (и …_shadow)
$pg = "C:\Program Files\PostgreSQL\17\bin"
& "$pg\createdb.exe" -U postgres verde_marea
& "$pg\createdb.exe" -U postgres verde_marea_shadow
npm run db:deploy; npm run db:seed; npm run build; npm run start:local
```

Путь к проекту лучше держать без кириллицы и пробелов. Спецсимволы в пароле базы кодируйте: `@` → `%40`, `#` → `%23`.

### Проверки

```bash
npm run typecheck && npm run lint && npm run build
npm run check:rules             # 122 проверки правил на живой базе (тестовые данные 2031 года удаляются)
npm run check:http              # сквозной HTTP-сценарий на запущенном приложении (SMOKE_BASE_URL, по умолчанию :3010)
```

## Демо-аккаунты

> Учебные данные seed для локального запуска. Значения берутся из `.env.example` и создаются командой `npm run db:seed`. Это не настоящие пароли.

| Роль | Почта | Пароль | Что посмотреть |
|------|-------|--------|----------------|
| `super_admin` | `owner@verde-marea.test` | `VerdeMarea-Owner-2026` | «Пользователи»: назначить и снять администратора; «История» |
| `admin` | `admin@verde-marea.test` | `VerdeMarea-Demo-2026` | «Бронирования»: фильтры и переходы; «Окна записи»: закрыть и открыть день |
| `user` | `anna@verde-marea.test` | `VerdeMarea-Demo-2026` | `/book`: план зала и выбор стола; «Мои бронирования», уведомления, отмена |
| `user` | `pavel@verde-marea.test` | `VerdeMarea-Demo-2026` | второй гость: подтверждённое бронирование, неявка, вчерашнее неподтверждённое |

Seed при каждом запуске приводит пароли демо-аккаунтов к значениям из `.env`.

## Документы

- [docs/runbook.md](docs/runbook.md) — подробный runbook проверяющего: роли и экраны, установка на трёх ОС, все команды, сценарий ручной проверки, карта «требование → код → проверка», частые проблемы;
- [spec.md](spec.md) — спецификация (роли, сущности, статусы, правила, критерии готовности);
- [design.md](design.md) — визуальная система, фото и движение;
- [AGENTS.md](AGENTS.md) — правила работы ИИ над проектом;
- [Plan.md](Plan.md) — этапы, решения и журнал;
- [docs/acceptance-checklist.md](docs/acceptance-checklist.md) и [docs/check-log.md](docs/check-log.md) — чек-лист приёмки и журнал проверок.

## Безопасность

- Секреты только в локальном `.env` (в `.gitignore`); в репозитории — `.env.example` с заглушками.
- Пароли — `bcryptjs`, 12 раундов; `passwordHash` не попадает в интерфейс и ответы; сессия — httpOnly-cookie, в базе только SHA-256 токена.
- Демо-аккаунты выше — учебные значения для локального seed; на реальном сервере задайте свои в `.env`.
- `npm audit`: известное предупреждение `deepmerge-ts` (high) внутри Prisma CLI — инструмент разработки, читает только локальный конфиг, в рантайм приложения не попадает; исправляется обновлением Prisma после выхода стабильной версии.

## Фото

Фотографии ресторана — с [Unsplash](https://unsplash.com), по [Unsplash License](https://unsplash.com/license) (бесплатно, в том числе для коммерческих проектов, атрибуция не обязательна — ссылки на оригиналы ниже):

- зал при свечах (`public/images/hall.jpg`) — <https://unsplash.com/photos/restaurant-dining-tables-with-plants-and-soft-lighting-Xl3zzUp60yA>;
- повар на кухне (`public/images/kitchen.jpg`) — <https://unsplash.com/photos/chef-chopping-vegetables-in-restaurant-kitchen-y-XZf_TNRms>;
- шеф фламбирует (`public/images/chef.jpg`) — <https://unsplash.com/photos/man-in-white-chef-uniform-cooking-4NQEvxW2_4w>.

## Автор

Артём — Telegram [@livesley](https://t.me/livesley). Вопросы, идеи и предложения — пишите.

---

Проект собран в рамках курса «Вайбкодинг» Яндекс Практикума как финальный проект модуля 4; версия 2 (план зала, выразительное движение, этот README) — развитие после сдачи.
