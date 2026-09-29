'use client';

import { ROLE_LABELS, ROLES, type Role, canAssignRole } from '@cpos/shared';
import { CheckCircle2, Plug, XCircle } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { RequirePermission } from '@/components/layout/guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CloposStatus, Company, Schedule, User } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { dateTime } from '@/lib/utils';

export default function SettingsPage() {
  const { can } = useAuth();
  return (
    <RequirePermission permission="reports:schedule">
      <PageHeader title="Настройки" description="Компания, интеграция Clopos, авто-отчёты и пользователи" />
      <div className="grid gap-6 xl:grid-cols-2">
        {can('settings:manage') && <CompanySettings />}
        {can('clopos:manage') && <CloposSettings />}
        <ScheduleSettings />
        {can('users:manage') && <UsersSettings />}
      </div>
    </RequirePermission>
  );
}

function useAction() {
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, success = 'Сохранено') => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(success);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return { error, ok, busy, run };
}

function CompanySettings() {
  const { refresh } = useAuth();
  const { data } = useApi<Company>('/api/settings');
  const [form, setForm] = useState({ name: '', timezone: '', currency: '' });
  const { error, ok, busy, run } = useAction();
  useEffect(() => {
    if (data) setForm({ name: data.name, timezone: data.timezone, currency: data.currency });
  }, [data]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Компания</CardTitle>
        <CardDescription>Часовой пояс используется для отчётов и расписаний (внутри — UTC)</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('/api/settings', { method: 'PATCH', body: form });
              await refresh();
            });
          }}
        >
          {error && <Alert variant="error">{error}</Alert>}
          {ok && <Alert>{ok}</Alert>}
          <Field label="Название">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Часовой пояс (IANA)" hint="например Asia/Tashkent">
              <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} required />
            </Field>
            <Field label="Валюта">
              <Input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} maxLength={10} />
            </Field>
          </div>
          <Button type="submit" disabled={busy} className="self-start">
            Сохранить
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const CAP_LABELS: Record<string, string> = {
  products: 'Товары',
  categories: 'Категории',
  venues: 'Заведения',
  storages: 'Склады',
  suppliers: 'Поставщики',
  stock: 'Остатки',
  createIncoming: 'Создание прихода',
  incomingOperations: 'История приходов',
  salesReport: 'Продажи (чеки)',
};

