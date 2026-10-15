import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ errorFormat: "minimal" });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Поля пользователя для интерфейса. passwordHash здесь нет и быть не должно. */
export const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  createdAt: true,
} as const;
