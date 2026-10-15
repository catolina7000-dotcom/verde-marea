import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { BookingStatus } from "./rules";
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

export async function createBooking(actorId: string, startsAt: Date, guests: number, db: Db = prisma): Promise<string> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT vm_create_booking(${actorId}::text, ${startsAt.toISOString()}::timestamptz, ${guests}::int) AS id`;
  return rows[0].id;
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
