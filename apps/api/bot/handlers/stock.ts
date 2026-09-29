import { formatAmount, formatMoney } from '@cpos/shared';
import { Markup, type Telegraf } from 'telegraf';
import type { BotContext } from '../context';
import type { BotDeps } from '../index';
import { actorOf, allowed, show, userMessage } from '../helpers';
import { backToMenu, CANCEL_ROW } from '../keyboards';

const b = (t: string, d: string) => Markup.button.callback(t, d);
const ALLOWED_EXT = /\.(xlsx|csv)$/i;

export const STOCK_HELP = [
  '📤 КАК ОБНОВИТЬ ОСТАТКИ',
  '',
  '1. В Clopos откройте отчёт по остаткам (склад → остатки).',
  '2. Выгрузите его в Excel (.xlsx) или CSV.',
  '3. Отправьте файл сюда, в этот чат, как документ.',
  '4. Проверьте превью и нажмите «✅ Подтвердить».',
  '',
  'Нужны колонки с названием товара и остатком/количеством. Склад, единица, себестоимость и сумма — по возможности.',
].join('\n');

function fmtDate(iso: string, timezone: string) {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: timezone }).format(new Date(iso));
}

async function downloadTelegramFile(ctx: BotContext, fileId: string): Promise<Buffer> {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(link.toString());
  if (!res.ok) throw new Error(`Telegram file download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export function registerStock(bot: Telegraf<BotContext>, deps: BotDeps) {
  const { reports, stockImport } = deps.services;

  bot.action('m:stock', async (ctx) => {
    if (!(await allowed(ctx, 'stock:view'))) return;
    const actor = actorOf(ctx);
    const { timezone, currency } = await reports.companyTimezone(actor.companyId);
    const inv = await reports.inventory(actor.companyId);
    const canImport = deps.can(actor, 'catalog:manage');
    const rows = [[b('🔎 Найти товар', 'stk:find')]];
    if (canImport) rows.push([b('📤 Обновить остатки', 'stk:help')]);
    rows.push(backToMenu());
    if (!inv.available) {
      await show(ctx, `📦 ОСТАТКИ\n\n${inv.reason}${canImport ? `\n\n${STOCK_HELP}` : ''}`, Markup.inlineKeyboard([backToMenu()]));
      return;
    }
    const s = inv.summary;
    const lines = [
      '📦 ОСТАТКИ',
      inv.source === 'import' && inv.asOf ? `По выгрузке из Clopos от ${fmtDate(inv.asOf, timezone)}` : `Онлайн из Clopos (${fmtDate(inv.asOf ?? new Date().toISOString(), timezone)})`,
      ...(inv.note ? [`⚠️ ${inv.note}`] : []),
      '',
      `Позиций: ${s.positions}`,
      `Всего единиц: ${formatAmount(s.totalQuantity)}`,
      s.totalValue !== null ? `Стоимость: ${formatMoney(s.totalValue, currency)}` : 'Стоимость: нет данных',
      '',
      s.lowStock.length ? '⚠️ Заканчиваются (≤ 5):' : '✅ Нет позиций с низким остатком',
      ...s.lowStock.slice(0, 15).map((l) => `  ${l.productName}: ${formatAmount(l.quantity)}`),
    ];
    await show(ctx, lines.join('\n'), Markup.inlineKeyboard(rows));
  });

  bot.action('stk:help', async (ctx) => {
    if (!(await allowed(ctx, 'catalog:manage'))) return;
    await show(ctx, STOCK_HELP, Markup.inlineKeyboard([[b('◀️ Остатки', 'm:stock')]]));
  });

  bot.action('stk:find', async (ctx) => {
    if (!(await allowed(ctx, 'stock:view'))) return;
    ctx.session.flow = { kind: 'stock-search', startedAt: Date.now() };
    await show(ctx, '🔎 Введите часть названия товара:', Markup.inlineKeyboard([CANCEL_ROW]));
  });

  // Excel / CSV export sent as a document
  bot.on('document', async (ctx) => {
    const doc = ctx.message.document;
    if (!(await allowed(ctx, 'catalog:manage'))) return;
    const name = doc.file_name ?? 'file';
    if (!ALLOWED_EXT.test(name)) {
      await ctx.reply(`⚠️ Нужен файл .xlsx или .csv с остатками.${/\.xls$/i.test(name) ? ' Старый .xls сохраните как .xlsx.' : ''}`);
      return;
    }
    if ((doc.file_size ?? 0) > 5 * 1024 * 1024) {
      await ctx.reply('⚠️ Файл больше 5 МБ.');
      return;
    }
    await ctx.reply('⏳ Читаю файл…');
    try {
      const buffer = await (deps.downloadFile ?? downloadTelegramFile)(ctx, doc.file_id);
      const draft = await stockImport.createDraft({ ...actorOf(ctx) }, buffer, name, 'telegram');
      const { currency } = await reports.companyTimezone(actorOf(ctx).companyId);
      const lines = [
        '📦 ИМПОРТ ОСТАТКОВ',
        `Файл: ${draft.fileName}`,
        '',
        `Позиций: ${draft.rowCount}`,
        `Всего единиц: ${formatAmount(draft.totalQuantity)}`,
        draft.totalValue !== null ? `Стоимость: ${formatMoney(draft.totalValue, currency)}` : 'Стоимость: нет в файле',
        draft.storages.length ? `Склады: ${draft.storages.slice(0, 5).join(', ')}${draft.storages.length > 5 ? '…' : ''}` : '',
        '',
        `Колонки: ${Object.entries(draft.columns).map(([k, v]) => `${k}=«${v}»`).join(', ')}`,
        '',
        'Первые строки:',
        ...draft.sample.slice(0, 5).map((r) => `  ${r.productName}: ${formatAmount(r.quantity)}${r.unit ? ` ${r.unit}` : ''}`),
        ...draft.warnings.map((w) => `⚠️ ${w}`),
        draft.skipped ? `ℹ️ Пропущено строк без товара/количества: ${draft.skipped}` : '',
        '',
        'Заменить текущие остатки этими данными?',
      ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
      await ctx.reply(lines.join('\n'), Markup.inlineKeyboard([[b('✅ Подтвердить', `stk:ok:${draft.id}`)], [b('❌ Отмена', `stk:no:${draft.id}`)]]));
    } catch (err) {
      deps.logger?.error({ err: err instanceof Error ? err.message : err }, 'stock import failed');
      await ctx.reply(`❌ ${userMessage(err)}`);
    }
  });

  bot.action(/^stk:ok:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'catalog:manage'))) return;
    await stockImport.confirm({ ...actorOf(ctx) }, ctx.match[1]!);
    await ctx.answerCbQuery('Остатки обновлены').catch(() => {});
    await show(ctx, '✅ Остатки обновлены.', Markup.inlineKeyboard([[b('📦 Посмотреть остатки', 'm:stock')], backToMenu()]));
  });

  bot.action(/^stk:no:(\w+)$/, async (ctx) => {
    if (!(await allowed(ctx, 'catalog:manage'))) return;
    await stockImport.discard({ ...actorOf(ctx) }, ctx.match[1]!).catch(() => {});
    await show(ctx, '❌ Импорт отменён.', Markup.inlineKeyboard([backToMenu()]));
  });
}

/** Text input for the stock search flow. Returns true when handled. */
export async function handleStockText(ctx: BotContext, deps: BotDeps, text: string): Promise<boolean> {
  const f = ctx.session.flow;
  if (!f || f.kind !== 'stock-search') return false;
  const q = text.trim();
  if (q.length < 2) {
    await ctx.reply('⚠️ Введите хотя бы 2 символа', Markup.inlineKeyboard([CANCEL_ROW]));
    return true;
  }
  const actor = actorOf(ctx);
  const service = await deps.services.clopos.forCompany(actor.companyId);
  let res: { items: { productName: string; storageName: string | null; quantity: number; unit: string | null }[] } | null = null;
  if (service.capabilities.stock) {
    try {
      const needle = q.toLowerCase();
      const stock = await service.getStock();
      res = {
        items: stock
          .filter((s) => s.productName.toLowerCase().includes(needle))
          .slice(0, 15)
          .map((s) => ({ productName: s.productName, storageName: s.storageId, quantity: s.quantity, unit: s.unit })),
      };
    } catch {
      res = null; // fall back to the Excel import
    }
  }
  res ??= await deps.services.stockImport.search(actor.companyId, q);
  if (!res) {
    ctx.session.flow = null;
    await ctx.reply('Остатки ещё не загружены.', Markup.inlineKeyboard([backToMenu()]));
    return true;
  }
  const lines = res.items.length
    ? [`🔎 «${q}»:`, ...res.items.map((i) => `${i.productName}${i.storageName ? ` (${i.storageName})` : ''}: ${formatAmount(i.quantity)}${i.unit ? ` ${i.unit}` : ''}`)]
    : [`Ничего не найдено по «${q}».`];
  lines.push('', 'Введите другое название или нажмите Отмена.');
  await ctx.reply(lines.join('\n'), Markup.inlineKeyboard([[b('◀️ Остатки', 'm:stock')], CANCEL_ROW]));
  return true;
}
