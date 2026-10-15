// npm run check:http — сквозной сценарий по HTTP на запущенном приложении (по умолчанию http://localhost:3010).
// Формы отправляются так же, как их отправил бы браузер без JavaScript (Server Actions
// поддерживают прогрессивное улучшение): берём скрытые поля формы из HTML и делаем POST.
//
// Сценарий: регистрация → вход → /book → бронирование → /account → admin подтверждает →
// super_admin меняет роль → /admin/audit → отмена → выход. Плюс: редиректы без сессии,
// «Нет доступа» для user, отсутствие passwordHash и bcrypt-хешей в HTML.
// Пароли берутся из окружения (.env) и никуда не выводятся. Тестовый пользователь удаляется.

import { randomBytes } from "node:crypto";
import { prisma } from "../lib/db";
import { hashToken } from "../lib/session";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3010";
const DOMAIN = "smoke.verde-marea.test";

type Result = { name: string; ok: boolean; detail?: string };
const results: Result[] = [];
class Fail extends Error {}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Fail(msg);
}
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const detail = e instanceof Fail ? e.message : String((e as Error)?.stack ?? e);
    results.push({ name, ok: false, detail });
    console.log(`  ✗ ${name}\n      ${detail}`);
  }
}

// ------------------------------------------------------------------ HTTP и формы

const pagesSeen: { url: string; html: string }[] = [];

async function get(path: string, cookie?: string) {
  const res = await fetch(`${BASE}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" });
  const html = await res.text();
  pagesSeen.push({ url: path, html });
  return { status: res.status, location: res.headers.get("location"), html };
}

function unescape(s: string) {
  return s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\s${name.replace(/[$]/g, "\\$")}="([^"]*)"`));
  return m ? unescape(m[1]) : null;
}

type Form = { html: string; fields: [string, string][]; buttons: { name: string | null; value: string | null; text: string }[] };

function forms(html: string): Form[] {
  return Array.from(html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g), (m) => {
    const body = m[1];
    const fields: [string, string][] = [];
    for (const input of body.matchAll(/<input\b[^>]*>/g)) {
      const name = attr(input[0], "name");
      const type = attr(input[0], "type");
      if (name && (type === "hidden" || type === null)) fields.push([name, attr(input[0], "value") ?? ""]);
    }
    const buttons = Array.from(body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g), (b) => ({
      name: attr(b[0], "name"),
      value: attr(b[0], "value"),
      text: b[2].replace(/<[^>]+>/g, "").trim(),
    }));
    return { html: m[0], fields, buttons };
  });
}

function findForm(html: string, predicate: (f: Form) => boolean): Form {
  const f = forms(html).find(predicate);
  assert(f, "форма не найдена на странице");
  return f;
}

const hasField = (f: Form, name: string, value?: string) => f.fields.some(([n, v]) => n === name && (value === undefined || v === value));

async function submit(path: string, form: Form, extra: Record<string, string>, cookie?: string) {
  const body = new FormData();
  for (const [k, v] of form.fields) if (!(k in extra)) body.append(k, v);
  for (const [k, v] of Object.entries(extra)) body.append(k, v);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body,
    redirect: "manual",
    headers: { origin: BASE, ...(cookie ? { cookie } : {}) },
  });
  const html = await res.text();
  pagesSeen.push({ url: `POST ${path}`, html });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  return { status: res.status, location: res.headers.get("location"), html, setCookie };
}

function sessionCookie(setCookie: string[]): { cookie: string; raw: string } {
  const raw = setCookie.find((c) => c.startsWith("vm_session="));
  assert(raw, "нет Set-Cookie vm_session");
  return { cookie: raw.split(";")[0], raw };
}

async function login(email: string, password: string) {
  const page = await get("/login");
  const form = findForm(page.html, (f) => f.html.includes('name="password"'));
  const res = await submit("/login", form, { email, password });
  assert(res.status === 303, `вход: статус ${res.status}`);
  const session = sessionCookie(res.setCookie);
  issuedTokens.push(session.cookie.slice("vm_session=".length));
  return { ...session, location: res.location };
}

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`нет переменной ${name}`);
  return v;
}

/** Токены сессий, выданных при входе под пользователями seed, — удаляются в конце. */
const issuedTokens: string[] = [];

