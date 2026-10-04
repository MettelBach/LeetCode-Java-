import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db, platformDb, runWithTenant } from '../db/index.js';
import { HttpError, idParam, nowSql } from '../lib/http.js';
import { platformMail } from '../services/platform.js';

export const TICKET_CATEGORIES = ['orders', 'integrations', 'products', 'shipping', 'invoices', 'billing', 'bug', 'other'] as const;

/* ------------------------------ client side: /api/support ------------------------------ */

export const supportRouter = Router();

supportRouter.get('/tickets', (req, res) => {
  res.json(
    platformDb
      .prepare(
        `SELECT t.id, t.subject, t.category, t.priority, t.status, t.last_author, t.last_message_at, t.created_at, u.name user_name
         FROM tickets t LEFT JOIN users u ON u.id = t.user_id WHERE t.account_id = ? ORDER BY t.last_message_at DESC`,
      )
      .all(req.account!.id),
  );
});

supportRouter.post('/tickets', (req, res) => {
  const b = z
    .object({
      subject: z.string().min(3).max(200),
      category: z.enum(TICKET_CATEGORIES),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      body: z.string().min(5).max(20000),
    })
    .parse(req.body);
  const author = req.impersonator ? `Support: ${req.impersonator.name}` : req.user!.name;
  const id = platformDb.transaction(() => {
    const r = platformDb
      .prepare('INSERT INTO tickets (account_id, user_id, subject, category, priority) VALUES (?, ?, ?, ?, ?)')
      .run(req.account!.id, req.user!.id, b.subject, b.category, b.priority ?? 'normal');
    const tid = Number(r.lastInsertRowid);
    platformDb
      .prepare(`INSERT INTO ticket_messages (ticket_id, author_type, author_id, author_name, body) VALUES (?, 'user', ?, ?, ?)`)
      .run(tid, req.user!.id, author, b.body);
    return tid;
  })();
  res.json({ id });
});

function ownTicket(accountId: number, id: number) {
  const t = platformDb.prepare('SELECT * FROM tickets WHERE id = ? AND account_id = ?').get(id, accountId) as any;
  if (!t) throw new HttpError(404, 'Ticket not found');
  return t;
}

supportRouter.get('/tickets/:id', (req, res) => {
  const t = ownTicket(req.account!.id, idParam(req));
  const messages = platformDb
    .prepare('SELECT id, author_type, author_name, body, created_at FROM ticket_messages WHERE ticket_id = ? AND internal = 0 ORDER BY id')
    .all(t.id);
  res.json({ ...t, messages });
});

supportRouter.post('/tickets/:id/messages', (req, res) => {
  const t = ownTicket(req.account!.id, idParam(req));
  if (t.status === 'closed') throw new HttpError(400, 'The ticket is closed — create a new one');
  const b = z.object({ body: z.string().min(1).max(20000) }).parse(req.body);
  platformDb.transaction(() => {
    platformDb
      .prepare(`INSERT INTO ticket_messages (ticket_id, author_type, author_id, author_name, body) VALUES (?, 'user', ?, ?, ?)`)
      .run(t.id, req.user!.id, req.user!.name, b.body);
    platformDb
      .prepare(`UPDATE tickets SET status = CASE WHEN status IN ('waiting','resolved') THEN 'open' ELSE status END, last_author = 'user', last_message_at = ?, updated_at = ? WHERE id = ?`)
      .run(nowSql(), nowSql(), t.id);
  })();
  res.json({ ok: true });
});

supportRouter.post('/tickets/:id/close', (req, res) => {
  const t = ownTicket(req.account!.id, idParam(req));
  platformDb.prepare(`UPDATE tickets SET status = 'closed', updated_at = ? WHERE id = ?`).run(nowSql(), t.id);
  platformDb
    .prepare(`INSERT INTO ticket_messages (ticket_id, author_type, author_name, body) VALUES (?, 'system', 'System', ?)`)
    .run(t.id, `Ticket closed by ${req.user!.name}`);
  res.json({ ok: true });
});

/* ------------------------------- staff side helpers ------------------------------- */

/** Posts a staff reply; notifies the client in the panel and by e-mail. */
export async function staffReply(ticketId: number, staff: { id: number; name: string }, body: string, internal: boolean, status?: string) {
  const t = platformDb.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId) as any;
  if (!t) throw new HttpError(404, 'Ticket not found');
  platformDb.transaction(() => {
    platformDb
      .prepare(`INSERT INTO ticket_messages (ticket_id, author_type, author_id, author_name, body, internal) VALUES (?, 'staff', ?, ?, ?, ?)`)
      .run(ticketId, staff.id, staff.name, body, internal ? 1 : 0);
    if (!internal) {
      platformDb
        .prepare(`UPDATE tickets SET status = ?, last_author = 'staff', last_message_at = ?, updated_at = ?, assigned_staff_id = COALESCE(assigned_staff_id, ?) WHERE id = ?`)
        .run(status ?? 'waiting', nowSql(), nowSql(), staff.id, ticketId);
    } else if (status) {
      platformDb.prepare('UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, nowSql(), ticketId);
    }
  })();
  if (!internal) {
    runWithTenant(t.account_id, () => {
      db.prepare('INSERT INTO notifications (type, message, link) VALUES (?, ?, ?)').run('support', `Support replied: ${t.subject}`, `/help/tickets/${t.id}`);
    });
    const u = t.user_id ? (platformDb.prepare('SELECT email FROM users WHERE id = ?').get(t.user_id) as { email: string } | undefined) : undefined;
    if (u) platformMail(u.email, `[#${t.id}] ${t.subject}`, `${body}\n\n—\n${config.appUrl}/help/tickets/${t.id}`).catch(() => undefined);
  }
}
