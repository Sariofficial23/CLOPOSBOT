import { z } from 'zod';
import { ROLES } from './roles';
import { PERIOD_REGEX } from './salary';

/** Money: non-negative, at most 2 decimals, below 10^13. Accepts numeric strings. */
export const moneySchema = z.coerce
  .number({ message: 'Должно быть числом' })
  .finite()
  .nonnegative('Не может быть отрицательным')
  .max(9_999_999_999_999, 'Слишком большое значение')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, {
    message: 'Не более 2 знаков после запятой',
  });

export const quantitySchema = z.coerce
  .number({ message: 'Должно быть числом' })
  .finite()
  .positive('Количество должно быть больше 0')
  .max(10_000_000, 'Слишком большое количество');

export const idSchema = z.string().min(1).max(128);

export const periodSchema = z.string().regex(PERIOD_REGEX, 'Период в формате YYYY-MM');

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некорректный email').max(254),
  password: z.string().min(8, 'Минимум 8 символов').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const incomingItemSchema = z.object({
  productId: idSchema,
  productName: z.string().trim().min(1).max(255),
  quantity: quantitySchema,
  price: moneySchema,
});

export const incomingInputSchema = z.object({
  storageId: idSchema,
  storageName: z.string().trim().min(1).max(255),
  supplierId: idSchema,
  supplierName: z.string().trim().min(1).max(255),
  note: z.string().trim().max(1000).optional(),
  items: z.array(incomingItemSchema).min(1, 'Нужна хотя бы одна позиция').max(200),
});
export type IncomingInputDto = z.infer<typeof incomingInputSchema>;

export const employeeCreateSchema = z.object({
  name: z.string().trim().min(1, 'Укажите имя').max(120),
  position: z.string().trim().min(1, 'Укажите должность').max(120),
  baseSalary: moneySchema,
  active: z.boolean().optional().default(true),
  telegramId: z.string().regex(/^\d{1,20}$/).optional().nullable(),
});
export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;

export const employeeUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    position: z.string().trim().min(1).max(120),
    baseSalary: moneySchema,
    active: z.boolean(),
    telegramId: z.string().regex(/^\d{1,20}$/).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Нет полей для обновления' });
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

export const salaryCreateSchema = z.object({
  employeeId: idSchema,
  period: periodSchema,
  baseSalary: moneySchema.optional(),
  // omitted components keep their current value (or 0 for a new record)
  bonus: moneySchema.optional(),
  penalty: moneySchema.optional(),
  advance: moneySchema.optional(),
  note: z.string().trim().max(500).optional(),
});
export type SalaryCreateInput = z.infer<typeof salaryCreateSchema>;

export const salaryAdjustSchema = z.object({
  kind: z.enum(['bonus', 'penalty', 'advance']),
  amount: moneySchema.refine((v) => v > 0, 'Сумма должна быть больше 0'),
  note: z.string().trim().max(500).optional(),
});
export type SalaryAdjustInput = z.infer<typeof salaryAdjustSchema>;

export const salaryUpdateSchema = z
  .object({
    baseSalary: moneySchema,
    bonus: moneySchema,
    penalty: moneySchema,
    advance: moneySchema,
    note: z.string().trim().max(500).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Нет полей для обновления' });

export const salaryPayrollSchema = z.object({ period: periodSchema });

export const dateRangeQuerySchema = z.object({
  preset: z.enum(['today', 'yesterday', 'week', 'month', 'last_week', 'last_month']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const reportScheduleSchema = z
  .object({
    type: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
    enabled: z.boolean(),
    hour: z.number().int().min(0).max(23),
    minute: z.number().int().min(0).max(59),
    dayOfWeek: z.number().int().min(1).max(7).nullable().optional(),
    dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
    reportPeriod: z.enum(['CURRENT', 'PREVIOUS']),
    extraChatId: z.string().regex(/^-?\d{1,20}$/).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'WEEKLY' && !v.dayOfWeek) ctx.addIssue({ code: 'custom', message: 'Укажите день недели', path: ['dayOfWeek'] });
    if (v.type === 'MONTHLY' && !v.dayOfMonth) ctx.addIssue({ code: 'custom', message: 'Укажите день месяца', path: ['dayOfMonth'] });
  });
export type ReportScheduleInput = z.infer<typeof reportScheduleSchema>;

export const companySettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    timezone: z.string().min(1).max(64),
    currency: z.string().trim().max(10),
  })
  .partial();

export const userCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.enum(ROLES),
    email: z.string().trim().toLowerCase().email().max(254).optional().nullable(),
    password: z.string().min(8).max(200).optional(),
    telegramId: z.string().regex(/^\d{1,20}$/, 'Telegram ID — только цифры').optional().nullable(),
  })
  .refine((v) => v.email || v.telegramId, { message: 'Нужен email или Telegram ID' })
  .refine((v) => !v.email || v.password, { message: 'Для входа по email нужен пароль', path: ['password'] });

export const userUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    role: z.enum(ROLES),
    active: z.boolean(),
    telegramId: z.string().regex(/^\d{1,20}$/).nullable(),
    password: z.string().min(8).max(200),
  })
  .partial();

/**
 * Clopos credentials as issued by Clopos (see developer.clopos.com → Authentication).
 * client_id / client_secret / integrator_id fall back to the server environment
 * when omitted; `brand` identifies the merchant.
 */
export const cloposConnectSchema = z.object({
  brand: z.string().trim().min(1).max(120),
  clientId: z.string().trim().min(1).max(255).optional(),
  clientSecret: z.string().min(1).max(1024).optional(),
  integratorId: z.string().trim().min(1).max(255).optional(),
  venueId: z.string().trim().max(64).optional(),
});
export type CloposConnectInput = z.infer<typeof cloposConnectSchema>;