function CloposSettings() {
  const { data: status, loading, reload } = useApi<CloposStatus>('/api/clopos/status');
  const [form, setForm] = useState({ brand: '', clientId: '', clientSecret: '', integratorId: '', venueId: '' });
  const [test, setTest] = useState<{ ok: boolean; checks: { name: string; ok: boolean; detail?: string }[] } | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const { error, ok, busy, run } = useAction();

  const connect = (e: FormEvent) => {
    e.preventDefault();
    // Credentials go to OUR backend only, which validates them with Clopos and stores them encrypted.
    const body = Object.fromEntries(Object.entries(form).filter(([, v]) => v.trim() !== ''));
    void run(async () => {
      await api('/api/clopos/connect', { method: 'POST', body });
      setForm((f) => ({ ...f, clientSecret: '' }));
      reload();
    }, 'Clopos подключён');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Plug className="size-4" /> Clopos
        </CardTitle>
        <CardDescription>Официальный Clopos Open API. Браузер не обращается к Clopos напрямую.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading && <Skeleton className="h-24" />}
        {status && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {status.mode === 'mock' ? (
                <Badge variant="warning">MOCK — CLOPOS_ADAPTER=mock</Badge>
              ) : status.connected ? (
                <Badge variant="success">Подключено</Badge>
              ) : (
                <Badge variant="secondary">Не подключено</Badge>
              )}
              {status.brand && <span className="text-muted-foreground">brand: {status.brand}</span>}
              {status.venueId && <span className="text-muted-foreground">venue: {status.venueId}</span>}
              {status.clientIdHint && <span className="text-muted-foreground">client: {status.clientIdHint}</span>}
            </div>
            {status.tokenExpiresAt && <p className="text-muted-foreground">Токен до: {dateTime(status.tokenExpiresAt)} (обновляется автоматически)</p>}
            {status.lastError && <Alert variant="error">{status.lastError}</Alert>}
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(status.capabilities).map(([k, v]) => (
                <Badge key={k} variant={v ? 'default' : 'secondary'} title={v ? 'Поддерживается' : 'Нет документированного endpoint в Clopos Open API'}>
                  {v ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
                  {CAP_LABELS[k] ?? k}
                </Badge>
              ))}
            </div>
          </div>
        )}
        {error && <Alert variant="error">{error}</Alert>}
        {ok && <Alert>{ok}</Alert>}
        {status?.mode === 'real' && (
          <form onSubmit={connect} className="flex flex-col gap-3 border-t pt-4" autoComplete="off">
            <p className="text-sm text-muted-foreground">
              Данные выдаёт Clopos. Пустые client_id / client_secret / integrator_id берутся из переменных окружения сервера.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Brand">
                <Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} required />
              </Field>
              <Field label="Venue ID (необязательно)">
                <Input value={form.venueId} onChange={(e) => setForm({ ...form, venueId: e.target.value })} />
              </Field>
              <Field label="Client ID">
                <Input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} />
              </Field>
              <Field label="Integrator ID">
                <Input value={form.integratorId} onChange={(e) => setForm({ ...form, integratorId: e.target.value })} />
              </Field>
            </div>
            <Field label="Client secret" hint="Хранится на сервере в зашифрованном виде и никогда не возвращается">
              <Input type="password" autoComplete="new-password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                Подключить
              </Button>
              {status.connected && (
                <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(true)}>
                  Отключить
                </Button>
              )}
            </div>
          </form>
        )}
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              run(async () => {
                setTest(await api('/api/clopos/test', { method: 'POST' }));
                reload();
              }, 'Проверка выполнена')
            }
          >
            Проверить соединение
          </Button>
        </div>
        {test && (
          <ul className="space-y-1 text-sm">
            {test.checks.map((c) => (
              <li key={c.name} className="flex gap-2">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 text-success" /> : <XCircle className="mt-0.5 size-4 text-destructive" />}
                <span>
                  <b>{c.name}</b>
                  {c.detail ? ` — ${c.detail}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <Dialog open={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Отключить Clopos?" description="Сохранённые ключи и токен будут удалены.">
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
            Отмена
          </Button>
          <Button
            variant="destructive"
            onClick={() =>
              run(async () => {
                await api('/api/clopos/connection', { method: 'DELETE' });
                setConfirmDisconnect(false);
                reload();
              }, 'Отключено')
            }
          >
            Отключить
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}

const TYPE_LABEL = { DAILY: 'Ежедневный', WEEKLY: 'Еженедельный', MONTHLY: 'Ежемесячный' } as const;
const DOW = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

function ScheduleRow({ schedule, onSaved }: { schedule: Schedule; onSaved: () => void }) {
  const [s, setS] = useState(schedule);
  const { error, ok, busy, run } = useAction();
  const time = `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <p className="font-medium">{TYPE_LABEL[s.type]}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
          Включён
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Время">
          <Input
            type="time"
            value={time}
            onChange={(e) => {
              const [h, m] = e.target.value.split(':').map(Number);
              if (Number.isInteger(h) && Number.isInteger(m)) setS({ ...s, hour: h!, minute: m! });
            }}
          />
        </Field>
        {s.type === 'WEEKLY' && (
          <Field label="День недели">
            <Select value={s.dayOfWeek ?? 1} onChange={(e) => setS({ ...s, dayOfWeek: Number(e.target.value) })}>
              {DOW.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {s.type === 'MONTHLY' && (
          <Field label="День месяца" hint="1–28">
            <Input type="number" min={1} max={28} value={s.dayOfMonth ?? 1} onChange={(e) => setS({ ...s, dayOfMonth: Number(e.target.value) })} />
          </Field>
        )}
        <Field label="Период отчёта">
          <Select value={s.reportPeriod} onChange={(e) => setS({ ...s, reportPeriod: e.target.value as Schedule['reportPeriod'] })}>
            <option value="CURRENT">Текущий</option>
            <option value="PREVIOUS">Предыдущий</option>
          </Select>
        </Field>
      </div>
      <Field label="Доп. чат (ID группы, необязательно)" hint="Отчёт также получат все пользователи с доступом к отчётам и Telegram ID">
        <Input value={s.extraChatId ?? ''} onChange={(e) => setS({ ...s, extraChatId: e.target.value.trim() || null })} />
      </Field>
      {error && <Alert variant="error">{error}</Alert>}
      {ok && <Alert>{ok}</Alert>}
      <Button
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const { id: _id, ...body } = s;
            await api('/api/report-schedules', { method: 'PUT', body });
            onSaved();
          })
        }
      >
        Сохранить
      </Button>
    </div>
  );
}

function ScheduleSettings() {
  const { company } = useAuth();
  const { data, error, reload } = useApi<Schedule[]>('/api/report-schedules');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Авто-отчёты в Telegram</CardTitle>
        <CardDescription>Время компании ({company?.timezone}). Cron-задача на Render работает в UTC и пересчитывает время автоматически.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {error && <Alert variant="error">{error}</Alert>}
        {!data && !error && <Skeleton className="h-40" />}
        {data?.map((s) => (
          <ScheduleRow key={`${s.id}-${s.type}`} schedule={s} onSaved={reload} />
        ))}
      </CardContent>
    </Card>
  );
}

function UsersSettings() {
  const { user: me } = useAuth();
  const { data, error, reload } = useApi<User[]>('/api/users');
  const [form, setForm] = useState({ name: '', role: 'MANAGER' as Role, telegramId: '', email: '', password: '' });
  const act = useAction();
  const assignable = ROLES.filter((r) => me && canAssignRole(me.role, r));

  return (
    <Card className="xl:col-span-2">
      <CardHeader>
        <CardTitle>Пользователи</CardTitle>
        <CardDescription>Доступ к боту выдаётся по Telegram ID (пользователь может узнать его командой /id)</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error && <Alert variant="error">{error}</Alert>}
        <Table>
          <THead>
            <TR>
              <TH>Имя</TH>
              <TH>Роль</TH>
              <TH>Email</TH>
              <TH>Telegram ID</TH>
              <TH>Последний вход</TH>
              <TH>Статус</TH>
            </TR>
          </THead>
          <TBody>
            {data?.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium">{u.name}</TD>
                <TD>
                  {me && u.id !== me.id && canAssignRole(me.role, u.role) ? (
                    <Select
                      value={u.role}
                      className="h-8 w-40"
                      aria-label={`Роль ${u.name}`}
                      onChange={(e) => act.run(async () => {
                        await api(`/api/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } });
                        reload();
                      })}
                    >
                      {assignable.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    ROLE_LABELS[u.role]
                  )}
                </TD>
                <TD className="text-muted-foreground">{u.email ?? '—'}</TD>
                <TD className="text-muted-foreground">{u.telegramId ?? '—'}</TD>
                <TD className="text-muted-foreground">{dateTime(u.lastLoginAt)}</TD>
                <TD>
                  {me && u.id !== me.id && canAssignRole(me.role, u.role) ? (
                    <button
                      type="button"
                      className="text-xs underline-offset-2 hover:underline"
                      onClick={() => act.run(async () => {
                        await api(`/api/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } });
                        reload();
                      })}
                    >
                      {u.active ? <Badge variant="success">Активен</Badge> : <Badge variant="secondary">Отключён</Badge>}
                    </button>
                  ) : u.active ? (
                    <Badge variant="success">Активен</Badge>
                  ) : (
                    <Badge variant="secondary">Отключён</Badge>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        {act.error && <Alert variant="error">{act.error}</Alert>}
        {act.ok && <Alert>{act.ok}</Alert>}
        <form
          className="grid gap-3 border-t pt-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            const body = {
              name: form.name,
              role: form.role,
              telegramId: form.telegramId.trim() || null,
              email: form.email.trim() || null,
              ...(form.password ? { password: form.password } : {}),
            };
            void act.run(async () => {
              await api('/api/users', { method: 'POST', body });
              setForm({ name: '', role: 'MANAGER', telegramId: '', email: '', password: '' });
              reload();
            }, 'Пользователь добавлен');
          }}
        >
          <Field label="Имя">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Роль">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {assignable.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Telegram ID">
            <Input inputMode="numeric" value={form.telegramId} onChange={(e) => setForm({ ...form, telegramId: e.target.value })} />
          </Field>
          <Field label="Email (для веб-входа)">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Пароль">
            <Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} />
          </Field>
          <Button type="submit" disabled={act.busy}>
            Добавить
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
