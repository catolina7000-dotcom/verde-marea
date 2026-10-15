import type { Metadata } from "next";
import { gate } from "@/lib/guard";
import { can, canChangeRole, type Role } from "@/lib/permissions";
import { listUsers } from "@/lib/booking/queries";
import { formatDateTime } from "@/lib/format";
import { setRoleAction } from "@/app/actions/admin";
import { RowAction } from "@/app/components/forms";
import { EmptyState, NoAccess, RoleBadge } from "@/app/components/ui";

export const metadata: Metadata = { title: "Пользователи" };

const ROLE_ACTION: Partial<Record<Role, string>> = {
  admin: "Сделать администратором",
  user: "Снять права администратора",
};

export default async function AdminUsersPage() {
  const access = await gate("users.view");
  if (!access.ok) return <NoAccess role={access.user.role} />;
  const viewer = access.user;
  const users = await listUsers();
  const canChange = can(viewer.role, "users.changeRole");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1>Пользователи</h1>
        <p className="prose-width text-muted">
          Владелец назначает и снимает администраторов. Роль владельца через интерфейс не выдаётся и не снимается.
        </p>
      </div>
      {!canChange ? (
        <p className="hint prose-width" role="note">
          Роли меняет только владелец (super_admin): он назначает администраторов и снимает с них права. Вам список
          доступен для чтения — чтобы выдать или снять права администратора, обратитесь к владельцу.
        </p>
      ) : null}
      {users.length === 0 ? (
        <EmptyState title="Пользователей нет" text="Зарегистрированные гости и сотрудники появятся здесь." />
      ) : (
        <table className="table-vm">
          <thead>
            <tr>
              <th scope="col">Имя</th>
              <th scope="col">Почта</th>
              <th scope="col">Роль</th>
              <th scope="col">С нами с</th>
              {canChange ? <th scope="col">Действия</th> : null}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const next: Role = u.role === "admin" ? "user" : "admin";
              const allowed = canChangeRole(viewer.role, u.role, next);
              return (
                <tr key={u.id}>
                  <td data-label="Имя" className="font-semibold">
                    {u.name}
                  </td>
                  <td data-label="Почта">{u.email}</td>
                  <td data-label="Роль">
                    <RoleBadge role={u.role} />
                  </td>
                  <td data-label="С нами с" className="whitespace-nowrap">
                    {formatDateTime(u.createdAt)}
                  </td>
                  {canChange ? (
                    <td data-label="Действия">
                      {allowed ? (
                        <RowAction
                          action={setRoleAction}
                          fields={{ userId: u.id, role: next }}
                          label={ROLE_ACTION[next] ?? ""}
                          variant="secondary"
                        />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
