'use client';

import { Table2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';

export interface TableView {
  columns: string[];
  rows: (string | number)[][];
}

/** Card wrapper that can swap any chart for its data table (accessibility / exact values). */
export function ChartCard({ title, description, children, table, legend, className }: {
  title: string;
  description?: string;
  children: ReactNode;
  table?: TableView;
  legend?: { label: string; color: string }[];
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card className={className}>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {table && (
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            aria-pressed={asTable}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Table2 className="size-3.5" /> {asTable ? 'График' : 'Таблица'}
          </button>
        )}
      </CardHeader>
      <CardContent>
        {legend && legend.length > 1 && !asTable && (
          <ul className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            {legend.map((l) => (
              <li key={l.label} className="flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm" style={{ background: l.color }} />
                {l.label}
              </li>
            ))}
          </ul>
        )}
        {asTable && table ? (
          <div className="max-h-72 overflow-y-auto">
            <Table>
              <THead>
                <TR>
                  {table.columns.map((c) => (
                    <TH key={c}>{c}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {table.rows.map((r, i) => (
                  <TR key={i}>
                    {r.map((cell, j) => (
                      <TD key={j} className={j > 0 ? 'tabular text-right' : ''}>
                        {cell}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

export function ChartEmpty({ children = 'Нет данных за период' }: { children?: ReactNode }) {
  return <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">{children}</div>;
}
