"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/guard";
import { can, canChangeRole, ROLES, type Permission, type Role } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { isBookingStatus, isDateString, isInHorizon, isMonday, isSlotTime, STATUS_LABELS } from "@/lib/booking/rules";
import { errorCode, errorMessage } from "@/lib/booking/errors";
import * as service from "@/lib/booking/service";
import type { ActionState } from "./state";

/** Первая проверка по lib/permissions.ts; окончательная — в функции vm_*. */
async function actor(permission: Permission) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return can(user.role, permission) ? user : null;
}

export async function changeStatusAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actor("booking.manage");
  if (!user) return { error: errorMessage("VM_FORBIDDEN") };
  const bookingId = String(formData.get("bookingId") ?? "");
  const to = String(formData.get("to") ?? "");
  if (!isBookingStatus(to)) return { error: errorMessage("VM_INVALID_TRANSITION") };
  try {
    await service.changeBookingStatus(user.id, bookingId, to);
  } catch (e) {
    revalidatePath("/admin");
    return { error: errorMessage(errorCode(e)) };
  }
  revalidatePath("/admin");
  revalidatePath("/admin/audit");
  return { success: `Статус: ${STATUS_LABELS[to]}.` };
}

export async function closeSlotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actor("slots.manage");
  if (!user) return { error: errorMessage("VM_FORBIDDEN") };
  const date = String(formData.get("date") ?? "");
  const startTimeRaw = String(formData.get("startTime") ?? "");
  const startTime = startTimeRaw === "" ? null : startTimeRaw;
  const reason = String(formData.get("reason") ?? "").trim();

  if (!isDateString(date) || (startTime !== null && !isSlotTime(startTime))) return { error: errorMessage("VM_INVALID_SLOT") };
  if (isMonday(date)) return { error: errorMessage("VM_MONDAY") };
  if (!isInHorizon(date, new Date())) return { error: errorMessage("VM_OUT_OF_HORIZON") };
  if (reason.length < 1 || reason.length > 120) return { error: errorMessage("VM_INVALID_REASON"), values: { reason } };

  try {
    await service.closeSlot(user.id, date, startTime, reason);
  } catch (e) {
    return { error: errorMessage(errorCode(e)), values: { reason } };
  }
  revalidatePath("/admin/slots");
  return { success: startTime ? `Окно ${startTime} закрыто.` : "День закрыт." };
}

export async function openSlotAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actor("slots.manage");
  if (!user) return { error: errorMessage("VM_FORBIDDEN") };
  try {
    await service.openSlot(user.id, String(formData.get("closureId") ?? ""));
  } catch (e) {
    return { error: errorMessage(errorCode(e)) };
  }
  revalidatePath("/admin/slots");
  return { success: "Открыто для записи." };
}

export async function setRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await actor("users.changeRole");
  if (!user) return { error: errorMessage("VM_FORBIDDEN") };
  const targetId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "");
  if (!(ROLES as readonly string[]).includes(role)) return { error: errorMessage("VM_ROLE_PROTECTED") };
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { role: true } });
  if (!target) return { error: errorMessage("VM_USER_NOT_FOUND") };
  if (!canChangeRole(user.role, target.role, role as Role)) {
    return { error: errorMessage(target.role === role ? "VM_ROLE_UNCHANGED" : "VM_ROLE_PROTECTED") };
  }
  try {
    await service.setUserRole(user.id, targetId, role as Role);
  } catch (e) {
    return { error: errorMessage(errorCode(e)) };
  }
  revalidatePath("/admin/users");
  return { success: "Роль изменена." };
}
