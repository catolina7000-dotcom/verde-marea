import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, type Permission, type Role } from "@/lib/permissions";
import { findSessionUser, SESSION_COOKIE } from "@/lib/session";

// Текущий пользователь из httpOnly-cookie и проверки доступа для страниц.

export async function readSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/** Только из Server Action. */
export async function writeSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export type CurrentUser = { id: string; name: string; email: string; role: Role; createdAt: Date };

/** Пользователь и роль — только из серверной сессии (AGENTS.md). */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionToken();
  if (!token) return null;
  return findSessionUser(token);
});

/** Для страниц: без сессии — на /login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type Gate = { ok: true; user: CurrentUser } | { ok: false; user: CurrentUser };

/** Для страниц: без сессии — на /login; без права — экран «Нет доступа» (решает страница). */
export async function gate(permission: Permission): Promise<Gate> {
  const user = await requireUser();
  return can(user.role, permission) ? { ok: true, user } : { ok: false, user };
}
