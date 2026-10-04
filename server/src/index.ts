import { createApp } from './app.js';
import { config } from './config.js';
import { initDb } from './db/index.js';
import { registerSyncListeners, startScheduler } from './integrations/sync.js';
import { registerAutomation } from './services/automation.js';

if (config.jwtSecret === 'dev-secret-change-me' && process.env.NODE_ENV === 'production') {
  console.error('JWT_SECRET must be set in production');
  process.exit(1);
}

initDb(config.dbFile);
registerAutomation();
registerSyncListeners();
startScheduler();

createApp().listen(config.port, () => {
  console.log(`SellHub API listening on http://localhost:${config.port}`);
});
