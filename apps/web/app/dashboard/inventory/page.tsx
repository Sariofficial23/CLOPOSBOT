'use client';

import { Search, Upload } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/layout/guard';
import { SourceBadge } from '@/components/source-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { api, errorText } from '@/lib/api';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import type { Capabilities, InventoryState, Option, Product, Stock } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { dateTime, money, num } from '@/lib/utils';

interface InventoryResponse {
  mode: 'real' | 'mock';
  capabilities: Capabilities;
  products: Product[];
  productsError?: string | null;
  categories: Option[];
  stock: Stock[] | null;
  summary: InventoryState;
}

export default function InventoryPage() {
  return (
    <RequirePermission permission="stock:view">
      <Inventory />
    </RequirePermission>
  );
}

function Inventory() {
  const { company, can } = useAuth();
  const currency = company?.currency ?? 'сум';
  const { data, error, loading, reload } = useApi<InventoryResponse>('/api/inventory');
  const [importOpen, setImportOpen] = useState(false);
  const [q, setQ] = useState('');
  const categories = useMemo(() => new Map((data?.categories ?? []).map((c) => [c.id, c.name])), [data]);
  const needle = q.trim().toLowerCase();
  const stock = (data?.stock ?? []).filter((s) => !needle || s.productName.toLowerCase().includes(needle));
  const products = (data?.products ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle));

  return (
    <>
      <PageHeader
        title="Остатки"
        description={
          data?.summary.available && data.summary.source === 'import' && data.summary.asOf
            ? `По выгрузке из Clopos от ${dateTime(data.summary.asOf, company?.timezone)} (${data.summary.fileName ?? 'файл'})`
            : 'Товары и остатки из Clopos'
        }
        actions={
          <>
            <SourceBadge source={data?.mode} />
            {can('catalog:manage') && (
              <Button onClick={() => setImportOpen(true)}>
                <Upload /> Загрузить Excel
              </Button>
            )}
          </>
        }
      />
      {error && <Alert variant="error" className="mb-6">{error}</Alert>}
      {data?.productsError && <Alert variant="warning" className="mb-6">{data.productsError}</Alert>}
      {data && !data.summary.available && (
        <Alert variant="warning" title="Остатки не загружены" className="mb-6">
          Выгрузите отчёт по остаткам из Clopos в Excel (.xlsx) или CSV и загрузите его кнопкой «Загрузить Excel» — или отправьте файл Telegram-боту.
        </Alert>
      )}
      {data?.summary.available && (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Позиций</p>
            <p className="tabular mt-2 text-2xl font-semibold">{data.summary.summary.positions}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Единиц всего</p>
            <p className="tabular mt-2 text-2xl font-semibold">{num(data.summary.summary.totalQuantity)}</p>
          </Card>
          <Card className="p-5">
            <p className="text-sm text-muted-foreground">Стоимость остатков</p>
            <p className="tabular mt-2 text-2xl font-semibold">{money(data.summary.summary.totalValue, currency)}</p>
          </Card>
        </div>
      )}
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Поиск товара" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск товара" />
      </div>
      {loading && <Skeleton className="h-64" />}
      {data?.stock && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Остатки по складам</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Товар</TH>
                  <TH>Склад</TH>
                  <TH className="text-right">Количество</TH>
                  <TH className="text-right">Себестоимость</TH>
                  <TH className="text-right">Сумма</TH>
                </TR>
              </THead>
              <TBody>
                {stock.length === 0 && <EmptyRow colSpan={5}>Ничего не найдено</EmptyRow>}
                {stock.slice(0, 500).map((s) => (
                  <TR key={`${s.storageId}:${s.productId}`}>
                    <TD className="font-medium">{s.productName}</TD>
                    <TD className="text-muted-foreground">{s.storageId ?? '—'}</TD>
                    <TD className="tabular text-right">
                      {s.quantity <= 5 ? <Badge variant="warning">{num(s.quantity)}</Badge> : num(s.quantity)} {s.unit}
                    </TD>
                    <TD className="tabular text-right">{num(s.cost)}</TD>
                    <TD className="tabular text-right">{s.cost === null ? '—' : num(s.cost * s.quantity)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {importOpen && (
        <ImportDialog
          currency={currency}
          onClose={() => setImportOpen(false)}
          onDone={() => {
            setImportOpen(false);
            reload();
          }}
        />
      )}
      {data && products.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Товары ({products.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THead>
                <TR>
                  <TH>Название</TH>
                  <TH>Категория</TH>
                  <TH>Тип</TH>
                  <TH className="text-right">Цена</TH>
                </TR>
              </THead>
              <TBody>
                {products.length === 0 && <EmptyRow colSpan={4}>Ничего не найдено</EmptyRow>}
                {products.slice(0, 500).map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium">{p.name}</TD>
                    <TD className="text-muted-foreground">{(p.categoryId && categories.get(p.categoryId)) ?? '—'}</TD>
                    <TD className="text-muted-foreground">{p.type ?? '—'}</TD>
                    <TD className="tabular text-right">{num(p.price)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}

interface Draft {
  id: string;
  fileName: string;
  rowCount: number;
  totalQuantity: number;
  totalValue: number | null;
  storages: string[];
  columns: Record<string, string>;
  warnings: string[];
  skipped: number;
  sample: { productName: string; storageName: string | null; quantity: number; unit: string | null }[];
}

function ImportDialog({ currency, onClose, onDone }: { currency: string; onClose: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    setError(null);
    if (!/\.(xlsx|csv)$/i.test(file.name)) return setError('Нужен файл .xlsx или .csv');
    if (file.size > 5 * 1024 * 1024) return setError('Файл больше 5 МБ');
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      setDraft(await api<Draft>('/api/stock/import', { method: 'POST', body: { fileName: file.name, contentBase64: btoa(bin) } }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (confirm: boolean) => {
    if (!draft) return onClose();
    setBusy(true);
    try {
      if (confirm) await api(`/api/stock/import/${draft.id}/confirm`, { method: 'POST' });
      else await api(`/api/stock/import/${draft.id}`, { method: 'DELETE' });
      confirm ? onDone() : onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={() => finish(false)} title="Импорт остатков" description="Отчёт по остаткам, выгруженный из Clopos в Excel или CSV" className="max-w-2xl">
      <div className="flex flex-col gap-4">
        {error && <Alert variant="error">{error}</Alert>}
        {!draft && (
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center text-sm text-muted-foreground hover:bg-muted">
            <Upload className="size-6" />
            {busy ? 'Читаю файл…' : 'Выберите файл .xlsx или .csv (до 5 МБ)'}
            <input type="file" accept=".xlsx,.csv" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          </label>
        )}
        {draft && (
          <>
            <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
              <dt className="text-muted-foreground">Файл</dt>
              <dd>{draft.fileName}</dd>
              <dt className="text-muted-foreground">Позиций</dt>
              <dd className="tabular">{draft.rowCount}</dd>
              <dt className="text-muted-foreground">Стоимость</dt>
              <dd className="tabular">{draft.totalValue === null ? 'нет в файле' : money(draft.totalValue, currency)}</dd>
              {draft.storages.length > 0 && (
                <>
                  <dt className="text-muted-foreground">Склады</dt>
                  <dd>{draft.storages.join(', ')}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Колонки</dt>
              <dd className="text-xs">{Object.entries(draft.columns).map(([k, v]) => `${k} = «${v}»`).join(' · ')}</dd>
            </dl>
            {draft.warnings.map((w) => (
              <Alert key={w} variant="warning">{w}</Alert>
            ))}
            <Table>
              <THead>
                <TR>
                  <TH>Товар</TH>
                  <TH>Склад</TH>
                  <TH className="text-right">Остаток</TH>
                </TR>
              </THead>
              <TBody>
                {draft.sample.map((r, i) => (
                  <TR key={i}>
                    <TD>{r.productName}</TD>
                    <TD className="text-muted-foreground">{r.storageName ?? '—'}</TD>
                    <TD className="tabular text-right">
                      {num(r.quantity)} {r.unit}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <p className="text-sm text-muted-foreground">Текущие остатки будут заменены данными из этого файла.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => finish(false)} disabled={busy}>
                Отмена
              </Button>
              <Button onClick={() => finish(true)} disabled={busy}>
                ✅ Подтвердить
              </Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
