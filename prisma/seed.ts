// Seed Verde Marea (spec.md, раздел 10): super_admin из .env, admin, два гостя, восемь столов,
// бронирования во всех статусах (в том числе pending после начала окна) и закрытия окон. Идемпотентный: повторный запуск не падает
// и не дублирует данные. Пароли берутся только из окружения и никуда не выводятся.
//
// Бронирования создаются теми же функциями vm_*, что и в приложении. Для прошедших
// (completed, no_show) seed сдвигает «сейчас» через SET LOCAL vm.now внутри своей транзакции.

import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { addDays, isMonday, restaurantToday, slotStartsAt } from "../lib/booking/rules";

const prisma = new PrismaClient();
type Tx = Prisma.TransactionClient;

export const DEMO_USERS = {
  admin: { email: "admin@verde-marea.test", name: "Марина Хостес", role: "admin" as const },
  anna: { email: "anna@verde-marea.test", name: "Анна Соколова", role: "user" as const },
  pavel: { email: "pavel@verde-marea.test", name: "Павел Орлов", role: "user" as const },
};

export const TABLES = [
  { code: "T1", zone: "Зал", capacity: 2 },
  { code: "T2", zone: "Зал", capacity: 2 },
  { code: "T3", zone: "Зал", capacity: 4 },
  { code: "T4", zone: "Зал", capacity: 4 },
  { code: "T5", zone: "Зал", capacity: 6 },
  { code: "T6", zone: "Веранда", capacity: 2 },
  { code: "T7", zone: "Веранда", capacity: 4 },
  { code: "T8", zone: "Веранда", capacity: 8 },
];

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Не задана переменная окружения ${name} (см. .env.example).`);
  return value;
}

async function asOf<T>(at: Date | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (at) await tx.$executeRaw`SELECT set_config('vm.now', ${at.toISOString()}, true)`;
    return fn(tx);
  });
}

async function createBooking(tx: Tx, actorId: string, startsAt: Date, guests: number): Promise<string> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT vm_create_booking(${actorId}::text, ${startsAt.toISOString()}::timestamptz, ${guests}::int) AS id`;
  return rows[0].id;
}

async function setStatus(tx: Tx, actorId: string, bookingId: string, to: string) {
  await tx.$executeRaw`SELECT vm_change_booking_status(${actorId}::text, ${bookingId}::text, ${to}::"BookingStatus")`;
}

/** n-й ближайший день от base (вперёд или назад), не понедельник. */
function nthOpenDay(base: string, step: 1 | -1, n: number): string {
  let d = base;
  let found = 0;
  while (found < n) {
    d = addDays(d, step);
    if (!isMonday(d)) found++;
  }
  return d;
}

const minutes = (m: number) => m * 60_000;

