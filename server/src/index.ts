import { createApp } from './app.js';
import { config } from './config.js';
import { initPlatform } from './db/index.js';
import { registerSyncListeners, startScheduler } from './integrations/sync.js';
import { registerAutomation } from './services/automation.js';
import { ensureBootstrapAdmin } from './services/platform.js';

if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET ?? '').length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters in production');
  process.exit(1);
}

if (process.env.NODE_ENV === 'production' && (process.env.SECRETS_KEY ?? '').length < 32) {
  console.error('SECRETS_KEY must be set to a random string of at least 32 characters in production (openssl rand -hex 32) and never changed');
  process.exit(1);
}

initPlatform(config.dataDir);
try {
  ensureBootstrapAdmin();
} catch (e: any) {
  console.error(e.message);
  process.exit(1);
}
registerAutomation();
registerSyncListeners();
startScheduler();

createApp().listen(config.port, () => {
  console.log(`SellHub listening on http://localhost:${config.port}`);
});
