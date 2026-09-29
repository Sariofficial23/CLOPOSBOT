import type { Permission } from '@cpos/shared';
import {
  BarChart3,
  Boxes,
  BookOpen,
  ClipboardList,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  PackagePlus,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
}

export const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Обзор', icon: LayoutDashboard, permission: 'dashboard:view' },
  { href: '/dashboard/sales', label: 'Продажи', icon: BarChart3, permission: 'sales:view' },
  { href: '/dashboard/inventory', label: 'Остатки', icon: Boxes, permission: 'stock:view' },
  { href: '/dashboard/incoming', label: 'Приходы', icon: PackagePlus, permission: 'incoming:view' },
  { href: '/dashboard/catalog', label: 'Справочники', icon: BookOpen, permission: 'incoming:view' },
  { href: '/dashboard/salary', label: 'Зарплата', icon: Wallet, permission: 'salary:view' },
  { href: '/dashboard/employees', label: 'Сотрудники', icon: Users, permission: 'employees:view' },
  { href: '/dashboard/reports', label: 'Отчёты', icon: FileText, permission: 'reports:view' },
  { href: '/dashboard/audit', label: 'Аудит', icon: ShieldCheck, permission: 'audit:view' },
  { href: '/dashboard/settings', label: 'Настройки', icon: Settings, permission: 'reports:schedule' },
];

export const PAGE_ICON = ClipboardList;
