import type { Access, Db, Employee, ModuleId, Role } from '../types';

export const RANK: Record<Access, number> = { none: 0, view: 1, manage: 2 };

export const MODULE_IDS: ModuleId[] = [
  'overview', 'analytics', 'customers', 'drivers', 'onboarding', 'checks', 'payments', 'loyalty', 'reviews',
  'chat', 'push', 'employees', 'access', 'tasks', 'activity', 'platform',
];

export const MODULE_LABEL: Record<ModuleId, string> = {
  overview: 'Overview', analytics: 'Analytics', customers: 'Customers', drivers: 'Drivers', onboarding: 'Driver onboarding', checks: 'Background checks',
  payments: 'Payments', loyalty: 'Levels & rewards', reviews: 'Reviews', chat: 'Live chat', push: 'Push notifications',
  employees: 'Employees', access: 'Roles & access', tasks: 'Tasks', activity: 'Activity log', platform: 'Platform',
};

export function accessMap(fill: Access, set: Partial<Record<ModuleId, Access>> = {}): Record<ModuleId, Access> {
  return Object.fromEntries(MODULE_IDS.map((m) => [m, set[m] ?? fill])) as Record<ModuleId, Access>;
}

/** An employee's override wins over their role. Suspended and invited staff have no access at all. */
export function effectiveAccess(e: Employee | undefined, roles: Role[], m: ModuleId): Access {
  if (!e || e.status !== 'active') return 'none';
  return e.overrides[m] ?? roles.find((r) => r.id === e.roleId)?.access[m] ?? 'none';
}

export const isOwner = (e: Employee | undefined) => e?.roleId === 'owner' && e.status === 'active';

/** Staff can never hand out more access than they hold themselves. */
export function canGrant(me: Employee | undefined, roles: Role[], m: ModuleId, level: Access) {
  return RANK[level] <= RANK[effectiveAccess(me, roles, m)];
}

export function roleWithinMine(me: Employee | undefined, roles: Role[], role: Role) {
  return MODULE_IDS.every((m) => canGrant(me, roles, m, role.access[m]));
}

/** The last active owner cannot be removed, suspended or demoted, or nobody could ever administer access again. */
export function isLastOwner(db: Db, employeeId: string) {
  const owners = db.employees.filter((e) => e.roleId === 'owner' && e.status === 'active');
  return owners.length === 1 && owners[0].id === employeeId;
}
