import type { Metadata } from "next";
import { gate } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { slotsOverview } from "@/lib/booking/queries";
import { horizonDates, isMonday, isSlotStarted, SLOT_TIMES, slotStartsAt } from "@/lib/booking/rules";
import { capitalizeFirst, formatDay } from "@/lib/format";
import { openSlotAction } from "@/app/actions/admin";
import { RowAction } from "@/app/components/forms";
import { NoAccess } from "@/app/components/ui";
import { CloseSlotForm } from "./close-slot-form";

export const metadata: Metadata = { title: "Окна записи" };

export default async function AdminSlotsPage() {
  const access = await gate("admin.access");
  if (!access.ok) return <NoAccess role={access.user.role} />;
  const canManage = can(access.user.role, "slots.manage");

  const now = new Date();
  const { closures, occupancy, activeTables } = await slotsOverview(now);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1>Окна записи</h1>
        <p className="prose-width text-muted">
          Окна считаются по правилам: вторник–воскресенье, {SLOT_TIMES.length} окон по 90 минут, 14 дней вперёд. Здесь
          можно закрыть отдельное окно или весь день и открыть обратно. Закрытие не отменяет уже созданные бронирования.
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {horizonDates(now).map((date) => {
          if (isMonday(date)) {
            return (
              <li key={date} className="card flex flex-wrap items-center justify-between gap-2">
                <h3>{capitalizeFirst(formatDay(date))}</h3>
                <span className="text-small text-muted">Выходной — окон нет</span>
              </li>
            );
          }
          const dayClosure = closures.find((c) => c.date === date && c.startTime === null);
          return (
            <li key={date} className="card flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3>{capitalizeFirst(formatDay(date))}</h3>
                {dayClosure ? <span className="badge badge-cancelled">День закрыт: {dayClosure.reason}</span> : null}
              </div>

              {dayClosure && canManage ? (
                <RowAction action={openSlotAction} fields={{ closureId: dayClosure.id }} label="Открыть день" />
              ) : null}

              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                {SLOT_TIMES.map((time) => {
                  const closure = closures.find((c) => c.date === date && c.startTime === time);
                  const busy = occupancy.get(`${date} ${time}`) ?? 0;
                  const past = isSlotStarted(slotStartsAt(date, time), now);
                  return (
                    <div key={time} className="flex flex-col gap-1 rounded-md border border-line p-3">
                      <span className="font-bold">{time}</span>
                      <span className="text-small text-muted">
                        занято {busy} из {activeTables}
                      </span>
                      {past ? (
                        <span className="text-small text-muted">прошло</span>
                      ) : closure ? (
                        <>
                          <span className="text-small text-danger">закрыто: {closure.reason}</span>
                          {canManage ? (
                            <RowAction action={openSlotAction} fields={{ closureId: closure.id }} label="Открыть" />
                          ) : null}
                        </>
                      ) : dayClosure ? (
                        <span className="text-small text-danger">закрыто</span>
                      ) : (
                        <span className="text-small text-green">открыто</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {canManage && !dayClosure ? (
                <CloseSlotForm
                  date={date}
                  times={SLOT_TIMES.filter(
                    (t) => !closures.some((c) => c.date === date && c.startTime === t) && !isSlotStarted(slotStartsAt(date, t), now),
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
