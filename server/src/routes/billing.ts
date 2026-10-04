import { Router } from 'express';
import { z } from 'zod';
import { platformDb } from '../db/index.js';
import { HttpError } from '../lib/http.js';
import {
  ACCELERATIONS,
  accountAccelerations,
  accountBalance,
  audit,
  PLANS,
  planById,
  setAccelerations,
} from '../services/platform.js';
import { requireAccountAdmin } from './auth.js';

/** Subscription, payments and "Akceleracje" of the client account. */
export const billingRouter = Router();

billingRouter.get('/', (req, res) => {
  const a = req.account!;
  const usage = platformDb.prepare('SELECT stats FROM accounts WHERE id = ?').get(a.id) as { stats: string };
  res.json({
    plan: planById(a.plan),
    plans: PLANS.filter((p) => p.id !== 'trial'),
    status: a.status,
    trial_ends_at: a.trial_ends_at,
    paid_until: a.paid_until,
    balance: accountBalance(a.id),
    usage: JSON.parse(usage?.stats || '{}'),
    ledger: platformDb.prepare('SELECT date, item, description, amount FROM billing WHERE account_id = ? ORDER BY date DESC, id DESC LIMIT 200').all(a.id),
    payment: {
      bank_account: process.env.PLATFORM_BANK_ACCOUNT ?? '',
      recipient: process.env.PLATFORM_COMPANY ?? 'SellHub',
      title: `SellHub ${a.id}`,
    },
  });
});

billingRouter.put('/plan', requireAccountAdmin, (req, res) => {
  const b = z.object({ plan: z.enum(PLANS.filter((p) => p.id !== 'trial').map((p) => p.id) as [string, ...string[]]) }).parse(req.body);
  const a = req.account!;
  const users = (platformDb.prepare('SELECT COUNT(*) c FROM users WHERE account_id = ?').get(a.id) as { c: number }).c;
  const plan = planById(b.plan);
  if (users > plan.users) throw new HttpError(400, `The plan allows ${plan.users} user(s); remove users first`);
  platformDb.prepare('UPDATE accounts SET plan = ? WHERE id = ?').run(b.plan, a.id);
  audit(null, a.id, 'plan.change', `${a.plan} → ${b.plan} by ${req.user!.email}`, req.ip ?? '');
  res.json({ ok: true });
});

billingRouter.get('/accelerations', (req, res) => {
  const a = req.account!;
  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  res.json({
    options: ACCELERATIONS,
    current: accountAccelerations(a.id),
    charges_30d: platformDb
      .prepare(`SELECT date, item, amount FROM billing WHERE account_id = ? AND item LIKE 'accel:%' AND date >= ? ORDER BY date DESC`)
      .all(a.id, since),
  });
});

billingRouter.put('/accelerations', requireAccountAdmin, (req, res) => {
  const b = z.record(z.string(), z.string()).parse(req.body);
  res.json({ current: setAccelerations(req.account!.id, b) });
});
