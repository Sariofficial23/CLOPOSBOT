'use client';

import { supplierSchema, warehouseSchema } from '@cpos/shared';
import { Pencil, Plus } from 'lucide-react';
import { useState } from 'react';
import { RequirePermission } from '@/components/layout/guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Alert, PageHeader, Skeleton } from '@/components/ui/misc';
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { api, errorText } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/use-api';

interface Entry {
  id: string;
  name: string;
  phone?: string | null;
  active: boolean;
}

type Kind = 'warehouses' | 'suppliers';
const LABELS: Record<Kind, { title: string; one: string; description: string }> = {
  warehouses: { title: 'Склады', one: 'склад', description: 'Куда поступает товар при приходе' },
  suppliers: { title: 'Поставщики', one: 'поставщика', description: 'От кого поступает товар' },
};

export default function CatalogPage() {
  return (
    <RequirePermission permission="incoming:view">
      <PageHeader
        title="Справочники"
        description="Clopos Open API не отдаёт склады и поставщиков, поэтому они ведутся здесь. Товары берутся из Clopos."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Directory kind="warehouses" />
        <Directory kind="suppliers" />
      </div>
    </RequirePermission>
  );
}

function Directory({ kind }: { kind: Kind }) {
  const { can } = useAuth();
  const manage = can('catalog:manage');
  const { data, error, loading, reload } = useApi<Entry[]>(`/api/${kind}`);
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  const l = LABELS[kind];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-2">
        <div>
          <CardTitle>{l.title}</CardTitle>
          <CardDescription>{l.description}</CardDescription>
        </div>
        {manage && (
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Добавить
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {error && <Alert variant="error">{error}</Alert>}
        {loading && !data ? (
          <Skeleton className="h-32" />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Название</TH>
                {kind === 'suppliers' && <TH>Телефон</TH>}
                <TH>Статус</TH>
                {manage && <TH />}
              </TR>
            </THead>
            <TBody>
              {data?.length === 0 && <EmptyRow colSpan={4}>Пока пусто — добавьте {l.one}</EmptyRow>}
              {data?.map((e) => (
                <TR key={e.id} className={e.active ? '' : 'opacity-60'}>
                  <TD className="font-medium">{e.name}</TD>
                  {kind === 'suppliers' && <TD className="text-muted-foreground">{e.phone || '—'}</TD>}
                  <TD>{e.active ? <Badge variant="success">Активен</Badge> : <Badge variant="secondary">Скрыт</Badge>}</TD>
                  {manage && (
                    <TD className="text-right">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e)} aria-label={`Изменить ${e.name}`}>
                        <Pencil />
                      </Button>
                    </TD>
                  )}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
      {editing && (
        <EntryDialog
          kind={kind}
          entry={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </Card>
  );
}

function EntryDialog({ kind, entry, onClose, onSaved }: { kind: Kind; entry: Entry | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(entry?.name ?? '');
  const [phone, setPhone] = useState(entry?.phone ?? '');
  const [active, setActive] = useState(entry?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const body = kind === 'suppliers' ? { name, phone: phone.trim() || null, active } : { name, active };
  const parsed = (kind === 'suppliers' ? supplierSchema : warehouseSchema).safeParse(body);

  return (
    <Dialog open onClose={onClose} title={entry ? `Изменить: ${entry.name}` : `Новый ${LABELS[kind].one.replace(/а$/, '')}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!parsed.success) {
            setError(parsed.error.issues.map((i) => i.message).join('; '));
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await api(entry ? `/api/${kind}/${entry.id}` : `/api/${kind}`, { method: entry ? 'PATCH' : 'POST', body: parsed.data });
            onSaved();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && <Alert variant="error">{error}</Alert>}
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
        </Field>
        {kind === 'suppliers' && (
          <Field label="Телефон (необязательно)">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" maxLength={32} />
          </Field>
        )}
        {entry && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Активен (показывать при приходе)
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button type="submit" disabled={busy || !parsed.success}>
            Сохранить
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
