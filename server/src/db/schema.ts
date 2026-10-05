/**
 * Database schema. Migrations are an ordered list; each entry runs once and
 * is recorded in the `migrations` table.
 */
export const migrations: string[] = [
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE status_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE order_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    short_name TEXT NOT NULL DEFAULT '',
    full_name TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#0f74d4',
    group_id INTEGER REFERENCES status_groups(id) ON DELETE SET NULL,
    sort INTEGER NOT NULL DEFAULT 0,
    system_key TEXT UNIQUE
  );

  CREATE TABLE integrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('allegro','empik','kaufland')),
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    demo INTEGER NOT NULL DEFAULT 0,
    credentials TEXT NOT NULL DEFAULT '{}',
    settings TEXT NOT NULL DEFAULT '{}',
    state TEXT NOT NULL DEFAULT '{}',
    last_sync_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER REFERENCES integrations(id) ON DELETE CASCADE,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES categories(id) ON DELETE SET NULL
  );

  CREATE TABLE manufacturers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL
  );

  CREATE TABLE warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    code TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE catalogs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    catalog_id INTEGER REFERENCES catalogs(id) ON DELETE CASCADE,
    sku TEXT NOT NULL DEFAULT '',
    ean TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    purchase_price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 23,
    weight REAL NOT NULL DEFAULT 0,
    width REAL NOT NULL DEFAULT 0,
    height REAL NOT NULL DEFAULT 0,
    length REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    manufacturer_id INTEGER REFERENCES manufacturers(id) ON DELETE SET NULL,
    images TEXT NOT NULL DEFAULT '[]',
    attributes TEXT NOT NULL DEFAULT '{}',
    variant_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_products_sku ON products(sku);
  CREATE INDEX idx_products_ean ON products(ean);
  CREATE INDEX idx_products_catalog ON products(catalog_id);

  CREATE TABLE product_stock (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    stock INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (product_id, warehouse_id)
  );

  CREATE TABLE warehouse_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('PZ','PW','WZ','RW','MM')),
    number TEXT NOT NULL,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    target_warehouse_id INTEGER REFERENCES warehouses(id),
    status TEXT NOT NULL DEFAULT 'draft',
    contractor TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT
  );

  CREATE TABLE warehouse_doc_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES warehouse_docs(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0
  );

  CREATE TABLE stock_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change INTEGER NOT NULL,
    stock_after INTEGER NOT NULL,
    reason TEXT NOT NULL,
    order_id INTEGER,
    warehouse_id INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    integration_id INTEGER REFERENCES integrations(id) ON DELETE SET NULL,
    status_id INTEGER NOT NULL REFERENCES order_statuses(id),
    warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL,
    status_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    date_add TEXT NOT NULL DEFAULT (datetime('now')),
    user_login TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'PLN',
    payment_method TEXT NOT NULL DEFAULT '',
    payment_cod INTEGER NOT NULL DEFAULT 0,
    paid_amount REAL NOT NULL DEFAULT 0,
    payment_date TEXT,
    delivery_method TEXT NOT NULL DEFAULT '',
    delivery_price REAL NOT NULL DEFAULT 0,
    delivery_fullname TEXT NOT NULL DEFAULT '',
    delivery_company TEXT NOT NULL DEFAULT '',
    delivery_address TEXT NOT NULL DEFAULT '',
    delivery_postcode TEXT NOT NULL DEFAULT '',
    delivery_city TEXT NOT NULL DEFAULT '',
    delivery_country_code TEXT NOT NULL DEFAULT 'PL',
    delivery_point_id TEXT NOT NULL DEFAULT '',
    delivery_point_name TEXT NOT NULL DEFAULT '',
    delivery_point_address TEXT NOT NULL DEFAULT '',
    delivery_point_postcode TEXT NOT NULL DEFAULT '',
    delivery_point_city TEXT NOT NULL DEFAULT '',
    invoice_wanted INTEGER NOT NULL DEFAULT 0,
    invoice_fullname TEXT NOT NULL DEFAULT '',
    invoice_company TEXT NOT NULL DEFAULT '',
    invoice_nip TEXT NOT NULL DEFAULT '',
    invoice_address TEXT NOT NULL DEFAULT '',
    invoice_postcode TEXT NOT NULL DEFAULT '',
    invoice_city TEXT NOT NULL DEFAULT '',
    invoice_country_code TEXT NOT NULL DEFAULT 'PL',
    buyer_comment TEXT NOT NULL DEFAULT '',
    seller_comment TEXT NOT NULL DEFAULT '',
    extra_field_1 TEXT NOT NULL DEFAULT '',
    extra_field_2 TEXT NOT NULL DEFAULT '',
    star INTEGER NOT NULL DEFAULT 0,
    flag TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    deleted INTEGER NOT NULL DEFAULT 0,
    stock_deducted INTEGER NOT NULL DEFAULT 0,
    external_status TEXT NOT NULL DEFAULT '',
    external_data TEXT NOT NULL DEFAULT '{}',
    token TEXT NOT NULL DEFAULT (lower(hex(randomblob(12)))),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX idx_orders_external ON orders(integration_id, external_id);
  CREATE INDEX idx_orders_status ON orders(status_id);
  CREATE INDEX idx_orders_date ON orders(date_add);

  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    ean TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    tax_rate REAL NOT NULL DEFAULT 23,
    weight REAL NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    attributes TEXT NOT NULL DEFAULT '',
    auction_id TEXT NOT NULL DEFAULT '',
    external_line_id TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_items_order ON order_items(order_id);

  CREATE TABLE order_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    user_name TEXT NOT NULL DEFAULT 'System',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_history_order ON order_history(order_id);

  CREATE TABLE offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    integration_id INTEGER NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    ean TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PLN',
    stock INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    url TEXT NOT NULL DEFAULT '',
    image TEXT NOT NULL DEFAULT '',
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    sync_stock INTEGER NOT NULL DEFAULT 1,
    sync_price INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT '',
    last_synced_at TEXT,
    raw TEXT NOT NULL DEFAULT '{}',
    UNIQUE (integration_id, external_id)
  );

  CREATE TABLE invoice_series (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('invoice','proforma','receipt','correction')),
    format TEXT NOT NULL DEFAULT '%N/%M/%Y',
    reset_period TEXT NOT NULL DEFAULT 'month',
    is_default INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    series_id INTEGER REFERENCES invoice_series(id),
    type TEXT NOT NULL,
    number TEXT NOT NULL,
    seq INTEGER NOT NULL,
    period TEXT NOT NULL,
    issue_date TEXT NOT NULL,
    sale_date TEXT NOT NULL,
    payment_due TEXT,
    payment_method TEXT NOT NULL DEFAULT '',
    paid INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PLN',
    buyer TEXT NOT NULL DEFAULT '{}',
    seller TEXT NOT NULL DEFAULT '{}',
    items TEXT NOT NULL DEFAULT '[]',
    total_net REAL NOT NULL DEFAULT 0,
    total_tax REAL NOT NULL DEFAULT 0,
    total_gross REAL NOT NULL DEFAULT 0,
    corrected_invoice_id INTEGER REFERENCES invoices(id),
    correction_reason TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_invoices_order ON invoices(order_id);

  CREATE TABLE shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    courier TEXT NOT NULL,
    account_name TEXT NOT NULL DEFAULT '',
    service TEXT NOT NULL DEFAULT '',
    tracking_number TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'created',
    weight REAL NOT NULL DEFAULT 0,
    size TEXT NOT NULL DEFAULT '',
    cod_amount REAL NOT NULL DEFAULT 0,
    insurance REAL NOT NULL DEFAULT 0,
    sent_to_source INTEGER NOT NULL DEFAULT 0,
    sent_to_source_at TEXT,
    label_printed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status_date TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_shipments_order ON shipments(order_id);

  CREATE TABLE return_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#0f74d4',
    sort INTEGER NOT NULL DEFAULT 0,
    system_key TEXT UNIQUE
  );

  CREATE TABLE returns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    status_id INTEGER NOT NULL REFERENCES return_statuses(id),
    source TEXT NOT NULL DEFAULT 'manual',
    external_id TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    refund_amount REAL NOT NULL DEFAULT 0,
    refunded INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PLN',
    buyer_name TEXT NOT NULL DEFAULT '',
    buyer_email TEXT NOT NULL DEFAULT '',
    bank_account TEXT NOT NULL DEFAULT '',
    tracking_number TEXT NOT NULL DEFAULT '',
    stock_returned INTEGER NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE email_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL
  );

  CREATE TABLE rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    event TEXT NOT NULL,
    conditions TEXT NOT NULL DEFAULT '[]',
    actions TEXT NOT NULL DEFAULT '[]',
    sort INTEGER NOT NULL DEFAULT 0,
    run_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE rule_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id INTEGER REFERENCES rules(id) ON DELETE CASCADE,
    order_id INTEGER,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    link TEXT NOT NULL DEFAULT '',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE email_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER,
    to_address TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  // 1: inventory like BaseLinker — price groups, catalog settings, texts per language/channel,
  // bundles, tags, extra fields, product log, reservations, stocktaking.
  `
  UPDATE products SET catalog_id = (SELECT id FROM catalogs ORDER BY is_default DESC, id LIMIT 1) WHERE catalog_id IS NULL;
  UPDATE products SET catalog_id = (SELECT p.catalog_id FROM products p WHERE p.id = products.parent_id) WHERE parent_id IS NOT NULL;
  UPDATE products SET sku = sku || '-DUP' || id
    WHERE sku != '' AND id NOT IN (SELECT MIN(id) FROM products WHERE sku != '' GROUP BY catalog_id, sku);
  CREATE UNIQUE INDEX ux_products_catalog_sku ON products(catalog_id, sku) WHERE sku != '';
  INSERT OR IGNORE INTO product_stock (product_id, warehouse_id, stock)
    SELECT p.id, (SELECT id FROM warehouses ORDER BY is_default DESC, id LIMIT 1), p.stock FROM products p
    WHERE p.stock != 0 AND NOT EXISTS (SELECT 1 FROM product_stock s WHERE s.product_id = p.id);
  UPDATE products SET stock = COALESCE((SELECT SUM(stock) FROM product_stock s WHERE s.product_id = products.id), 0);

  CREATE TABLE price_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'PLN',
    is_default INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO price_groups (name, description, is_default) VALUES ('Detaliczna', 'Cena podstawowa', 1);
  CREATE TABLE product_prices (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    price_group_id INTEGER NOT NULL REFERENCES price_groups(id) ON DELETE CASCADE,
    price REAL NOT NULL,
    PRIMARY KEY (product_id, price_group_id)
  );
  INSERT INTO product_prices (product_id, price_group_id, price) SELECT id, (SELECT id FROM price_groups LIMIT 1), price FROM products;

  ALTER TABLE catalogs ADD COLUMN languages TEXT NOT NULL DEFAULT '["pl"]';
  ALTER TABLE catalogs ADD COLUMN default_language TEXT NOT NULL DEFAULT 'pl';
  ALTER TABLE catalogs ADD COLUMN default_price_group_id INTEGER REFERENCES price_groups(id) ON DELETE SET NULL;
  ALTER TABLE catalogs ADD COLUMN default_warehouse_id INTEGER REFERENCES warehouses(id) ON DELETE SET NULL;
  CREATE TABLE catalog_price_groups (
    catalog_id INTEGER NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
    price_group_id INTEGER NOT NULL REFERENCES price_groups(id) ON DELETE CASCADE,
    PRIMARY KEY (catalog_id, price_group_id)
  );
  CREATE TABLE catalog_warehouses (
    catalog_id INTEGER NOT NULL REFERENCES catalogs(id) ON DELETE CASCADE,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    PRIMARY KEY (catalog_id, warehouse_id)
  );
  INSERT INTO catalog_price_groups SELECT c.id, g.id FROM catalogs c, price_groups g;
  INSERT INTO catalog_warehouses SELECT c.id, w.id FROM catalogs c, warehouses w;
  UPDATE catalogs SET default_price_group_id = (SELECT id FROM price_groups LIMIT 1),
    default_warehouse_id = (SELECT id FROM warehouses ORDER BY is_default DESC, id LIMIT 1);

  ALTER TABLE warehouses ADD COLUMN type TEXT NOT NULL DEFAULT 'own';
  ALTER TABLE warehouses ADD COLUMN allow_negative INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE product_stock ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN avg_cost REAL NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN is_bundle INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN min_stock INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE products ADD COLUMN features TEXT NOT NULL DEFAULT '[]';
  UPDATE products SET avg_cost = purchase_price;
  ALTER TABLE categories ADD COLUMN catalog_id INTEGER REFERENCES catalogs(id) ON DELETE CASCADE;
  ALTER TABLE categories ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;
  UPDATE categories SET catalog_id = (SELECT id FROM catalogs ORDER BY is_default DESC, id LIMIT 1);
  ALTER TABLE orders ADD COLUMN stock_reserved INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE product_texts (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    lang TEXT NOT NULL,
    integration_id INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (product_id, lang, integration_id)
  );
  CREATE TABLE bundle_items (
    bundle_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (bundle_id, product_id)
  );
  CREATE TABLE extra_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'text',
    options TEXT NOT NULL DEFAULT '[]',
    sort INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE product_extra_values (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    field_id INTEGER NOT NULL REFERENCES extra_fields(id) ON DELETE CASCADE,
    value TEXT NOT NULL,
    PRIMARY KEY (product_id, field_id)
  );
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#1271d3'
  );
  CREATE TABLE product_tags (
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (product_id, tag_id)
  );
  CREATE TABLE product_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    user_name TEXT NOT NULL DEFAULT 'System',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_product_log ON product_log(product_id);
  ALTER TABLE stock_history ADD COLUMN doc_id INTEGER;
  ALTER TABLE stock_history ADD COLUMN user_name TEXT NOT NULL DEFAULT '';
  CREATE TABLE stocktakes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    catalog_id INTEGER REFERENCES catalogs(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','canceled')),
    category_id INTEGER,
    doc_id INTEGER,
    user_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    closed_at TEXT
  );
  CREATE TABLE stocktake_items (
    stocktake_id INTEGER NOT NULL REFERENCES stocktakes(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    expected INTEGER NOT NULL,
    counted INTEGER,
    PRIMARY KEY (stocktake_id, product_id)
  );
  `,
  // 2: warehouse documents with more types, cancellation, numbering on confirm and line snapshots.
  `-- nofk
  CREATE TABLE warehouse_docs_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK (type IN ('PZ','PW','WZ','RW','MM','ZW','BO','INW')),
    number TEXT NOT NULL DEFAULT '',
    seq INTEGER,
    period TEXT,
    doc_date TEXT NOT NULL DEFAULT (date('now')),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    target_warehouse_id INTEGER REFERENCES warehouses(id),
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','canceled')),
    contractor TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    order_id INTEGER,
    reverses_doc_id INTEGER,
    user_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT,
    UNIQUE (type, period, seq)
  );
  INSERT INTO warehouse_docs_new (id, type, number, doc_date, warehouse_id, target_warehouse_id, status, contractor, notes, user_name, created_at, confirmed_at)
    SELECT id, type, number, date(created_at), warehouse_id, target_warehouse_id, CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'draft' END,
      contractor, notes, user_name, created_at, confirmed_at FROM warehouse_docs;
  UPDATE warehouse_docs_new SET number = '' WHERE status = 'draft';
  -- Numbers like "PZ 3/10/2026" → seq 3, period 10/2026 (first occurrence only, older versions could duplicate numbers).
  UPDATE warehouse_docs_new SET
    seq = CAST(substr(number, instr(number, ' ') + 1, instr(number, '/') - instr(number, ' ') - 1) AS INTEGER),
    period = substr(number, instr(number, '/') + 1)
  WHERE number LIKE '% %/%' AND id IN (SELECT MIN(id) FROM warehouse_docs_new WHERE number != '' GROUP BY type, number);
  CREATE TABLE warehouse_doc_items_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES warehouse_docs_new(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
    name TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL DEFAULT '',
    ean TEXT NOT NULL DEFAULT '',
    quantity INTEGER NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    stock_before INTEGER
  );
  INSERT INTO warehouse_doc_items_new (id, doc_id, product_id, name, sku, ean, quantity, price)
    SELECT i.id, i.doc_id, i.product_id, COALESCE(p.name, ''), COALESCE(p.sku, ''), COALESCE(p.ean, ''), i.quantity, i.price
    FROM warehouse_doc_items i LEFT JOIN products p ON p.id = i.product_id;
  DROP TABLE warehouse_doc_items;
  DROP TABLE warehouse_docs;
  ALTER TABLE warehouse_docs_new RENAME TO warehouse_docs;
  ALTER TABLE warehouse_doc_items_new RENAME TO warehouse_doc_items;
  CREATE INDEX idx_doc_items_doc ON warehouse_doc_items(doc_id);
  CREATE INDEX idx_doc_items_product ON warehouse_doc_items(product_id);
  `,
];
