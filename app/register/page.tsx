import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { registerAction } from "@/app/actions/auth";
import { AuthForm } from "@/app/components/auth-form";
import { PageHeading } from "@/app/components/ui";
import { AuthSplit } from "@/app/components/auth-split";
import { PASSWORD_MIN } from "@/lib/validation";

export const metadata: Metadata = { title: "Регистрация" };

export default async function RegisterPage() {
  const user = await getCurrentUser();
  if (!can(user?.role ?? null, "auth.signIn")) redirect("/account");
  return (
    <AuthSplit>
      <PageHeading eyebrow="Новый гость" title="Регистрация">
        После регистрации можно сразу выбрать дату и стол.
      </PageHeading>
      <AuthForm
        action={registerAction}
        submitLabel="Создать аккаунт"
        fields={[
          { name: "name", label: "Имя", type: "text", autoComplete: "name", hint: "Как к вам обращаться, 2–60 символов." },
          { name: "email", label: "Почта", type: "email", autoComplete: "email" },
          {
            name: "password",
            label: "Пароль",
            type: "password",
            autoComplete: "new-password",
            hint: `Не короче ${PASSWORD_MIN} символов.`,
          },
        ]}
        footer={{ text: "Уже есть аккаунт?", href: "/login", link: "Войти" }}
      />
    </AuthSplit>
  );
}
