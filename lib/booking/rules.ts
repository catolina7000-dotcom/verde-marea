// Правила окон и бронирования (spec.md, раздел 5) — общие для интерфейса и сервера.
// Зеркало функций vm_* в миграции booking_rules: меняются только вместе (AGENTS.md).
// Модуль чистый: без доступа к базе и Node-API, его можно импортировать в клиентские компоненты.

export const RESTAURANT_TZ = "Europe/Moscow";
/** Europe/Moscow = UTC+3 без перехода на летнее время (spec.md, раздел 11). */
export const TZ_OFFSET_MINUTES = 180;

export const SLOT_TIMES = ["12:00", "13:30", "15:00", "16:30", "18:00", "19:30"] as const;
export type SlotTime = (typeof SLOT_TIMES)[number];
export const SLOT_DURATION_MINUTES = 90;
export const HORIZON_DAYS = 14;
export const CANCEL_DEADLINE_HOURS = 3;
export const MIN_GUESTS = 1;
export const MAX_GUESTS = 8;

export const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export const ACTIVE_STATUSES: readonly BookingStatus[] = ["pending", "confirmed"];
export const TERMINAL_STATUSES: readonly BookingStatus[] = ["cancelled", "completed", "no_show"];

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Ожидает подтверждения",
  confirmed: "Подтверждено",
  cancelled: "Отменено",
  completed: "Состоялось",
  no_show: "Неявка",
};

/** Таблица переходов (spec.md, раздел 4) без учёта времени и роли. */
export const STATUS_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  pending: ["confirmed", "cancelled", "completed", "no_show"],
  confirmed: ["cancelled", "completed", "no_show"],
  cancelled: [],
  completed: [],
  no_show: [],
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function isSlotTime(value: string): value is SlotTime {
  return (SLOT_TIMES as readonly string[]).includes(value);
}

export function isBookingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value);
}

export function isActiveStatus(status: BookingStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function isTerminalStatus(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** "YYYY-MM-DD" — дата ресторана для момента времени. */
export function localDateString(at: Date): string {
  return new Date(at.getTime() + TZ_OFFSET_MINUTES * MINUTE).toISOString().slice(0, 10);
}

/** "HH:MM" — время ресторана для момента времени. */
export function localTimeString(at: Date): string {
  return new Date(at.getTime() + TZ_OFFSET_MINUTES * MINUTE).toISOString().slice(11, 16);
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** ISO-день недели: 1 — понедельник … 7 — воскресенье. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function isMonday(date: string): boolean {
  return isoWeekday(date) === 1;
}

export function restaurantToday(now: Date): string {
  return localDateString(now);
}

/** Сегодня и ещё 13 дней (14 дней ресторана). */
export function isInHorizon(date: string, now: Date): boolean {
  const today = restaurantToday(now);
  return date >= today && date < addDays(today, HORIZON_DAYS);
}

/** Дни, на которые вообще можно бронировать: горизонт без понедельников. */
export function bookableDates(now: Date): string[] {
  const today = restaurantToday(now);
  const dates: string[] = [];
  for (let i = 0; i < HORIZON_DAYS; i++) {
    const d = addDays(today, i);
    if (!isMonday(d)) dates.push(d);
  }
  return dates;
}

export function horizonDates(now: Date): string[] {
  const today = restaurantToday(now);
  return Array.from({ length: HORIZON_DAYS }, (_, i) => addDays(today, i));
}

/** Момент начала окна (UTC) для даты и времени ресторана. */
export function slotStartsAt(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - TZ_OFFSET_MINUTES * MINUTE);
}

export function slotEndsAt(startsAt: Date): Date {
  return new Date(startsAt.getTime() + SLOT_DURATION_MINUTES * MINUTE);
}

/** Окно, которое уже началось, не показывается и не бронируется. */
export function isSlotStarted(startsAt: Date, now: Date): boolean {
  return now.getTime() >= startsAt.getTime();
}

export function isValidGuests(guests: number): boolean {
  return Number.isInteger(guests) && guests >= MIN_GUESTS && guests <= MAX_GUESTS;
}

export type SlotRuleViolation = "VM_INVALID_SLOT" | "VM_MONDAY" | "VM_OUT_OF_HORIZON" | "VM_SLOT_STARTED";

/** Проверка окна без базы (закрытия и занятость проверяет vm_create_booking). */
export function checkSlot(date: string, time: string, now: Date): SlotRuleViolation | null {
  if (!isDateString(date) || !isSlotTime(time)) return "VM_INVALID_SLOT";
  if (isMonday(date)) return "VM_MONDAY";
  if (!isInHorizon(date, now)) return "VM_OUT_OF_HORIZON";
  if (isSlotStarted(slotStartsAt(date, time), now)) return "VM_SLOT_STARTED";
  return null;
}

/** Дедлайн отмены гостем: now ≤ startsAt − 3 часа. */
export function cancelDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - CANCEL_DEADLINE_HOURS * 60 * MINUTE);
}

