'use client';

import { employeeCreateSchema } from '@cpos/shared';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '@/components/layout/guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Employee } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { money } from '@/lib/utils';

export default function EmployeesPage() {
  return (
    <RequirePermission permission="employees:view">
      <Employees />
    </RequirePermission>
  );
}

function Employees() {
  const { company, can } = useAuth();
  const currency = company?.currency ?? 'сум';
  const { data, error, loading, reload } = useApi<Employee[]>('/api/employees');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const manage = can('employees:manage');

  return (
    <>
      <PageHeader
        title="Сотрудники"
        description={data ? `${data.filter((e) => e.active).length} активных` : undefined}
        actions={
          manage && (
            <Button onClick={() => setEditing('new')}>
              <Plus /> Добавить
            </Button>
          )
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
                <TH>Имя</TH>
                <TH>Должность</TH>
                <TH className="text-right">Оклад</TH>
                <TH>Telegram ID</TH>
                <TH>Статус</TH>
                {manage && <TH />}
              </TR>
            </THead>
            <TBody>
              {data?.length === 0 && <EmptyRow colSpan={6}>Сотрудников пока нет</EmptyRow>}
              {data?.map((e) => (
                <TR key={e.id} className={e.active ? '' : 'opacity-60'}>
                  <TD className="font-medium">{e.name}</TD>
                  <TD>{e.position}</TD>
                  <TD className="tabular text-right">{money(e.baseSalary, currency)}</TD>
                  <TD className="text-muted-foreground">{e.telegramId ?? '—'}</TD>
                  <TD>{e.active ? <Badge variant="success">Активен</Badge> : <Badge variant="secondary">Неактивен</Badge>}</TD>
                  {manage && (
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`Изменить ${e.name}`}>
                        <Pencil />
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
      {editing && (
        <EmployeeDialog
          employee={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </>
  );
}

function EmployeeDialog({ employee, onClose, onSaved }: { employee: Employee | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: employee?.name ?? '',
    position: employee?.position ?? '',
    baseSalary: employee ? String(employee.baseSalary) : '',
    telegramId: employee?.telegramId ?? '',
    active: employee?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const body = {
    name: form.name,
    position: form.position,
    baseSalary: form.baseSalary.replace(/\s/g, '').replace(',', '.'),
    telegramId: form.telegramId.trim() || null,
    active: form.active,
  };

  const validate = () => {
    const r = employeeCreateSchema.safeParse(body);
    if (!r.success) {
      setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])));
      return null;
    }
    setErrors({});
    return r.data;
  };

  const save = async () => {
    const data = validate();
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      if (employee) await api(`/api/employees/${employee.id}`, { method: 'PATCH', body: data });
      else await api('/api/employees', { method: 'POST', body: data });
      onSaved();
    } catch (err) {
      setError(errorText(err));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={employee ? `Изменить: ${employee.name}` : 'Новый сотрудник'}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (validate()) setConfirm(true);
        }}
      >
        {error && <Alert variant="error">{error}</Alert>}
        <Field label="Имя" error={errors.name}>
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Должность" error={errors.position}>
          <Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} maxLength={120} />
        </Field>
        <Field label="Оклад в месяц" error={errors.baseSalary}>
          <Input inputMode="decimal" value={form.baseSalary} onChange={(e) => setForm({ ...form, baseSalary: e.target.value })} />
        </Field>
        <Field label="Telegram ID (необязательно)" error={errors.telegramId}>
          <Input inputMode="numeric" value={form.telegramId} onChange={(e) => setForm({ ...form, telegramId: e.target.value })} />
        </Field>
        {employee && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="size-4" />
            Активен
          </label>
        )}
        {confirm ? (
          <div className="flex items-center justify-between gap-2 rounded-md border bg-muted p-3">
            <span className="text-sm">Сохранить изменения?</span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(false)}>
                Нет
              </Button>
              <Button type="button" size="sm" onClick={save} disabled={busy}>
                Да, сохранить
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit">Сохранить</Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
