import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { errorHandler } from './lib/http.js';
import { authRouter, requireAuth, usersRouter } from './routes/auth.js';
import { invoicesRouter, returnsRouter, shipmentsRouter } from './routes/documents.js';
import { integrationsRouter, offersRouter } from './routes/integrations.js';
import { dashboardRouter, miscRouter, publicRouter, rulesRouter, settingsRouter } from './routes/misc.js';
import { ordersRouter } from './routes/orders.js';
import { productsRouter } from './routes/products.js';
import { statusesRouter } from './routes/statuses.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  if (process.env.CORS_ORIGIN) app.use(cors({ origin: process.env.CORS_ORIGIN.split(',') }));
  app.use(express.json({ limit: '12mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/public', publicRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use('/users', usersRouter);
  api.use('/statuses', statusesRouter);
  api.use('/orders', ordersRouter);
  api.use('/products', productsRouter);
  api.use('/integrations', integrationsRouter);
  api.use('/offers', offersRouter);
  api.use('/shipments', shipmentsRouter);
  api.use('/invoices', invoicesRouter);
  api.use('/returns', returnsRouter);
  api.use('/rules', rulesRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/settings', settingsRouter);
  api.use('/', miscRouter);
  app.use('/api', api);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Serve the built frontend (single page app).
  if (fs.existsSync(path.join(config.webDist, 'index.html'))) {
    app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  }

  app.use(errorHandler);
  return app;
}
