import Image from "next/image";
import Link from "next/link";
import { getCurrentUser } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { CANCEL_DEADLINE_HOURS, HORIZON_DAYS, SLOT_TIMES } from "@/lib/booking/rules";
import { HeroGallery, type HeroSlide } from "@/app/components/hero-gallery";
import { Reveal } from "@/app/components/reveal";

const HERO_SLIDES: HeroSlide[] = [
  { src: "/images/hall-green-wall.webp", alt: "Вечерний зал Verde Marea с живой зелёной стеной и мраморными столами" },
];

const STORIES = [
  {
    src: "/images/open-kitchen.jpg",
    alt: "Открытая кухня Verde Marea и гости за столами",
    title: "Открытая кухня",
    text: "Из зала видно, как готовят ваш ужин: рыба с утреннего улова, овощи с рынка на набережной.",
  },
  {
    src: "/images/chef-flambe.webp",
    alt: "Шеф фламбирует блюдо",
    title: "Шеф у плиты каждый вечер",
    text: "Короткое меню, которое меняется вместе с сезоном и морем.",
  },
];

export default async function HomePage() {
  const user = await getCurrentUser();
  const bookHref = user ? "/book" : "/login";
  return (
    <div className="flex flex-col gap-16">
      <HeroGallery slides={HERO_SLIDES}>
        <p className="eyebrow hero-eyebrow">Ресторан средиземноморской кухни на набережной</p>
        <h1 className="hero-title">Verde Marea — стол у моря без звонка и тетради</h1>
        <p className="hero-lead">
          Зал и веранда, восемь столов от двух до восьми мест. Выберите дату и число гостей — мы покажем только
          реальные свободные окна и сами подберём подходящий стол.
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
                <div className="story-media">
                  <Image src={s.src} alt={s.alt} fill sizes="(min-width: 768px) 540px, 100vw" className="story-img" />
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
            <h3>Когда мы открыты</h3>
            <p className="text-small text-muted">
              Вторник–воскресенье. Окна по 90 минут: {SLOT_TIMES.join(", ")}. Понедельник — выходной.
            </p>
          </div>
        </Reveal>
        <Reveal className="h-full" delay={100}>
          <div className="card flex h-full flex-col gap-2">
            <h3>На {HORIZON_DAYS} дней вперёд</h3>
            <p className="text-small text-muted">
              Бронирование открыто на сегодня и ближайшие две недели. После брони администратор подтвердит её —
              статус виден в «Моих бронированиях».
            </p>
          </div>
        </Reveal>
        <Reveal className="h-full" delay={200}>
          <div className="card flex h-full flex-col gap-2">
            <h3>Планы изменились?</h3>
            <p className="text-small text-muted">
              Отменить бронирование можно самостоятельно не позднее чем за {CANCEL_DEADLINE_HOURS} часа до начала.
            </p>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
