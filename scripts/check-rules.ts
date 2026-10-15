// npm run check:rules — проверка правил spec.md (разделы 4–6, 10) на живой базе.
//
// Как устроено:
// - все тестовые данные лежат в 2031 году и у пользователей с почтой *@check.verde-marea.test,
//   поэтому данные seed не задеваются; в конце всё тестовое удаляется, счётчики seed сверяются;
// - «сейчас» для правил задаётся через SET LOCAL vm.now внутри транзакции (см. vm_now());
// - проверки, которые меняют общие данные (например, выключение стола), идут в транзакции
//   с откатом.
// Запуск: tsx --conditions=react-server (чтобы модули с "server-only" импортировались вне Next).

import { Prisma } from "@prisma/client";
import { prisma, publicUserSelect } from "../lib/db";
import { authenticate, hashPassword, registerUser } from "../lib/auth";
import { createSession, findSessionUser, hashToken } from "../lib/session";
import { errorCode } from "../lib/booking/errors";
import * as service from "../lib/booking/service";
import {
  addDays,
  bookableDates,
  BOOKING_STATUSES,
  canOwnerCancel,
  cancelDeadline,
  checkSlot,
  isMonday,
  SLOT_TIMES,
  slotStartsAt,
  staffTransitions,
  STATUS_TRANSITIONS,
  TABLE_SLACK,
  tableFitsGuests,
  tableStatus,
  type BookingStatus,
} from "../lib/booking/rules";
import { boxesOverlap, boxInside, HALL, LANDMARKS, PLAN_HEIGHT, PLAN_WIDTH, tableBox, VERANDA, type TableShape } from "../lib/booking/floor-plan";
import { can, canChangeRole, PERMISSIONS, ROLES, type Permission, type Role, type Viewer } from "../lib/permissions";

type Tx = Prisma.TransactionClient;

const EMAIL_DOMAIN = "check.verde-marea.test";
const BASE_DAY = "2031-03-05"; // среда
const BASE_NOW = slotStartsAt(BASE_DAY, "09:00");
const day = (n: number) => addDays(BASE_DAY, n);
const MIN = 60_000;

// --------------------------------------------------------------------------------------------
// Мини-фреймворк
// --------------------------------------------------------------------------------------------

type Result = { section: string; name: string; ok: boolean; detail?: string };
const results: Result[] = [];
let section = "";

class AssertionFailed extends Error {}
class Rollback extends Error {
  constructor(public value: unknown) {
    super("rollback");
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionFailed(message);
}

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ section, name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    const detail = e instanceof AssertionFailed ? e.message : `${errorCode(e)} ${(e as Error)?.message?.split("\n").slice(-1)[0] ?? e}`;
    results.push({ section, name, ok: false, detail });
    console.log(`  ✗ ${name}\n      ${detail}`);
  }
}

function begin(title: string) {
  section = title;
  console.log(`\n${title}`);
}

/** Ожидает ошибку с кодом VM_* (или именем ограничения) — иначе проверка не пройдена. */
async function expectCode(expected: string, fn: () => Promise<unknown>) {
  let got: string | null = null;
  let raw = "";
  try {
    await fn();
  } catch (e) {
    if (e instanceof AssertionFailed) throw e;
    got = errorCode(e);
    raw = `${(e as Error)?.message ?? e} ${JSON.stringify((e as { meta?: unknown })?.meta ?? "")}`;
  }
  assert(got !== null, `ожидалась ошибка ${expected}, но операция прошла`);
  // код VM_* из функции/триггера или имя ограничения базы (CHECK, EXCLUDE, UNIQUE, FK)
  const matched = expected.startsWith("VM_") ? got === expected : raw.includes(expected);
  assert(matched, `ожидалась ошибка ${expected}, получено ${got === "UNKNOWN" ? raw.slice(-200) : got}`);
}

