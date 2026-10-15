"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { canOwnerCancel, checkSlot, MAX_GUESTS, MIN_GUESTS, slotStartsAt } from "@/lib/booking/rules";
import { errorCode, errorMessage } from "@/lib/booking/errors";
import * as service from "@/lib/booking/service";
import type { ActionState } from "./state";

const createSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  guests: z.coerce.number().int().min(MIN_GUESTS).max(MAX_GUESTS),
});

export async function createBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "booking.create")) return { error: errorMessage("VM_FORBIDDEN") };

  const parsed = createSchema.safeParse({
    date: formData.get("date"),
    time: formData.get("time"),
    guests: formData.get("guests"),
  });
  if (!parsed.success) return { error: errorMessage("VM_INVALID_SLOT") };
  const { date, time, guests } = parsed.data;

  // первая проверка — те же правила, что в интерфейсе; окончательная — vm_create_booking
  const violation = checkSlot(date, time, new Date());
  if (violation) {
    revalidatePath("/book");
    return { error: errorMessage(violation) };
  }

  try {
    await service.createBooking(user.id, slotStartsAt(date, time), guests);
  } catch (e) {
    // окно могли занять между показом и нажатием — список окон обновится вместе с ответом
    revalidatePath("/book");
    return { error: errorMessage(errorCode(e)) };
  }
  revalidatePath("/account");
  redirect("/account?created=1");
}

export async function cancelOwnBookingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "booking.cancelOwn")) return { error: errorMessage("VM_FORBIDDEN") };

  const bookingId = String(formData.get("bookingId") ?? "");
  const booking = await prisma.booking.findUnique({ where: { id: bookingId }, select: { userId: true, startsAt: true, status: true } });
  if (!booking || booking.userId !== user.id) return { error: errorMessage("VM_BOOKING_NOT_FOUND") };
  if (!canOwnerCancel(booking.status, booking.startsAt, new Date())) {
    return { error: errorMessage(booking.status === "pending" || booking.status === "confirmed" ? "VM_CANCEL_DEADLINE" : "VM_TERMINAL_STATUS") };
  }

  try {
    await service.changeBookingStatus(user.id, bookingId, "cancelled");
  } catch (e) {
    return { error: errorMessage(errorCode(e)) };
  }
  revalidatePath("/account");
  return { success: "Бронирование отменено." };
}

export async function markNotificationsReadAction(formData: FormData): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!can(user.role, "booking.viewOwn")) return;
  const id = String(formData.get("notificationId") ?? "");
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
  revalidatePath("/account");
}
