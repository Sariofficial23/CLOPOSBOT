'use client';

import { Boxes, PackagePlus, ReceiptText, ShoppingCart, TrendingUp, Wallet } from 'lucide-react';
import { useState } from 'react';
import { ExpensesChart, PaymentMethodsChart, ProfitChart, SalesByDayChart, TopProductsChart } from '@/components/charts/charts';
import { DateRangeSelector, type RangeValue, rangeQuery } from '@/components/layout/date-range';
import { RequirePermission } from '@/components/layout/guard';
import { SourceBadge } from '@/components/source-badge';
import { StatCard } from '@/components/stat-card';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { useAuth } from '@/lib/auth';
import type { Dashboard } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { money, num } from '@/lib/utils';

export default function DashboardPage() {
  return (
    <RequirePermission permission="dashboard:view">
      <Overview />
    </RequirePermission>
  );
}

function Overview() {
  const { company } = useAuth();
  const currency = company?.currency ?? 'сум';
  const [range, setRange] = useState<RangeValue>({ preset: 'month' });
  const { data, error, loading } = useApi<Dashboard>('/api/dashboard', rangeQuery(range));
  const c = data?.cards;

  return (
    <>
      <PageHeader
        title="Обзор"
        description={data ? `Период: ${data.range.label}` : 'Ключевые показатели'}
        actions={<SourceBadge source={data?.source} />}
      />
      <div className="mb-6">
        <DateRangeSelector value={range} onChange={setRange} />
      </div>
      {error && <Alert variant="error" title="Не удалось загрузить данные" className="mb-6">{error}</Alert>}
      {data?.warnings.map((w) => (
        <Alert key={w} variant="warning" className="mb-4">
          {w}
        </Alert>
      ))}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatCard label="Продажи" icon={ShoppingCart} loading={loading} value={money(c?.sales, currency)} hint={c ? `Средний чек ${money(c.averageCheck, currency)}` : undefined} />
        <StatCard label="Заказы" icon={ReceiptText} loading={loading} value={num(c?.orders)} />
        <StatCard
          label="Прибыль"
          icon={TrendingUp}
          loading={loading}
          value={c?.profit === null ? 'нет данных' : money(c?.profit, currency)}
          hint={c?.profit === null ? 'себестоимость недоступна' : 'валовая'}
        />
        <StatCard
          label="Остаток"
          icon={Boxes}
          loading={loading}
          value={c?.stock ? (c.stock.value !== null ? money(c.stock.value, currency) : `${c.stock.positions} поз.`) : 'нет данных'}
          hint={c?.stock ? `${c.stock.positions} позиций` : 'Clopos не отдаёт остатки'}
        />
        <StatCard label="Приходы" icon={PackagePlus} loading={loading} value={money(c?.incoming, currency)} hint="за период" />
        <StatCard
          label="Зарплата"
          icon={Wallet}
          loading={loading}
          value={money(c?.salaryPaid, currency)}
          hint={c ? `Начислено за месяц: ${money(c.payrollCurrentMonth, currency)}` : undefined}
        />
      </div>

      {loading && !data ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      ) : data ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <SalesByDayChart data={data.charts.salesByDay} currency={currency} />
          <PaymentMethodsChart data={data.charts.paymentMethods} currency={currency} />
          <TopProductsChart data={data.charts.topProducts} currency={currency} />
          <ExpensesChart data={data.charts.expensesByDay} currency={currency} />
          <ProfitChart data={data.charts.profitByDay} currency={currency} />
          {data.inventory.available && data.inventory.summary.lowStock.length > 0 && (
            <div className="rounded-lg border bg-card p-5">
              <h3 className="mb-3 font-semibold">Заканчиваются</h3>
              <ul className="space-y-1.5 text-sm">
                {data.inventory.summary.lowStock.slice(0, 10).map((l) => (
                  <li key={l.productName} className="flex justify-between">
                    <span>{l.productName}</span>
                    <span className="tabular text-muted-foreground">{num(l.quantity)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}
    </>
  );
}
