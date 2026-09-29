/** Telegram text formatting for reports (plain text, no Markdown escaping headaches). */
import { formatAmount, formatMoney } from '@cpos/shared';
import type { FullReport } from './report.service';

const HEADERS: Record<string, string> = {
  today: '📊 ОТЧЁТ ЗА СЕГОДНЯ',
  yesterday: '📊 ОТЧЁТ ЗА ВЧЕРА',
  week: '📊 ОТЧЁТ ЗА НЕДЕЛЮ',
  last_week: '📊 ОТЧЁТ ЗА ПРОШЛУЮ НЕДЕЛЮ',
  month: '📊 ОТЧЁТ ЗА МЕСЯЦ',
  last_month: '📊 ОТЧЁТ ЗА ПРОШЛЫЙ МЕСЯЦ',
  custom: '📊 ОТЧЁТ',
};

export function formatReportText(report: FullReport, currency: string): string {
  const s = report.sales;
  const m = (v: number) => formatMoney(v, currency);
  const lines: string[] = [];
  lines.push(HEADERS[report.range.preset] ?? HEADERS.custom!);
  lines.push(report.range.label);
  if (report.source === 'mock') lines.push('⚠️ ТЕСТОВЫЕ ДАННЫЕ (MockCloposService)');
  lines.push('');
  lines.push(`Продажи: ${m(s.sales)}`);
  lines.push(`Заказов: ${s.orders}`);
  if (s.orders) lines.push(`Средний чек: ${m(s.averageCheck)}`);
  lines.push('');
  lines.push(`Наличные: ${formatAmount(s.payments.cash)}`);
  lines.push(`Карта: ${formatAmount(s.payments.card)}`);
  lines.push(`Другие: ${formatAmount(s.payments.other)}`);
  lines.push('');
  if (s.cost !== null && s.grossProfit !== null) {
    lines.push(`Себестоимость: ${formatAmount(s.cost)}`);
    lines.push(`Валовая прибыль: ${formatAmount(s.grossProfit)}${s.grossMargin !== null ? ` (${s.grossMargin}%)` : ''}`);
  } else {
    lines.push('Себестоимость: нет данных из Clopos');
    lines.push('Валовая прибыль: нет данных');
  }
  lines.push('');
  lines.push(`Расходы: ${formatAmount(report.expenses.total)}`);
  lines.push(`  • приходы товара: ${formatAmount(report.expenses.incoming)}`);
  lines.push(`  • выплаты зарплаты: ${formatAmount(report.expenses.salary)}`);
  if (report.inventory.available) {
    lines.push('');
    lines.push(`📦 Остатки: ${report.inventory.summary.positions} позиций`);
    if (report.inventory.summary.totalValue !== null) {
      lines.push(`Стоимость остатков: ${formatAmount(report.inventory.summary.totalValue)}`);
    }
    if (report.inventory.summary.lowStock.length) {
      lines.push(`Заканчиваются: ${report.inventory.summary.lowStock.slice(0, 5).map((l) => `${l.productName} (${l.quantity})`).join(', ')}`);
    }
  }
  if (s.topProducts?.length) {
    lines.push('');
    lines.push('🏆 Топ товаров:');
    s.topProducts.slice(0, 5).forEach((p, i) => lines.push(`${i + 1}. ${p.name} — ${formatAmount(p.total)}`));
  }
  for (const w of report.warnings) lines.push(`\nℹ️ ${w}`);
  return lines.join('\n');
}
