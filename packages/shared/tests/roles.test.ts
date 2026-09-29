import { describe, expect, it } from 'vitest';
import { canAssignRole, hasPermission, PERMISSIONS, ROLE_PERMISSIONS } from '../src/roles';

describe('permissions', () => {
  it('SUPER_ADMIN has every permission', () => {
    for (const p of PERMISSIONS) expect(hasPermission('SUPER_ADMIN', p)).toBe(true);
  });

  it('ADMIN has everything except company deletion', () => {
    expect(hasPermission('ADMIN', 'company:delete')).toBe(false);
    expect(ROLE_PERMISSIONS.ADMIN).toHaveLength(PERMISSIONS.length - 1);
  });

  it('MANAGER: sales, stock, reports — no salary/audit', () => {
    expect(hasPermission('MANAGER', 'sales:view')).toBe(true);
    expect(hasPermission('MANAGER', 'stock:view')).toBe(true);
    expect(hasPermission('MANAGER', 'reports:view')).toBe(true);
    expect(hasPermission('MANAGER', 'salary:view')).toBe(false);
    expect(hasPermission('MANAGER', 'audit:view')).toBe(false);
  });

  it('ACCOUNTANT: finance, salary, reports — no stock', () => {
    expect(hasPermission('ACCOUNTANT', 'finance:view')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'salary:manage')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'reports:view')).toBe(true);
    expect(hasPermission('ACCOUNTANT', 'stock:view')).toBe(false);
    expect(hasPermission('ACCOUNTANT', 'settings:manage')).toBe(false);
  });

  it('EMPLOYEE is limited', () => {
    expect(ROLE_PERMISSIONS.EMPLOYEE).toEqual(['stock:view', 'incoming:create']);
    expect(hasPermission('EMPLOYEE', 'reports:view')).toBe(false);
    expect(hasPermission('EMPLOYEE', 'dashboard:view')).toBe(false);
  });

  it('role assignment never escalates', () => {
    expect(canAssignRole('ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canAssignRole('ADMIN', 'MANAGER')).toBe(true);
    expect(canAssignRole('SUPER_ADMIN', 'SUPER_ADMIN')).toBe(true);
    expect(canAssignRole('MANAGER', 'EMPLOYEE')).toBe(false);
  });
});