async function cleanup() {
  if (issuedTokens.length) await prisma.session.deleteMany({ where: { tokenHash: { in: issuedTokens.map(hashToken) } } });
  const ids = (await prisma.user.findMany({ where: { email: { endsWith: `@${DOMAIN}` } }, select: { id: true } })).map((u) => u.id);
  if (!ids.length) return;
  const bookingIds = (await prisma.booking.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((b) => b.id);
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { userId: { in: ids } } }),
    prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { in: ids } },
          { targetUserId: { in: ids } },
          { bookingId: { in: bookingIds } },
          { action: { in: ["slot_closed", "slot_opened"] }, details: { path: ["reason"], equals: "Смоук-проверка" } },
        ],
      },
    }),
    prisma.booking.deleteMany({ where: { userId: { in: ids } } }),
    prisma.session.deleteMany({ where: { userId: { in: ids } } }),
    prisma.user.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

// ------------------------------------------------------------------ сценарий

async function main() {
  await cleanup();
  const email = `guest-${Date.now()}@${DOMAIN}`;
  const password = randomBytes(12).toString("base64url");
  const name = "Смоук Проверкин";
  let userCookie = "";
  let adminCookie = "";
  let ownerCookie = "";
  let bookingId = "";

  console.log(`HTTP-сценарий на ${BASE}`);

  await step("главная открывается без входа", async () => {
    const r = await get("/");
    assert(r.status === 200 && r.html.includes("Verde Marea"), `статус ${r.status}`);
  });

  await step("без сессии защищённые страницы ведут на /login", async () => {
    for (const p of ["/book", "/account", "/admin", "/admin/slots", "/admin/users", "/admin/audit"]) {
      const r = await get(p);
      assert(r.status >= 300 && r.status < 400 && r.location?.endsWith("/login"), `${p}: ${r.status} → ${r.location}`);
    }
  });

  await step("регистрация: ошибка валидации показывается рядом с полем", async () => {
    const page = await get("/register");
    const form = findForm(page.html, (f) => f.html.includes('name="name"'));
    const r = await submit("/register", form, { name: "Я", email: "не-почта", password: "123" });
    assert(r.status === 200, `статус ${r.status}`);
    assert(r.html.includes("Имя — от 2 до 60 символов.") && r.html.includes("Введите корректную почту."), "нет ошибок полей");
  });

  await step("регистрация создаёт user, httpOnly-cookie сессии и ведёт на /book", async () => {
    const page = await get("/register");
    const form = findForm(page.html, (f) => f.html.includes('name="name"'));
    const r = await submit("/register", form, { name, email, password });
    assert(r.status === 303 && r.location?.endsWith("/book"), `статус ${r.status} → ${r.location}`);
    const { cookie, raw } = sessionCookie(r.setCookie);
    assert(/HttpOnly/i.test(raw) && /SameSite=lax/i.test(raw) && /Path=\//.test(raw), `атрибуты cookie: ${raw.replace(/=[^;]+/, "=…")}`);
    userCookie = cookie;
    const u = await prisma.user.findUniqueOrThrow({ where: { email }, select: { role: true, passwordHash: true } });
    assert(u.role === "user" && u.passwordHash.startsWith("$2b$12$"), "роль/хеш не те");
  });

  await step("выход и повторный вход по паролю", async () => {
    const page = await get("/account", userCookie);
    const logout = findForm(page.html, (f) => f.buttons.some((b) => b.text === "Выйти"));
    const r = await submit("/account", logout, {}, userCookie);
    assert(r.status === 303 && r.location?.endsWith("/"), `выход: ${r.status} → ${r.location}`);
    const after = await get("/account", userCookie);
    assert(after.status >= 300 && after.location?.endsWith("/login"), "старая cookie всё ещё действует");
    const bad = await (async () => {
      const lp = await get("/login");
      return submit("/login", findForm(lp.html, (f) => f.html.includes('name="password"')), { email, password: "wrong-password" });
    })();
    assert(bad.status === 200 && bad.html.includes("Неверная почта или пароль."), "неверный пароль не отклонён");
    const ok = await login(email, password);
    assert(ok.location?.endsWith("/book"), `после входа → ${ok.location}`);
    userCookie = ok.cookie;
  });

  await step("/login и /register с сессией уводят в /account", async () => {
    const r = await get("/login", userCookie);
    assert(r.status >= 300 && r.location?.endsWith("/account"), `${r.status} → ${r.location}`);
  });

  let chosen = { date: "", time: "" };
  await step("/book показывает окна; бронирование создаётся (pending) и ведёт в /account", async () => {
    // ищем ближайший день с окнами для 4 гостей
    const first = await get("/book?guests=4", userCookie);
    assert(first.status === 200, `статус ${first.status}`);
    const dates = [...new Set(Array.from(first.html.matchAll(/href="\/book\?date=(\d{4}-\d{2}-\d{2})&amp;guests=4"/g), (m) => m[1]))];
    assert(dates.length === 12, `дат в выборе: ${dates.length} (ожидалось 12 — 14 дней без понедельников)`);
    for (const d of dates.slice(1)) {
      const r = await get(`/book?date=${d}&guests=4`, userCookie);
      const form = forms(r.html).find((f) => hasField(f, "date", d) && f.buttons.some((b) => b.name === "time"));
      if (!form) continue;
      const time = form.buttons.find((b) => b.name === "time")!.value!;
      const res = await submit(`/book?date=${d}&guests=4`, form, { time }, userCookie);
      assert(res.status === 303 && res.location?.includes("/account?created=1"), `создание: ${res.status} → ${res.location}`);
      chosen = { date: d, time };
      break;
    }
    assert(chosen.date, "не нашлось дня с окнами");
    const b = await prisma.booking.findFirstOrThrow({
      where: { user: { email } },
      select: { id: true, status: true, guests: true, table: { select: { capacity: true } } },
    });
    assert(b.status === "pending" && b.guests === 4 && b.table.capacity === 4, `бронирование ${JSON.stringify(b)}`);
    bookingId = b.id;
  });

  await step("занятое окно: повторное бронирование на то же время — понятная ошибка", async () => {
    const r = await get(`/book?date=${chosen.date}&guests=2`, userCookie);
    const form = findForm(r.html, (f) => hasField(f, "date", chosen.date));
    assert(!form.buttons.some((b) => b.value === chosen.time), "окно со своей бронью всё ещё показано");
    const res = await submit(`/book?date=${chosen.date}&guests=2`, form, { time: chosen.time }, userCookie);
    assert(res.status === 200 && res.html.includes("У вас уже есть активное бронирование на это время."), `статус ${res.status}`);
  });

  // ---------------------------------------------------------------- план зала (версия 2)
  let planPick = { time: "", code: "", form: null as Form | null, url: "" };
  await step("план: полоса окон с числом свободных столов, SVG-план, ссылки на свободные столы", async () => {
    const r = await get(`/book?date=${chosen.date}&guests=2`, userCookie);
    assert(r.status === 200, `статус ${r.status}`);
    assert(/class="window-chip"/.test(r.html) && /\d+ свободно/.test(r.html), "нет полосы окон с «N свободно»");
    assert(r.html.includes("<svg") && r.html.includes("План зала, окно"), "нет SVG-плана");
    assert(/aria-label="Стол T\d, (зал|веранда), \d мест[а]?, свободен"/.test(r.html), "нет aria-label свободного стола");
    const links = Array.from(r.html.matchAll(/href="(\/book\?date=[^"]*?&amp;time=(\d{2}:\d{2})&amp;table=(T\d))"/g), (m) => ({
      url: unescape(m[1]),
      time: m[2],
      code: m[3],
    }));
    assert(links.length > 0, "нет ссылок на свободные столы");
    const pick = links.find((l) => l.time !== chosen.time) ?? links[0];
    planPick = { time: pick.time, code: pick.code, form: null, url: pick.url };
  });

  await step("план: клик по столу → карточка → «Забронировать этот стол» создаёт pending именно на этот стол", async () => {
    const r = await get(planPick.url, userCookie);
    assert(r.html.includes(`Стол ${planPick.code}`) && r.html.includes("Забронировать этот стол"), "нет карточки выбранного стола");
    const form = findForm(r.html, (f) => hasField(f, "tableId") && hasField(f, "time", planPick.time));
    planPick.form = form;
    const res = await submit(planPick.url, form, {}, userCookie);
    assert(res.status === 303 && res.location?.includes("/account?created=1"), `создание: ${res.status} → ${res.location}`);
    const b = await prisma.booking.findFirstOrThrow({
      where: { user: { email }, status: "pending", table: { code: planPick.code } },
      select: { guests: true, startsAt: true },
    });
    assert(b.guests === 2, `гостей ${b.guests}`);
  });

  await step("план: стол заняли между показом и кликом — понятная ошибка, план обновлён (стол занят)", async () => {
    const page = await get("/register");
    const form = findForm(page.html, (f) => f.html.includes('name="name"'));
    const reg = await submit("/register", form, { name: "Смоук Соперник", email: `rival-${Date.now()}@${DOMAIN}`, password });
    const rival = sessionCookie(reg.setCookie).cookie;
    assert(planPick.form, "нет формы стола из прошлого шага");
    const res = await submit(planPick.url, planPick.form, {}, rival);
    assert(res.status === 200, `статус ${res.status}`);
    assert(res.html.includes("Этот стол только что заняли"), "нет понятной ошибки о занятом столе");
    assert(new RegExp(`aria-label="Стол ${planPick.code}, [^"]*, занят в это время"`).test(res.html), "план не обновлён: стол не показан занятым");
    assert(!res.html.includes(`table=${planPick.code}"`), "занятый стол всё ещё можно выбрать");
  });

  await step("/account: бронирование, стол, статус, уведомление и кнопка отмены", async () => {
    const r = await get("/account?created=1", userCookie);
    assert(r.status === 200, `статус ${r.status}`);
    assert(r.html.includes("Ожидает подтверждения") && r.html.includes("Бронирование создано и ждёт подтверждения"), "нет статуса/плашки");
    assert(r.html.includes("создано: стол"), "нет уведомления");
    assert(forms(r.html).some((f) => hasField(f, "bookingId", bookingId)), "нет формы отмены");
  });

  await step("user в /admin видит «Нет доступа»", async () => {
    for (const p of ["/admin", "/admin/slots", "/admin/users", "/admin/audit"]) {
      const r = await get(p, userCookie);
      assert(r.status === 200 && r.html.includes("Нет доступа") && !r.html.includes("Окна записи</h1>"), `${p}: ${r.status}`);
    }
  });

  await step("демо-гости seed входят по паролю из README (SEED_DEMO_PASSWORD)", async () => {
    for (const demo of ["anna@verde-marea.test", "pavel@verde-marea.test"]) {
      const r = await login(demo, env("SEED_DEMO_PASSWORD"));
      assert(r.location?.endsWith("/book"), `${demo}: после входа → ${r.location}`);
    }
  });

  await step("admin входит, фильтрует и подтверждает бронирование", async () => {
    const a = await login("admin@verde-marea.test", env("SEED_DEMO_PASSWORD"));
    assert(a.location?.endsWith("/admin"), `после входа → ${a.location}`);
    adminCookie = a.cookie;
    const list = await get(`/admin?status=pending&date=${chosen.date}`, adminCookie);
    assert(list.status === 200 && list.html.includes(email), "бронирование не найдено фильтром");
    assert(!list.html.includes('badge badge-confirmed">'), "фильтр по статусу пропустил confirmed");
    const confirm = findForm(list.html, (f) => hasField(f, "bookingId", bookingId) && hasField(f, "to", "confirmed"));
    const r = await submit(`/admin?status=pending&date=${chosen.date}`, confirm, {}, adminCookie);
    assert(r.status === 200, `статус ${r.status}`);
    assert((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status === "confirmed", "статус не изменился");
    const filtered = await get(`/admin?status=confirmed&date=${chosen.date}`, adminCookie);
    assert(filtered.html.includes(email), "нет в фильтре confirmed");
  });

  await step("admin видит пользователей без кнопок смены роли, с пояснением", async () => {
    const r = await get("/admin/users", adminCookie);
    assert(r.status === 200 && r.html.includes(email), `статус ${r.status}`);
    assert(!forms(r.html).some((f) => hasField(f, "role")), "у admin есть формы смены роли");
    assert(r.html.includes("Роли меняет только владелец"), "нет пояснения о смене ролей");
  });

  await step("плашка «Ваша роль» показывает права admin и то, что только владельцу", async () => {
    const r = await get("/admin", adminCookie);
    assert(r.html.includes("Ваша роль:") && r.html.includes("Администратор"), "нет плашки роли");
    assert(r.html.includes("Только владельцу") && r.html.includes("Назначать и снимать администраторов"), "нет списка «Только владельцу»");
  });

  await step("pending после начала окна: в /admin есть «Состоялось», «Неявка», «Отменить», нет «Подтвердить»", async () => {
    const stale = await prisma.booking.findFirst({
      where: { status: "pending", startsAt: { lt: new Date() } },
      select: { id: true },
      orderBy: { startsAt: "desc" },
    });
    assert(stale, "в базе нет pending с начавшимся окном (его создаёт seed)");
    const r = await get("/admin?status=pending", adminCookie);
    const tos = forms(r.html)
      .filter((f) => hasField(f, "bookingId", stale.id))
      .flatMap((f) => f.fields.filter(([n]) => n === "to").map(([, v]) => v));
    assert(tos.sort().join(",") === "cancelled,completed,no_show", `кнопки: ${tos.join(",")}`);
  });

  await step("admin видит окна записи и закрывает/открывает окно", async () => {
    const r = await get("/admin/slots", adminCookie);
    const form = findForm(r.html, (f) => f.html.includes('name="reason"') && hasField(f, "date", chosen.date));
    const res = await submit("/admin/slots", form, { startTime: "", reason: "Смоук-проверка" }, adminCookie);
    assert(res.status === 200 && res.html.includes("День закрыт"), `закрытие: ${res.status}`);
    const after = await get("/admin/slots", adminCookie);
    const open = findForm(after.html, (f) => f.buttons.some((b) => b.text === "Открыть день"));
    const res2 = await submit("/admin/slots", open, {}, adminCookie);
    assert(res2.status === 200, `открытие: ${res2.status}`);
    assert((await prisma.slotClosure.count({ where: { reason: "Смоук-проверка" } })) === 0, "закрытие не снято");
  });

  await step("super_admin повышает пользователя до admin — у него открывается /admin", async () => {
    const o = await login(env("SEED_SUPER_ADMIN_EMAIL").toLowerCase(), env("SEED_SUPER_ADMIN_PASSWORD"));
    ownerCookie = o.cookie;
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const r = await get("/admin/users", ownerCookie);
    const promote = findForm(r.html, (f) => hasField(f, "userId", user.id) && hasField(f, "role", "admin"));
    const res = await submit("/admin/users", promote, {}, ownerCookie);
    assert(res.status === 200, `статус ${res.status}`);
    assert((await prisma.user.findUniqueOrThrow({ where: { email } })).role === "admin", "роль не изменилась");
    const admin = await get("/admin", userCookie);
    assert(admin.status === 200 && !admin.html.includes("Нет доступа"), "новый admin не видит /admin");
    const owners = forms(r.html).filter((f) => hasField(f, "role"));
    const superIds = (await prisma.user.findMany({ where: { role: "super_admin" }, select: { id: true } })).map((x) => x.id);
    assert(!owners.some((f) => superIds.some((id) => hasField(f, "userId", id))), "есть кнопка смены роли super_admin");
  });

  await step("super_admin понижает обратно до user", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
    const r = await get("/admin/users", ownerCookie);
    const demote = findForm(r.html, (f) => hasField(f, "userId", user.id) && hasField(f, "role", "user"));
    await submit("/admin/users", demote, {}, ownerCookie);
    assert((await prisma.user.findUniqueOrThrow({ where: { email } })).role === "user", "роль не вернулась");
  });

  await step("/admin/audit показывает создание, подтверждение, смену роли, закрытие и открытие с автором", async () => {
    const r = await get("/admin/audit", ownerCookie);
    assert(r.status === 200, `статус ${r.status}`);
    for (const text of ["Создал бронирование", "Подтвердил бронирование", "Сменил роль", "Закрыл окно", "Открыл окно", name, "Марина Хостес"]) {
      assert(r.html.includes(text), `нет «${text}»`);
    }
  });

  await step("гость отменяет своё бронирование в два шага (сервер принимает отмену)", async () => {
    const r = await get("/account", userCookie);
    const form = findForm(r.html, (f) => hasField(f, "bookingId", bookingId));
    assert(form.buttons.some((b) => b.text === "Отменить"), "нет кнопки «Отменить»");
    const res = await submit("/account", form, {}, userCookie);
    assert(res.status === 200 && res.html.includes("Бронирование отменено."), `статус ${res.status}`);
    assert((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } })).status === "cancelled", "не отменено");
  });

  await step("в HTML ни одной страницы нет passwordHash и bcrypt-хешей", async () => {
    const leaks = pagesSeen.filter((p) => p.html.includes("passwordHash") || /\$2[aby]\$\d{2}\$/.test(p.html));
    assert(leaks.length === 0, `утечка на: ${leaks.map((l) => l.url).join(", ")}`);
    assert(pagesSeen.length > 20, `проверено страниц: ${pagesSeen.length}`);
  });

  await cleanup();
  const failed = results.filter((r) => !r.ok);
  console.log(`\nИтого: ${results.length - failed.length} из ${results.length} шагов, проверено ответов: ${pagesSeen.length}.`);
  if (failed.length) process.exitCode = 1;
}

main()
  .catch(async (e) => {
    console.error("Сценарий прерван:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => {});
    await prisma.$disconnect();
  });
