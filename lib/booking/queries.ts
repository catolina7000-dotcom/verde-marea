import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, publicUserSelect } from "@/lib/db";
import {
  ACTIVE_STATUSES,
  addDays,
  HORIZON_DAYS,
  localDateString,
  localTimeString,
  restaurantToday,
  slotStartsAt,
  type BookingStatus,
} from "./rules";

// Чтение для страниц. Пользователи выбираются только через publicUserSelect — без passwordHash.

const bookingListSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  guests: true,
  status: true,
  createdAt: true,
  table: { select: { code: true, zone: true, capacity: true } },
} as const;

export async function listOwnBookings(userId: string) {
  return prisma.booking.findMany({
    where: { userId },
    select: bookingListSelect,
    orderBy: [{ startsAt: "desc" }],
    take: 100,
  });
}

export async function listOwnNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    select: { id: true, type: true, message: true, readAt: true, createdAt: true },
    orderBy: [{ createdAt: "desc" }],
    take: 50,
  });
}

export async function countUnreadNotifications(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function listBookingsForAdmin(filter: { status?: BookingStatus; date?: string }) {
  const where: Prisma.BookingWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.date) {
    where.startsAt = { gte: slotStartsAt(filter.date, "00:00"), lt: slotStartsAt(addDays(filter.date, 1), "00:00") };
  }
  return prisma.booking.findMany({
    where,
    select: {
      ...bookingListSelect,
      user: { select: { id: true, name: true, email: true } },
    },
    orderBy: [{ startsAt: "asc" }, { createdAt: "asc" }],
    take: 200,
  });
}

/** Окна 14 дней: закрытия и число активных бронирований в каждом окне. */
export async function slotsOverview(now: Date) {
  const today = restaurantToday(now);
  const end = addDays(today, HORIZON_DAYS);
  const [closures, bookings, tables] = await Promise.all([
    prisma.slotClosure.findMany({
      where: { date: { gte: new Date(`${today}T00:00:00Z`), lt: new Date(`${end}T00:00:00Z`) } },
      select: { id: true, date: true, startTime: true, reason: true, createdAt: true, createdBy: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    }),
    prisma.booking.findMany({
      where: {
        status: { in: [...ACTIVE_STATUSES] },
        startsAt: { gte: slotStartsAt(today, "00:00"), lt: slotStartsAt(end, "00:00") },
      },
      select: { startsAt: true, guests: true },
    }),
    prisma.table.count({ where: { isActive: true } }),
  ]);
  const occupancy = new Map<string, number>();
  for (const b of bookings) {
    const key = `${localDateString(b.startsAt)} ${localTimeString(b.startsAt)}`;
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }
  return {
    closures: closures.map((c) => ({ ...c, date: c.date.toISOString().slice(0, 10) })),
    occupancy,
    activeTables: tables,
  };
}

export async function listUsers() {
  return prisma.user.findMany({ select: publicUserSelect, orderBy: [{ createdAt: "asc" }] });
}

export async function listAudit(limit = 200) {
  return prisma.auditLog.findMany({
    select: {
      id: true,
      action: true,
      details: true,
      createdAt: true,
      actor: { select: { name: true } },
      targetUser: { select: { name: true } },
      booking: { select: { startsAt: true, table: { select: { code: true } }, user: { select: { name: true } } } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: limit,
  });
}
