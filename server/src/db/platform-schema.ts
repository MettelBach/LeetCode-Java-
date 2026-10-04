/** Schema of the platform database (accounts, users, support, billing). */
export const platformMigrations: string[] = [
  `
  CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nip TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    plan TEXT NOT NULL DEFAULT 'trial',
    status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended','closed')),
    trial_ends_at TEXT,
    paid_until TEXT,
    language TEXT NOT NULL DEFAULT 'pl',
    settings TEXT NOT NULL DEFAULT '{}',
    stats TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    last_activity_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('owner','admin','user')),
    language TEXT NOT NULL DEFAULT 'pl',
    active INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_users_account ON users(account_id);

  CREATE TABLE staff (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'support' CHECK (role IN ('superadmin','support')),
    active INTEGER NOT NULL DEFAULT 1,
    token_version INTEGER NOT NULL DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    subject TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'other',
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','open','waiting','resolved','closed')),
    assigned_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    last_author TEXT NOT NULL DEFAULT 'user',
    last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_tickets_account ON tickets(account_id);
  CREATE INDEX idx_tickets_status ON tickets(status);

  CREATE TABLE ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_type TEXT NOT NULL CHECK (author_type IN ('user','staff','system')),
    author_id INTEGER,
    author_name TEXT NOT NULL,
    body TEXT NOT NULL,
    internal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_ticket_messages ON ticket_messages(ticket_id);

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE billing (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    item TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (account_id, date, item)
  );
  `,
  // Marketing attribution captured at sign-up (UTM, gclid, fbclid...).
  `ALTER TABLE accounts ADD COLUMN attribution TEXT NOT NULL DEFAULT '{}';`,
];
