import { gate } from "@/lib/guard";
import { AdminTabs } from "@/app/components/admin-tabs";
import { NoAccess } from "@/app/components/ui";
import { RolePanel } from "@/app/components/role-panel";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // без сессии — /login; user — «Нет доступа». Каждая страница проверяет своё право ещё раз.
  const access = await gate("admin.access");
  if (!access.ok) return <NoAccess role={access.user.role} />;
  return (
    <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)] md:gap-8">
      <aside className="flex flex-col gap-2">
        <p className="eyebrow">Администрирование</p>
        <AdminTabs />
        <div className="mt-2">
          <RolePanel role={access.user.role} />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
