/**
 * Role based access control. This file is the single source of truth for
 * what each role may do — the API, the Telegram bot and the web dashboard all
 * read from it.
 */
export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'company:delete',
  'company:manage',
  'settings:manage',
  'users:manage',
  'clopos:manage',
  'dashboard:view',
  'sales:view',
  'stock:view',
  'incoming:view',
  'incoming:create',
  'catalog:manage',
  'reports:view',
  'reports:schedule',
  'finance:view',
  'employees:view',
  'employees:manage',
  'salary:view',
  'salary:manage',
  'audit:view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // everything
  SUPER_ADMIN: ALL,
  // everything except company deletion
  ADMIN: ALL.filter((p) => p !== 'company:delete'),
  // sales, stock, reports
  MANAGER: [
    'dashboard:view',
    'sales:view',
    'stock:view',
    'incoming:view',
    'incoming:create',
    'catalog:manage',
    'reports:view',
  ],
  // finance, salary, reports
  ACCOUNTANT: [
    'dashboard:view',
    'finance:view',
    'incoming:view',
    'reports:view',
    'employees:view',
    'salary:view',
    'salary:manage',
  ],
  // limited Telegram functionality: check stock and register incoming goods
  EMPLOYEE: ['stock:view', 'incoming:create'],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function hasAllPermissions(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p));
}

/** Roles a user may assign to others: never higher than their own. */
const ROLE_RANK: Record<Role, number> = {
  SUPER_ADMIN: 5,
  ADMIN: 4,
  MANAGER: 3,
  ACCOUNTANT: 3,
  EMPLOYEE: 1,
};

export function canAssignRole(actor: Role, target: Role): boolean {
  if (target === 'SUPER_ADMIN') return actor === 'SUPER_ADMIN';
  return hasPermission(actor, 'users:manage') && ROLE_RANK[actor] >= ROLE_RANK[target];
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Супер-админ',
  ADMIN: 'Администратор',
  MANAGER: 'Менеджер',
  ACCOUNTANT: 'Бухгалтер',
  EMPLOYEE: 'Сотрудник',
};