async function main() {
  const superEmail = requireEnv("SEED_SUPER_ADMIN_EMAIL").toLowerCase();
  const superName = requireEnv("SEED_SUPER_ADMIN_NAME");
  const superPassword = requireEnv("SEED_SUPER_ADMIN_PASSWORD");
  const demoPassword = requireEnv("SEED_DEMO_PASSWORD");

  const [superHash, demoHash] = await Promise.all([bcrypt.hash(superPassword, 12), bcrypt.hash(demoPassword, 12)]);

  // 1. super_admin: роль защищена триггером, seed снимает защиту только в своей транзакции.
  const owner = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('vm.allow_super_admin', 'on', true)`;
    const existing = await tx.user.findUnique({ where: { email: superEmail }, select: { id: true } });
    if (existing) {
      await tx.$executeRaw`SELECT set_config('vm.actor_id', ${existing.id}, true)`;
      return tx.user.update({
        where: { id: existing.id },
        data: { name: superName, role: "super_admin", passwordHash: superHash },
        select: { id: true },
      });
    }
    return tx.user.create({
      data: { email: superEmail, name: superName, role: "super_admin", passwordHash: superHash },
      select: { id: true },
    });
  });

  // 2. Демо-пользователи: имя и пароль приводятся к значениям seed (SEED_DEMO_PASSWORD),
  //    роль существующих не трогаем — её мог изменить владелец.
  const ids: Record<keyof typeof DEMO_USERS, string> = { admin: "", anna: "", pavel: "" };
  for (const [key, u] of Object.entries(DEMO_USERS) as [keyof typeof DEMO_USERS, (typeof DEMO_USERS)["admin"]][]) {
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, passwordHash: demoHash },
      create: { email: u.email, name: u.name, role: u.role, passwordHash: demoHash },
      select: { id: true },
    });
    ids[key] = row.id;
  }

  // 3. Столы.
  for (const t of TABLES) {
    await prisma.table.upsert({
      where: { code: t.code },
      update: { zone: t.zone, capacity: t.capacity, isActive: true },
      create: { ...t, isActive: true },
    });
  }

  // 4. Бронирования и закрытия — один раз (признак: у демо-гостей уже есть бронирования).
  const already = await prisma.booking.count({ where: { userId: { in: [ids.anna, ids.pavel] } } });
  let created = false;
  if (already === 0) {
    const now = new Date();
    const today = restaurantToday(now);
    const d1 = nthOpenDay(today, 1, 1);
    const d2 = nthOpenDay(today, 1, 2);
    const d3 = nthOpenDay(today, 1, 3);
    const p1 = nthOpenDay(today, -1, 3);
    const p2 = nthOpenDay(today, -1, 2);

    // Будущие: pending, confirmed, cancelled.
    await asOf(null, async (tx) => {
      await createBooking(tx, ids.anna, slotStartsAt(d1, "19:30"), 2);
      const confirmed = await createBooking(tx, ids.pavel, slotStartsAt(d1, "19:30"), 4);
      await setStatus(tx, ids.admin, confirmed, "confirmed");
      const cancelled = await createBooking(tx, ids.anna, slotStartsAt(d2, "18:00"), 4);
      await setStatus(tx, ids.anna, cancelled, "cancelled");
      await createBooking(tx, ids.pavel, slotStartsAt(d2, "13:30"), 6);
    });

    // Прошедшие: completed и no_show — создаются «в прошлом» и проходят переходы по времени.
    for (const [day, time, user, guests, final] of [
      [p1, "13:30", ids.anna, 3, "completed"],
      [p2, "19:30", ids.pavel, 2, "no_show"],
    ] as const) {
      const startsAt = slotStartsAt(day, time);
      const bookingId = await asOf(new Date(startsAt.getTime() - minutes(26 * 60)), (tx) =>
        createBooking(tx, user, startsAt, guests),
      );
      await asOf(new Date(startsAt.getTime() - minutes(20 * 60)), (tx) => setStatus(tx, ids.admin, bookingId, "confirmed"));
      await asOf(new Date(startsAt.getTime() + minutes(final === "completed" ? 95 : 30)), (tx) =>
        setStatus(tx, ids.admin, bookingId, final),
      );
    }

    // Закрытия: весь день (банкет) и одно окно.
    await asOf(null, async (tx) => {
      await tx.$queryRaw`SELECT vm_close_slot(${ids.admin}::text, ${d3}::date, NULL::text, ${"Банкет"}::text)`;
      await tx.$queryRaw`SELECT vm_close_slot(${ids.admin}::text, ${d2}::date, ${"15:00"}::text, ${"Дегустация для поставщиков"}::text)`;
    });
    created = true;
  }

  // 5. Пример «pending после начала окна» (spec.md, раздел 4): вчерашнее неподтверждённое
  //    бронирование, которое администратор закрывает как «Состоялось», «Неявка» или «Отменено».
  //    Создаётся, только если у демо-гостей нет такого незакрытого бронирования.
  const stalePending = await prisma.booking.count({
    where: { userId: { in: [ids.anna, ids.pavel] }, status: "pending", startsAt: { lt: new Date() } },
  });
  if (stalePending === 0) {
    const lastDay = nthOpenDay(restaurantToday(new Date()), -1, 1);
    const startsAt = slotStartsAt(lastDay, "16:30");
    const taken = await prisma.booking.count({ where: { userId: ids.pavel, startsAt } });
    if (taken === 0) {
      await asOf(new Date(startsAt.getTime() - minutes(24 * 60)), (tx) => createBooking(tx, ids.pavel, startsAt, 3));
    }
  }

  const [users, tables, bookings, closures] = await Promise.all([
    prisma.user.count(),
    prisma.table.count(),
    prisma.booking.groupBy({ by: ["status"], _count: true }),
    prisma.slotClosure.count(),
  ]);
  console.log(
    `Seed готов${created ? "" : " (демо-бронирования уже были, пропущены)"}: пользователей ${users}, столов ${tables}, ` +
      `бронирований ${bookings.map((b) => `${b.status}=${b._count}`).join(", ")}, закрытий ${closures}. ` +
      `super_admin id=${owner.id}.`,
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
