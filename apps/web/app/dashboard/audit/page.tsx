'use client';

import { Fragment, useState } from 'react';
import { RequirePermission } from '@/components/layout/guard';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Alert, PageHeader, Pagination, Skeleton } from '@/components/ui/misc';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import type { AuditEntry, Paged } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { dateTime } from '@/lib/utils';

const ACTIONS: Record<string, string> = {
  AUTH_LOGIN: 'Вход',
  AUTH_LOGIN_FAILED: 'Неудачный вход',
  AUTH_TELEGRAM_LOGIN: 'Вход через Telegram',
  AUTH_BOT_DENIED: 'Отказ в доступе к боту',
  INCOMING_CREATE: 'Приход товара',
  EMPLOYEE_CREATE: 'Новый сотрудник',
  EMPLOYEE_UPDATE: 'Изменение сотрудника',
  SALARY_CALCULATE: 'Расчёт зарплаты',
  SALARY_UPDATE: 'Изменение зарплаты',
  SALARY_ADJUST: 'Бонус/штраф/аванс',
  SALARY_PAY: 'Выплата зарплаты',
  REPORT_GENERATE: 'Отчёт',
  REPORT_SCHEDULED_SENT: 'Авто-отчёт отправлен',
  SETTINGS_UPDATE: 'Настройки',
  SCHEDULE_UPDATE: 'Расписание отчётов',
  CLOPOS_CONNECT: 'Подключение Clopos',
  CLOPOS_DISCONNECT: 'Отключение Clopos',
  CLOPOS_TEST: 'Проверка Clopos',
  USER_CREATE: 'Новый пользователь',
  USER_UPDATE: 'Изменение пользователя',
  COMPANY_DELETE: 'Удаление компании',
  CATALOG_CREATE: 'Справочник: добавление',
  CATALOG_UPDATE: 'Справочник: изменение',
  STOCK_IMPORT: 'Импорт остатков',
};

const tone = (a: string) => (a.includes('FAILED') || a.includes('DENIED') || a.includes('DELETE') ? 'destructive' : a.startsWith('SALARY') ? 'warning' : 'default');

export default function AuditPage() {
  return (
    <RequirePermission permission="audit:view">
      <Audit />
    </RequirePermission>
  );
}

function Audit() {
  const { company } = useAuth();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, loading } = useApi<Paged<AuditEntry>>('/api/audit', { page, pageSize: 50, action: action || undefined });

  return (
    <>
      <PageHeader
        title="Журнал аудита"
        description="Все действия пользователей. Пароли и секреты не сохраняются."
        actions={
          <Select
            value={action}
            onChange={(e) => {
              setPage(1);
              setAction(e.target.value);
            }}
            className="w-64"
            aria-label="Фильтр по действию"
          >
            <option value="">Все действия</option>
            {Object.entries(ACTIONS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        }
      />
      {error && <Alert variant="error" className="mb-6">{error}</Alert>}
      <Card>
        {loading && !data ? (
          <Skeleton className="m-5 h-40" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Время</TH>
                <TH>Пользователь</TH>
                <TH>Действие</TH>
                <TH>Объект</TH>
                <TH>IP</TH>
              </TR>
            </THead>
            <TBody>
              {data?.items.length === 0 && <EmptyRow colSpan={5}>Записей нет</EmptyRow>}
              {data?.items.map((e) => (
                <Fragment key={e.id}>
                  <TR className="cursor-pointer" onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>
                    <TD className="whitespace-nowrap">{dateTime(e.createdAt, company?.timezone)}</TD>
                    <TD>{e.userName ?? <span className="text-muted-foreground">система</span>}</TD>
                    <TD>
                      <Badge variant={tone(e.action)}>{ACTIONS[e.action] ?? e.action}</Badge>
                    </TD>
                    <TD className="text-muted-foreground">
                      {e.entity}
                      {e.entityId ? ` · ${e.entityId.slice(0, 10)}` : ''}
                    </TD>
                    <TD className="text-muted-foreground">{e.ip ?? '—'}</TD>
                  </TR>
                  {open === e.id && (
                    <tr className="border-b bg-muted/40">
                      <td colSpan={5} className="px-3 py-3">
                        <pre className="overflow-x-auto text-xs">{JSON.stringify(e.metadata ?? {}, null, 2)}</pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </TBody>
          </Table>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
    </>
  );
}
