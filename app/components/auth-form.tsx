"use client";

import Link from "next/link";
import { useActionState } from "react";
import { initialState, type ActionState } from "@/app/actions/state";
import { SubmitButton } from "./forms";

type Field = { name: string; label: string; type: string; autoComplete: string; hint?: string };

export function AuthForm({
  action,
  fields,
  submitLabel,
  footer,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  fields: Field[];
  submitLabel: string;
  footer: { text: string; href: string; link: string };
}) {
  const [state, formAction] = useActionState(action, initialState);
  return (
    <form action={formAction} className="card flex flex-col gap-4" noValidate>
      {state.error ? (
        <p className="form-alert" role="alert">
          {state.error}
        </p>
      ) : null}
      {fields.map((f) => {
        const error = state.fieldErrors?.[f.name];
        return (
          <div key={f.name} className="field">
            <label htmlFor={f.name} className="label">
              {f.label}
            </label>
            <input
              id={f.name}
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              defaultValue={f.type === "password" ? undefined : state.values?.[f.name]}
              className="input"
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${f.name}-error` : f.hint ? `${f.name}-hint` : undefined}
            />
            {error ? (
              <p id={`${f.name}-error`} className="field-error">
                {error}
              </p>
            ) : f.hint ? (
              <p id={`${f.name}-hint`} className="text-small text-muted">
                {f.hint}
              </p>
            ) : null}
          </div>
        );
      })}
      <SubmitButton block pendingText="Проверяем…">
        {submitLabel}
      </SubmitButton>
      <p className="text-small text-muted">
        {footer.text} <Link href={footer.href}>{footer.link}</Link>
      </p>
    </form>
  );
}
