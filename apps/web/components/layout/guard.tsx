'use client';

import type { Permission } from '@cpos/shared';
import type { ReactNode } from 'react';
import { Alert } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';

/** UI-level guard. The backend enforces the same permission on every endpoint. */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return <Alert variant="warning" title="Недостаточно прав">У вашей роли нет доступа к этому разделу.</Alert>;
  }
  return <>{children}</>;
}
