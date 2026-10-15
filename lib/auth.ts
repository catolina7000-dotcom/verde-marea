import "server-only";

// Auth-lite: пароли (bcryptjs, 12 раундов), регистрация и проверка входа.
// Без зависимостей от Next — модуль используется и в scripts/check-rules.ts.
import { Prisma } from "@prisma/client";
import { prisma, publicUserSelect } from "@/lib/db";
import bcrypt from "bcryptjs";

// Только bcryptjs с 12 раундами (spec.md, раздел 9; AGENTS.md).
export const BCRYPT_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Хеш для выравнивания времени ответа, когда пользователя с такой почтой нет.
const DUMMY_HASH = "$2b$12$8P7Ey2pxrwxfhBOkI1ny4O8s48UDWrIQiDFZOkFlb6RYCl1Ie/Zx2";

export async function verifyPasswordOrDummy(password: string, hash: string | null): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return hash !== null && ok;
}

export async function registerUser(input: { name: string; email: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash, role: "user" },
      select: publicUserSelect,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

export async function authenticate(email: string, password: string) {
  const found = await prisma.user.findUnique({ where: { email }, select: { id: true, passwordHash: true } });
  const ok = await verifyPasswordOrDummy(password, found?.passwordHash ?? null);
  return ok && found ? found.id : null;
}
