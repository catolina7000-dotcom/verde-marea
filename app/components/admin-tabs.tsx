"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Бронирования" },
  { href: "/admin/slots", label: "Окна записи" },
  { href: "/admin/users", label: "Пользователи" },
  { href: "/admin/audit", label: "История" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Разделы администрирования" className="tabs md:flex-col">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="tab" aria-current={pathname === t.href ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
