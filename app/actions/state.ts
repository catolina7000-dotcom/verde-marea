import type { FieldErrors } from "@/lib/validation";

/** Состояние формы Server Action: ошибка рядом с действием или сообщение об успехе. */
export type ActionState = {
  error?: string;
  success?: string;
  fieldErrors?: FieldErrors;
  values?: Record<string, string>;
};

export const initialState: ActionState = {};
