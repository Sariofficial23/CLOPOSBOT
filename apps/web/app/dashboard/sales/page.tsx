'use client';

import { CreditCard, ReceiptText, ShoppingCart, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { PaymentMethodsChart, SalesByDayChart, TopProductsChart } from '@/components/charts/charts';
import { DateRangeSelector, type RangeValue, rangeQuery } from '@/components/layout/date-range';
import { RequirePermission } from '@/components/layout/guard';
import { SourceBadge } from '@/components/source-badge';
import { StatCard } from '@/components/stat-card';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, PageHeader } from '@/components/ui/misc';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import type { RangeInfo, SalesSummary } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { money, num, shortDate } from '@/lib/utils';

export default function SalesPage() {
  return (
    <RequirePermission permission="sales:view">
      <Sales />
    </RequirePermission>
  );
}

function Sales() {
  const { company } = useAuth();
  const currency = company?.currency ?? 'сум';
  const [range, setRange] = useState<RangeValue>({ preset: 'week' });
  const { data, error, loading } = useApi<{ range: RangeInfo; source: 'real' | 'mock'; sales: SalesSummary; warnings: string[] }>(
    '/api/sales',
    rangeQuery(range),
  );
  const s = data?.sales;

  return (
    <>
      <PageHeader title="Продажи" description={data?.range.label} actions={<SourceBadge source={data?.source} />} />
      <div className="mb-6">
        <DateRangeSelector value={range} onChange={setRange} />
      </div>
      {error && <Alert variant="error" className="mb-6">{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Выручка" icon={ShoppingCart} loading={loading} value={money(s?.sales, currency)} />
        <StatCard label="Заказов" icon={ReceiptText} loading={loading} value={num(s?.orders)} hint={s ? `Средний чек ${money(s.averageCheck, currency)}` : undefined} />
        <StatCard
          label="Наличные / Карта / Другие"
          icon={CreditCard}
          loading={loading}
          value={s ? `${num(s.payments.cash)}` : '—'}
          hint={s ? `карта ${num(s.payments.card)} · другие ${num(s.payments.other)}` : undefined}
        />
        <StatCard
          label="Валовая прибыль"
          icon={TrendingUp}
          loading={loading}
          value={s?.grossProfit === null ? 'нет данных' : money(s?.grossProfit, currency)}
          hint={s?.grossMargin !== null && s?.grossMargin !== undefined ? `маржа ${s.grossMargin}%` : undefined}
        />
      </div>
      {s && (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <SalesByDayChart data={s.salesByDay} currency={currency} />
          <PaymentMethodsChart data={s.paymentMethods} currency={currency} />
          <TopProductsChart data={s.topProducts} currency={currency} />
          <Card>
            <CardHeader>
              <CardTitle>По дням</CardTitle>
            </CardHeader>
            <CardContent className="max-h-80 overflow-y-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Дата</TH>
                    <TH className="text-right">Заказы</TH>
                    <TH className="text-right">Выручка</TH>
                    <TH className="text-right">Прибыль</TH>
                  </TR>
                </THead>
                <TBody>
                  {s.salesByDay.length === 0 && <EmptyRow colSpan={4}>Нет данных</EmptyRow>}
                  {s.salesByDay.map((d) => (
                    <TR key={d.date}>
                      <TD>{shortDate(d.date)}</TD>
                      <TD className="tabular text-right">{d.orders}</TD>
                      <TD className="tabular text-right">{num(d.sales)}</TD>
                      <TD className="tabular text-right">{d.profit === null ? '—' : num(d.profit)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
