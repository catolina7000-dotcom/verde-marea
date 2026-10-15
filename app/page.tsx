import Image from "next/image";
import Link from "next/link";
import { getCurrentUser } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { CANCEL_DEADLINE_HOURS, HORIZON_DAYS, SLOT_DURATION_MINUTES, SLOT_TIMES } from "@/lib/booking/rules";
import { prisma } from "@/lib/db";
import { HeroGallery, type HeroSlide } from "@/app/components/hero-gallery";
import { Reveal } from "@/app/components/reveal";
import { HomeMotion } from "@/app/components/home-motion";

const HERO_SLIDES: HeroSlide[] = [
  { src: "/images/hall.jpg", alt: "Вечерний зал Verde Marea: столы при свечах среди пальм и тёплого света" },
];

function tablesWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "стол";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "стола";
  return "столов";
}

const MARQUEE = ["Средиземноморская кухня", "Свежий улов", "Зал и веранда", "Бронирование онлайн"];

const STORIES = [
  {
    src: "/images/kitchen.jpg",
    alt: "Повар Verde Marea нарезает овощи на кухне",
    title: "Открытая кухня",
    text: "Из зала видно, как готовят ваш ужин: рыба с утреннего улова, овощи с рынка на набережной.",
  },
  {
    src: "/images/chef.jpg",
    alt: "Шеф фламбирует блюдо на сковороде",
    title: "Шеф у плиты каждый вечер",
    text: "Короткое меню, которое меняется вместе с сезоном и морем.",
  },
];

export default async function HomePage() {
  const [user, tables] = await Promise.all([getCurrentUser(), prisma.table.count({ where: { isActive: true } })]);
  const bookHref = user ? "/book" : "/login";
  return (
    <HomeMotion>
      <HeroGallery slides={HERO_SLIDES}>
        <p className="eyebrow hero-eyebrow">Ресторан средиземноморской кухни на набережной</p>
        <h1 className="hero-title" data-split-lines>Verde Marea — стол у моря без звонка и тетради</h1>
        <p className="hero-lead">
          Зал и веранда, восемь столов от двух до восьми мест. Выберите дату и число гостей — мы покажем только
          реальные свободные окна, а стол можно выбрать прямо на плане зала.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={bookHref} className="btn btn-hero btn-block-mobile">
            Забронировать стол
          </Link>
          {!user ? (
            <Link href="/register" className="btn btn-hero-outline btn-block-mobile">
              Создать аккаунт
            </Link>
          ) : can(user.role, "admin.access") ? (
            <Link href="/admin" className="btn btn-hero-outline btn-block-mobile">
              Администрирование
            </Link>
          ) : null}
        </div>
      </HeroGallery>

      {/* Бегущая строка (design.md, 4б): декоративная, дублирует смысл первого экрана */}
      <div className="marquee" aria-hidden="true">
        <div className="marquee-track">
          {[0, 1].map((copy) => (
            <span key={copy} className="marquee-group">
              {[...MARQUEE, ...MARQUEE].map((item, i) => (
                <span key={i} className="marquee-item">
                  {item}
                  <span className="marquee-dot">·</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-6" aria-labelledby="stories-title">
        <Reveal>
          <p className="eyebrow">Кухня и зал</p>
          <h2 id="stories-title" className="mt-2">
            Ужин, который видно с вашего стола
          </h2>
        </Reveal>
        <div className="grid gap-6 md:grid-cols-2">
          {STORIES.map((s, i) => (
            <Reveal key={s.src} delay={i * 120}>
              <figure className="story">
                <div className="story-media" data-clip-reveal>
                  <div className="story-parallax" data-parallax>
                    <Image src={s.src} alt={s.alt} fill sizes="(min-width: 768px) 540px, 100vw" className="story-img" />
                  </div>
                </div>
                <figcaption className="flex flex-col gap-1 pt-4">
                  <h3>{s.title}</h3>
                  <p className="text-small text-muted">{s.text}</p>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3" aria-label="Как работает бронирование">
        <Reveal className="h-full">
          <div className="card flex h-full flex-col gap-2">
            <p className="stat" aria-hidden="true">
              <span data-counter={SLOT_DURATION_MINUTES}>{SLOT_DURATION_MINUTES}</span> минут
            </p>
            <h3>Когда мы открыты</h3>
            <p className="text-small text-muted">
              Вторник–воскресенье. Окна по {SLOT_DURATION_MINUTES} минут: {SLOT_TIMES.join(", ")}. Понедельник — выходной.
            </p>
          </div>
        </Reveal>
        <Reveal className="h-full" delay={100}>
          <div className="card flex h-full flex-col gap-2">
            <p className="stat" aria-hidden="true">
              <span data-counter={HORIZON_DAYS}>{HORIZON_DAYS}</span> дней
            </p>
            <h3>На {HORIZON_DAYS} дней вперёд</h3>
            <p className="text-small text-muted">
              Бронирование открыто на сегодня и ближайшие две недели. После брони администратор подтвердит её —
              статус виден в «Моих бронированиях». Отменить можно не позднее чем за {CANCEL_DEADLINE_HOURS} часа до
              начала.
            </p>
          </div>
        </Reveal>
        <Reveal className="h-full" delay={200}>
          <div className="card flex h-full flex-col gap-2">
            <p className="stat" aria-hidden="true">
              <span data-counter={tables}>{tables}</span> {tablesWord(tables)}
            </p>
            <h3>Стол на плане зала</h3>
            <p className="text-small text-muted">
              Зал и веранда у моря, от двух до восьми мест. Выберите стол на плане или доверьте подбор нам — покажем
              только свободные.
            </p>
          </div>
        </Reveal>
      </section>
    </HomeMotion>
  );
}
