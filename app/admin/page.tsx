import type { Metadata } from "next";
import Link from "next/link";
import { gate } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { listBookingsForAdmin } from "@/lib/booking/queries";
import { BOOKING_STATUSES, isBookingStatus, isDateString, restaurantToday, staffTransitions, STATUS_LABELS, type BookingStatus } from "@/lib/booking/rules";
import { formatDateTime, pluralGuests, pluralSeats } from "@/lib/format";
import { changeStatusAction } from "@/app/actions/admin";
import { RowAction } from "@/app/components/forms";
import { EmptyState, NoAccess, StatusBadge } from "@/app/components/ui";

export const metadata: Metadata = { title: "Бронирования" };

const ACTION_LABELS: Record<BookingStatus, { label: string; confirm?: string; variant: "secondary" | "danger" }> = {
  confirmed: { label: "Подтвердить", variant: "secondary" },
  completed: { label: "Состоялось", variant: "secondary" },
  cancelled: { label: "Отменить", confirm: "Да, отменить", variant: "danger" },
  no_show: { label: "Неявка", confirm: "Да, неявка", variant: "danger" },
  pending: { label: "", variant: "secondary" },
};

type Search = Promise<{ status?: string; date?: string }>;

export default async function AdminBookingsPage({ searchParams }: { searchParams: Search }) {
  const access = await gate("admin.access");
  if (!access.ok) return <NoAccess role={access.user.role} />;
  const canManage = can(access.user.role, "booking.manage");

  const params = await searchParams;
  const status = params.status && isBookingStatus(params.status) ? params.status : undefined;
  const date = params.date && isDateString(params.date) ? params.date : undefined;
  const bookings = await listBookingsForAdmin({ status, date });
  const now = new Date();
  const filtered = Boolean(status || date);

  return (
    <div className="flex flex-col gap-6">
      <h1>Бронирования</h1>

      <form method="get" className="card flex flex-col gap-4 md:flex-row md:items-end">
        <div className="field md:w-64">
          <label htmlFor="status" className="label">
            Статус
          </label>
          <select id="status" name="status" defaultValue={status ?? ""} className="input">
            <option value="">Все статусы</option>
            {BOOKING_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field md:w-56">
          <label htmlFor="date" className="label">
            Дата
          </label>
          <input id="date" name="date" type="date" defaultValue={date ?? ""} className="input" />
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className="btn btn-primary btn-block-mobile">
            Показать
          </button>
          <Link href={`/admin?date=${restaurantToday(now)}`} className="btn btn-secondary btn-block-mobile">
            Сегодня
          </Link>
          {filtered ? (
            <Link href="/admin" className="btn btn-secondary btn-block-mobile">
              Сбросить фильтры
            </Link>
          ) : null}
        </div>
      </form>

      {bookings.length === 0 ? (
        <EmptyState
          title={filtered ? "Ничего не найдено" : "Бронирований пока нет"}
          text={filtered ? "По выбранным статусу и дате бронирований нет." : "Как только гости забронируют стол, бронирования появятся здесь."}
          action={filtered ? { href: "/admin", label: "Сбросить фильтры" } : undefined}
        />
      ) : (
        <table className="table-vm">
          <thead>
            <tr>
              <th scope="col">Когда</th>
              <th scope="col">Гость</th>
              <th scope="col">Гостей</th>
              <th scope="col">Стол</th>
              <th scope="col">Статус</th>
              <th scope="col">Действия</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const transitions = canManage ? staffTransitions(b.status, b.startsAt, now) : [];
              return (
                <tr key={b.id}>
                  <td data-label="Когда" className="whitespace-nowrap">
                    {formatDateTime(b.startsAt)}
                  </td>
                  <td data-label="Гость">
                    <span className="font-semibold">{b.user.name}</span>
                    <br />
                    <span className="text-muted">{b.user.email}</span>
                  </td>
                  <td data-label="Гостей">{pluralGuests(b.guests)}</td>
                  <td data-label="Стол">
                    <span className="font-semibold">{b.table.code}</span> <span className="text-muted">· {b.table.zone}, {pluralSeats(b.table.capacity)}</span>
                  </td>
                  <td data-label="Статус">
                    <StatusBadge status={b.status} />
                  </td>
                  <td data-label="Действия">
                    {transitions.length === 0 ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {transitions.map((to) => (
                          <RowAction
                            key={to}
                            action={changeStatusAction}
                            fields={{ bookingId: b.id, to }}
                            label={ACTION_LABELS[to].label}
                            confirmLabel={ACTION_LABELS[to].confirm}
                            variant={ACTION_LABELS[to].variant}
                          />
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
