/**
 * CLI: creates a demo client account.
 *   npm run seed -- demo@example.com "<password>" "Demo Sklep"
 * Without a password a random one is generated and printed once.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { registerSyncListeners } from '../integrations/sync.js';
import { registerAutomation } from '../services/automation.js';
import { seedDemo } from '../services/demo-seed.js';
import { createAccount } from '../services/platform.js';
import { initPlatform, runWithTenant } from './index.js';

const [email = 'demo@sellhub.local', password = crypto.randomBytes(9).toString('base64url'), company = 'Demo Sklep'] = process.argv.slice(2);
initPlatform(config.dataDir);
registerAutomation();
registerSyncListeners();
const { accountId } = createAccount({ company, name: 'Demo', email, password });
await runWithTenant(accountId, () => seedDemo());
console.log(`Demo account ${accountId} created: ${email} / ${password}`);
setTimeout(() => process.exit(0), 2000);
