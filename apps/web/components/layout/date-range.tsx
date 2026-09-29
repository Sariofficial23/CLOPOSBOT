'use client';

import { CalendarRange } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'last_month';
export type RangeValue = { preset: Preset } | { from: string; to: string };

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'yesterday', label: 'Вчера' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'last_month', label: 'Прошлый месяц' },
];

export function rangeQuery(v: RangeValue) {
  return 'preset' in v ? { preset: v.preset } : { from: v.from, to: v.to };
}

/** Preset buttons + custom date range; one row above the charts. */
export function DateRangeSelector({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [custom, setCustom] = useState(!('preset' in value));
  const [from, setFrom] = useState('from' in value ? value.from : '');
  const [to, setTo] = useState('to' in value ? value.to : '');
  const invalid = !!from && !!to && to < from;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex flex-wrap rounded-md border bg-card p-0.5" role="group" aria-label="Период">
        {PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            aria-pressed={'preset' in value && value.preset === p.value}
            onClick={() => {
              setCustom(false);
              onChange({ preset: p.value });
            }}
            className={cn(
              'rounded px-3 py-1.5 text-sm transition-colors',
              'preset' in value && value.preset === p.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => setCustom((c) => !c)}
          className={cn('flex items-center gap-1 rounded px-3 py-1.5 text-sm', custom ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted')}
        >
          <CalendarRange className="size-4" /> Период
        </button>
      </div>
      {custom && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to && !invalid) onChange({ from, to });
          }}
        >
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="С" required />
          <span className="text-muted-foreground">—</span>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="По" required />
          <Button type="submit" size="sm" disabled={invalid}>
            Применить
          </Button>
          {invalid && <span className="text-xs text-destructive">Конец раньше начала</span>}
        </form>
      )}
    </div>
  );
}
