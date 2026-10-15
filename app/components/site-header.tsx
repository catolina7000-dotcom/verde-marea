import Link from "next/link";
import { getCurrentUser } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { countUnreadNotifications } from "@/lib/booking/queries";
import { logoutAction } from "@/app/actions/auth";
import { SubmitButton } from "./forms";

export async function SiteHeader() {
  const user = await getCurrentUser();
  const unread = user && can(user.role, "booking.viewOwn") ? await countUnreadNotifications(user.id) : 0;
  return (
    <header className="border-b border-line bg-surface">
      <div className="container-vm flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3">
        <Link href="/" className="font-display text-[26px] leading-none text-ink no-underline">
          Verde Marea
        </Link>
        <nav aria-label="Основная навигация" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[14px] font-semibold">
          {user ? (
            <>
              {can(user.role, "booking.create") ? <Link href="/book">Забронировать</Link> : null}
              {can(user.role, "booking.viewOwn") ? (
                <Link href="/account">
                  Мои бронирования{unread > 0 ? <span className="text-muted"> · {unread}</span> : null}
                </Link>
              ) : null}
              {can(user.role, "admin.access") ? <Link href="/admin">Администрирование</Link> : null}
              <form action={logoutAction}>
                <SubmitButton variant="link" pendingText="Выходим…">
                  Выйти
                </SubmitButton>
              </form>
            </>
          ) : (
            <>
              <Link href="/login">Войти</Link>
              <Link href="/register">Регистрация</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
