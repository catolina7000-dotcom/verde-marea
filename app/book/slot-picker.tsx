"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createBookingAction } from "@/app/actions/booking";
import { initialState } from "@/app/actions/state";
import { pluralSeats } from "@/lib/format";

function Tiles({ slots }: { slots: { time: string; capacity: number }[] }) {
  const { pending, data } = useFormStatus();
  const chosen = pending ? data?.get("time") : null;
  return (
    <div className="slot-grid">
      {slots.map((s) => (
        <button
          key={s.time}
          type="submit"
          name="time"
          value={s.time}
          className="slot-tile"
          disabled={pending}
          aria-pressed={chosen === s.time}
        >
          <span className="slot-time">{chosen === s.time ? "…" : s.time}</span>
          <span className="text-small text-muted">стол на {pluralSeats(s.capacity)}</span>
        </button>
      ))}
    </div>
  );
}

export function SlotPicker({ date, guests, slots }: { date: string; guests: number; slots: { time: string; capacity: number }[] }) {
  const [state, formAction] = useActionState(createBookingAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="guests" value={guests} />
      <Tiles slots={slots} />
      {state.error ? (
        <p className="form-alert" role="alert">
          {state.error}
        </p>
      ) : (
        <p className="text-small text-muted">Нажмите на окно — бронирование создастся сразу и будет ждать подтверждения.</p>
      )}
    </form>
  );
}
