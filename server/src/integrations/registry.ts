/**
 * Catalog of integrations shown on "Integracje → Dodaj integrację" (like
 * BaseLinker): marketplaces, online shops, couriers, invoicing, payments,
 * comparison sites. Available ones have a connector; the rest are listed as
 * "coming soon" so sellers can see what is planned.
 */
export type IntegrationCategory = 'marketplace' | 'shop' | 'courier' | 'invoicing' | 'payment' | 'comparison' | 'other';
export type Capability = 'orders' | 'offers' | 'stock' | 'price' | 'listing' | 'tracking' | 'statuses' | 'messages' | 'labels' | 'invoices';

export interface CredentialField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  help?: string;
}

export interface IntegrationDescriptor {
  type: string;
  name: string;
  category: IntegrationCategory;
  countries: string[];
  description: string;
  status: 'available' | 'beta' | 'coming_soon';
  /** How the account is connected. */
  auth: 'oauth_device' | 'oauth_code' | 'api_key' | 'hmac' | 'none';
  fields: CredentialField[];
  capabilities: Capability[];
  /** Where the seller gets the API credentials. */
  docs_url?: string;
}

export const INTEGRATIONS: IntegrationDescriptor[] = [
  /* ---------------------------------- marketplaces ---------------------------------- */
  {
    type: 'allegro',
    name: 'Allegro',
    category: 'marketplace',
    countries: ['PL', 'CZ', 'SK'],
    description: 'The largest marketplace in Poland. Orders, offers, stock and prices, statuses and tracking numbers (Allegro REST API, OAuth).',
    status: 'available',
    auth: 'oauth_device',
    fields: [
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', secret: true },
    ],
    capabilities: ['orders', 'offers', 'stock', 'price', 'listing', 'statuses', 'tracking'],
    docs_url: 'https://apps.developer.allegro.pl/',
  },
  {
    type: 'empik',
    name: 'Empik',
    category: 'marketplace',
    countries: ['PL'],
    description: 'Empik Marketplace (Mirakl). Orders with automatic acceptance, offers, stock and prices, tracking numbers.',
    status: 'available',
    auth: 'api_key',
    fields: [
      { key: 'api_key', label: 'API key', secret: true },
      { key: 'base_url', label: 'API address', placeholder: 'https://marketplace.empik.com', help: 'Leave empty for the production Empik address' },
    ],
    capabilities: ['orders', 'offers', 'stock', 'price', 'listing', 'statuses', 'tracking'],
    docs_url: 'https://marketplace.empik.com/',
  },
  {
    type: 'kaufland',
    name: 'Kaufland',
    category: 'marketplace',
    countries: ['PL', 'DE', 'CZ', 'SK'],
    description: 'Kaufland Marketplace (Seller API v2). Orders, offers, stock and prices, shipping confirmation with a tracking number.',
    status: 'available',
    auth: 'hmac',
    fields: [
      { key: 'client_key', label: 'Client Key' },
      { key: 'secret_key', label: 'Secret Key', secret: true },
      { key: 'storefront', label: 'Storefront', placeholder: 'pl', help: 'pl, de, cz or sk' },
    ],
    capabilities: ['orders', 'offers', 'stock', 'price', 'listing', 'statuses', 'tracking'],
    docs_url: 'https://sellerapi.kaufland.com/',
  },
  {
    type: 'olx',
    name: 'OLX',
    category: 'marketplace',
    countries: ['PL'],
    description: 'OLX.pl adverts (Partner API v2): download adverts, link them with products, change prices, deactivate when out of stock and activate again, publish new adverts.',
    status: 'beta',
    auth: 'oauth_code',
    fields: [
      { key: 'client_id', label: 'Client ID' },
      { key: 'client_secret', label: 'Client Secret', secret: true },
    ],
    capabilities: ['offers', 'stock', 'price', 'listing'],
    docs_url: 'https://developer.olx.pl/',
  },
  ...(
    [
      ['amazon', 'Amazon', ['PL', 'DE', 'FR', 'IT', 'ES', 'NL', 'SE']],
      ['ebay', 'eBay', ['PL', 'DE', 'GB', 'US']],
      ['erli', 'Erli', ['PL']],
      ['temu', 'Temu', ['PL']],
      ['allegro_lokalnie', 'Allegro Lokalnie', ['PL']],
      ['emag', 'eMAG', ['RO', 'HU', 'BG']],
      ['zalando', 'Zalando', ['PL', 'DE']],
      ['aliexpress', 'AliExpress', ['PL']],
      ['vinted', 'Vinted', ['PL']],
    ] as const
  ).map(
    ([type, name, countries]): IntegrationDescriptor => ({
      type,
      name,
      category: 'marketplace',
      countries: [...countries],
      description: 'Orders, offers, stock and prices.',
      status: 'coming_soon',
      auth: 'none',
      fields: [],
      capabilities: ['orders', 'offers', 'stock', 'price'],
    }),
  ),
  /* ---------------------------------- online shops ---------------------------------- */
  ...(
    [
      ['woocommerce', 'WooCommerce'],
      ['prestashop', 'PrestaShop'],
      ['shoper', 'Shoper'],
      ['shopify', 'Shopify'],
      ['idosell', 'IdoSell'],
      ['magento', 'Magento'],
      ['sky_shop', 'Sky-Shop'],
    ] as const
  ).map(
    ([type, name]): IntegrationDescriptor => ({
      type,
      name,
      category: 'shop',
      countries: ['PL'],
      description: 'Orders from your online shop, stock and prices sent from the inventory.',
      status: 'coming_soon',
      auth: 'api_key',
      fields: [],
      capabilities: ['orders', 'stock', 'price', 'statuses'],
    }),
  ),
  /* ------------------------------------ couriers ------------------------------------ */
  ...(
    [
      ['inpost', 'InPost (ShipX)', 'Parcel lockers and courier, labels and tracking'],
      ['allegro_delivery', 'Wysyłam z Allegro', 'Allegro Delivery labels for Allegro orders'],
      ['dpd', 'DPD Polska', 'Courier shipments, labels, pickup orders'],
      ['dhl', 'DHL Parcel', 'Courier shipments and labels'],
      ['gls', 'GLS', 'Courier shipments and labels'],
      ['pocztex', 'Poczta Polska / Pocztex', 'e-Nadawca: parcels and labels'],
      ['orlen', 'ORLEN Paczka', 'Pick-up points and labels'],
      ['ups', 'UPS', 'Domestic and international shipments'],
      ['fedex', 'FedEx', 'International shipments'],
    ] as const
  ).map(
    ([type, name, description]): IntegrationDescriptor => ({
      type,
      name,
      category: 'courier',
      countries: ['PL'],
      description,
      status: 'coming_soon',
      auth: 'api_key',
      fields: [],
      capabilities: ['labels', 'tracking'],
    }),
  ),
  /* ----------------------------------- invoicing ----------------------------------- */
  ...(
    [
      ['ksef', 'KSeF (Krajowy System e-Faktur)', 'Sending invoices to KSeF and downloading KSeF numbers'],
      ['fakturownia', 'Fakturownia', 'Invoices issued in Fakturownia'],
      ['infakt', 'inFakt', 'Invoices issued in inFakt'],
      ['wfirma', 'wFirma', 'Invoices and accounting in wFirma'],
      ['ifirma', 'iFirma', 'Invoices and accounting in iFirma'],
    ] as const
  ).map(
    ([type, name, description]): IntegrationDescriptor => ({
      type,
      name,
      category: 'invoicing',
      countries: ['PL'],
      description,
      status: 'coming_soon',
      auth: 'api_key',
      fields: [],
      capabilities: ['invoices'],
    }),
  ),
  /* ------------------------------------ payments ------------------------------------ */
  ...(
    [
      ['przelewy24', 'Przelewy24'],
      ['payu', 'PayU'],
      ['tpay', 'Tpay'],
    ] as const
  ).map(
    ([type, name]): IntegrationDescriptor => ({
      type,
      name,
      category: 'payment',
      countries: ['PL'],
      description: 'Payment status of orders paid online.',
      status: 'coming_soon',
      auth: 'api_key',
      fields: [],
      capabilities: [],
    }),
  ),
  /* --------------------------------- comparison sites --------------------------------- */
  ...(
    [
      ['ceneo', 'Ceneo'],
      ['google_merchant', 'Google Merchant Center'],
    ] as const
  ).map(
    ([type, name]): IntegrationDescriptor => ({
      type,
      name,
      category: 'comparison',
      countries: ['PL'],
      description: 'Product feed (XML) generated from the inventory.',
      status: 'coming_soon',
      auth: 'none',
      fields: [],
      capabilities: [],
    }),
  ),
];

export const descriptor = (type: string) => INTEGRATIONS.find((d) => d.type === type);

/** Types that can be connected now (have a connector). */
export const CONNECTABLE = INTEGRATIONS.filter((d) => d.status !== 'coming_soon').map((d) => d.type);
