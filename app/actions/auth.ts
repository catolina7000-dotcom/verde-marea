"use server";

import { redirect } from "next/navigation";
import { authenticate, registerUser } from "@/lib/auth";
import { createSession, deleteSession } from "@/lib/session";
import { clearSessionCookie, getCurrentUser, readSessionToken, writeSessionCookie } from "@/lib/guard";
import { can, isStaff } from "@/lib/permissions";
import { errorMessage } from "@/lib/booking/errors";
import { fieldErrors, loginSchema, registerSchema } from "@/lib/validation";
import { prisma } from "@/lib/db";
import type { ActionState } from "./state";

async function onlyGuests() {
  const viewer = await getCurrentUser();
  if (!can(viewer?.role ?? null, "auth.signIn")) redirect("/account");
}

export async function registerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await onlyGuests();
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const values = { name: raw.name, email: raw.email };
  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const user = await registerUser(parsed.data);
  if (!user) return { fieldErrors: { email: errorMessage("EMAIL_TAKEN") }, values };

  const { token, expiresAt } = await createSession(user.id);
  await writeSessionCookie(token, expiresAt);
  redirect("/book");
}

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await onlyGuests();
  const raw = { email: String(formData.get("email") ?? ""), password: String(formData.get("password") ?? "") };
  const values = { email: raw.email };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };

  const userId = await authenticate(parsed.data.email, parsed.data.password);
  if (!userId) return { error: errorMessage("INVALID_CREDENTIALS"), values };

  const { token, expiresAt } = await createSession(userId);
  await writeSessionCookie(token, expiresAt);
  const role = (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role ?? null;
  redirect(isStaff(role) ? "/admin" : "/book");
}

export async function logoutAction(): Promise<void> {
  const token = await readSessionToken();
  if (token) await deleteSession(token);
  await clearSessionCookie();
  redirect("/");
}
