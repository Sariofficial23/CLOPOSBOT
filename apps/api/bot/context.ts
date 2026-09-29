import type { Context } from 'telegraf';
import type { Actor } from '../services/types';
import type { IncomingFlowState } from './flows/incoming.flow';

/** Waiting for an amount for a salary adjustment, then confirmation. */
export interface SalaryInputFlow {
  kind: 'salary';
  startedAt: number;
  employeeId: string;
  employeeName: string;
  period: string;
  field: 'bonus' | 'penalty' | 'advance';
  amount?: number;
}

export interface EmployeeCreateFlow {
  kind: 'employee-create';
  startedAt: number;
  step: 'name' | 'position' | 'salary' | 'confirm';
  name?: string;
  position?: string;
  baseSalary?: number;
}

export interface EmployeeEditFlow {
  kind: 'employee-edit';
  startedAt: number;
  employeeId: string;
  employeeName: string;
  field: 'name' | 'position' | 'baseSalary';
  value?: string | number;
}

export type Flow = IncomingFlowState | SalaryInputFlow | EmployeeCreateFlow | EmployeeEditFlow;

export interface BotSession {
  flow?: Flow | null;
}

export interface BotContext extends Context {
  session: BotSession;
  actor?: Actor;
}

/** Abandoned flows expire so a stale confirmation can't be replayed much later. */
export const FLOW_TTL_MS = 60 * 60_000;
