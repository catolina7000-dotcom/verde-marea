import Link from "next/link";
import { getCurrentUser } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { CANCEL_DEADLINE_HOURS, HORIZON_DAYS, SLOT_TIMES } from "@/lib/booking/rules";

export default async function HomePage() {
  const user = await getCurrentUser();
  const bookHref = user ? "/book" : "/login";
  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <p className="eyebrow">Ресторан средиземноморской кухни на набережной</p>
        <h1 className="max-w-3xl">Verde Marea — стол у моря без звонка и тетради</h1>
        <hr className="gold-rule" />
        <p className="prose-width text-muted">
          Зал и веранда, восемь столов от двух до восьми мест. Выберите дату и число гостей — мы покажем только
          реальные свободные окна и сами подберём подходящий стол.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={bookHref} className="btn btn-primary btn-block-mobile">
            Забронировать стол
          </Link>
          {!user ? (
            <Link href="/register" className="btn btn-secondary btn-block-mobile">
              Создать аккаунт
            </Link>
          ) : can(user.role, "admin.access") ? (
            <Link href="/admin" className="btn btn-secondary btn-block-mobile">
              Администрирование
            </Link>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="card flex flex-col gap-2">
          <h3>Когда мы открыты</h3>
          <p className="text-small text-muted">
            Вторник–воскресенье. Окна по 90 минут: {SLOT_TIMES.join(", ")}. Понедельник — выходной.
          </p>
        </div>
        <div className="card flex flex-col gap-2">
          <h3>На {HORIZON_DAYS} дней вперёд</h3>
          <p className="text-small text-muted">
            Бронирование открыто на сегодня и ближайшие две недели. После брони администратор подтвердит её —
            статус виден в «Моих бронированиях».
          </p>
        </div>
        <div className="card flex flex-col gap-2">
          <h3>Планы изменились?</h3>
          <p className="text-small text-muted">
            Отменить бронирование можно самостоятельно не позднее чем за {CANCEL_DEADLINE_HOURS} часа до начала.
          </p>
        </div>
      </section>
    </div>
  );
}
