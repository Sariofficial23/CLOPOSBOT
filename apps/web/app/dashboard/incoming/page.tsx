'use client';

import { incomingInputSchema } from '@cpos/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { DateRangeSelector, type RangeValue, rangeQuery } from '@/components/layout/date-range';
import { RequirePermission } from '@/components/layout/guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Alert, PageHeader, Pagination, Skeleton } from '@/components/ui/misc';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Incoming, Option, Paged, Product } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { dateTime, money, num } from '@/lib/utils';

const STATUS: Record<Incoming['status'], { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary' }> = {
  SYNCED: { label: 'В Clopos', variant: 'success' },
  LOCAL_ONLY: { label: 'Только локально', variant: 'secondary' },
  FAILED: { label: 'Ошибка Clopos', variant: 'destructive' },
  PENDING: { label: 'Отправляется', variant: 'warning' },
};

export default function IncomingPage() {
  return (
    <RequirePermission permission="incoming:view">
      <IncomingList />
    </RequirePermission>
  );
}

function IncomingList() {
  const { company, can } = useAuth();
  const currency = company?.currency ?? 'сум';
  const [range, setRange] = useState<RangeValue>({ preset: 'month' });
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const { data, error, loading, reload } = useApi<Paged<Incoming> & { sum: number }>('/api/incoming', { ...rangeQuery(range), page, pageSize: 20 });

  return (
    <>
      <PageHeader
        title="Приходы"
        description={data ? `Сумма за период: ${money(data.sum, currency)}` : 'Поступления товара'}
        actions={
          can('incoming:create') && (
            <Button onClick={() => setOpen(true)}>
              <Plus /> Новый приход
            </Button>
          )
        }
      />
      <div className="mb-6">
        <DateRangeSelector
          value={range}
          onChange={(v) => {
            setPage(1);
            setRange(v);
          }}
        />
      </div>
      {error && <Alert variant="error" className="mb-6">{error}</Alert>}
      <Card>
        {loading && !data ? (
          <Skeleton className="m-5 h-40" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Дата</TH>
                <TH>Поставщик</TH>
                <TH>Склад</TH>
                <TH>Позиции</TH>
                <TH className="text-right">Сумма</TH>
                <TH>Статус</TH>
                <TH>Источник</TH>
              </TR>
            </THead>
            <TBody>
              {data?.items.length === 0 && <EmptyRow colSpan={7}>Приходов за период нет</EmptyRow>}
              {data?.items.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap">{dateTime(i.createdAt, company?.timezone)}</TD>
                  <TD className="font-medium">{i.supplierName}</TD>
                  <TD>{i.storageName}</TD>
                  <TD className="text-muted-foreground">
                    {i.items.map((it) => `${it.productName} × ${num(it.quantity)}`).join(', ')}
                  </TD>
                  <TD className="tabular text-right">{num(i.total)}</TD>
                  <TD>
                    <Badge variant={STATUS[i.status].variant} title={i.syncError ?? undefined}>
                      {STATUS[i.status].label}
                    </Badge>
                  </TD>
                  <TD className="text-muted-foreground">{i.source === 'telegram' ? 'Telegram' : 'Веб'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
      </Card>
      {open && (
        <NewIncomingDialog
          currency={currency}
          onClose={() => setOpen(false)}
          onCreated={() => {
            setOpen(false);
            reload();
          }}
        />
      )}
    </>
  );
}

interface Options {
  available: boolean;
  reason: string | null;
  storages: Option[];
  suppliers: Option[];
  products: Product[];
}

interface ItemRow {
  productId: string;
  quantity: string;
  price: string;
}

function NewIncomingDialog({ currency, onClose, onCreated }: { currency: string; onClose: () => void; onCreated: () => void }) {
  const { data: opts, error: optsError, loading } = useApi<Options>('/api/incoming/options');
  const [storageId, setStorageId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<ItemRow[]>([{ productId: '', quantity: '', price: '' }]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());

  const nameOf = (list: Option[] | undefined, id: string) => list?.find((x) => x.id === id)?.name ?? '';
  const payload = {
    storageId,
    storageName: nameOf(opts?.storages, storageId),
    supplierId,
    supplierName: nameOf(opts?.suppliers, supplierId),
    note: note || undefined,
    items: items.map((i) => ({
      productId: i.productId,
      productName: nameOf(opts?.products, i.productId),
      quantity: i.quantity.replace(',', '.').replace(/\s/g, ''),
      price: i.price.replace(',', '.').replace(/\s/g, ''),
    })),
  };
  const parsed = incomingInputSchema.safeParse(payload);
  const total = parsed.success ? parsed.data.items.reduce((a, i) => a + i.quantity * i.price, 0) : 0;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/incoming', { method: 'POST', body: parsed.success ? parsed.data : payload, headers: { 'Idempotency-Key': key } });
      onCreated();
    } catch (err) {
      setError(errorText(err));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const update = (idx: number, patch: Partial<ItemRow>) => setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <Dialog open onClose={onClose} title={confirming ? 'Подтвердите приход' : 'Новый приход'} className="max-w-2xl">
      {loading && <Skeleton className="h-40" />}
      {optsError && <Alert variant="error">{optsError}</Alert>}
      {opts && !opts.available && (
        <Alert variant="warning" title="Приход пока недоступен">
          {opts.reason}{' '}
          <a href="/dashboard/catalog" className="font-medium underline">
            Открыть справочники
          </a>
        </Alert>
      )}
      {opts?.available && !confirming && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (parsed.success) setConfirming(true);
            else setError(parsed.error.issues.map((i) => i.message).join('; '));
          }}
        >
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Склад">
              <Select value={storageId} onChange={(e) => setStorageId(e.target.value)} required>
                <option value="">Выберите склад</option>
                {opts.storages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Поставщик">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} required>
                <option value="">Выберите поставщика</option>
                {opts.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Позиции</p>
            {items.map((row, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_90px_110px_auto] gap-2">
                <Select value={row.productId} onChange={(e) => update(idx, { productId: e.target.value })} aria-label="Товар" required>
                  <option value="">Товар</option>
                  {opts.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Input inputMode="decimal" placeholder="Кол-во" value={row.quantity} onChange={(e) => update(idx, { quantity: e.target.value })} aria-label="Количество" required />
                <Input inputMode="decimal" placeholder="Цена" value={row.price} onChange={(e) => update(idx, { price: e.target.value })} aria-label="Цена" required />
                <Button type="button" variant="ghost" size="icon" disabled={items.length === 1} onClick={() => setItems((r) => r.filter((_, i) => i !== idx))} aria-label="Удалить позицию">
                  <Trash2 />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setItems((r) => [...r, { productId: '', quantity: '', price: '' }])}>
              <Plus /> Позиция
            </Button>
          </div>
          <Field label="Комментарий">
            <Input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex items-center justify-between border-t pt-4">
            <span className="tabular text-sm">Итого: <b>{money(total, currency)}</b></span>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Отмена
              </Button>
              <Button type="submit" disabled={!parsed.success}>
                Далее
              </Button>
            </div>
          </div>
        </form>
      )}
      {confirming && parsed.success && (
        <div className="flex flex-col gap-4">
          {error && <Alert variant="error">{error}</Alert>}
          <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">Поставщик</dt>
            <dd>{parsed.data.supplierName}</dd>
            <dt className="text-muted-foreground">Склад</dt>
            <dd>{parsed.data.storageName}</dd>
          </dl>
          <Table>
            <THead>
              <TR>
                <TH>Товар</TH>
                <TH className="text-right">Кол-во</TH>
                <TH className="text-right">Цена</TH>
                <TH className="text-right">Сумма</TH>
              </TR>
            </THead>
            <TBody>
              {parsed.data.items.map((i) => (
                <TR key={i.productId}>
                  <TD>{i.productName}</TD>
                  <TD className="tabular text-right">{num(i.quantity)}</TD>
                  <TD className="tabular text-right">{num(i.price)}</TD>
                  <TD className="tabular text-right">{num(i.quantity * i.price)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="text-right text-sm">
            Итого: <b className="tabular">{money(total, currency)}</b>
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Назад
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? 'Отправка…' : '✅ Подтвердить'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