export function canOwnerCancel(status: BookingStatus, startsAt: Date, now: Date): boolean {
  return isActiveStatus(status) && now.getTime() <= cancelDeadline(startsAt).getTime();
}

/**
 * Может ли персонал (admin, super_admin) перевести бронирование from → to при started
 * (окно уже началось). spec.md, раздел 4 (изменение 2026-10-15):
 * - подтвердить pending — только до начала;
 * - отменить pending — в любое время, confirmed — только до начала;
 * - «Состоялось» и «Неявка» из pending и confirmed — только после начала.
 * Зеркало: триггер vm_booking_before_write и функция vm_change_booking_status.
 */
export function staffCanTransition(from: BookingStatus, to: BookingStatus, started: boolean): boolean {
  if (!STATUS_TRANSITIONS[from].includes(to)) return false;
  if (to === "confirmed") return !started;
  if (to === "cancelled") return from === "pending" || !started;
  return started; // completed, no_show
}

/** Переходы, доступные персоналу сейчас. */
export function staffTransitions(status: BookingStatus, startsAt: Date, now: Date): BookingStatus[] {
  const started = isSlotStarted(startsAt, now);
  return STATUS_TRANSITIONS[status].filter((to) => staffCanTransition(status, to, started));
}

// --------------------------------------------------------------------------------------------
// Версия 2: выбор стола на плане зала (spec.md, раздел 5 — «Выбор стола на плане»).
// Зеркало: vm_table_slack(), vm_table_fits(), vm_table_availability() в миграции floor_plan.
// --------------------------------------------------------------------------------------------

/** Сколько «лишних» мест допустимо при выборе стола гостем: двое не занимают стол на восемь. */
export const TABLE_SLACK = 2;

/** Стол подходит для выбора на плане: guests ≤ capacity ≤ guests + 2. */
export function tableFitsGuests(capacity: number, guests: number): boolean {
  return guests <= capacity && capacity <= guests + TABLE_SLACK;
}

export const TABLE_STATUSES = ["free", "busy", "unsuitable", "closed"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  free: "свободен",
  busy: "занят в это время",
  unsuitable: "не подходит по числу мест",
  closed: "недоступен в это окно",
};

/** Статус окна дня в полосе окон (vm_day_availability). Бронировать можно только open. */
export const WINDOW_STATUSES = ["open", "past", "closed", "user_busy", "full"] as const;
export type WindowStatus = (typeof WINDOW_STATUSES)[number];

/** Статус стола без базы — для проверки совпадения правила в rules.ts и в БД. */
export function tableStatus(input: {
  windowOpen: boolean;
  isActive: boolean;
  busy: boolean;
  capacity: number;
  guests: number;
}): TableStatus {
  if (!input.windowOpen || !input.isActive) return "closed";
  if (input.busy) return "busy";
  if (!tableFitsGuests(input.capacity, input.guests)) return "unsuitable";
  return "free";
}
