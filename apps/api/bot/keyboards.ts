import { hasPermission, type Permission, type Role } from '@cpos/shared';
import { Markup } from 'telegraf';
import { type IncomingFlowState, visibleProducts } from './flows/incoming.flow';

type Button = ReturnType<typeof Markup.button.callback>;
const btn = (text: string, data: string): Button => Markup.button.callback(text, data);

export const CANCEL_ROW = [btn('❌ Отмена', 'x')];

export const MENU_ITEMS: { text: string; data: string; permission: Permission }[] = [
  { text: '📊 Dashboard', data: 'm:dash', permission: 'dashboard:view' },
  { text: '📦 Приход товара', data: 'm:inc', permission: 'incoming:create' },
  { text: '📈 Отчёты', data: 'm:rep', permission: 'reports:view' },
  { text: '💰 Зарплата', data: 'm:sal', permission: 'salary:view' },
  { text: '📦 Остатки', data: 'm:stock', permission: 'stock:view' },
  { text: '💵 Продажи', data: 'm:sales', permission: 'sales:view' },
  { text: '⚙️ Настройки', data: 'm:set', permission: 'reports:schedule' },
];

/** Main menu: only the sections the role may open, two per row. */
export function mainMenu(role: Role) {
  const items = MENU_ITEMS.filter((i) => hasPermission(role, i.permission)).map((i) => btn(i.text, i.data));
  const rows: Button[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return Markup.inlineKeyboard(rows);
}

export const backToMenu = () => [btn('◀️ Меню', 'm:main')];

export function reportsMenu() {
  return Markup.inlineKeyboard([
    [btn('Сегодня', 'r:today'), btn('Вчера', 'r:yesterday')],
    [btn('Неделя', 'r:week'), btn('Месяц', 'r:month')],
    [btn('Прошлая неделя', 'r:last_week'), btn('Прошлый месяц', 'r:last_month')],
    backToMenu(),
  ]);
}

export function confirmKeyboard(okData: string, okText = '✅ Подтвердить') {
  return Markup.inlineKeyboard([[btn(okText, okData)], CANCEL_ROW]);
}

/** Keyboard for the current incoming step. Indexes (not ids) keep callback data < 64 bytes. */
export function incomingKeyboard(state: IncomingFlowState) {
  const nav = [btn('⬅️ Назад', 'inc:back'), btn('❌ Отмена', 'x')];
  switch (state.step) {
    case 'storage':
      return Markup.inlineKeyboard([...state.storages.slice(0, 30).map((s, i) => [btn(s.name, `inc:s:${i}`)]), CANCEL_ROW]);
    case 'supplier':
      return Markup.inlineKeyboard([...state.suppliers.slice(0, 30).map((s, i) => [btn(s.name, `inc:u:${i}`)]), nav]);
    case 'product': {
      const { items, page, pages } = visibleProducts(state);
      const rows: Button[][] = items.map(({ option, index }) => [btn(option.name, `inc:p:${index}`)]);
      const paging: Button[] = [];
      if (page > 0) paging.push(btn('◀️', `inc:pg:${page - 1}`));
      if (page < pages - 1) paging.push(btn('▶️', `inc:pg:${page + 1}`));
      if (paging.length) rows.push(paging);
      if (state.filter) rows.push([btn('🔎 Сбросить поиск', 'inc:clr')]);
      rows.push(nav);
      return Markup.inlineKeyboard(rows);
    }
    case 'quantity':
    case 'price':
      return Markup.inlineKeyboard([nav]);
    case 'confirm':
      return Markup.inlineKeyboard([[btn('✅ Подтвердить', 'inc:ok')], [btn('⬅️ Назад', 'inc:back'), btn('❌ Отмена', 'x')]]);
  }
}
