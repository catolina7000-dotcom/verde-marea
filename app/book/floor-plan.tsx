"use client";

import { useActionState, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";
import { createBookingAction } from "@/app/actions/booking";
import { initialState, type ActionState } from "@/app/actions/state";
import { SubmitButton } from "@/app/components/forms";
import {
  ENTRANCE,
  HALL,
  LANDMARKS,
  PLAN_DESCRIPTION,
  PLAN_HEIGHT,
  PLAN_WIDTH,
  SEA,
  SEA_WINDOWS,
  SEAT_RADIUS,
  seatPositions,
  tableBox,
  VERANDA,
  ZONE_LABELS,
  type Box,
  type TableShape,
} from "@/lib/booking/floor-plan";
import {
  SLOT_DURATION_MINUTES,
  TABLE_SLACK,
  TABLE_STATUS_LABELS,
  type TableStatus,
  type WindowStatus,
} from "@/lib/booking/rules";
import { pluralSeats } from "@/lib/format";

// План зала на /book (spec.md, раздел 5 и 10а; design.md, 4б): полоса окон с числом свободных
// столов → SVG-план со статусами → карточка выбранного стола → «Забронировать этот стол».
// Статусы приходят из базы (vm_table_availability); здесь только показ и выбор.
// Без JavaScript всё работает ссылками (?time=…&table=…) и обычной отправкой форм.

export type PlanTable = {
  id: string;
  code: string;
  zone: string;
  capacity: number;
  isActive: boolean;
  shape: TableShape;
  x: number;
  y: number;
  w: number;
  h: number;
  status: TableStatus;
};

export type PlanWindow = {
  time: string;
  status: WindowStatus;
  freeTables: number;
  autoTableCode: string | null;
  autoTableCapacity: number | null;
};

type Props = {
  date: string;
  dayLabel: string;
  guests: number;
  windows: PlanWindow[];
  tables: Record<string, PlanTable[]>;
  initialTime: string;
  initialTable: string | null;
};

const WINDOW_NOTES: Record<Exclude<WindowStatus, "open">, string> = {
  past: "Это окно уже началось.",
  closed: "Это окно закрыто для записи.",
  user_busy: "У вас уже есть бронирование на это время.",
  full: "В это окно не осталось подходящих столов.",
};

function endTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + SLOT_DURATION_MINUTES;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function freeLabel(n: number): string {
  return n === 0 ? "автоподбор" : `${n} свободно`;
}

function tableLabel(t: PlanTable, selected: boolean): string {
  const status = selected ? "выбран" : !t.isActive ? "временно не обслуживается" : TABLE_STATUS_LABELS[t.status];
  return `Стол ${t.code}, ${t.zone.toLowerCase()}, ${pluralSeats(t.capacity)}, ${status}`;
}

export function FloorPlanBooking({ date, dayLabel, guests, windows, tables, initialTime, initialTable }: Props) {
  const [time, setTime] = useState(initialTime);
  const [selectedCode, setSelectedCode] = useState<string | null>(initialTable);
  // какие столы сменили статус при последней смене окна — для лёгкого «вспыхивания» (design.md, 4б)
  const [flash, setFlash] = useState<{ codes: string[]; n: number }>({ codes: [], n: 0 });
  const [state, formAction, isPending] = useActionState(createBookingAction, initialState);
  // ошибку прошлой попытки скрываем, как только гость выбирает что-то новое
  const [dismissed, setDismissed] = useState<ActionState | null>(null);
  const error = state !== dismissed ? state.error : undefined;

  const stripRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const bookButtonRef = useRef<HTMLDivElement>(null);

  const current = tables[time] ?? [];
  const win = windows.find((w) => w.time === time);
  const openWindows = windows.filter((w) => w.status === "open" || w.time === time);
  // выбранный стол показывается, только пока он свободен: после гонки план обновится и карточка закроется
  const selected = current.find((t) => t.code === selectedCode && t.status === "free") ?? null;

  const urlFor = (t: string, code: string | null) =>
    `/book?date=${date}&guests=${guests}&time=${t}${code ? `&table=${code}` : ""}`;

  function chooseWindow(next: string, e?: MouseEvent) {
    e?.preventDefault();
    if (next === time) return;
    const before = new Map(current.map((t) => [t.code, t.status]));
    const after = tables[next] ?? [];
    const keep = after.some((t) => t.code === selectedCode && t.status === "free") ? selectedCode : null;
    setFlash({ codes: after.filter((t) => before.get(t.code) !== t.status).map((t) => t.code), n: flash.n + 1 });
    setTime(next);
    setSelectedCode(keep);
    setDismissed(state);
    window.history.replaceState(null, "", urlFor(next, keep));
  }

  function chooseTable(code: string, e?: MouseEvent) {
    e?.preventDefault();
    setSelectedCode(code);
    setDismissed(state);
    window.history.replaceState(null, "", urlFor(time, code));
    // клавиатура: Enter на столе → фокус на главной кнопке карточки
    requestAnimationFrame(() => bookButtonRef.current?.querySelector("button")?.focus({ preventScroll: true }));
  }

  function clearSelection() {
    const code = selectedCode;
    setSelectedCode(null);
    setDismissed(state);
    window.history.replaceState(null, "", urlFor(time, null));
    if (code) {
      requestAnimationFrame(() => {
        // из двух планов (альбомный и книжный) виден один — фокус возвращаем на видимый стол
        const link = [...document.querySelectorAll<SVGAElement>(`[data-table-link="${code}"]`)].find(
          (el) => el.getClientRects().length > 0,
        );
        link?.focus({ preventScroll: true });
      });
    }
  }

  function onCardKey(e: KeyboardEvent) {
    if (e.key === "Escape") clearSelection();
  }

  // Индикатор активного окна переезжает между чипами (transform, 300 ms).
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const indicator = indicatorRef.current;
    if (!strip || !indicator) return;
    const place = () => {
      const active = strip.querySelector<HTMLElement>('[aria-current="true"]');
      if (!active) {
        indicator.style.opacity = "0";
        return;
      }
      indicator.style.opacity = "1";
      indicator.style.width = `${active.offsetWidth}px`;
      indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop + active.offsetHeight - 3}px)`;
    };
    place();
    const raf = requestAnimationFrame(() => indicator.setAttribute("data-ready", "true"));
    const observer = new ResizeObserver(place);
    observer.observe(strip);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [time, openWindows.length]);

  const flashKind: "a" | "b" = flash.n % 2 === 0 ? "a" : "b";
  const svgProps = {
    tables: current,
    selectedCode: selected?.code ?? null,
    time,
    flashCodes: flash.codes,
    flashKind,
    switched: flash.n > 0,
    urlFor,
    onChoose: chooseTable,
  };

  return (
    <div className="flex flex-col gap-4" data-sheet-open={selected ? "true" : undefined}>
      <div className="flex flex-col gap-2">
        <p className="text-small text-muted">
          На плане можно выбрать стол на {guests}–{pluralSeats(guests + TABLE_SLACK)}: двое не занимают стол на восемь.
        </p>
        <div ref={stripRef} className="window-strip" role="group" aria-label="Окна дня">
          {openWindows.map((w) => (
            <a
              key={w.time}
              href={urlFor(w.time, null)}
              className="window-chip"
              aria-current={w.time === time ? "true" : undefined}
              aria-label={`${w.time}–${endTime(w.time)}, ${w.status === "open" ? (w.freeTables ? `свободно столов: ${w.freeTables}` : "стол подберём автоматически") : "недоступно"}`}
              onClick={(e) => chooseWindow(w.time, e)}
            >
              <span className="window-chip-time">{w.time}</span>
              <span className="window-chip-badge" data-empty={w.freeTables === 0 ? "true" : undefined}>
                {w.status === "open" ? freeLabel(w.freeTables) : "недоступно"}
              </span>
            </a>
          ))}
          <span ref={indicatorRef} className="window-indicator" aria-hidden="true" />
        </div>
      </div>

      {error ? (
        <p className="form-alert" role="alert">
          {error}
        </p>
      ) : null}
      {win && win.status !== "open" ? (
        <p className="hint" role="status">
          {WINDOW_NOTES[win.status]} Выберите другое окно.
        </p>
      ) : null}

      <div className="plan-layout">
        <div className="plan-box">
          <PlanSvg orientation="landscape" {...svgProps} />
          <PlanSvg orientation="portrait" {...svgProps} />
          <PlanLegend />
        </div>

        <aside className="plan-side" aria-label="Бронирование стола">
          {selected ? (
            <div key={selected.code} className="plan-sheet card card-booking" role="region" aria-label={`Стол ${selected.code}`} onKeyDown={onCardKey}>
              <p className="eyebrow">Выбранный стол</p>
              <p className="plan-sheet-code font-display">Стол {selected.code}</p>
              <dl className="plan-sheet-facts text-small">
                <div>
                  <dt>Зона</dt>
                  <dd>{selected.zone}</dd>
                </div>
                <div>
                  <dt>Мест</dt>
                  <dd>{selected.capacity}</dd>
                </div>
                <div>
                  <dt>Когда</dt>
                  <dd>
                    {dayLabel}, {time}–{endTime(time)}
                  </dd>
                </div>
              </dl>
              <form action={formAction} className="flex flex-col gap-2">
                <input type="hidden" name="date" value={date} />
                <input type="hidden" name="time" value={time} />
                <input type="hidden" name="guests" value={guests} />
                <input type="hidden" name="tableId" value={selected.id} />
                <div ref={bookButtonRef} className="flex flex-col">
                  <SubmitButton pendingText="Бронируем…">Забронировать этот стол</SubmitButton>
                </div>
              </form>
              <a
                href={urlFor(time, null)}
                className="btn-link self-start"
                onClick={(e) => {
                  e.preventDefault();
                  clearSelection();
                }}
              >
                Выбрать другой
              </a>
            </div>
          ) : (
            <div className="plan-placeholder card">
              <p className="font-semibold">Выберите свободный стол на плане</p>
              <p className="text-small text-muted">
                Свободные столы обведены зелёным. Клавиатура: Tab — по свободным столам, Enter — выбрать, Esc — снять выбор.
              </p>
            </div>
          )}

          {win?.status === "open" ? (
            <form action={formAction} className="card flex flex-col items-start gap-3">
              <input type="hidden" name="date" value={date} />
              <input type="hidden" name="guests" value={guests} />
              <p className="font-semibold">Не важно, где сидеть?</p>
              <p className="text-small text-muted">
                Подберём самый подходящий свободный стол
                {win.autoTableCapacity ? ` — сейчас это стол на ${pluralSeats(win.autoTableCapacity)}` : ""}. Бронирование будет
                ждать подтверждения.
              </p>
              <button type="submit" name="time" value={time} className="btn btn-secondary btn-block-mobile" disabled={isPending}>
                {isPending ? "Бронируем…" : "Подобрать автоматически"}
              </button>
            </form>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// SVG-план. Два варианта одной раскладки: альбомный (≥ 640 px) и повёрнутый на 90° книжный
// (телефон) — столы на 375 px крупнее, текст остаётся горизонтальным. Виден один, второй скрыт CSS.
// ---------------------------------------------------------------------------------------------

type Orientation = "landscape" | "portrait";

type SvgProps = {
  orientation: Orientation;
  tables: PlanTable[];
  selectedCode: string | null;
  time: string;
  flashCodes: string[];
  flashKind: "a" | "b";
  switched: boolean;
  urlFor: (time: string, code: string | null) => string;
  onChoose: (code: string, e?: MouseEvent) => void;
};

/** Поворот на 90° по часовой: зал сверху, веранда и море снизу. */
function mapPoint(o: Orientation, x: number, y: number): [number, number] {
  return o === "landscape" ? [x, y] : [PLAN_HEIGHT - y, x];
}

function mapBox(o: Orientation, b: Box): Box {
  if (o === "landscape") return b;
  return { x0: PLAN_HEIGHT - b.y1, y0: b.x0, x1: PLAN_HEIGHT - b.y0, y1: b.x1 };
}

function BoxLabel({ box, label, className }: { box: Box; label: string; className: string }) {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const vertical = box.y1 - box.y0 > (box.x1 - box.x0) * 1.5;
  return (
    <text
      x={cx}
      y={cy}
      className={className}
      textAnchor="middle"
      dominantBaseline="central"
      transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
    >
      {label}
    </text>
  );
}

function PlanSvg({ orientation: o, tables, selectedCode, time, flashCodes, flashKind, switched, urlFor, onChoose }: SvgProps) {
  const [vw, vh] = o === "landscape" ? [PLAN_WIDTH, PLAN_HEIGHT] : [PLAN_HEIGHT, PLAN_WIDTH];
  const hatch = `plan-hatch-${o}`;
  const veranda = mapBox(o, VERANDA);
  const sea = mapBox(o, SEA);
  // стены зала с проёмом входа внизу (в альбомной ориентации)
  const wall = [
    [ENTRANCE.x0, HALL.y1],
    [HALL.x0, HALL.y1],
    [HALL.x0, HALL.y0],
    [HALL.x1, HALL.y0],
    [HALL.x1, HALL.y1],
    [ENTRANCE.x1, HALL.y1],
  ]
    .map(([x, y], i) => `${i ? "L" : "M"}${mapPoint(o, x, y).join(" ")}`)
    .join(" ");
  const seaLine = o === "landscape" ? { x1: sea.x0, y1: sea.y0, x2: sea.x0, y2: sea.y1 } : { x1: sea.x0, y1: sea.y0, x2: sea.x1, y2: sea.y0 };
  const entranceLabel = mapPoint(o, (ENTRANCE.x0 + ENTRANCE.x1) / 2, HALL.y1 - 16);
  const windowsLabel = mapBox(o, { x0: HALL.x1, y0: 20, x1: VERANDA.x0, y1: 620 });

  return (
    <svg
      viewBox={`0 0 ${vw} ${vh}`}
      className={`plan plan-${o}`}
      data-switched={switched ? "true" : undefined}
      role="group"
      aria-labelledby={`plan-title-${o} plan-desc-${o}`}
    >
      <title id={`plan-title-${o}`}>{`План зала, окно ${time}`}</title>
      <desc id={`plan-desc-${o}`}>{PLAN_DESCRIPTION}</desc>
      <defs>
        <pattern id={hatch} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" className="plan-hatch-line" />
        </pattern>
      </defs>

      <g aria-hidden="true">
        <rect x={0} y={0} width={vw} height={vh} className="plan-floor" />
        <rect x={sea.x0} y={sea.y0} width={sea.x1 - sea.x0} height={sea.y1 - sea.y0} className="plan-sea" />
        <line {...seaLine} className="plan-sea-line" />
        <BoxLabel box={sea} label="Море" className="plan-zone-label" />
        <rect
          x={veranda.x0}
          y={veranda.y0}
          width={veranda.x1 - veranda.x0}
          height={veranda.y1 - veranda.y0}
          className="plan-veranda"
        />
        <path d={wall} className="plan-wall" />
        {SEA_WINDOWS.map((w) => {
          const [ax, ay] = mapPoint(o, HALL.x1, w.y0);
          const [bx, by] = mapPoint(o, HALL.x1, w.y1);
          return (
            <g key={w.y0}>
              <line x1={ax} y1={ay} x2={bx} y2={by} className="plan-window-gap" />
              <line x1={ax} y1={ay} x2={bx} y2={by} className="plan-window" />
            </g>
          );
        })}
        <BoxLabel box={windowsLabel} label="Окна к морю" className="plan-note" />
        {LANDMARKS.map((l) => {
          const b = mapBox(o, l.box);
          return (
            <g key={l.key}>
              <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} rx={8} className="plan-landmark" />
              <BoxLabel box={b} label={l.label} className="plan-note" />
            </g>
          );
        })}
        <text x={entranceLabel[0]} y={entranceLabel[1]} className="plan-note" textAnchor="middle" dominantBaseline="central">
          Вход
        </text>
        {ZONE_LABELS.map((z) => {
          const [x, y] = o === "portrait" && z.portrait ? [z.portrait.x, z.portrait.y] : mapPoint(o, z.x, z.y);
          return (
            <text key={z.label} x={x} y={y} className="plan-zone-label" textAnchor="middle" dominantBaseline="central">
              {z.label}
            </text>
          );
        })}
      </g>

      <g>
        {tables.map((t, i) => {
          const selected = t.code === selectedCode;
          const free = t.status === "free";
          const [cx, cy] = mapPoint(o, t.x, t.y);
          const [w, h] = o === "landscape" || t.shape === "round" ? [t.w, t.h] : [t.h, t.w];
          const seats = seatPositions({ shape: t.shape, x: t.x, y: t.y, w: t.w, h: t.h, capacity: t.capacity }).map((s) =>
            mapPoint(o, s.x, s.y),
          );
          const hit = mapBox(o, tableBox({ shape: t.shape, x: t.x, y: t.y, w: t.w, h: t.h, capacity: t.capacity }, true));
          const pad = 6;
          const label = tableLabel(t, selected);
          const body = (
            <g
              className="plan-body"
              data-flash={flashCodes.includes(t.code) ? flashKind : undefined}
              style={{ "--i": i } as CSSProperties}
            >
              <rect
                x={hit.x0 - pad}
                y={hit.y0 - pad}
                width={hit.x1 - hit.x0 + pad * 2}
                height={hit.y1 - hit.y0 + pad * 2}
                rx={8}
                className="plan-focus"
              />
              {selected ? (
                t.shape === "round" ? (
                  <circle cx={cx} cy={cy} r={w / 2 + 9} className="plan-ring" />
                ) : (
                  <rect x={cx - w / 2 - 9} y={cy - h / 2 - 9} width={w + 18} height={h + 18} rx={12} className="plan-ring" />
                )
              ) : null}
              {seats.map(([sx, sy], k) => (
                <circle key={k} cx={sx} cy={sy} r={SEAT_RADIUS} className="plan-seat" />
              ))}
              {t.shape === "round" ? (
                <>
                  <circle cx={cx} cy={cy} r={w / 2} className="plan-shape" />
                  {t.status === "busy" ? <circle cx={cx} cy={cy} r={w / 2} fill={`url(#${hatch})`} className="plan-hatch" /> : null}
                </>
              ) : (
                <>
                  <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={8} className="plan-shape" />
                  {t.status === "busy" ? (
                    <rect x={cx - w / 2} y={cy - h / 2} width={w} height={h} rx={8} fill={`url(#${hatch})`} className="plan-hatch" />
                  ) : null}
                </>
              )}
              <text x={cx} y={cy} className="plan-code" textAnchor="middle" dominantBaseline="central">
                {t.code}
              </text>
            </g>
          );
          return (
            <g
              key={t.code}
              className="plan-table"
              data-status={t.status}
              data-selected={selected ? "true" : undefined}
              role={free ? undefined : "img"}
              aria-label={free ? undefined : label}
            >
              {free ? (
                <a
                  href={urlFor(time, t.code)}
                  className="plan-hit"
                  aria-label={label}
                  aria-current={selected ? "true" : undefined}
                  data-table-link={t.code}
                  onClick={(e) => onChoose(t.code, e)}
                >
                  {body}
                </a>
              ) : (
                body
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function PlanLegend() {
  const items: { key: string; label: string }[] = [
    { key: "free", label: "свободен" },
    { key: "selected", label: "выбран" },
    { key: "busy", label: "занят" },
    { key: "unsuitable", label: "не подходит" },
  ];
  return (
    <ul className="plan-legend text-small" aria-label="Обозначения на плане">
      {items.map((it) => (
        <li key={it.key}>
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" className="plan-legend-swatch" data-kind={it.key}>
            <defs>
              <pattern id={`legend-hatch-${it.key}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="plan-hatch-line" />
              </pattern>
            </defs>
            <circle cx="10" cy="10" r="8" className="plan-legend-shape" />
            {it.key === "busy" ? <circle cx="10" cy="10" r="8" fill={`url(#legend-hatch-${it.key})`} /> : null}
          </svg>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
