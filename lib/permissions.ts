// Единая матрица ролей (spec.md, раздел 6). По ней интерфейс показывает кнопки,
// а Server Actions делают первую проверку. Окончательная проверка — в функциях vm_*.
// Модуль чистый: его можно импортировать и в клиентские компоненты.

export const ROLES = ["user", "admin", "super_admin"] as const;
export type Role = (typeof ROLES)[number];
/** null — гость без входа (отдельной роли в базе нет). */
export type Viewer = Role | null;
type Subject = "guest" | Role;

export const ROLE_LABELS: Record<Role, string> = {
  user: "Гость",
  admin: "Администратор",
  super_admin: "Владелец",
};

const MATRIX = {
  "auth.signIn": ["guest"],
  "slots.view": ["user", "admin", "super_admin"],
  "booking.create": ["user", "admin", "super_admin"],
  "booking.viewOwn": ["user", "admin", "super_admin"],
  "booking.cancelOwn": ["user", "admin", "super_admin"],
  "admin.access": ["admin", "super_admin"],
  "booking.manage": ["admin", "super_admin"],
  "slots.manage": ["admin", "super_admin"],
  "users.view": ["admin", "super_admin"],
  "users.changeRole": ["super_admin"],
  "audit.view": ["admin", "super_admin"],
} as const satisfies Record<string, readonly Subject[]>;

export type Permission = keyof typeof MATRIX;
export const PERMISSIONS = Object.keys(MATRIX) as Permission[];

export function can(viewer: Viewer, permission: Permission): boolean {
  const subject: Subject = viewer ?? "guest";
  return (MATRIX[permission] as readonly Subject[]).includes(subject);
}

/** Роли, которые можно назначать через интерфейс: только user ↔ admin. */
export const ASSIGNABLE_ROLES: readonly Role[] = ["user", "admin"];

/** super_admin меняет user ↔ admin; роль super_admin никто не выдаёт и не снимает. */
export function canChangeRole(actor: Viewer, targetRole: Role, nextRole: Role): boolean {
  return (
    can(actor, "users.changeRole") &&
    targetRole !== "super_admin" &&
    ASSIGNABLE_ROLES.includes(nextRole) &&
    targetRole !== nextRole
  );
}

/** Подписи прав для плашки «Ваша роль» (spec.md, раздел 8). */
export const PERMISSION_LABELS: Record<Permission, string> = {
  "auth.signIn": "Регистрация и вход",
  "slots.view": "Смотреть свободные окна",
  "booking.create": "Бронировать стол на себя",
  "booking.viewOwn": "Свои бронирования и уведомления",
  "booking.cancelOwn": "Отменять своё бронирование не позднее чем за 3 часа",
  "admin.access": "Административный контур",
  "booking.manage": "Подтверждать, отменять, отмечать «Состоялось» и неявку",
  "slots.manage": "Закрывать и открывать окна и дни",
  "users.view": "Смотреть список пользователей",
  "users.changeRole": "Назначать и снимать администраторов (user ↔ admin)",
  "audit.view": "Смотреть историю изменений",
};

/** Что доступно роли и что из прав персонала есть только у владельца — по той же матрице. */
export function describeRole(role: Role): { allowed: string[]; ownerOnly: string[] } {
  const visible = PERMISSIONS.filter((p) => p !== "auth.signIn");
  return {
    allowed: visible.filter((p) => can(role, p)).map((p) => PERMISSION_LABELS[p]),
    ownerOnly: visible.filter((p) => can("super_admin", p) && !can("admin", p)).map((p) => PERMISSION_LABELS[p]),
  };
}

export function isStaff(viewer: Viewer): boolean {
  return can(viewer, "admin.access");
}
