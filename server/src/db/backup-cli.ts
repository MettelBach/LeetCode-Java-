/** Usage: BACKUP_DIR=/backups npm --prefix server run backup  (or pass the directory as an argument). */
import { backupAll } from '../services/backup.js';

backupAll(process.argv[2] ?? process.env.BACKUP_DIR)
  .then((r) => console.log(`Backup created: ${r.dir} (${r.tenants} client databases)`))
  .catch((e) => {
    console.error('Backup failed:', e.message);
    process.exit(1);
  });
