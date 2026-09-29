import { describe, expect, it } from 'vitest';
import { ApiError, buildUrl, errorText } from '../lib/api';
import { compact, money, shortDate } from '../lib/utils';

describe('web utils', () => {
  it('formats money and compact axis labels', () => {
    expect(money(12_450_000)).toBe('12 450 000 сум');
    expect(money(null)).toBe('—');
    expect(compact(12_450_000)).toBe('12 млн');
    expect(compact(2_500_000)).toBe('2,5 млн');
    expect(compact(3_000)).toBe('3 тыс');
    expect(shortDate('2026-09-29')).toBe('29.09');
  });

  it('builds backend URLs only (never Clopos)', () => {
    const url = buildUrl('/api/sales', { preset: 'week', empty: '', none: undefined });
    expect(url).toBe('http://localhost:3001/api/sales?preset=week');
    expect(url).not.toContain('clopos.com');
  });

  it('turns validation errors into readable text', () => {
    const err = new ApiError(400, 'VALIDATION_ERROR', 'Некорректные данные', [{ path: 'items.0.quantity', message: 'Количество должно быть больше 0' }]);
    expect(errorText(err)).toBe('items.0.quantity: Количество должно быть больше 0');
    expect(errorText(new Error('x'))).toBe('Неизвестная ошибка');
  });
});
