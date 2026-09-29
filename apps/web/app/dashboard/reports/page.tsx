'use client';

import { Copy } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '@/components/layout/guard';
import { SourceBadge } from '@/components/source-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, PageHeader, Skeleton, Tabs } from '@/components/ui/misc';
import { Table, TBody, TD, TH, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import type { FullReport } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { money } from '@/lib/utils';

type Kind = 'daily' | 'weekly' | 'monthly';

export default function ReportsPage() {
  return (
    <RequirePermission permission="reports:view">
      <Reports />
    </RequirePermission>
  );
}

function Reports() {
  const { company } = useAuth();
  const currency = company?.currency ?? 'сум';
  const [kind, setKind] = useState<Kind>('daily');
  const [previous, setPrevious] = useState(false);
  const { data, error, loading } = useApi<FullReport>(`/api/reports/${kind}`, { previous });
  const { data: text } = useApi<{ text: string }>(`/api/reports/${kind}`, { previous, format: 'text' });
  const [copied, setCopied] = useState(false);
  const s = data?.sales;
  const rows: [string, string][] = s
    ? [
        ['Продажи', money(s.sales, currency)],
        ['Заказов', String(s.orders)],
        ['Средний чек', money(s.averageCheck, currency)],
        ['Наличные', money(s.payments.cash, currency)],
        ['Карта', money(s.payments.card, currency)],
        ['Другие', money(s.payments.other, currency)],
        ['Себестоимость', s.cost === null ? 'нет данных' : money(s.cost, currency)],
        ['Валовая прибыль', s.grossProfit === null ? 'нет данных' : money(s.grossProfit, currency)],
        ['Расходы: приходы', money(data!.expenses.incoming, currency)],
        ['Расходы: зарплата', money(data!.expenses.salary, currency)],
        [
          'Остатки',
          data!.inventory.available
            ? `${data!.inventory.summary.positions} поз., ${money(data!.inventory.summary.totalValue, currency)}`
            : 'нет данных из Clopos',
        ],
      ]
    : [];

  return (
    <>
      <PageHeader title="Отчёты" description={data?.range.label} actions={<SourceBadge source={data?.source} />} />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tabs<Kind>
          value={kind}
          onChange={setKind}
          items={[
            { value: 'daily', label: 'День' },
            { value: 'weekly', label: 'Неделя' },
            { value: 'monthly', label: 'Месяц' },
          ]}
        />
        <Tabs<'cur' | 'prev'>
          value={previous ? 'prev' : 'cur'}
          onChange={(v) => setPrevious(v === 'prev')}
          items={[
            { value: 'cur', label: 'Текущий' },
            { value: 'prev', label: 'Предыдущий' },
          ]}
        />
      </div>
      {error && <Alert variant="error" className="mb-6">{error}</Alert>}
      {data?.warnings.map((w) => (
        <Alert key={w} variant="warning" className="mb-4">
          {w}
        </Alert>
      ))}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Показатели</CardTitle>
          </CardHeader>
          <CardContent>
            {loading && !data ? (
              <Skeleton className="h-64" />
            ) : (
              <Table>
                <TBody>
                  {rows.map(([k, v]) => (
                    <TR key={k}>
                      <TH className="normal-case tracking-normal">{k}</TH>
                      <TD className="tabular text-right font-medium">{v}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Как в Telegram</CardTitle>
            {text && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(text.text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                <Copy /> {copied ? 'Скопировано' : 'Копировать'}
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-4 font-sans text-sm leading-relaxed">{text?.text ?? '…'}</pre>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
