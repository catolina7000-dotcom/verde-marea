// Коды ошибок функций vm_* и ограничений базы → понятный текст для интерфейса.

export const ERROR_MESSAGES: Record<string, string> = {
  VM_ACTOR_NOT_FOUND: "Сессия устарела. Войдите снова.",
  VM_ACTOR_REQUIRED: "Изменение без автора запрещено.",
  VM_FORBIDDEN: "Недостаточно прав для этого действия.",
  VM_INVALID_GUESTS: "Число гостей — от 1 до 8.",
  VM_INVALID_SLOT: "Такого окна нет в расписании.",
  VM_MONDAY: "По понедельникам ресторан закрыт.",
  VM_OUT_OF_HORIZON: "Бронирование открыто только на ближайшие 14 дней.",
  VM_SLOT_STARTED: "Это окно уже началось. Выберите другое время.",
  VM_SLOT_CLOSED: "Это окно закрыто для записи. Выберите другое время.",
  VM_USER_OVERLAP: "У вас уже есть активное бронирование на это время.",
  VM_NO_TABLE: "Это окно только что заняли — свободного стола нет. Список окон обновлён.",
  VM_CAPACITY: "Гостей больше, чем мест за столом.",
  VM_TABLE_INACTIVE: "Стол сейчас не принимает бронирования.",
  VM_TABLE_NOT_FOUND: "Стол не найден.",
  VM_BOOKING_NOT_FOUND: "Бронирование не найдено.",
  VM_BOOKING_IMMUTABLE: "Бронирование нельзя изменить — только отменить и создать новое.",
  VM_TERMINAL_STATUS: "Статус окончательный и больше не меняется.",
  VM_INVALID_TRANSITION: "Такой переход статуса не предусмотрен.",
  VM_CANCEL_DEADLINE: "Отменить можно не позднее чем за 3 часа до начала.",
  VM_WINDOW_STARTED: "Окно уже началось — это действие доступно только до начала.",
  VM_WINDOW_NOT_STARTED: "Окно ещё не началось — это действие доступно после начала.",
  VM_USER_NOT_FOUND: "Пользователь не найден.",
  VM_ROLE_PROTECTED: "Роль владельца не выдаётся и не снимается.",
  VM_ROLE_UNCHANGED: "У пользователя уже эта роль.",
  VM_INVALID_REASON: "Укажите причину закрытия (до 120 символов).",
  VM_CLOSURE_EXISTS: "Это окно или день уже закрыты.",
  VM_CLOSURE_NOT_FOUND: "Закрытие не найдено — возможно, его уже сняли.",
  EMAIL_TAKEN: "Эта почта уже зарегистрирована.",
  INVALID_CREDENTIALS: "Неверная почта или пароль.",
  UNKNOWN: "Не получилось выполнить действие. Попробуйте ещё раз.",
};

export type ErrorCode = keyof typeof ERROR_MESSAGES;

/**
 * Достаёт код VM_* или имя нарушенного ограничения из ошибки Prisma/PostgreSQL.
 * Ищем только в тексте ошибки базы (а не во всём сообщении Prisma: в режиме разработки
 * оно содержит фрагмент исходного кода вокруг вызова, где тоже могут встретиться коды).
 */
export function errorCode(error: unknown): string {
  const meta = (error as { meta?: { message?: unknown; modelName?: unknown } } | null)?.meta;
  const prismaCode = (error as { code?: unknown } | null)?.code;
  if (prismaCode === "P2002" && meta?.modelName === "SlotClosure") return "VM_CLOSURE_EXISTS";
  const message = error instanceof Error ? error.message : String(error);
  const dbText = [
    typeof meta?.message === "string" ? meta.message : "",
    ...Array.from(message.matchAll(/Message: `([^`]*)`/g), (m) => m[1]),
    ...Array.from(message.matchAll(/message: "([^"]*)"/g), (m) => m[1]),
    ...Array.from(message.matchAll(/constraint(?::|\s+)\s*[`"]?([A-Za-z_]+)[`"]?/g), (m) => m[1]),
  ].join(" ");
  const vm = dbText.match(/\bVM_[A-Z_]+/);
  if (vm) return vm[0];
  if (dbText.includes("Booking_table_no_overlap")) return "VM_NO_TABLE";
  if (dbText.includes("Booking_user_no_overlap")) return "VM_USER_OVERLAP";
  if (dbText.includes("SlotClosure_date_")) return "VM_CLOSURE_EXISTS";
  return "UNKNOWN";
}

export function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.UNKNOWN;
}

export function toUserMessage(error: unknown): string {
  return errorMessage(errorCode(error));
}
