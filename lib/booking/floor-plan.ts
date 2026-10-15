// План зала (spec.md: Table, раздел 5; design.md, раздел 4б). Чистый модуль без базы и Node-API:
// его используют SVG-план на /book, seed и check:rules.
// Система координат 1000 × 640: зал слева, веранда справа, «море» у правого края.
// Столы и их места на плане задаёт seed (поля shape, planX, planY, planW, planH);
// ориентиры (стены, вход, бар, кухня, окна, море) — неинтерактивные константы ниже.

export const PLAN_WIDTH = 1000;
export const PLAN_HEIGHT = 640;

export type TableShape = "round" | "rect";

export type PlanGeometry = {
  shape: TableShape;
  /** центр стола */
  x: number;
  y: number;
  /** ширина и высота (для round — диаметр, w = h) */
  w: number;
  h: number;
  capacity: number;
};

export type Box = { x0: number; y0: number; x1: number; y1: number };

/** Расстояние от края стола до центра стула и радиус стула-точки. */
export const SEAT_OFFSET = 14;
export const SEAT_RADIUS = 7;

/** Стулья-точки по числу мест (design.md, 4б). */
export function seatPositions(t: PlanGeometry): { x: number; y: number }[] {
  const n = t.capacity;
  if (t.shape === "round") {
    const r = t.w / 2 + SEAT_OFFSET;
    const start = n === 2 ? Math.PI : -Math.PI / 2;
    return Array.from({ length: n }, (_, i) => {
      const a = start + (i * 2 * Math.PI) / n;
      return { x: round1(t.x + r * Math.cos(a)), y: round1(t.y + r * Math.sin(a)) };
    });
  }
  const horizontal = t.w >= t.h;
  const first = Math.ceil(n / 2);
  const second = n - first;
  const seats: { x: number; y: number }[] = [];
  const along = (count: number, i: number, length: number, from: number) => from + ((i + 0.5) * length) / count;
  if (horizontal) {
    const x0 = t.x - t.w / 2;
    for (let i = 0; i < first; i++) seats.push({ x: round1(along(first, i, t.w, x0)), y: t.y - t.h / 2 - SEAT_OFFSET });
    for (let i = 0; i < second; i++) seats.push({ x: round1(along(second, i, t.w, x0)), y: t.y + t.h / 2 + SEAT_OFFSET });
  } else {
    const y0 = t.y - t.h / 2;
    for (let i = 0; i < first; i++) seats.push({ x: t.x - t.w / 2 - SEAT_OFFSET, y: round1(along(first, i, t.h, y0)) });
    for (let i = 0; i < second; i++) seats.push({ x: t.x + t.w / 2 + SEAT_OFFSET, y: round1(along(second, i, t.h, y0)) });
  }
  return seats;
}

/** Прямоугольник стола; withSeats — вместе со стульями (для проверки пересечений и зоны клика). */
export function tableBox(t: PlanGeometry, withSeats = false): Box {
  const pad = withSeats ? SEAT_OFFSET + SEAT_RADIUS : 0;
  return { x0: t.x - t.w / 2 - pad, y0: t.y - t.h / 2 - pad, x1: t.x + t.w / 2 + pad, y1: t.y + t.h / 2 + pad };
}

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
}

export function boxInside(inner: Box, outer: Box): boolean {
  return inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1;
}

function round1(v: number) {
  return Math.round(v * 10) / 10;
}

// ---------------------------------------------------------------------------------------------
// Ориентиры — неинтерактивные (aria-hidden на плане, описаны одной подписью у SVG).
// ---------------------------------------------------------------------------------------------

/** Зал: стены с проёмом входа внизу. */
export const HALL: Box = { x0: 20, y0: 20, x1: 600, y1: 620 };
export const ENTRANCE = { x0: 150, x1: 250, y: 620 };
/** Веранда — открытая терраса, граница пунктиром. */
export const VERANDA: Box = { x0: 620, y0: 20, x1: 880, y1: 620 };
/** Полоса «моря» у веранды. */
export const SEA: Box = { x0: 900, y0: 0, x1: 1000, y1: 640 };

export const LANDMARKS: { key: string; label: string; box: Box; vertical?: boolean }[] = [
  { key: "bar", label: "Бар", box: { x0: 40, y0: 40, x1: 300, y1: 92 } },
  { key: "kitchen", label: "Открытая кухня", box: { x0: 40, y0: 150, x1: 112, y1: 470 }, vertical: true },
];

/** Окна к морю — проёмы в стене зала со стороны веранды (x = 600). */
export const SEA_WINDOWS: { y0: number; y1: number }[] = [
  { y0: 120, y1: 230 },
  { y0: 290, y1: 400 },
  { y0: 460, y1: 570 },
];

/** Подписи зон; portrait — своё место в повёрнутом (книжном) плане, если по повороту подпись наезжает на стол. */
export const ZONE_LABELS: { label: string; x: number; y: number; portrait?: { x: number; y: number } }[] = [
  { label: "Зал", x: 470, y: 72 },
  { label: "Веранда", x: 750, y: 64, portrait: { x: 556, y: 852 } },
];

/** Короткое текстовое описание плана для скринридера. */
export const PLAN_DESCRIPTION =
  "План ресторана. Слева зал: бар вдоль верхней стены, открытая кухня у левой стены, вход снизу. " +
  "Справа, за окнами к морю, — веранда, за ней море.";
