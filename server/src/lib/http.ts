import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what);
export const badRequest = (msg: string) => new HttpError(400, msg);

export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}

export function idParam(req: Request, name = 'id'): number {
  const v = Number(req.params[name]);
  if (!Number.isInteger(v) || v <= 0) throw badRequest(`Invalid ${name}`);
  return v;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err && typeof err === 'object' && 'type' in err && (err as any).type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  // A reference to a missing record or a duplicate that a route did not check explicitly.
  const code = (err as any)?.code;
  if (code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    res.status(400).json({ error: 'The referenced record does not exist or is still in use' });
    return;
  }
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    res.status(409).json({ error: 'A record with this value already exists' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

/** Helpers to coerce query string values. */
export const q = {
  str: (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined),
  int: (v: unknown) => {
    if (typeof v !== 'string' || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : undefined;
  },
  num: (v: unknown) => {
    if (typeof v !== 'string' || v === '') return undefined;
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : undefined;
  },
  ints: (v: unknown) => {
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
    return arr.map((x) => Number(x)).filter((n) => Number.isInteger(n));
  },
  strs: (v: unknown) => {
    const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  },
};

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

/** LIKE argument "contains s": % and _ typed by the user are matched literally (use with ESCAPE '!'). */
export const likeContains = (s: string) => `%${s.replace(/[!%_]/g, (m) => '!' + m)}%`;
