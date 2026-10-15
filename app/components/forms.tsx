"use client";

import { useActionState, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { initialState, type ActionState } from "@/app/actions/state";

// Клиентские части форм: блокировка кнопок во время запроса, ошибки рядом с действием,
// опасные действия в два нажатия без системного диалога (design.md, разделы 4–5).

type Variant = "primary" | "secondary" | "danger" | "link";

export function SubmitButton({
  children,
  variant = "primary",
  small = false,
  block = false,
  pendingText = "Сохраняем…",
  name,
  value,
}: {
  children: ReactNode;
  variant?: Variant;
  small?: boolean;
  block?: boolean;
  pendingText?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  const cls = variant === "link" ? "btn-link" : `btn btn-${variant}${small ? " btn-sm" : ""}${block ? " btn-block-mobile" : ""}`;
  return (
    <button type="submit" className={cls} disabled={pending} aria-disabled={pending} name={name} value={value}>
      {pending ? pendingText : children}
    </button>
  );
}

export function ActionMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p className="field-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="form-success" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Кнопка действия над записью. danger — два нажатия: «Отменить» → «Да, отменить» + «Не надо».
 */
export function RowAction({
  action,
  fields,
  label,
  confirmLabel,
  variant = "secondary",
}: {
  action: Action;
  fields: Record<string, string>;
  label: string;
  confirmLabel?: string;
  variant?: "primary" | "secondary" | "danger";
}) {
  const [state, formAction] = useActionState(action, initialState);
  const [armed, setArmed] = useState(false);
  const needsConfirm = Boolean(confirmLabel);
  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {needsConfirm && !armed ? (
        <button type="button" className={`btn btn-sm btn-${variant}`} onClick={() => setArmed(true)}>
          {label}
        </button>
      ) : needsConfirm ? (
        <div className="flex flex-wrap gap-2">
          <SubmitButton variant={variant} small>
            {confirmLabel}
          </SubmitButton>
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setArmed(false)}>
            Не надо
          </button>
        </div>
      ) : (
        <SubmitButton variant={variant} small>
          {label}
        </SubmitButton>
      )}
      <ActionMessage state={state} />
    </form>
  );
}
