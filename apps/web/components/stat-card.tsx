import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';

export function StatCard({ label, value, hint, icon: Icon, loading }: { label: string; value: string; hint?: string; icon: LucideIcon; loading?: boolean }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      {loading ? <Skeleton className="mt-3 h-7 w-32" /> : <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>}
      {hint && !loading && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
