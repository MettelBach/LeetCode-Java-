import { createApp } from './app.js';
import { config } from './config.js';
import { initPlatform } from './db/index.js';
import { registerSyncListeners, startScheduler } from './integrations/sync.js';
import { registerAutomation } from './services/automation.js';
import { ensureBootstrapAdmin } from './services/platform.js';

if (process.env.NODE_ENV === 'production' && (config.jwtSecret === 'dev-secret-change-me' || config.jwtSecret.length < 32)) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters in production');
  process.exit(1);
}

initPlatform(config.dataDir);
ensureBootstrapAdmin();
registerAutomation();
registerSyncListeners();
startScheduler();

createApp().listen(config.port, () => {
  console.log(`SellHub listening on http://localhost:${config.port}`);
});
