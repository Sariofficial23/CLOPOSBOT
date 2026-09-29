import { Badge } from '@/components/ui/badge';

/** Makes it impossible to mistake MockCloposService data for real Clopos data. */
export function SourceBadge({ source }: { source?: 'real' | 'mock' }) {
  if (!source) return null;
  return source === 'mock' ? (
    <Badge variant="warning" title="Данные MockCloposService — не из Clopos">MOCK DATA</Badge>
  ) : (
    <Badge variant="success">Clopos</Badge>
  );
}
