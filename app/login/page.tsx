import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/guard";
import { can } from "@/lib/permissions";
import { loginAction } from "@/app/actions/auth";
import { AuthForm } from "@/app/components/auth-form";
import { PageHeading } from "@/app/components/ui";
import { AuthSplit } from "@/app/components/auth-split";

export const metadata: Metadata = { title: "Вход" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (!can(user?.role ?? null, "auth.signIn")) redirect("/account");
  return (
    <AuthSplit>
      <PageHeading eyebrow="С возвращением" title="Вход" />
      <AuthForm
        action={loginAction}
        submitLabel="Войти"
        fields={[
          { name: "email", label: "Почта", type: "email", autoComplete: "email" },
          { name: "password", label: "Пароль", type: "password", autoComplete: "current-password" },
        ]}
        footer={{ text: "Ещё нет аккаунта?", href: "/register", link: "Зарегистрироваться" }}
      />
    </AuthSplit>
  );
}
