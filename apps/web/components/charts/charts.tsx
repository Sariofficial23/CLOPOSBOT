'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { compact, num, shortDate } from '@/lib/utils';
import { ChartCard, ChartEmpty } from './chart-card';

// Validated reference palette roles (see globals.css): series order is fixed, never cycled.
export const SERIES = { 1: 'var(--series-1)', 2: 'var(--series-2)', 3: 'var(--series-3)' } as const;
const GRID = 'var(--chart-grid)';
const AXIS = 'var(--chart-axis)';
const axisProps = { stroke: AXIS, tick: { fill: AXIS, fontSize: 12 }, tickLine: false, axisLine: false } as const;

type Row = Record<string, string | number | null>;

interface TooltipItem {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: unknown;
}

function ChartTooltip({ active, payload, label, currency, fmtLabel, extra }: {
  active?: boolean;
  payload?: readonly TooltipItem[];
  label?: unknown;
  currency: string;
  fmtLabel?: (l: string) => string;
  extra?: (row: Row) => string | null;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as Row;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-foreground">{fmtLabel ? fmtLabel(String(label)) : String(label ?? '')}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center gap-2 text-muted-foreground">
          <span className="inline-block size-2 rounded-sm" style={{ background: p.color }} />
          {String(p.name)}: <span className="tabular font-medium text-foreground">{num(Number(p.value))} {currency}</span>
        </p>
      ))}
      {extra && extra(row) && <p className="mt-1 text-muted-foreground">{extra(row)}</p>}
    </div>
  );
}

const dayLabel = (d: string) => shortDate(d);

