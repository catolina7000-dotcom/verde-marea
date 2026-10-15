import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { BookingStatus, TableStatus, WindowStatus } from "./rules";
import type { TableShape } from "./floor-plan";
import type { Role } from "@/lib/permissions";

// Вызовы функций PostgreSQL vm_* — единственный путь изменения бронирований, окон и ролей.
// Функции сами проверяют роль из базы, правила окон и пишут AuditLog/Notification.

type Db = PrismaClient | Prisma.TransactionClient;

export type AvailableSlot = {
  startTime: string;
  startsAt: Date;
  endsAt: Date;
  tableId: string;
  tableCode: string;
  tableCapacity: number;
};

export async function availableSlots(
  userId: string | null,
  date: string,
  guests: number,
  db: Db = prisma,
): Promise<AvailableSlot[]> {
  const rows = await db.$queryRaw<
    { start_time: string; starts_at: Date; ends_at: Date; table_id: string; table_code: string; table_capacity: number }[]
  >`SELECT * FROM vm_available_slots(${userId}::text, ${date}::date, ${guests}::int)`;
  return rows.map((r) => ({
    startTime: r.start_time,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    tableId: r.table_id,
    tableCode: r.table_code,
    tableCapacity: Number(r.table_capacity),
  }));
}

/**
 * Создание бронирования. Без tableId — автоподбор версии 1 (самый маленький подходящий стол).
 * С tableId — стол, выбранный на плане (версия 2): база проверяет guests ≤ capacity ≤ guests + 2,
 * активность и занятость стола и отвечает VM_TABLE_UNAVAILABLE.
 */
export async function createBooking(
  actorId: string,
  startsAt: Date,
  guests: number,
  db: Db = prisma,
  tableId: string | null = null,
): Promise<string> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT vm_create_booking(${actorId}::text, ${startsAt.toISOString()}::timestamptz, ${guests}::int, ${tableId}::text) AS id`;
  return rows[0].id;
}

export type PlanTableState = {
  id: string;
  code: string;
  zone: string;
  capacity: number;
  isActive: boolean;
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  status: TableStatus;
};

/** Статусы всех столов в окне (vm_table_availability). */
export async function tableAvailability(
  userId: string | null,
  startsAt: Date,
  guests: number,
  db: Db = prisma,
): Promise<PlanTableState[]> {
  const rows = await db.$queryRaw<
    {
      table_id: string;
      table_code: string;
      zone: string;
      capacity: number;
      is_active: boolean;
      shape: string;
      plan_x: number;
      plan_y: number;
      plan_w: number;
      plan_h: number;
      status: string;
    }[]
  >`SELECT * FROM vm_table_availability(${userId}::text, ${startsAt.toISOString()}::timestamptz, ${guests}::int)`;
  return rows.map((r) => ({
    id: r.table_id,
    code: r.table_code,
    zone: r.zone,
    capacity: Number(r.capacity),
    isActive: r.is_active,
    shape: r.shape as TableShape,
    x: Number(r.plan_x),
    y: Number(r.plan_y),
    w: Number(r.plan_w),
    h: Number(r.plan_h),
    status: r.status as TableStatus,
  }));
}

export type DayWindow = {
  startTime: string;
  startsAt: Date;
  endsAt: Date;
  status: WindowStatus;
  /** свободные подходящие столы для выбора на плане */
  freeTables: number;
  /** стол, который назначит «Подобрать автоматически» (только для open) */
  autoTableCode: string | null;
  autoTableCapacity: number | null;
};

/** Окна дня с числом свободных столов (vm_day_availability). */
export async function dayAvailability(userId: string | null, date: string, guests: number, db: Db = prisma): Promise<DayWindow[]> {
  const rows = await db.$queryRaw<
    {
      start_time: string;
      starts_at: Date;
      ends_at: Date;
      status: string;
      free_tables: number;
      auto_table_code: string | null;
      auto_table_capacity: number | null;
    }[]
  >`SELECT * FROM vm_day_availability(${userId}::text, ${date}::date, ${guests}::int)`;
  return rows.map((r) => ({
    startTime: r.start_time,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status as WindowStatus,
    freeTables: Number(r.free_tables),
    autoTableCode: r.auto_table_code,
    autoTableCapacity: r.auto_table_capacity === null ? null : Number(r.auto_table_capacity),
  }));
}

/** Окна дня и статусы столов во всех окнах — одним запросом (для плана на /book). */
export async function dayPlan(userId: string | null, date: string, guests: number, db: Db = prisma) {
  const windows = await dayAvailability(userId, date, guests, db);
  if (windows.length === 0) return { windows, tables: new Map<string, PlanTableState[]>() };
  const rows = await Promise.all(windows.map((w) => tableAvailability(userId, w.startsAt, guests, db)));
  return { windows, tables: new Map(windows.map((w, i) => [w.startTime, rows[i]])) };
}

export async function changeBookingStatus(
  actorId: string,
  bookingId: string,
  to: BookingStatus,
  db: Db = prisma,
): Promise<void> {
  await db.$executeRaw`SELECT vm_change_booking_status(${actorId}::text, ${bookingId}::text, ${to}::"BookingStatus")`;
}

export async function setUserRole(actorId: string, targetId: string, role: Role, db: Db = prisma): Promise<void> {
  await db.$executeRaw`SELECT vm_set_user_role(${actorId}::text, ${targetId}::text, ${role}::"Role")`;
}

export async function closeSlot(
  actorId: string,
  date: string,
  startTime: string | null,
  reason: string,
  db: Db = prisma,
): Promise<string> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT vm_close_slot(${actorId}::text, ${date}::date, ${startTime}::text, ${reason}::text) AS id`;
  return rows[0].id;
}

export async function openSlot(actorId: string, closureId: string, db: Db = prisma): Promise<void> {
  await db.$executeRaw`SELECT vm_open_slot(${actorId}::text, ${closureId}::text)`;
}
