'use client';

import { calculateSalaryTotal } from '@cpos/shared';
import { Calculator, CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '@/components/layout/guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Payroll, SalaryRecord } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { currentPeriod, dateTime, money, num } from '@/lib/utils';

type Kind = 'bonus' | 'penalty' | 'advance';
const KIND_LABEL: Record<Kind, string> = { bonus: 'Бонус', penalty: 'Штраф', advance: 'Аванс' };

export default function SalaryPage() {
  return (
    <RequirePermission permission="salary:view">
      <SalaryView />
    </RequirePermission>
  );
}

function SalaryView() {
  const { company, can } = useAuth();
  const currency = company?.currency ?? 'сум';
  const [period, setPeriod] = useState(() => currentPeriod(company?.timezone));
  const { data, error, loading, reload } = useApi<Payroll>('/api/salary', { period });
  const [adjust, setAdjust] = useState<{ record: SalaryRecord; kind: Kind } | null>(null);
  const [pay, setPay] = useState<SalaryRecord | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const manage = can('salary:manage');

  const run = async (fn: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await fn();
      reload();
    } catch (err) {
      setActionError(errorText(err));
    }
  };

  return (
    <>
      <PageHeader
        title="Зарплата"
        description="total = оклад + бонус − штраф − аванс"
        actions={
          <>
            <Input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="w-44" aria-label="Период" />
            {manage && (
              <Button variant="outline" onClick={() => run(() => api('/api/salary/calculate-all', { method: 'POST', body: { period } }))}>
                <Calculator /> Рассчитать всех
              </Button>
            )}
          </>
        }
      />
      {(error || actionError) && <Alert variant="error" className="mb-6">{error ?? actionError}</Alert>}
      {data && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Начислено</p>
            <p className="tabular mt-2 text-2xl font-semibold">{money(data.totals.total, currency)}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Выплачено</p>
            <p className="tabular mt-2 text-2xl font-semibold">{money(data.totals.paid, currency)}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">К выплате</p>
            <p className="tabular mt-2 text-2xl font-semibold">{money(data.totals.unpaid, currency)}</p>
          </Card>
        </div>
      )}
      <Card>
        {loading && !data ? (
          <Skeleton className="m-5 h-40" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Сотрудник</TH>
                <TH className="text-right">Оклад</TH>
                <TH className="text-right">Бонус</TH>
                <TH className="text-right">Штраф</TH>
                <TH className="text-right">Аванс</TH>
                <TH className="text-right">Итого</TH>
                <TH>Статус</TH>
                {manage && <TH className="text-right">Действия</TH>}
              </TR>
            </THead>
            <TBody>
              {data && data.items.length === 0 && data.missing.length === 0 && <EmptyRow colSpan={8}>Нет сотрудников</EmptyRow>}
              {data?.items.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <p className="font-medium">{r.employeeName}</p>
                    <p className="text-xs text-muted-foreground">{r.position}</p>
                  </TD>
                  <TD className="tabular text-right">{num(r.baseSalary)}</TD>
                  <TD className="tabular text-right">{num(r.bonus)}</TD>
                  <TD className="tabular text-right">{num(r.penalty)}</TD>
                  <TD className="tabular text-right">{num(r.advance)}</TD>
                  <TD className="tabular text-right font-semibold">{num(r.total)}</TD>
                  <TD>
                    {r.status === 'PAID' ? (
                      <Badge variant="success" title={dateTime(r.paidAt, company?.timezone)}>
                        <CheckCircle2 className="size-3" /> Выплачено
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Черновик</Badge>
                    )}
                  </TD>
                  {manage && (
                    <TD className="text-right">
                      {r.status === 'DRAFT' && (
                        <div className="flex justify-end gap-1">
                          {(['bonus', 'penalty', 'advance'] as Kind[]).map((k) => (
                            <Button key={k} size="sm" variant="ghost" onClick={() => setAdjust({ record: r, kind: k })}>
                              {k === 'bonus' ? '+' : '−'} {KIND_LABEL[k]}
                            </Button>
                          ))}
                          <Button size="sm" onClick={() => setPay(r)}>
                            Выплатить
                          </Button>
                        </div>
                      )}
                    </TD>
                  )}
                </TR>
              ))}
              {data?.missing.map((e) => (
                <TR key={e.id} className="text-muted-foreground">
                  <TD>
                    <p className="font-medium text-foreground">{e.name}</p>
                    <p className="text-xs">{e.position}</p>
                  </TD>
                  <TD className="tabular text-right">{num(e.baseSalary)}</TD>
                  <TD colSpan={4} className="text-center text-xs">
                    не рассчитано
                  </TD>
                  <TD>
                    <Badge variant="outline">—</Badge>
                  </TD>
                  {manage && (
                    <TD className="text-right">
                      <Button size="sm" variant="outline" onClick={() => run(() => api('/api/salary', { method: 'POST', body: { employeeId: e.id, period } }))}>
                        Рассчитать
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {adjust && (
        <AdjustDialog
          record={adjust.record}
          initialKind={adjust.kind}
          currency={currency}
          onClose={() => setAdjust(null)}
          onDone={() => {
            setAdjust(null);
            reload();
          }}
        />
      )}
      <Dialog open={!!pay} onClose={() => setPay(null)} title="Подтвердите выплату" description="После выплаты запись нельзя изменить.">
        {pay && (
          <div className="flex flex-col gap-4">
            <p className="text-sm">
              {pay.employeeName} · {pay.period}: <b className="tabular">{money(pay.total, currency)}</b>
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPay(null)}>
                Отмена
              </Button>
              <Button
                onClick={() =>
                  run(async () => {
                    await api(`/api/salary/${pay.id}/pay`, { method: 'POST' });
                    setPay(null);
                  })
                }
              >
                ✅ Подтвердить выплату
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}

function AdjustDialog({ record, initialKind, currency, onClose, onDone }: { record: SalaryRecord; initialKind: Kind; currency: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const value = Number(amount.replace(/\s/g, '').replace(',', '.'));
  const valid = Number.isFinite(value) && value > 0 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
  const preview = valid
    ? calculateSalaryTotal({
        baseSalary: record.baseSalary,
        bonus: record.bonus + (kind === 'bonus' ? value : 0),
        penalty: record.penalty + (kind === 'penalty' ? value : 0),
        advance: record.advance + (kind === 'advance' ? value : 0),
      })
    : null;

  return (
    <Dialog open onClose={onClose} title={`${KIND_LABEL[kind]}: ${record.employeeName}`} description={`Период ${record.period}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!valid) return;
          setBusy(true);
          setError(null);
          try {
            await api(`/api/salary/${record.id}/adjust`, { method: 'POST', body: { kind, amount: value, note: note || undefined } });
            onDone();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert variant="error">{error}</Alert>}
        <Field label="Тип">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="bonus">Бонус</option>
            <option value="penalty">Штраф</option>
            <option value="advance">Аванс</option>
          </Select>
        </Field>
        <Field label="Сумма" error={amount && !valid ? 'Введите положительную сумму (до 2 знаков после запятой)' : undefined}>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
        </Field>
        <Field label="Комментарий">
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="text-sm text-muted-foreground">
          Итого сейчас: <span className="tabular">{money(record.total, currency)}</span>
          {preview !== null && (
            <>
              {' '}→ после: <b className="tabular text-foreground">{money(preview, currency)}</b>
            </>
          )}
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            Подтвердить
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
