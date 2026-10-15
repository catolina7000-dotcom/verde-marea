import { RESTAURANT_TZ } from "@/lib/booking/rules";

// Форматирование дат во времени ресторана (Europe/Moscow), на русском.

const dateLong = new Intl.DateTimeFormat("ru-RU", { timeZone: RESTAURANT_TZ, weekday: "long", day: "numeric", month: "long" });
const dateShort = new Intl.DateTimeFormat("ru-RU", { timeZone: RESTAURANT_TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const weekdayShort = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", weekday: "short" });
const dayMonth = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", day: "numeric", month: "short" });
const dayLong = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const time = new Intl.DateTimeFormat("ru-RU", { timeZone: RESTAURANT_TZ, hour: "2-digit", minute: "2-digit" });

/** «четверг, 16 октября, 19:30» */
export function formatSlot(at: Date): string {
  return `${dateLong.format(at)}, ${time.format(at)}`;
}

/** «16.10.2026 19:30» */
export function formatDateTime(at: Date): string {
  return `${dateShort.format(at)} ${time.format(at)}`;
}

export function formatTime(at: Date): string {
  return time.format(at);
}

/** Для даты ресторана "YYYY-MM-DD": { weekday: "чт", day: "16 окт." } */
export function formatDayChip(date: string): { weekday: string; day: string } {
  const d = new Date(`${date}T12:00:00Z`);
  return { weekday: weekdayShort.format(d), day: dayMonth.format(d) };
}

/** «четверг, 16 октября» для даты ресторана "YYYY-MM-DD" */
export function formatDay(date: string): string {
  return dayLong.format(new Date(`${date}T12:00:00Z`));
}

/** Первая буква заглавная: «Четверг, 16 октября». */
export function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function pluralGuests(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} гость`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} гостя`;
  return `${n} гостей`;
}

/** «стол на 2 места», «стол на 6 мест» */
export function pluralSeats(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} место`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} места`;
  return `${n} мест`;
}
