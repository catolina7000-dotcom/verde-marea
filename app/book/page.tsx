import type { Metadata } from "next";
import Link from "next/link";
import { gate } from "@/lib/guard";
import { availableSlots } from "@/lib/booking/service";
import { bookableDates, MAX_GUESTS, MIN_GUESTS } from "@/lib/booking/rules";
import { formatDay, formatDayChip, pluralGuests } from "@/lib/format";
import { NoAccess, PageHeading } from "@/app/components/ui";
import { SlotPicker } from "./slot-picker";

export const metadata: Metadata = { title: "Забронировать" };

type Search = Promise<{ date?: string; guests?: string }>;

export default async function BookPage({ searchParams }: { searchParams: Search }) {
  const access = await gate("slots.view");
  if (!access.ok) return <NoAccess role={access.user.role} />;
  const { user } = access;

  const params = await searchParams;
  const now = new Date();
  const dates = bookableDates(now);
  const date = params.date && dates.includes(params.date) ? params.date : dates[0];
  const guestsNum = Number(params.guests);
  const guests = Number.isInteger(guestsNum) && guestsNum >= MIN_GUESTS && guestsNum <= MAX_GUESTS ? guestsNum : 2;

  const slots = await availableSlots(user.id, date, guests);
  const href = (d: string, g: number) => `/book?date=${d}&guests=${g}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeading eyebrow="Бронирование" title="Забронировать стол">
        Выберите дату и число гостей — покажем только свободные окна по 90 минут. Стол подберём сами: самый
        подходящий по числу мест.
      </PageHeading>

      <section aria-labelledby="date-heading" className="flex flex-col gap-3">
        <h3 id="date-heading">Дата</h3>
        <p className="text-small text-muted">Ближайшие 14 дней, понедельник — выходной.</p>
        <div className="flex flex-wrap gap-2">
          {dates.map((d) => {
            const chip = formatDayChip(d);
            return (
              <Link key={d} href={href(d, guests)} className="chip" aria-current={d === date ? "true" : undefined} scroll={false}>
                <span className="eyebrow" style={{ color: "inherit" }}>
                  {chip.weekday}
                </span>
                <span>{chip.day}</span>
              </Link>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="guests-heading" className="flex flex-col gap-3">
        <h3 id="guests-heading">Гостей</h3>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: MAX_GUESTS }, (_, i) => i + 1).map((g) => (
            <Link key={g} href={href(date, g)} className="chip" aria-current={g === guests ? "true" : undefined} scroll={false}>
              {g}
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="slots-heading" className="flex flex-col gap-3">
        <h3 id="slots-heading">
          Свободные окна · {formatDay(date)}, {pluralGuests(guests)}
        </h3>
        {slots.length === 0 ? (
          <div className="card flex flex-col items-start gap-3">
            <p className="font-semibold">На эту дату нет свободных окон</p>
            <p className="prose-width text-small text-muted">
              Попробуйте выбрать другую дату или меньше гостей. Если у вас уже есть бронирование на это время, второе
              создать нельзя.
            </p>
          </div>
        ) : (
          <SlotPicker
            date={date}
            guests={guests}
            slots={slots.map((s) => ({ time: s.startTime, capacity: s.tableCapacity }))}
          />
        )}
      </section>
    </div>
  );
}