/** Транзакция с заданным «сейчас». */
function at<T>(now: Date, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('vm.now', ${now.toISOString()}, true)`;
      return fn(tx);
    },
    { timeout: 30_000 },
  );
}

/** То же, но с откатом: изменения не сохраняются. */
async function dry<T>(now: Date, fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    await at(now, async (tx) => {
      throw new Rollback(await fn(tx));
    });
  } catch (e) {
    if (e instanceof Rollback) return e.value as T;
    throw e;
  }
  throw new Error("unreachable");
}

const slotsAt = (now: Date, userId: string | null, date: string, guests: number) =>
  at(now, (tx) => service.availableSlots(userId, date, guests, tx));

// --------------------------------------------------------------------------------------------
// Тестовые данные
// --------------------------------------------------------------------------------------------

type U = { id: string; email: string };
const users: Record<string, U> = {};
let sharedHash = "";

async function cleanup() {
  await prisma.$transaction(async (tx) => {
    const ids = (await tx.user.findMany({ where: { email: { endsWith: `@${EMAIL_DOMAIN}` } }, select: { id: true } })).map((u) => u.id);
    if (ids.length === 0) return;
    await tx.$executeRaw`SELECT set_config('vm.actor_id', ${ids[0]}, true)`;
    await tx.slotClosure.deleteMany({ where: { createdById: { in: ids } } });
    const bookingIds = (await tx.booking.findMany({ where: { userId: { in: ids } }, select: { id: true } })).map((b) => b.id);
    await tx.notification.deleteMany({ where: { userId: { in: ids } } });
    await tx.auditLog.deleteMany({
      where: { OR: [{ actorId: { in: ids } }, { targetUserId: { in: ids } }, { bookingId: { in: bookingIds } }] },
    });
    await tx.booking.deleteMany({ where: { userId: { in: ids } } });
    await tx.session.deleteMany({ where: { userId: { in: ids } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
  });
}

async function makeUser(key: string, role: Role = "user"): Promise<U> {
  const email = `${key}@${EMAIL_DOMAIN}`;
  const user = await prisma.$transaction(async (tx) => {
    if (role === "super_admin") await tx.$executeRaw`SELECT set_config('vm.allow_super_admin', 'on', true)`;
    return tx.user.create({ data: { email, name: `Проверка ${key}`, passwordHash: sharedHash, role }, select: { id: true, email: true } });
  });
  users[key] = user;
  return user;
}

async function snapshot() {
  const [u, t, b, n, a, c, s] = await Promise.all([
    prisma.user.count(),
    prisma.table.count(),
    prisma.booking.count(),
    prisma.notification.count(),
    prisma.auditLog.count(),
    prisma.slotClosure.count(),
    prisma.booking.groupBy({ by: ["status"], _count: true, orderBy: { status: "asc" } }),
  ]);
  return JSON.stringify({ u, t, b, n, a, c, s });
}

async function bookingStatus(id: string) {
  return (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
}

/** Бронирование в нужном статусе, проведённое по правилам с перемещением во времени. */
async function bookingIn(status: BookingStatus, owner: U, date: string, time: string, guests = 2): Promise<{ id: string; startsAt: Date }> {
  const startsAt = slotStartsAt(date, time);
  const admin = users.admin;
  const id = await at(BASE_NOW, (tx) => service.createBooking(owner.id, startsAt, guests, tx));
  if (status === "pending") return { id, startsAt };
  if (status === "cancelled") {
    await at(BASE_NOW, (tx) => service.changeBookingStatus(admin.id, id, "cancelled", tx));
    return { id, startsAt };
  }
  await at(BASE_NOW, (tx) => service.changeBookingStatus(admin.id, id, "confirmed", tx));
  if (status === "confirmed") return { id, startsAt };
  await at(new Date(startsAt.getTime() + 30 * MIN), (tx) => service.changeBookingStatus(admin.id, id, status, tx));
  return { id, startsAt };
}

// --------------------------------------------------------------------------------------------
// Проверки
// --------------------------------------------------------------------------------------------

async function main() {
  await cleanup();
  const before = await snapshot();
  sharedHash = await hashPassword("check-rules-password");

  // ---------------------------------------------------------------- seed
  begin("1. Данные seed (spec.md, раздел 10)");
  await check("8 активных столов вместимостью от 2 до 8", async () => {
    const tables = await prisma.table.findMany({ where: { isActive: true }, select: { capacity: true } });
    assert(tables.length === 8, `столов ${tables.length}`);
    const caps = tables.map((t) => t.capacity);
    assert(Math.min(...caps) === 2 && Math.max(...caps) === 8, `вместимость ${caps.join(",")}`);
  });
  await check("есть super_admin, admin и не меньше двух гостей", async () => {
    const roles = await prisma.user.groupBy({ by: ["role"], _count: true, where: { NOT: { email: { endsWith: `@${EMAIL_DOMAIN}` } } } });
    const n = (r: Role) => roles.find((x) => x.role === r)?._count ?? 0;
    assert(n("super_admin") >= 1 && n("admin") >= 1 && n("user") >= 2, JSON.stringify(roles));
  });
  await check("бронирования во всех пяти статусах и хотя бы одно закрытие", async () => {
    const statuses = (await prisma.booking.groupBy({ by: ["status"], _count: true })).map((s) => s.status);
    for (const s of BOOKING_STATUSES) assert(statuses.includes(s), `нет статуса ${s}`);
    assert((await prisma.slotClosure.count()) >= 1, "нет закрытий");
  });
  await check("у всех пользователей seed хеш bcrypt $2b$12$", async () => {
    const rows = await prisma.user.findMany({ select: { passwordHash: true } });
    assert(rows.every((r) => r.passwordHash.startsWith("$2b$12$")), "найден хеш не bcrypt-12");
  });

  // ---------------------------------------------------------------- test users
  await makeUser("owner", "super_admin");
  await makeUser("admin");
  await at(BASE_NOW, (tx) => service.setUserRole(users.owner.id, users.admin.id, "admin", tx));
  for (const k of ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"]) await makeUser(k);

  // ---------------------------------------------------------------- auth
  begin("2. Auth-lite и пароли");
  await check("регистрация создаёт user с хешем $2b$12$, вход сверяет bcrypt.compare", async () => {
    const created = await registerUser({ name: "Регистрация", email: `reg@${EMAIL_DOMAIN}`, password: "correct-horse-1" });
    assert(created, "пользователь не создан");
    assert(created.role === "user", `роль ${created.role}`);
    assert(!("passwordHash" in created), "registerUser вернул passwordHash");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id }, select: { passwordHash: true } });
    assert(/^\$2b\$12\$/.test(row.passwordHash), "хеш не bcrypt-12");
    assert((await authenticate(`reg@${EMAIL_DOMAIN}`, "correct-horse-1")) === created.id, "верный пароль не принят");
    assert((await authenticate(`reg@${EMAIL_DOMAIN}`, "wrong-password")) === null, "неверный пароль принят");
    assert((await authenticate(`nobody@${EMAIL_DOMAIN}`, "whatever-1")) === null, "вход без пользователя");
  });
  await check("повторная регистрация на ту же почту отклоняется", async () => {
    assert((await registerUser({ name: "Дубль", email: `reg@${EMAIL_DOMAIN}`, password: "another-pass-2" })) === null, "дубль создан");
  });
  await check("почта хранится в нижнем регистре (CHECK)", async () => {
    await expectCode("User_email_lowercase", () =>
      prisma.user.create({ data: { email: `UPPER@${EMAIL_DOMAIN}`, name: "Верхний", passwordHash: sharedHash } }),
    );
  });
  await check("имя 2–60 символов (CHECK)", async () => {
    await expectCode("User_name_length", () =>
      prisma.user.create({ data: { email: `short@${EMAIL_DOMAIN}`, name: "Я", passwordHash: sharedHash } }),
    );
  });
  await check("publicUserSelect не содержит passwordHash", async () => {
    assert(!Object.keys(publicUserSelect).includes("passwordHash"), "passwordHash в publicUserSelect");
  });
  await check("сессия: в базе только SHA-256 токена, пользователь без passwordHash, срок 7 дней", async () => {
    const { token, expiresAt } = await createSession(users.u1.id);
    const row = await prisma.session.findFirstOrThrow({ where: { userId: users.u1.id }, orderBy: { createdAt: "desc" } });
    assert(row.tokenHash === hashToken(token) && row.tokenHash !== token && row.tokenHash.length === 64, "токен хранится не хешем");
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    assert(days > 6.9 && days <= 7, `срок ${days.toFixed(2)} дн.`);
    const user = await findSessionUser(token);
    assert(user?.id === users.u1.id, "сессия не находит пользователя");
    assert(!("passwordHash" in (user ?? {})), "в сессии есть passwordHash");
  });
  await check("просроченная сессия не действует и удаляется", async () => {
    const { token } = await createSession(users.u2.id);
    await prisma.session.update({ where: { tokenHash: hashToken(token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert((await findSessionUser(token)) === null, "просроченная сессия принята");
    assert((await prisma.session.count({ where: { tokenHash: hashToken(token) } })) === 0, "просроченная сессия не удалена");
  });

  // ---------------------------------------------------------------- windows
  begin("3. Окна по правилам (spec.md, раздел 5)");
  await check("рабочий день: 6 окон 12:00…19:30, длительность 90 минут", async () => {
    const slots = await slotsAt(BASE_NOW, null, day(1), 2);
    assert(slots.map((s) => s.startTime).join(",") === SLOT_TIMES.join(","), slots.map((s) => s.startTime).join(","));
    assert(slots.every((s) => s.endsAt.getTime() - s.startsAt.getTime() === 90 * MIN), "длительность не 90 минут");
    assert(slots[slots.length - 1].endsAt.getTime() === slotStartsAt(day(1), "21:00").getTime(), "последнее окно не до 21:00");
  });
  await check("понедельник закрыт: окон нет (БД и rules.ts)", async () => {
    const monday = day(5);
    assert(isMonday(monday), "день не понедельник");
    assert((await slotsAt(BASE_NOW, null, monday, 2)).length === 0, "в понедельник есть окна");
    assert(checkSlot(monday, "12:00", BASE_NOW) === "VM_MONDAY", "rules.ts пропускает понедельник");
    await expectCode("VM_MONDAY", () => at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(monday, "12:00"), 2, tx)));
  });
  await check("прошлое: начавшееся окно не показывается и не бронируется", async () => {
    const now = slotStartsAt(BASE_DAY, "13:30"); // ровно начало окна 13:30
    const slots = (await slotsAt(now, null, BASE_DAY, 2)).map((s) => s.startTime);
    assert(!slots.includes("12:00") && !slots.includes("13:30") && slots.includes("15:00"), slots.join(","));
    assert(checkSlot(BASE_DAY, "13:30", now) === "VM_SLOT_STARTED" && checkSlot(BASE_DAY, "15:00", now) === null, "rules.ts расходится с БД");
    await expectCode("VM_SLOT_STARTED", () => at(now, (tx) => service.createBooking(users.u1.id, slotStartsAt(BASE_DAY, "13:30"), 2, tx)));
    assert((await slotsAt(BASE_NOW, null, day(-1), 2)).length === 0, "вчера есть окна");
  });
  await check("горизонт 14 дней: сегодня+13 доступен, сегодня+14 — нет", async () => {
    assert((await slotsAt(BASE_NOW, null, day(13), 2)).length === 6, "последний день горизонта пуст");
    assert((await slotsAt(BASE_NOW, null, day(14), 2)).length === 0, "день за горизонтом доступен");
    await expectCode("VM_OUT_OF_HORIZON", () => at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(day(14), "12:00"), 2, tx)));
    assert(checkSlot(day(14), "12:00", BASE_NOW) === "VM_OUT_OF_HORIZON", "rules.ts пропускает день за горизонтом");
  });
  await check("набор дней с окнами в БД совпадает с bookableDates() из rules.ts", async () => {
    const dbDays: string[] = [];
    for (let i = -1; i <= 15; i++) if ((await slotsAt(BASE_NOW, null, day(i), 1)).length > 0) dbDays.push(day(i));
    assert(dbDays.join(",") === bookableDates(BASE_NOW).join(","), `БД: ${dbDays.join(",")}`);
  });
  await check("время не из расписания и число гостей вне 1–8 отклоняются", async () => {
    await expectCode("VM_INVALID_SLOT", () => at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(day(1), "12:30"), 2, tx)));
    await expectCode("VM_INVALID_GUESTS", () => at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(day(1), "12:00"), 0, tx)));
    await expectCode("VM_INVALID_GUESTS", () => at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(day(1), "12:00"), 9, tx)));
    await expectCode("VM_INVALID_GUESTS", () => slotsAt(BASE_NOW, null, day(1), 9));
  });

  // ---------------------------------------------------------------- closures
  begin("4. Закрытие окон и дней");
  const closeDay = day(3); // суббота
  let windowClosureId = "";
  let dayClosureId = "";
  await check("admin закрывает окно: окно не показывается и не бронируется; запись slot_closed", async () => {
    windowClosureId = await at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, closeDay, "18:00", "Проверка: окно", tx));
    const slots = (await slotsAt(BASE_NOW, null, closeDay, 2)).map((s) => s.startTime);
    assert(!slots.includes("18:00") && slots.length === 5, slots.join(","));
    await expectCode("VM_SLOT_CLOSED", () => at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(closeDay, "18:00"), 2, tx)));
    const log = await prisma.auditLog.findFirst({ where: { action: "slot_closed", actorId: users.admin.id } });
    assert(log && (log.details as { startTime?: string }).startTime === "18:00", "нет записи slot_closed");
  });
  await check("повторное закрытие того же окна отклоняется", async () => {
    await expectCode("VM_CLOSURE_EXISTS", () => at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, closeDay, "18:00", "Ещё раз", tx)));
  });
  await check("закрытие не отменяет уже созданные бронирования", async () => {
    const b = await at(BASE_NOW, (tx) => service.createBooking(users.u9.id, slotStartsAt(closeDay, "19:30"), 2, tx));
    const cid = await at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, closeDay, "19:30", "Проверка: после брони", tx));
    assert((await bookingStatus(b)) === "pending", "бронирование изменилось после закрытия");
    await at(BASE_NOW, (tx) => service.openSlot(users.admin.id, cid, tx));
  });
  await check("admin закрывает весь день: окон нет; закрыть окно в закрытый день нельзя", async () => {
    dayClosureId = await at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, day(2), null, "Проверка: банкет", tx));
    assert((await slotsAt(BASE_NOW, null, day(2), 2)).length === 0, "в закрытый день есть окна");
    await expectCode("VM_SLOT_CLOSED", () => at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(day(2), "12:00"), 2, tx)));
    await expectCode("VM_CLOSURE_EXISTS", () => at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, day(2), "12:00", "Окно", tx)));
    await expectCode("VM_CLOSURE_EXISTS", () => at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, day(2), null, "Ещё раз", tx)));
  });
  await check("уникальность закрытий держит сама база (прямая вставка дубля дня)", async () => {
    await expectCode("Unique constraint failed on the fields: (`date`)", () =>
      prisma.slotClosure.create({ data: { date: new Date(`${day(2)}T00:00:00Z`), startTime: null, reason: "Дубль", createdById: users.admin.id } }),
    );
  });
  await check("закрытие: понедельник, за горизонтом, чужое время, пустая причина — отклоняются", async () => {
    await expectCode("VM_MONDAY", () => at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, day(5), null, "Причина", tx)));
    await expectCode("VM_OUT_OF_HORIZON", () => at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, day(15), null, "Причина", tx)));
    await expectCode("VM_INVALID_SLOT", () => at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, day(4), "21:00", "Причина", tx)));
    await expectCode("VM_INVALID_REASON", () => at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, day(4), null, "   ", tx)));
  });
  await check("user не закрывает и не открывает окна", async () => {
    await expectCode("VM_FORBIDDEN", () => at(BASE_NOW, (tx) => service.closeSlot(users.u1.id, day(4), null, "Причина", tx)));
    await expectCode("VM_FORBIDDEN", () => at(BASE_NOW, (tx) => service.openSlot(users.u1.id, windowClosureId, tx)));
  });
  await check("открытие возвращает окно и день; запись slot_opened; повторное открытие — ошибка", async () => {
    await at(BASE_NOW, (tx) => service.openSlot(users.admin.id, windowClosureId, tx));
    await at(BASE_NOW, (tx) => service.openSlot(users.owner.id, dayClosureId, tx));
    assert((await slotsAt(BASE_NOW, null, closeDay, 2)).some((s) => s.startTime === "18:00"), "окно не вернулось");
    assert((await slotsAt(BASE_NOW, null, day(2), 2)).length === 6, "день не вернулся");
    assert((await prisma.auditLog.count({ where: { action: "slot_opened", actorId: { in: [users.admin.id, users.owner.id] } } })) >= 2, "нет slot_opened");
    await expectCode("VM_CLOSURE_NOT_FOUND", () => at(BASE_NOW, (tx) => service.openSlot(users.admin.id, windowClosureId, tx)));
  });
  await check("удаление закрытия в обход функций без автора отклоняется (история обязательна)", async () => {
    const cid = await at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, day(4), "12:00", "Проверка: автор", tx));
    await expectCode("VM_ACTOR_REQUIRED", () => prisma.slotClosure.delete({ where: { id: cid } }));
    await at(BASE_NOW, (tx) => service.openSlot(users.admin.id, cid, tx));
  });

  // ---------------------------------------------------------------- booking creation
  begin("5. Создание бронирования и подбор стола");
  const D = day(1); // четверг
  await check("новое бронирование — pending, стол наименьшей вместимости (затем по коду)", async () => {
    const order: string[] = [];
    for (const k of ["u1", "u2", "u3", "u4"]) {
      const id = await at(BASE_NOW, (tx) => service.createBooking(users[k].id, slotStartsAt(D, "12:00"), 2, tx));
      const b = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, table: { select: { code: true } } } });
      assert(b.status === "pending", `статус ${b.status}`);
      order.push(b.table.code);
    }
    assert(order.join(",") === "T1,T2,T6,T3", `столы ${order.join(",")}`);
  });
  await check("окно показывает стол, который будет назначен", async () => {
    const slot = (await slotsAt(BASE_NOW, null, D, 2)).find((s) => s.startTime === "12:00");
    assert(slot?.tableCode === "T4", `показан ${slot?.tableCode}`);
  });
  await check("второе активное бронирование пользователя на то же время отклоняется (функция и БД)", async () => {
    await expectCode("VM_USER_OVERLAP", () => at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(D, "12:00"), 4, tx)));
    const free = await prisma.table.findFirstOrThrow({ where: { code: "T8" } });
    await expectCode("Booking_user_no_overlap", () =>
      at(BASE_NOW, async (tx) => {
        await tx.$executeRaw`SELECT set_config('vm.actor_id', ${users.u1.id}, true)`;
        await tx.$executeRaw`INSERT INTO "Booking" ("id","userId","tableId","startsAt","endsAt","guests","status","createdAt","updatedAt")
          VALUES ('direct-user-overlap', ${users.u1.id}, ${free.id}, ${slotStartsAt(D, "12:00")}, ${new Date(slotStartsAt(D, "12:00").getTime() + 90 * MIN)}, 2, 'pending', now(), now())`;
      }),
    );
  });
  await check("окно, где у пользователя уже есть бронирование, ему не показывается", async () => {
    assert(!(await slotsAt(BASE_NOW, users.u1.id, D, 2)).some((s) => s.startTime === "12:00"), "окно показано владельцу брони");
    assert((await slotsAt(BASE_NOW, users.u5.id, D, 2)).some((s) => s.startTime === "12:00"), "окно скрыто от другого гостя");
  });
  await check("один стол на пересекающееся окно — отклоняет база (прямая вставка в обход функций)", async () => {
    const t1 = await prisma.table.findFirstOrThrow({ where: { code: "T1" } });
    await expectCode("Booking_table_no_overlap", () =>
      at(BASE_NOW, async (tx) => {
        await tx.$executeRaw`SELECT set_config('vm.actor_id', ${users.u5.id}, true)`;
        await tx.$executeRaw`INSERT INTO "Booking" ("id","userId","tableId","startsAt","endsAt","guests","status","createdAt","updatedAt")
          VALUES ('direct-table-overlap', ${users.u5.id}, ${t1.id}, ${slotStartsAt(D, "12:00")}, ${new Date(slotStartsAt(D, "12:00").getTime() + 90 * MIN)}, 2, 'pending', now(), now())`;
      }),
    );
  });
  await check("прямая вставка: вместимость стола, длительность 90 минут, неактивный стол, автор", async () => {
    const t1 = await prisma.table.findFirstOrThrow({ where: { code: "T1" } });
    const t5 = await prisma.table.findFirstOrThrow({ where: { code: "T5" } });
    const s = slotStartsAt(D, "15:00");
    const insert = (tx: Tx, tableId: string, guests: number, endsAt: Date) =>
      tx.$executeRaw`INSERT INTO "Booking" ("id","userId","tableId","startsAt","endsAt","guests","status","createdAt","updatedAt")
        VALUES (${`direct-${guests}-${tableId}`}, ${users.u6.id}, ${tableId}, ${s}, ${endsAt}, ${guests}, 'pending', now(), now())`;
    const actor = (tx: Tx) => tx.$executeRaw`SELECT set_config('vm.actor_id', ${users.u6.id}, true)`;
    await expectCode("VM_CAPACITY", () => dry(BASE_NOW, async (tx) => { await actor(tx); await insert(tx, t1.id, 4, new Date(s.getTime() + 90 * MIN)); }));
    await expectCode("Booking_duration_90", () => dry(BASE_NOW, async (tx) => { await actor(tx); await insert(tx, t5.id, 2, new Date(s.getTime() + 60 * MIN)); }));
    await expectCode("Booking_guests_range", () => dry(BASE_NOW, async (tx) => { await actor(tx); await insert(tx, t5.id, 0, new Date(s.getTime() + 90 * MIN)); }));
    await expectCode("VM_TABLE_INACTIVE", () =>
      dry(BASE_NOW, async (tx) => {
        await actor(tx);
        await tx.table.update({ where: { id: t5.id }, data: { isActive: false } });
        await insert(tx, t5.id, 2, new Date(s.getTime() + 90 * MIN));
      }),
    );
    await expectCode("VM_ACTOR_REQUIRED", () => dry(BASE_NOW, (tx) => insert(tx, t5.id, 2, new Date(s.getTime() + 90 * MIN))));
  });
  await check("неактивный стол не назначается (откат после проверки)", async () => {
    const code = await dry(BASE_NOW, async (tx) => {
      await tx.table.updateMany({ where: { code: "T1" }, data: { isActive: false } });
      const id = await service.createBooking(users.u7.id, slotStartsAt(D, "16:30"), 1, tx);
      return (await tx.booking.findUniqueOrThrow({ where: { id }, select: { table: { select: { code: true } } } })).table.code;
    });
    assert(code === "T2", `назначен ${code}`);
  });
  await check("нет подходящего свободного стола — окна нет, бронирование отклоняется", async () => {
    await at(BASE_NOW, (tx) => service.createBooking(users.u5.id, slotStartsAt(D, "13:30"), 7, tx)); // T8
    const for7 = (await slotsAt(BASE_NOW, null, D, 7)).map((s) => s.startTime);
    const for2 = (await slotsAt(BASE_NOW, null, D, 2)).map((s) => s.startTime);
    assert(!for7.includes("13:30") && for2.includes("13:30"), `7: ${for7.join(",")}; 2: ${for2.join(",")}`);
    await expectCode("VM_NO_TABLE", () => at(BASE_NOW, (tx) => service.createBooking(users.u6.id, slotStartsAt(D, "13:30"), 7, tx)));
  });
  await check("гонка: два параллельных запроса на последний стол — проходит ровно один", async () => {
    const s = slotStartsAt(D, "18:00");
    const outcomes = await Promise.allSettled([
      at(BASE_NOW, (tx) => service.createBooking(users.u7.id, s, 8, tx)),
      at(BASE_NOW, (tx) => service.createBooking(users.u8.id, s, 8, tx)),
    ]);
    const ok = outcomes.filter((o) => o.status === "fulfilled").length;
    const codes = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected").map((o) => errorCode(o.reason));
    assert(ok === 1 && codes[0] === "VM_NO_TABLE", `успешных ${ok}, ошибки ${codes.join(",")}`);
  });
  await check("отменённое бронирование освобождает стол", async () => {
    const s = slotStartsAt(D, "19:30");
    const id = await at(BASE_NOW, (tx) => service.createBooking(users.u7.id, s, 8, tx));
    await expectCode("VM_NO_TABLE", () => at(BASE_NOW, (tx) => service.createBooking(users.u8.id, s, 8, tx)));
    await at(BASE_NOW, (tx) => service.changeBookingStatus(users.u7.id, id, "cancelled", tx));
    await at(BASE_NOW, (tx) => service.createBooking(users.u8.id, s, 8, tx));
  });
  await check("создание пишет AuditLog booking_created и Notification владельцу", async () => {
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: users.u2.id }, select: { id: true } });
    const log = await prisma.auditLog.findFirst({ where: { bookingId: b.id, action: "booking_created" } });
    const note = await prisma.notification.findFirst({ where: { bookingId: b.id, type: "booking_created" } });
    assert(log?.actorId === users.u2.id, "нет записи истории с автором");
    assert(note?.userId === users.u2.id && note.message.length > 10, "нет уведомления владельцу");
  });
  await check("уведомление нельзя привязать к чужому пользователю (составной FK)", async () => {
    const b = await prisma.booking.findFirstOrThrow({ where: { userId: users.u2.id }, select: { id: true } });
    await expectCode("Notification_bookingId_userId_fkey", () =>
      prisma.notification.create({ data: { userId: users.u3.id, bookingId: b.id, type: "booking_created", message: "Чужое" } }),
    );
  });

  // ---------------------------------------------------------------- cancel deadline
  begin("6. Дедлайн отмены гостем — 3 часа");
  const cancelDay = day(4); // воскресенье
  const cb = await at(BASE_NOW, (tx) => service.createBooking(users.u1.id, slotStartsAt(cancelDay, "18:00"), 2, tx));
  const cbStart = slotStartsAt(cancelDay, "18:00");
  await check("ровно за 3 часа владелец отменяет (now ≤ startsAt − 3 ч)", async () => {
    const now = cancelDeadline(cbStart);
    assert(canOwnerCancel("pending", cbStart, now), "rules.ts запрещает");
    await dry(now, (tx) => service.changeBookingStatus(users.u1.id, cb, "cancelled", tx));
  });
  await check("за 2 ч 59 мин владелец уже не отменяет (сервер и база)", async () => {
    const now = new Date(cancelDeadline(cbStart).getTime() + MIN);
    assert(!canOwnerCancel("pending", cbStart, now), "rules.ts разрешает");
    await expectCode("VM_CANCEL_DEADLINE", () => at(now, (tx) => service.changeBookingStatus(users.u1.id, cb, "cancelled", tx)));
  });
  await check("чужое бронирование user отменить не может", async () => {
    await expectCode("VM_FORBIDDEN", () => at(BASE_NOW, (tx) => service.changeBookingStatus(users.u2.id, cb, "cancelled", tx)));
  });
  await check("admin отменяет pending и до, и после начала окна (без дедлайна гостя)", async () => {
    await dry(new Date(cbStart.getTime() - MIN), (tx) => service.changeBookingStatus(users.admin.id, cb, "cancelled", tx));
    await dry(new Date(cbStart.getTime() + 60 * MIN), (tx) => service.changeBookingStatus(users.admin.id, cb, "cancelled", tx));
  });
  await check("отмена владельцем пишет booking_cancelled в историю и уведомление", async () => {
    await at(BASE_NOW, (tx) => service.changeBookingStatus(users.u1.id, cb, "cancelled", tx));
    assert((await bookingStatus(cb)) === "cancelled", "статус не cancelled");
    assert(await prisma.auditLog.findFirst({ where: { bookingId: cb, action: "booking_cancelled", actorId: users.u1.id } }), "нет истории");
    assert(await prisma.notification.findFirst({ where: { bookingId: cb, type: "booking_cancelled", userId: users.u1.id } }), "нет уведомления");
  });

  // ---------------------------------------------------------------- transitions
  begin("7. Переходы статусов: все пары × время (spec.md, раздел 4)");
  const fixtures: Record<BookingStatus, { id: string; startsAt: Date }> = {} as never;
  const td = day(6); // вторник
  const owners: Record<BookingStatus, U> = { pending: users.u1, confirmed: users.u2, cancelled: users.u3, completed: users.u4, no_show: users.u5 };
  for (const s of BOOKING_STATUSES) fixtures[s] = await bookingIn(s, owners[s], td, "18:00");
  const before0 = new Date(fixtures.pending.startsAt.getTime() - 60 * MIN);
  const after0 = new Date(fixtures.pending.startsAt.getTime() + 30 * MIN);

  for (const from of BOOKING_STATUSES) {
    for (const to of BOOKING_STATUSES) {
      for (const [label, now] of [["до начала", before0], ["после начала", after0]] as const) {
        const expectedOk = staffTransitions(from, fixtures[from].startsAt, now).includes(to);
        await check(`admin: ${from} → ${to} ${label} — ${expectedOk ? "разрешено" : "запрещено"}`, async () => {
          const f = fixtures[from];
          if (expectedOk) {
            const effects = await dry(now, async (tx) => {
              await service.changeBookingStatus(users.admin.id, f.id, to, tx);
              const st = (await tx.booking.findUniqueOrThrow({ where: { id: f.id } })).status;
              const log = await tx.auditLog.findFirst({ where: { bookingId: f.id, action: `booking_${to}` as never, actorId: users.admin.id } });
              const note = await tx.notification.findFirst({ where: { bookingId: f.id, type: `booking_${to}` as never, userId: owners[from].id } });
              return { st, log: !!log, note: !!note, details: log?.details as { from?: string; to?: string } | undefined };
            });
            assert(effects.st === to, `статус ${effects.st}`);
            assert(effects.log && effects.details?.from === from && effects.details?.to === to, "нет записи истории {from,to}");
            assert(effects.note, "нет уведомления владельцу");
          } else {
            const expected = STATUS_TRANSITIONS[from].length === 0
              ? "VM_TERMINAL_STATUS"
              : STATUS_TRANSITIONS[from].includes(to)
                ? (to === "confirmed" || to === "cancelled" ? "VM_WINDOW_STARTED" : "VM_WINDOW_NOT_STARTED")
                : "VM_INVALID_TRANSITION";
            await expectCode(expected, () => dry(now, (tx) => service.changeBookingStatus(users.admin.id, f.id, to, tx)));
          }
        });
      }
    }
  }
  await check("pending после начала окна не «зависает»: admin закрывает как completed, no_show или cancelled", async () => {
    for (const to of ["completed", "no_show", "cancelled"] as const) {
      const st = await dry(after0, async (tx) => {
        await service.changeBookingStatus(users.admin.id, fixtures.pending.id, to, tx);
        return (await tx.booking.findUniqueOrThrow({ where: { id: fixtures.pending.id } })).status;
      });
      assert(st === to, `${to}: статус ${st}`);
    }
    assert(staffTransitions("pending", fixtures.pending.startsAt, after0).join(",") === "cancelled,completed,no_show", "rules.ts расходится");
    await expectCode("VM_WINDOW_STARTED", () => dry(after0, (tx) => service.changeBookingStatus(users.admin.id, fixtures.pending.id, "confirmed", tx)));
  });
  await check("confirmed после начала окна admin не отменяет; pending до начала — не завершает", async () => {
    await expectCode("VM_WINDOW_STARTED", () => dry(after0, (tx) => service.changeBookingStatus(users.admin.id, fixtures.confirmed.id, "cancelled", tx)));
    await expectCode("VM_WINDOW_NOT_STARTED", () => dry(before0, (tx) => service.changeBookingStatus(users.admin.id, fixtures.pending.id, "completed", tx)));
    await expectCode("VM_WINDOW_NOT_STARTED", () => dry(before0, (tx) => service.changeBookingStatus(users.admin.id, fixtures.pending.id, "no_show", tx)));
  });
  await check("владелец не отменяет свой pending после начала окна (дедлайн 3 часа)", async () => {
    await expectCode("VM_CANCEL_DEADLINE", () => dry(after0, (tx) => service.changeBookingStatus(owners.pending.id, fixtures.pending.id, "cancelled", tx)));
  });
  await check("super_admin выполняет те же переходы, что admin", async () => {
    await dry(before0, (tx) => service.changeBookingStatus(users.owner.id, fixtures.pending.id, "confirmed", tx));
    await dry(after0, (tx) => service.changeBookingStatus(users.owner.id, fixtures.confirmed.id, "no_show", tx));
    await dry(after0, (tx) => service.changeBookingStatus(users.owner.id, fixtures.pending.id, "completed", tx));
  });
  await check("user не подтверждает, не завершает и не отмечает неявку даже своё", async () => {
    await expectCode("VM_FORBIDDEN", () => dry(before0, (tx) => service.changeBookingStatus(users.u1.id, fixtures.pending.id, "confirmed", tx)));
    await expectCode("VM_FORBIDDEN", () => dry(after0, (tx) => service.changeBookingStatus(users.u2.id, fixtures.confirmed.id, "completed", tx)));
    await expectCode("VM_FORBIDDEN", () => dry(after0, (tx) => service.changeBookingStatus(users.u2.id, fixtures.confirmed.id, "no_show", tx)));
    await expectCode("VM_FORBIDDEN", () => dry(after0, (tx) => service.changeBookingStatus(users.u1.id, fixtures.pending.id, "completed", tx)));
  });
  await check("терминальные статусы не меняются и прямым UPDATE (триггер)", async () => {
    for (const s of ["cancelled", "completed", "no_show"] as const) {
      await expectCode("VM_TERMINAL_STATUS", () =>
        dry(before0, async (tx) => {
          await tx.$executeRaw`SELECT set_config('vm.actor_id', ${users.admin.id}, true)`;
          await tx.booking.update({ where: { id: fixtures[s].id }, data: { status: "pending" } });
        }),
      );
    }
  });
  await check("прямой UPDATE: недопустимый переход, правка полей, смена без автора — отклоняются", async () => {
    await expectCode("VM_INVALID_TRANSITION", () =>
      dry(before0, async (tx) => {
        await tx.$executeRaw`SELECT set_config('vm.actor_id', ${users.admin.id}, true)`;
        await tx.booking.update({ where: { id: fixtures.confirmed.id }, data: { status: "pending" } });
      }),
    );
    await expectCode("VM_WINDOW_STARTED", () =>
      dry(after0, async (tx) => {
        await tx.$executeRaw`SELECT set_config('vm.actor_id', ${users.admin.id}, true)`;
        await tx.booking.update({ where: { id: fixtures.confirmed.id }, data: { status: "cancelled" } });
      }),
    );
    await expectCode("VM_BOOKING_IMMUTABLE", () =>
      dry(before0, (tx) => tx.booking.update({ where: { id: fixtures.pending.id }, data: { guests: 1 } })),
    );
    await expectCode("VM_ACTOR_REQUIRED", () =>
      dry(before0, (tx) => tx.booking.update({ where: { id: fixtures.pending.id }, data: { status: "confirmed" } })),
    );
  });

  // ---------------------------------------------------------------- roles
  begin("8. Роли и матрица прав (spec.md, раздел 6)");
  const SPEC_MATRIX: Record<Permission, ("guest" | Role)[]> = {
    "auth.signIn": ["guest"],
    "slots.view": ["user", "admin", "super_admin"],
    "booking.create": ["user", "admin", "super_admin"],
    "booking.viewOwn": ["user", "admin", "super_admin"],
    "booking.cancelOwn": ["user", "admin", "super_admin"],
    "admin.access": ["admin", "super_admin"],
    "booking.manage": ["admin", "super_admin"],
    "slots.manage": ["admin", "super_admin"],
    "users.view": ["admin", "super_admin"],
    "users.changeRole": ["super_admin"],
    "audit.view": ["admin", "super_admin"],
  };
  await check("lib/permissions.ts совпадает с таблицей spec.md, раздел 6", async () => {
    for (const p of PERMISSIONS) {
      for (const v of [null, ...ROLES] as Viewer[]) {
        const expected = SPEC_MATRIX[p].includes(v ?? "guest");
        assert(can(v, p) === expected, `${p} для ${v ?? "гостя"}: ${can(v, p)}`);
      }
    }
  });
  await check("super_admin повышает user → admin и понижает обратно; история role_changed", async () => {
    await at(BASE_NOW, (tx) => service.setUserRole(users.owner.id, users.u9.id, "admin", tx));
    assert((await prisma.user.findUniqueOrThrow({ where: { id: users.u9.id } })).role === "admin", "не повышен");
    // через минуту: у записей истории разное время, порядок однозначен
    await at(new Date(BASE_NOW.getTime() + MIN), (tx) => service.setUserRole(users.owner.id, users.u9.id, "user", tx));
    assert((await prisma.user.findUniqueOrThrow({ where: { id: users.u9.id } })).role === "user", "не понижен");
    const logs = await prisma.auditLog.findMany({ where: { targetUserId: users.u9.id, action: "role_changed" }, orderBy: { createdAt: "asc" } });
    const pairs = logs.map((l) => `${(l.details as { from: string }).from}>${(l.details as { to: string }).to}`);
    assert(pairs.join(",") === "user>admin,admin>user" && logs.every((l) => l.actorId === users.owner.id), pairs.join(","));
  });
  await check("admin и user не меняют роли (БД и permissions.ts)", async () => {
    await expectCode("VM_FORBIDDEN", () => at(BASE_NOW, (tx) => service.setUserRole(users.admin.id, users.u9.id, "admin", tx)));
    await expectCode("VM_FORBIDDEN", () => at(BASE_NOW, (tx) => service.setUserRole(users.u1.id, users.u9.id, "admin", tx)));
    assert(!canChangeRole("admin", "user", "admin") && !canChangeRole("user", "user", "admin"), "permissions.ts разрешает");
    assert(canChangeRole("super_admin", "user", "admin") && canChangeRole("super_admin", "admin", "user"), "permissions.ts запрещает super_admin");
  });
  await check("роль super_admin никто не выдаёт и не снимает", async () => {
    const seedOwner = await prisma.user.findFirstOrThrow({ where: { role: "super_admin", NOT: { id: users.owner.id } } });
    await expectCode("VM_ROLE_PROTECTED", () => at(BASE_NOW, (tx) => service.setUserRole(users.owner.id, seedOwner.id, "user", tx)));
    await expectCode("VM_ROLE_PROTECTED", () => at(BASE_NOW, (tx) => service.setUserRole(users.owner.id, users.u9.id, "super_admin", tx)));
    await expectCode("VM_ROLE_PROTECTED", () => at(BASE_NOW, (tx) => service.setUserRole(users.owner.id, users.owner.id, "admin", tx)));
    assert(!canChangeRole("super_admin", "super_admin", "admin") && !canChangeRole("super_admin", "user", "super_admin"), "permissions.ts разрешает");
  });
  await check("роль super_admin защищена и от прямых UPDATE/INSERT (триггер)", async () => {
    await expectCode("VM_ROLE_PROTECTED", () =>
      dry(BASE_NOW, async (tx) => {
        await tx.$executeRaw`SELECT set_config('vm.actor_id', ${users.owner.id}, true)`;
        await tx.user.update({ where: { id: users.u9.id }, data: { role: "super_admin" } });
      }),
    );
    await expectCode("VM_ROLE_PROTECTED", () =>
      prisma.user.create({ data: { email: `sa@${EMAIL_DOMAIN}`, name: "Самозванец", passwordHash: sharedHash, role: "super_admin" } }),
    );
  });
  await check("та же роль — ошибка; смена роли в обход функции без автора отклоняется", async () => {
    await expectCode("VM_ROLE_UNCHANGED", () => at(BASE_NOW, (tx) => service.setUserRole(users.owner.id, users.u9.id, "user", tx)));
    await expectCode("VM_ACTOR_REQUIRED", () => prisma.user.update({ where: { id: users.u9.id }, data: { role: "admin" } }));
  });
  await check("право admin.access/booking.manage/slots.manage в permissions.ts совпадает с ответом БД", async () => {
    for (const [role, actor] of [["user", users.u6], ["admin", users.admin], ["super_admin", users.owner]] as const) {
      let dbManage = true;
      try {
        await dry(before0, (tx) => service.changeBookingStatus(actor.id, fixtures.pending.id, "confirmed", tx));
      } catch {
        dbManage = false;
      }
      let dbSlots = true;
      try {
        await dry(BASE_NOW, (tx) => service.closeSlot(actor.id, day(8), null, "Проверка прав", tx));
      } catch {
        dbSlots = false;
      }
      assert(dbManage === can(role, "booking.manage"), `booking.manage ${role}: БД ${dbManage}`);
      assert(dbSlots === can(role, "slots.manage"), `slots.manage ${role}: БД ${dbSlots}`);
    }
  });


  // ---------------------------------------------------------------- floor plan (v2)
  begin("9. План зала и выбор стола (spec.md, раздел 5 «Выбор стола на плане», 10а)");
  const planTables = await prisma.table.findMany({ orderBy: { code: "asc" } });
  const tid = (code: string) => planTables.find((t) => t.code === code)!.id;
  const geom = (t: (typeof planTables)[number]) => ({
    shape: t.shape as TableShape,
    x: t.planX,
    y: t.planY,
    w: t.planW,
    h: t.planH,
    capacity: t.capacity,
  });
  await check("seed: у 8 столов есть форма и место на плане 1000×640, столы со стульями не пересекаются", async () => {
    assert(planTables.length === 8, `столов ${planTables.length}`);
    const plan = { x0: 0, y0: 0, x1: PLAN_WIDTH, y1: PLAN_HEIGHT };
    for (const t of planTables) {
      assert(t.shape === "round" || t.shape === "rect", `${t.code}: форма ${t.shape}`);
      assert(boxInside(tableBox(geom(t), true), plan), `${t.code} выходит за план`);
      const zone = t.zone === "Зал" ? HALL : VERANDA;
      assert(boxInside(tableBox(geom(t), true), zone), `${t.code} не внутри зоны «${t.zone}»`);
      for (const l of LANDMARKS) assert(!boxesOverlap(tableBox(geom(t), true), l.box), `${t.code} наезжает на «${l.label}»`);
    }
    for (let i = 0; i < planTables.length; i++)
      for (let j = i + 1; j < planTables.length; j++)
        assert(!boxesOverlap(tableBox(geom(planTables[i]), true), tableBox(geom(planTables[j]), true)), `${planTables[i].code} пересекает ${planTables[j].code}`);
  });
  await check("CHECK плана: неизвестная форма и стол за границей плана отклоняются базой", async () => {
    await expectCode("Table_shape_valid", () => dry(BASE_NOW, (tx) => tx.table.update({ where: { code: "T1" }, data: { shape: "oval" } })));
    await expectCode("Table_plan_bounds", () => dry(BASE_NOW, (tx) => tx.table.update({ where: { code: "T1" }, data: { planX: 995 } })));
  });
  await check("правило guests ≤ capacity ≤ guests + 2: rules.ts совпадает с vm_table_fits для 1–12 мест × 1–8 гостей", async () => {
    const rows = await prisma.$queryRaw<{ c: number; g: number; fits: boolean }[]>`
      SELECT c, g, vm_table_fits(c, g) AS fits FROM generate_series(1, 12) c CROSS JOIN generate_series(1, 8) g`;
    assert(rows.length === 96, `строк ${rows.length}`);
    const diff = rows.filter((r) => tableFitsGuests(Number(r.c), Number(r.g)) !== r.fits);
    assert(diff.length === 0, `расхождения: ${diff.map((r) => `${r.c}/${r.g}`).join(", ")}`);
    const slack = await prisma.$queryRaw<{ s: number }[]>`SELECT vm_table_slack() AS s`;
    assert(Number(slack[0].s) === TABLE_SLACK, `vm_table_slack ${slack[0].s}`);
  });
  const PD = day(7); // среда, пустой день
  const ps = (t: string) => slotStartsAt(PD, t);
  const avail = (now: Date, userId: string | null, startsAt: Date, guests: number) =>
    at(now, (tx) => service.tableAvailability(userId, startsAt, guests, tx));
  await check("пустое окно: статусы столов в БД = tableStatus() из rules.ts для 1–8 гостей", async () => {
    for (let g = 1; g <= 8; g++) {
      const rows = await avail(BASE_NOW, null, ps("12:00"), g);
      assert(rows.length === 8, `строк ${rows.length}`);
      for (const r of rows) {
        const expected = tableStatus({ windowOpen: true, isActive: r.isActive, busy: false, capacity: r.capacity, guests: g });
        assert(r.status === expected, `${g} гостей, ${r.code}: БД ${r.status}, rules.ts ${expected}`);
      }
      assert(rows.some((r) => r.status === "free"), `${g} гостей: нет ни одного подходящего стола`);
    }
  });
  await makeUser("p1");
  await makeUser("p2");
  await makeUser("p3");
  await check("выбор стола: бронирование pending именно на выбранный стол, история и уведомление", async () => {
    const id = await at(BASE_NOW, (tx) => service.createBooking(users.p1.id, ps("13:30"), 2, tx, tid("T3")));
    const b = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, table: { select: { code: true } } } });
    assert(b.status === "pending" && b.table.code === "T3", `${b.status} ${b.table.code}`);
    assert(await prisma.auditLog.findFirst({ where: { bookingId: id, action: "booking_created", actorId: users.p1.id } }), "нет истории");
    assert(await prisma.notification.findFirst({ where: { bookingId: id, userId: users.p1.id, type: "booking_created" } }), "нет уведомления");
  });
  await check("статусы в окне: busy у занятого стола, closed у всех столов для гостя, который уже бронирует это время", async () => {
    const other = await avail(BASE_NOW, users.p2.id, ps("13:30"), 2);
    assert(other.find((r) => r.code === "T3")?.status === "busy", "T3 не busy");
    assert(other.find((r) => r.code === "T1")?.status === "free", "T1 не free");
    assert(other.find((r) => r.code === "T8")?.status === "unsuitable", "T8 для двоих не unsuitable");
    const own = await avail(BASE_NOW, users.p1.id, ps("13:30"), 2);
    assert(own.every((r) => r.status === "closed"), `у владельца брони: ${own.map((r) => r.status).join(",")}`);
  });
  await check("p_table_id: стол меньше числа гостей и стол больше guests + 2 — VM_TABLE_UNAVAILABLE", async () => {
    await expectCode("VM_TABLE_UNAVAILABLE", () => at(BASE_NOW, (tx) => service.createBooking(users.p2.id, ps("15:00"), 3, tx, tid("T1"))));
    await expectCode("VM_TABLE_UNAVAILABLE", () => at(BASE_NOW, (tx) => service.createBooking(users.p2.id, ps("15:00"), 2, tx, tid("T5"))));
    await expectCode("VM_TABLE_UNAVAILABLE", () => at(BASE_NOW, (tx) => service.createBooking(users.p2.id, ps("15:00"), 2, tx, tid("T8"))));
    // граница: ровно guests + 2 — можно
    const code = await dry(BASE_NOW, async (tx) => {
      const id = await service.createBooking(users.p2.id, ps("15:00"), 2, tx, tid("T4"));
      return (await tx.booking.findUniqueOrThrow({ where: { id }, select: { table: { select: { code: true } } } })).table.code;
    });
    assert(code === "T4", `назначен ${code}`);
  });
  await check("p_table_id: занятый стол, неактивный стол, несуществующий стол — VM_TABLE_UNAVAILABLE", async () => {
    await expectCode("VM_TABLE_UNAVAILABLE", () => at(BASE_NOW, (tx) => service.createBooking(users.p2.id, ps("13:30"), 3, tx, tid("T3"))));
    await expectCode("VM_TABLE_UNAVAILABLE", () =>
      dry(BASE_NOW, async (tx) => {
        await tx.table.update({ where: { code: "T7" }, data: { isActive: false } });
        const st = (await service.tableAvailability(users.p2.id, ps("15:00"), 4, tx)).find((r) => r.code === "T7")?.status;
        assert(st === "closed", `неактивный T7 на плане: ${st}`);
        await service.createBooking(users.p2.id, ps("15:00"), 4, tx, tid("T7"));
      }),
    );
    await expectCode("VM_TABLE_UNAVAILABLE", () => at(BASE_NOW, (tx) => service.createBooking(users.p2.id, ps("15:00"), 2, tx, "no-such-table")));
  });
  await check("p_table_id: закрытое окно — VM_SLOT_CLOSED, на плане все столы closed, окна нет в полосе", async () => {
    const cid = await at(BASE_NOW, (tx) => service.closeSlot(users.admin.id, PD, "16:30", "Проверка: план", tx));
    await expectCode("VM_SLOT_CLOSED", () => at(BASE_NOW, (tx) => service.createBooking(users.p2.id, ps("16:30"), 2, tx, tid("T1"))));
    assert((await avail(BASE_NOW, null, ps("16:30"), 2)).every((r) => r.status === "closed"), "не все столы closed");
    const w = (await at(BASE_NOW, (tx) => service.dayAvailability(null, PD, 2, tx))).find((x) => x.startTime === "16:30");
    assert(w?.status === "closed" && w.freeTables === 0, `окно ${JSON.stringify(w)}`);
    await at(BASE_NOW, (tx) => service.openSlot(users.admin.id, cid, tx));
  });
  await check("p_table_id: начавшееся окно — VM_SLOT_STARTED, столы closed", async () => {
    const now = ps("18:00");
    await expectCode("VM_SLOT_STARTED", () => at(now, (tx) => service.createBooking(users.p2.id, ps("18:00"), 2, tx, tid("T1"))));
    assert((await avail(now, null, ps("18:00"), 2)).every((r) => r.status === "closed"), "не все столы closed");
  });
  await check("гонка: два гостя одновременно выбирают один стол — проходит ровно один, второй VM_TABLE_UNAVAILABLE", async () => {
    const outcomes = await Promise.allSettled([
      at(BASE_NOW, (tx) => service.createBooking(users.p2.id, ps("19:30"), 4, tx, tid("T7"))),
      at(BASE_NOW, (tx) => service.createBooking(users.p3.id, ps("19:30"), 4, tx, tid("T7"))),
    ]);
    const ok = outcomes.filter((o) => o.status === "fulfilled").length;
    const codes = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected").map((o) => errorCode(o.reason));
    assert(ok === 1 && codes[0] === "VM_TABLE_UNAVAILABLE", `успешных ${ok}, ошибки ${codes.join(",")}`);
    assert((await prisma.booking.count({ where: { tableId: tid("T7"), startsAt: ps("19:30"), status: "pending" } })) === 1, "на T7 не одно бронирование");
  });
  await check("гонка в обход проверки функции: второй стол на окно отклоняет EXCLUDE Booking_table_no_overlap", async () => {
    await expectCode("Booking_table_no_overlap", () =>
      at(BASE_NOW, async (tx) => {
        await tx.$executeRaw`SELECT set_config('vm.actor_id', ${users.p3.id}, true)`;
        await tx.$executeRaw`INSERT INTO "Booking" ("id","userId","tableId","startsAt","endsAt","guests","status","createdAt","updatedAt")
          VALUES ('direct-plan-race', ${users.p3.id}, ${tid("T7")}, ${ps("19:30")}, ${new Date(ps("19:30").getTime() + 90 * MIN)}, 4, 'pending', now(), now())`;
      }),
    );
  });
  await check("без p_table_id — автоподбор версии 1: самый маленький подходящий стол", async () => {
    const code = await dry(BASE_NOW, async (tx) => {
      const id = await service.createBooking(users.p3.id, ps("13:30"), 3, tx);
      return (await tx.booking.findUniqueOrThrow({ where: { id }, select: { table: { select: { code: true } } } })).table.code;
    });
    assert(code === "T4", `назначен ${code} (T3 занят p1)`);
  });
  await check("полоса окон: открытые окна vm_day_availability = vm_available_slots, число свободных = free на плане", async () => {
    for (const [uid, g] of [[null, 2], [users.p1.id, 2], [users.p2.id, 4], [null, 8]] as const) {
      const days = await at(BASE_NOW, (tx) => service.dayAvailability(uid, PD, g, tx));
      const slots = await slotsAt(BASE_NOW, uid, PD, g);
      const open = days.filter((w) => w.status === "open");
      assert(open.map((w) => `${w.startTime}:${w.autoTableCode}`).join(",") === slots.map((s) => `${s.startTime}:${s.tableCode}`).join(","),
        `${g} гостей: ${open.map((w) => w.startTime).join(",")} ≠ ${slots.map((s) => s.startTime).join(",")}`);
      for (const w of days) {
        const free = (await avail(BASE_NOW, uid, w.startsAt, g)).filter((r) => r.status === "free").length;
        assert(w.freeTables === free, `${w.startTime}: ${w.freeTables} ≠ ${free}`);
      }
    }
    const p1 = await at(BASE_NOW, (tx) => service.dayAvailability(users.p1.id, PD, 2, tx));
    assert(p1.find((w) => w.startTime === "13:30")?.status === "user_busy", "окно с бронью гостя не user_busy");
    assert((await at(BASE_NOW, (tx) => service.dayAvailability(null, day(5), 2, tx))).length === 0, "у понедельника есть окна");
  });

  // ---------------------------------------------------------------- cleanup
  begin("10. Уборка");
  await cleanup();
  await check("тестовые данные удалены, данные seed не изменились", async () => {
    const after = await snapshot();
    assert(after === before, `до ${before}\n      после ${after}`);
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nИтого: ${results.length - failed.length} из ${results.length} проверок пройдено.`);
  if (failed.length) {
    console.log("Не пройдены:");
    for (const f of failed) console.log(`  - [${f.section}] ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main()
  .catch(async (e) => {
    console.error("Проверка прервана:", e);
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());