export function SalesByDayChart({ data, currency }: { data: { date: string; sales: number; orders: number }[]; currency: string }) {
  return (
    <ChartCard
      title="Продажи по дням"
      table={{ columns: ['Дата', 'Продажи', 'Заказы'], rows: data.map((d) => [shortDate(d.date), num(d.sales), d.orders]) }}
    >
      {data.every((d) => d.sales === 0) ? (
        <ChartEmpty />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={SERIES[1]} stopOpacity={0.25} />
                <stop offset="100%" stopColor={SERIES[1]} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={dayLabel} {...axisProps} minTickGap={16} />
            <YAxis tickFormatter={compact} {...axisProps} width={72} />
            <Tooltip
              cursor={{ stroke: AXIS, strokeDasharray: '3 3' }}
              content={(p) => <ChartTooltip active={p.active} payload={p.payload as readonly TooltipItem[]} label={p.label} currency={currency} fmtLabel={dayLabel} extra={(r) => `Заказов: ${r.orders}`} />}
            />
            <Area type="monotone" dataKey="sales" name="Продажи" stroke={SERIES[1]} strokeWidth={2} fill="url(#salesFill)" dot={data.length <= 7 ? { r: 4, fill: SERIES[1], stroke: 'var(--chart-surface)', strokeWidth: 2 } : false} activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

function HorizontalBars({ data, currency, name }: { data: { label: string; value: number }[]; currency: string; name: string }) {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36 + 16)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tickFormatter={compact} {...axisProps} />
        <YAxis type="category" dataKey="label" width={120} {...axisProps} tick={{ fill: 'var(--foreground)', fontSize: 12 }} />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          content={(p) => <ChartTooltip active={p.active} payload={p.payload as readonly TooltipItem[]} label={p.label} currency={currency} extra={(r) => `${Math.round((Number(r.value) / total) * 1000) / 10}%`} />}
        />
        <Bar dataKey="value" name={name} fill={SERIES[1]} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PaymentMethodsChart({ data, currency }: { data: { name: string; amount: number }[]; currency: string }) {
  const rows = data.slice(0, 8).map((d) => ({ label: d.name, value: d.amount }));
  return (
    <ChartCard title="Способы оплаты" table={{ columns: ['Способ', 'Сумма'], rows: data.map((d) => [d.name, num(d.amount)]) }}>
      {rows.length === 0 ? <ChartEmpty /> : <HorizontalBars data={rows} currency={currency} name="Сумма" />}
    </ChartCard>
  );
}

export function TopProductsChart({ data, currency }: { data: { name: string; quantity: number; total: number }[] | null; currency: string }) {
  return (
    <ChartCard
      title="Топ товаров"
      description="по выручке"
      table={data ? { columns: ['Товар', 'Кол-во', 'Выручка'], rows: data.map((d) => [d.name, num(d.quantity), num(d.total)]) } : undefined}
    >
      {data === null ? (
        <ChartEmpty>Clopos не вернул позиции чеков — топ товаров недоступен</ChartEmpty>
      ) : data.length === 0 ? (
        <ChartEmpty />
      ) : (
        <HorizontalBars data={data.slice(0, 8).map((d) => ({ label: d.name, value: d.total }))} currency={currency} name="Выручка" />
      )}
    </ChartCard>
  );
}

export function ExpensesChart({ data, currency }: { data: { date: string; incoming: number; salary: number }[]; currency: string }) {
  const legend = [
    { label: 'Приходы товара', color: SERIES[1] },
    { label: 'Зарплата', color: SERIES[2] },
  ];
  return (
    <ChartCard
      title="Расходы"
      description="приходы и выплаты зарплаты"
      legend={legend}
      table={{ columns: ['Дата', 'Приходы', 'Зарплата'], rows: data.map((d) => [shortDate(d.date), num(d.incoming), num(d.salary)]) }}
    >
      {data.every((d) => d.incoming === 0 && d.salary === 0) ? (
        <ChartEmpty>Нет расходов за период</ChartEmpty>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={dayLabel} {...axisProps} minTickGap={16} />
            <YAxis tickFormatter={compact} {...axisProps} width={72} />
            <Tooltip cursor={{ fill: 'var(--muted)' }} content={(p) => <ChartTooltip active={p.active} payload={p.payload as readonly TooltipItem[]} label={p.label} currency={currency} fmtLabel={dayLabel} />} />
            {/* 2px surface stroke = gap between stacked segments */}
            <Bar dataKey="incoming" name="Приходы товара" stackId="e" fill={SERIES[1]} stroke="var(--chart-surface)" strokeWidth={2} maxBarSize={28} />
            <Bar dataKey="salary" name="Зарплата" stackId="e" fill={SERIES[2]} stroke="var(--chart-surface)" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

export function ProfitChart({ data, currency }: { data: { date: string; sales: number; profit: number | null }[]; currency: string }) {
  const available = data.some((d) => d.profit !== null);
  const legend = [
    { label: 'Продажи', color: SERIES[1] },
    { label: 'Валовая прибыль', color: SERIES[2] },
  ];
  return (
    <ChartCard
      title="Прибыль"
      description="продажи и валовая прибыль"
      legend={available ? legend : undefined}
      table={{ columns: ['Дата', 'Продажи', 'Прибыль'], rows: data.map((d) => [shortDate(d.date), num(d.sales), d.profit === null ? '—' : num(d.profit)]) }}
    >
      {!available ? (
        <ChartEmpty>Себестоимость недоступна в Clopos — прибыль не рассчитывается</ChartEmpty>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={dayLabel} {...axisProps} minTickGap={16} />
            <YAxis tickFormatter={compact} {...axisProps} width={72} />
            <Tooltip cursor={{ stroke: AXIS, strokeDasharray: '3 3' }} content={(p) => <ChartTooltip active={p.active} payload={p.payload as readonly TooltipItem[]} label={p.label} currency={currency} fmtLabel={dayLabel} />} />
            <Line type="monotone" dataKey="sales" name="Продажи" stroke={SERIES[1]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line type="monotone" dataKey="profit" name="Валовая прибыль" stroke={SERIES[2]} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}
