"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

// Выразительное движение главной (design.md, раздел 4б): инерционная прокрутка Lenis,
// заголовок первого экрана по строкам из-под маски (SplitText), проявление фото clip-path
// с параллаксом внутри кадра, параллакс главного кадра, счётчики в карточках правил.
// Бегущая строка — чистый CSS (globals.css).
//
// Включается, только если на <html> есть data-motion: его ставит встроенный скрипт в layout,
// когда JavaScript работает и нет prefers-reduced-motion. До запуска эффекта элементы,
// которые анимируются «из невидимого», скрыты CSS (html[data-motion]:not(.motion-ready)),
// поэтому нет вспышки готового текста до гидрации. Всё снимается при размонтировании:
// ctx.revert() возвращает DOM (SplitText, clip-path, transform), lenis.destroy() — прокрутку.

gsap.registerPlugin(ScrollTrigger, SplitText);

export function HomeMotion({ children }: { children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const html = document.documentElement;
    const node = root.current;
    if (!node || !html.hasAttribute("data-motion")) return;

    // Инерционная прокрутка — только мышь/тачпад: на сенсорных экранах нативная прокрутка лучше.
    const touch = window.matchMedia("(pointer: coarse)").matches;
    let lenis: Lenis | null = null;
    const tick = (time: number) => lenis?.raf(time * 1000);
    if (!touch) {
      lenis = new Lenis({ lerp: 0.1, autoRaf: false });
      lenis.on("scroll", ScrollTrigger.update);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }

    const counters: { el: HTMLElement; target: number }[] = [];

    const ctx = gsap.context(() => {
      // Заголовок по строкам из-под маски: yPercent 100 → 0, 1.0 s, power3.out, шаг 0.08 s.
      node.querySelectorAll<HTMLElement>("[data-split-lines]").forEach((el) => {
        SplitText.create(el, {
          type: "lines",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) =>
            gsap.from(self.lines, { yPercent: 100, duration: 1, ease: "power3.out", stagger: 0.08 }),
        });
      });

      // Фото «Кухня и зал»: проявление clip-path при входе в экран + параллакс −8 %…8 % кадра.
      node.querySelectorAll<HTMLElement>("[data-clip-reveal]").forEach((frame) => {
        gsap.fromTo(
          frame,
          { clipPath: "inset(100% 0% 0% 0%)" },
          {
            clipPath: "inset(0% 0% 0% 0%)",
            duration: 1.2,
            ease: "power3.out",
            scrollTrigger: { trigger: frame, start: "top 85%", once: true },
          },
        );
        const inner = frame.querySelector<HTMLElement>("[data-parallax]");
        if (inner) {
          // слой выше кадра на 20 %: 8 % кадра = 6.67 % слоя
          gsap.fromTo(
            inner,
            { yPercent: -6.67 },
            { yPercent: 6.67, ease: "none", scrollTrigger: { trigger: frame, start: "top bottom", end: "bottom top", scrub: true } },
          );
        }
      });

      // Главный кадр медленнее страницы: yPercent 0 → 10 за прокрутку первого экрана.
      node.querySelectorAll<HTMLElement>("[data-hero-parallax]").forEach((layer) => {
        const hero = layer.closest(".hero") ?? layer;
        gsap.to(layer, { yPercent: 10, ease: "none", scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: true } });
      });

      // Счётчики: от 0 до значения при появлении, 1.2 s.
      node.querySelectorAll<HTMLElement>("[data-counter]").forEach((el) => {
        const target = Number(el.dataset.counter);
        if (!Number.isFinite(target)) return;
        counters.push({ el, target });
        const value = { n: 0 };
        el.textContent = "0";
        gsap.to(value, {
          n: target,
          duration: 1.2,
          ease: "power2.out",
          onUpdate: () => {
            el.textContent = String(Math.round(value.n));
          },
          scrollTrigger: { trigger: el, start: "top 90%", once: true },
        });
      });
    }, node);

    // начальные состояния выставлены — снимаем CSS-скрытие (до первой отрисовки, это layout-эффект)
    html.classList.add("motion-ready");

    return () => {
      ctx.revert();
      for (const { el, target } of counters) el.textContent = String(target);
      html.classList.remove("motion-ready");
      if (lenis) {
        gsap.ticker.remove(tick);
        gsap.ticker.lagSmoothing(500, 33); // значения GSAP по умолчанию
        lenis.destroy();
        lenis = null;
      }
    };
  }, []);

  return (
    <div ref={root} className="flex flex-col gap-16">
      {children}
    </div>
  );
}
