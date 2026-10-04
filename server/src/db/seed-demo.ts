/** CLI: `npm run seed` — fills the database with demo data. */
import { config } from '../config.js';
import { initDb } from './index.js';
import { registerSyncListeners } from '../integrations/sync.js';
import { registerAutomation } from '../services/automation.js';
import { seedDemo } from '../services/demo-seed.js';

initDb(config.dbFile);
registerAutomation();
registerSyncListeners();
await seedDemo();
console.log('Demo data created');
setTimeout(() => process.exit(0), 3000);
