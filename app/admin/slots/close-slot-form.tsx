"use client";

import { useActionState } from "react";
import { closeSlotAction } from "@/app/actions/admin";
import { initialState } from "@/app/actions/state";
import { ActionMessage, SubmitButton } from "@/app/components/forms";

export function CloseSlotForm({ date, times }: { date: string; times: readonly string[] }) {
  const [state, formAction] = useActionState(closeSlotAction, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3 border-t border-line pt-4">
      <input type="hidden" name="date" value={date} />
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="field md:w-48">
          <label htmlFor={`what-${date}`} className="label">
            Что закрыть
          </label>
          <select id={`what-${date}`} name="startTime" className="input" defaultValue="">
            <option value="">Весь день</option>
            {times.map((t) => (
              <option key={t} value={t}>
                Окно {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field md:flex-1">
          <label htmlFor={`reason-${date}`} className="label">
            Причина
          </label>
          <input
            id={`reason-${date}`}
            name="reason"
            className="input"
            maxLength={120}
            required
            placeholder="Например, банкет"
            defaultValue={state.values?.reason}
          />
        </div>
        <SubmitButton variant="secondary" block>
          Закрыть
        </SubmitButton>
      </div>
      <ActionMessage state={state} />
    </form>
  );
}
