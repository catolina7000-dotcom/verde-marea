import type { Metadata } from "next";
import { gate } from "@/lib/guard";
import { listAudit } from "@/lib/booking/queries";
import { isBookingStatus, STATUS_LABELS } from "@/lib/booking/rules";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { formatDateTime, formatDay } from "@/lib/format";
import { EmptyState, NoAccess } from "@/app/components/ui";

export const metadata: Metadata = { title: "История" };

const ACTION_LABELS: Record<string, string> = {
  booking_created: "Создал бронирование",
  booking_confirmed: "Подтвердил бронирование",
  booking_cancelled: "Отменил бронирование",
  booking_completed: "Отметил «Состоялось»",
  booking_no_show: "Отметил неявку",
  role_changed: "Сменил роль",
  slot_closed: "Закрыл окно",
  slot_opened: "Открыл окно",
};

type Details = { from?: string | null; to?: string; date?: string; startTime?: string | null; reason?: string };

function statusLabel(s?: string | null) {
  return s && isBookingStatus(s) ? STATUS_LABELS[s] : s ?? "—";
}

function roleLabel(r?: string | null) {
  return r && r in ROLE_LABELS ? ROLE_LABELS[r as Role] : r ?? "—";
}

export default async function AdminAuditPage() {
  const access = await gate("audit.view");
  if (!access.ok) return <NoAccess role={access.user.role} />;
  const entries = await listAudit();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1>История</h1>
        <p className="prose-width text-muted">Последние 200 действий: кто, когда и что изменил. Записи создаёт база в той же транзакции, что и изменение.</p>
      </div>
      {entries.length === 0 ? (
        <EmptyState title="История пуста" text="Здесь появятся бронирования, смены статусов и ролей, закрытия окон." />
      ) : (
        <table className="table-vm">
          <thead>
            <tr>
              <th scope="col">Когда</th>
              <th scope="col">Кто</th>
              <th scope="col">Действие</th>
              <th scope="col">Подробности</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const d = (e.details ?? {}) as Details;
              let detail = "";
              if (e.action === "role_changed") {
                detail = `${e.targetUser?.name ?? "—"}: ${roleLabel(d.from)} → ${roleLabel(d.to)}`;
              } else if (e.action === "slot_closed" || e.action === "slot_opened") {
                detail = `${d.date ? formatDay(d.date) : "—"}, ${d.startTime ? `окно ${d.startTime}` : "весь день"}${d.reason ? ` · ${d.reason}` : ""}`;
              } else if (e.booking) {
                const transition = d.from ? `${statusLabel(d.from)} → ${statusLabel(d.to)}` : statusLabel(d.to);
                detail = `${e.booking.user.name}, ${formatDateTime(e.booking.startsAt)}, стол ${e.booking.table.code} · ${transition}`;
              }
              return (
                <tr key={e.id}>
                  <td data-label="Когда" className="whitespace-nowrap">
                    {formatDateTime(e.createdAt)}
                  </td>
                  <td data-label="Кто">
                    <span className="font-semibold">{e.actor.name}</span>
                  </td>
                  <td data-label="Действие">{ACTION_LABELS[e.action] ?? e.action}</td>
                  <td data-label="Подробности">{detail}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
