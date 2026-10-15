"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export type HeroSlide = { src: string; alt: string };

const SLIDE_MS = 6500;

// Первый экран: размытая копия кадра на фоне и чёткий кадр справа.
// Кадры сменяются плавным затуханием; при prefers-reduced-motion — один статичный кадр.
export function HeroGallery({ slides, children }: { slides: HeroSlide[]; children: React.ReactNode }) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (media.matches || slides.length < 2) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setActive((i) => (i + 1) % slides.length);
    }, SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [slides.length]);

  return (
    <section className="hero" aria-label="Verde Marea">
      <div className="hero-backdrop" aria-hidden="true">
        {slides.map((s, i) => (
          <Image
            key={s.src}
            src={s.src}
            alt=""
            fill
            sizes="100vw"
            priority={i === 0}
            className="hero-backdrop-img"
            data-active={i === active}
          />
        ))}
      </div>

      <div className="hero-inner">
        <div className="hero-copy">{children}</div>

        <figure className="hero-frame">
          {slides.map((s, i) => (
            <Image
              key={s.src}
              src={s.src}
              alt={i === active ? s.alt : ""}
              aria-hidden={i !== active}
              fill
              sizes="(min-width: 768px) 520px, 100vw"
              priority={i === 0}
              className="hero-frame-img"
              data-active={i === active}
            />
          ))}
          {slides.length > 1 && (
            <div className="hero-dots" role="group" aria-label="Фото ресторана">
              {slides.map((s, i) => (
                <button
                  key={s.src}
                  type="button"
                  className="hero-dot"
                  aria-label={`Фото ${i + 1} из ${slides.length}`}
                  aria-current={i === active}
                  onClick={() => setActive(i)}
                />
              ))}
            </div>
          )}
        </figure>
      </div>
    </section>
  );
}
