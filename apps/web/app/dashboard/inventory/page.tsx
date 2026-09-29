'use client';

import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { RequirePermission } from '@/components/layout/guard';
import { SourceBadge } from '@/components/source-badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useAuth } from '@/lib/auth';
import type { Capabilities, InventoryState, Option, Product, Stock } from '@/lib/types';
import { useApi } from '@/lib/use-api';
import { money, num } from '@/lib/utils';

interface InventoryResponse {
  mode: 'real' | 'mock';
  capabilities: Capabilities;
  products: Product[];
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
  const { company } = useAuth();
  const currency = company?.currency ?? 'сум';
  const { data, error, loading } = useApi<InventoryResponse>('/api/inventory');
  const [q, setQ] = useState('');
  const categories = useMemo(() => new Map((data?.categories ?? []).map((c) => [c.id, c.name])), [data]);
  const needle = q.trim().toLowerCase();
  const stock = (data?.stock ?? []).filter((s) => !needle || s.productName.toLowerCase().includes(needle));
  const products = (data?.products ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle));

  return (
    <>
      <PageHeader title="Остатки" description="Товары и остатки из Clopos" actions={<SourceBadge source={data?.mode} />} />
      {error && <Alert variant="error" className="mb-6">{error}</Alert>}
      {data && !data.summary.available && (
        <Alert variant="warning" title="Остатки недоступны" className="mb-6">
          {data.summary.reason}. Список товаров ниже загружен из Clopos.
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
      {data && (
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
