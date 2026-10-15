import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_LABELS, type BookingStatus } from "@/lib/booking/rules";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

// Общие серверные компоненты Verde Marea (design.md, разделы 4–5).

export function StatusBadge({ status }: { status: BookingStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function RoleBadge({ role }: { role: Role }) {
  return <span className={`badge badge-role-${role}`}>{ROLE_LABELS[role]}</span>;
}

export function PageHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-8 flex flex-col gap-3">
      {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
      <h1>{title}</h1>
      <hr className="gold-rule" />
      {children ? <div className="prose-width text-muted">{children}</div> : null}
    </header>
  );
}

/** Пустое состояние: пояснение и одно действие. */
export function EmptyState({ title, text, action }: { title: string; text: string; action?: { href: string; label: string } }) {
  return (
    <div className="card flex flex-col items-start gap-3">
      <h3>{title}</h3>
      <p className="prose-width text-muted">{text}</p>
      {action ? (
        <Link href={action.href} className="btn btn-secondary">
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function NoAccess({ role }: { role: Role }) {
  return (
    <div className="card flex max-w-xl flex-col items-start gap-3" role="alert">
      <p className="eyebrow">Ошибка 403</p>
      <h2>Нет доступа</h2>
      <p className="text-muted">
        Раздел «Администрирование» открыт администраторам и владельцу. Ваша роль — <RoleBadge role={role} />. Если вы
        сотрудник, попросите владельца выдать вам права администратора.
      </p>
      <Link href="/" className="btn btn-secondary">
        На главную
      </Link>
    </div>
  );
}

export function SuccessBanner({ children }: { children: ReactNode }) {
  return (
    <p className="form-success" role="status">
      {children}
    </p>
  );
}
