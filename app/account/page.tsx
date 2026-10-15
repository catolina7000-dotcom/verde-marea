import type { Metadata } from "next";
import { gate } from "@/lib/guard";
import { listOwnBookings, listOwnNotifications } from "@/lib/booking/queries";
import { canOwnerCancel, cancelDeadline, isActiveStatus, CANCEL_DEADLINE_HOURS } from "@/lib/booking/rules";
import { formatDateTime, formatSlot, pluralGuests } from "@/lib/format";
import { cancelOwnBookingAction, markNotificationsReadAction } from "@/app/actions/booking";
import { EmptyState, NoAccess, PageHeading, StatusBadge, SuccessBanner } from "@/app/components/ui";
import { RowAction, SubmitButton } from "@/app/components/forms";

export const metadata: Metadata = { title: "Мои бронирования" };

type Search = Promise<{ created?: string }>;

export default async function AccountPage({ searchParams }: { searchParams: Search }) {
  const access = await gate("booking.viewOwn");
  if (!access.ok) return <NoAccess role={access.user.role} />;
  const { user } = access;
  const { created } = await searchParams;

  const [allBookings, notifications] = await Promise.all([listOwnBookings(user.id), listOwnNotifications(user.id)]);
  const now = new Date();
  // сначала предстоящие активные (ближайшие сверху), затем остальные — от новых к старым
  const upcoming = (b: (typeof allBookings)[number]) => isActiveStatus(b.status) && b.endsAt.getTime() > now.getTime();
  const bookings = [
    ...allBookings.filter(upcoming).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    ...allBookings.filter((b) => !upcoming(b)),
  ];
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="flex flex-col gap-10">
      <PageHeading eyebrow={user.name} title="Мои бронирования">
        Отменить бронирование можно не позднее чем за {CANCEL_DEADLINE_HOURS} часа до начала.
      </PageHeading>

      {created ? <SuccessBanner>Бронирование создано и ждёт подтверждения администратора.</SuccessBanner> : null}

      <section aria-labelledby="bookings-heading" className="flex flex-col gap-4">
        <h2 id="bookings-heading">Бронирования</h2>
        {bookings.length === 0 ? (
          <EmptyState
            title="Пока нет бронирований"
            text="Выберите дату и число гостей — мы покажем свободные окна."
            action={{ href: "/book", label: "Забронировать стол" }}
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {bookings.map((b) => {
              const cancellable = canOwnerCancel(b.status, b.startsAt, now);
              return (
                <li key={b.id} className="card card-booking flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-semibold">{formatSlot(b.startsAt)}</p>
                    <StatusBadge status={b.status} />
                  </div>
                  <p className="text-small text-muted">
                    Стол <span className="font-semibold text-ink">{b.table.code}</span> · {b.table.zone} ·{" "}
                    {pluralGuests(b.guests)}
                  </p>
                  {cancellable ? (
                    <div className="flex flex-col gap-1">
                      <RowAction
                        action={cancelOwnBookingAction}
                        fields={{ bookingId: b.id }}
                        label="Отменить"
                        confirmLabel="Да, отменить"
                        variant="danger"
                      />
                      <p className="text-small text-muted">Отмена доступна до {formatDateTime(cancelDeadline(b.startsAt))}.</p>
                    </div>
                  ) : isActiveStatus(b.status) ? (
                    <p className="text-small text-muted">
                      До начала меньше {CANCEL_DEADLINE_HOURS} часов — отменить онлайн уже нельзя.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="notes-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="notes-heading">Уведомления</h2>
          {unread > 0 ? (
            <form action={markNotificationsReadAction}>
              <SubmitButton variant="link" pendingText="…">
                Отметить все прочитанными
              </SubmitButton>
            </form>
          ) : null}
        </div>
        {notifications.length === 0 ? (
          <EmptyState title="Уведомлений нет" text="Здесь появятся изменения статусов ваших бронирований." />
        ) : (
          <div className="card">
            <ul>
              {notifications.map((n) => (
                <li key={n.id} className="note" data-unread={n.readAt ? "false" : "true"}>
                  <span className="note-dot" aria-hidden="true" />
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="text-small font-semibold">{NOTE_TITLES[n.type]}</p>
                    <p className="text-small text-muted">{n.message}</p>
                    {!n.readAt ? (
                      <form action={markNotificationsReadAction}>
                        <input type="hidden" name="notificationId" value={n.id} />
                        <SubmitButton variant="link" pendingText="…">
                          Прочитано
                        </SubmitButton>
                      </form>
                    ) : null}
                  </div>
                  <time className="text-small whitespace-nowrap text-muted" dateTime={n.createdAt.toISOString()}>
                    {formatDateTime(n.createdAt)}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

const NOTE_TITLES: Record<string, string> = {
  booking_created: "Бронирование создано",
  booking_confirmed: "Бронирование подтверждено",
  booking_cancelled: "Бронирование отменено",
  booking_completed: "Визит состоялся",
  booking_no_show: "Отмечена неявка",
};
