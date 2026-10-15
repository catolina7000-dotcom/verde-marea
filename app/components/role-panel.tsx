import { describeRole, ROLE_LABELS, type Role } from "@/lib/permissions";
import { RoleBadge } from "./ui";

/**
 * Плашка «Ваша роль» в административном контуре (spec.md, раздел 8). Строится по lib/permissions.ts.
 * На телефоне — раскрывающаяся строка (чтобы не отодвигать содержимое), с 768 px — открытая карточка.
 */
export function RolePanel({ role }: { role: Role }) {
  return (
    <>
      <details className="hint md:hidden">
        <summary className="cursor-pointer font-semibold">
          <RoleLine role={role} /> <span className="font-normal text-muted">· что доступно</span>
        </summary>
        <div className="mt-3">
          <RoleLists role={role} />
        </div>
      </details>
      <section aria-label="Права вашей роли" className="hint hidden flex-col gap-3 md:flex">
        <p className="font-semibold">
          <RoleLine role={role} />
        </p>
        <RoleLists role={role} />
      </section>
    </>
  );
}

function RoleLine({ role }: { role: Role }) {
  return (
    <>
      Ваша роль: <RoleBadge role={role} /> <span className="font-normal text-muted">({role})</span>
    </>
  );
}

function RoleLists({ role }: { role: Role }) {
  const { allowed, ownerOnly } = describeRole(role);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="eyebrow">Вам доступно</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {allowed.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <p className="eyebrow">Только владельцу</p>
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {ownerOnly.map((item) => (
            <li key={item}>
              {item}
              {role === "super_admin" ? " — это вы" : ""}
            </li>
          ))}
        </ul>
        <p className="text-muted">Роль «{ROLE_LABELS.super_admin}» не выдаётся и не снимается через интерфейс.</p>
      </div>
    </div>
  );
}
