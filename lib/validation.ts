import { z } from "zod";

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72; // предел bcrypt — 72 байта

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Имя — от 2 до 60 символов.").max(60, "Имя — от 2 до 60 символов."),
  email: z.string().trim().toLowerCase().pipe(z.email("Введите корректную почту.")),
  password: z
    .string()
    .min(PASSWORD_MIN, `Пароль — не короче ${PASSWORD_MIN} символов.`)
    .refine((v) => new TextEncoder().encode(v).length <= PASSWORD_MAX, `Пароль — не длиннее ${PASSWORD_MAX} байт.`),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Введите корректную почту.")),
  password: z.string().min(1, "Введите пароль."),
});

export type FieldErrors = Partial<Record<string, string>>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
