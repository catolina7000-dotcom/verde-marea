import type { Metadata } from "next";
import Link from "next/link";
import { gate } from "@/lib/guard";
import { dayPlan } from "@/lib/booking/service";
import { bookableDates, isSlotTime, MAX_GUESTS, MIN_GUESTS } from "@/lib/booking/rules";
import { capitalizeFirst, formatDay, formatDayChip, pluralGuests } from "@/lib/format";
import { NoAccess, PageHeading } from "@/app/components/ui";
import { FloorPlanBooking, type PlanTable, type PlanWindow } from "./floor-plan";

export const metadata: Metadata = { title: "Забронировать" };

type Search = Promise<{ date?: string; guests?: string; time?: string; table?: string }>;

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

  // Окна дня (vm_day_availability) и статусы столов в каждом окне (vm_table_availability).
  const plan = await dayPlan(user.id, date, guests);
  const windows: PlanWindow[] = plan.windows.map((w) => ({
    time: w.startTime,
    status: w.status,
    freeTables: w.freeTables,
    autoTableCode: w.autoTableCode,
    autoTableCapacity: w.autoTableCapacity,
  }));
  const tables: Record<string, PlanTable[]> = Object.fromEntries(
    [...plan.tables.entries()].map(([time, rows]) => [
      time,
      rows.map((t) => ({
        id: t.id,
        code: t.code,
        zone: t.zone,
        capacity: t.capacity,
        isActive: t.isActive,
        shape: t.shape,
        x: t.x,
        y: t.y,
        w: t.w,
        h: t.h,
        status: t.status,
      })),
    ]),
  );
  const open = windows.filter((w) => w.status === "open");
  // ?time= и ?table= — выбранные окно и стол (ссылки плана работают и без JavaScript)
  const initialTime =
    params.time && isSlotTime(params.time) && windows.some((w) => w.time === params.time) ? params.time : open[0]?.time;
  const initialTable =
    initialTime && params.table && tables[initialTime]?.some((t) => t.code === params.table && t.status === "free")
      ? params.table
      : null;

  const href = (d: string, g: number) => `/book?date=${d}&guests=${g}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeading eyebrow="Бронирование" title="Забронировать стол">
        Выберите дату и число гостей, затем окно на 90 минут и свободный стол на плане зала. Не важно, где сидеть, —
        подберём самый подходящий стол сами.
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
          Окна и столы · {formatDay(date)}, {pluralGuests(guests)}
        </h3>
        {open.length === 0 || !initialTime ? (
          <div className="card flex flex-col items-start gap-3">
            <p className="font-semibold">На эту дату нет свободных окон</p>
            <p className="prose-width text-small text-muted">
              Попробуйте выбрать другую дату или меньше гостей. Если у вас уже есть бронирование на это время, второе
              создать нельзя.
            </p>
          </div>
        ) : (
          <FloorPlanBooking
            key={`${date}-${guests}`}
            date={date}
            dayLabel={capitalizeFirst(formatDay(date))}
            guests={guests}
            windows={windows}
            tables={tables}
            initialTime={initialTime}
            initialTable={initialTable}
          />
        )}
      </section>
    </div>
  );
}
