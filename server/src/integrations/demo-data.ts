/** Sample catalogue and buyers used by the demo mode and the demo seed. */
export interface DemoProduct {
  sku: string;
  ean: string;
  name: string;
  price: number;
  purchase: number;
  weight: number;
  stock: number;
  category: string;
  manufacturer: string;
  location: string;
  markets: ('allegro' | 'empik' | 'kaufland')[];
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  { sku: 'BT-SPK-001', ean: '5901234123457', name: 'Głośnik Bluetooth Bazooka BT2500', price: 189.99, purchase: 92, weight: 1.2, stock: 34, category: 'Elektronika', manufacturer: 'Blow', location: 'A-01-1', markets: ['allegro', 'kaufland'] },
  { sku: 'HDPH-ANC-02', ean: '5901234123464', name: 'Słuchawki bezprzewodowe ANC Pro 2', price: 249.0, purchase: 120, weight: 0.4, stock: 21, category: 'Elektronika', manufacturer: 'Soundix', location: 'A-01-2', markets: ['allegro', 'empik', 'kaufland'] },
  { sku: 'PWB-20K', ean: '5901234123471', name: 'Powerbank 20000 mAh USB-C PD 22,5W', price: 99.99, purchase: 45, weight: 0.45, stock: 58, category: 'Elektronika', manufacturer: 'Voltix', location: 'A-02-1', markets: ['allegro', 'kaufland'] },
  { sku: 'KBL-USBC-2M', ean: '5901234123488', name: 'Kabel USB-C – USB-C 2 m 100W', price: 29.99, purchase: 8, weight: 0.08, stock: 240, category: 'Elektronika', manufacturer: 'Voltix', location: 'A-02-2', markets: ['allegro', 'empik', 'kaufland'] },
  { sku: 'WATCH-SMT-5', ean: '5901234123495', name: 'Smartwatch FitPro 5 AMOLED czarny', price: 329.0, purchase: 170, weight: 0.15, stock: 12, category: 'Elektronika', manufacturer: 'FitPro', location: 'A-03-1', markets: ['allegro', 'empik'] },
  { sku: 'BOOK-WIEDZ-01', ean: '9788328712345', name: 'Wiedźmin. Ostatnie życzenie — Andrzej Sapkowski', price: 44.9, purchase: 27, weight: 0.4, stock: 45, category: 'Książki', manufacturer: 'SuperNowa', location: 'B-01-1', markets: ['empik', 'allegro'] },
  { sku: 'BOOK-LALKA-02', ean: '9788373271234', name: 'Lalka — Bolesław Prus (wydanie ilustrowane)', price: 59.9, purchase: 31, weight: 0.9, stock: 18, category: 'Książki', manufacturer: 'Greg', location: 'B-01-2', markets: ['empik'] },
  { sku: 'GAME-PUZ-1000', ean: '5904438012345', name: 'Puzzle 1000 elementów — Kraków nocą', price: 39.99, purchase: 18, weight: 0.7, stock: 30, category: 'Zabawki i gry', manufacturer: 'Trefl', location: 'B-02-1', markets: ['empik', 'kaufland', 'allegro'] },
  { sku: 'GAME-PLANSZ-07', ean: '5904438054321', name: 'Gra planszowa Osadnicy — edycja rodzinna', price: 149.0, purchase: 85, weight: 1.5, stock: 9, category: 'Zabawki i gry', manufacturer: 'Galakta', location: 'B-02-2', markets: ['empik', 'allegro'] },
  { sku: 'KUCH-PAT-28', ean: '5907671012345', name: 'Patelnia granitowa 28 cm indukcja', price: 119.0, purchase: 52, weight: 1.1, stock: 26, category: 'Dom i ogród', manufacturer: 'Ambition', location: 'C-01-1', markets: ['kaufland', 'allegro'] },
  { sku: 'KUCH-NOZE-6', ean: '5907671054321', name: 'Zestaw noży kuchennych 6 el. z blokiem', price: 159.99, purchase: 70, weight: 2.3, stock: 14, category: 'Dom i ogród', manufacturer: 'Gerlach', location: 'C-01-2', markets: ['kaufland', 'allegro'] },
  { sku: 'OGR-WAZ-30', ean: '5907671098765', name: 'Wąż ogrodowy 30 m z zraszaczem', price: 89.0, purchase: 38, weight: 3.4, stock: 22, category: 'Dom i ogród', manufacturer: 'Cellfast', location: 'C-02-1', markets: ['kaufland'] },
  { sku: 'LAMP-LED-DESK', ean: '5907671011111', name: 'Lampka biurkowa LED z ładowarką Qi', price: 134.0, purchase: 61, weight: 0.9, stock: 17, category: 'Dom i ogród', manufacturer: 'Lumio', location: 'C-02-2', markets: ['allegro', 'kaufland', 'empik'] },
  { sku: 'KAWA-ZIAR-1KG', ean: '5900000123456', name: 'Kawa ziarnista 100% Arabica 1 kg', price: 69.99, purchase: 39, weight: 1.05, stock: 80, category: 'Spożywcze', manufacturer: 'Palarnia Mokotów', location: 'D-01-1', markets: ['allegro', 'kaufland'] },
  { sku: 'PLECAK-CITY-25', ean: '5901111222333', name: 'Plecak miejski 25 l wodoodporny szary', price: 139.0, purchase: 58, weight: 0.8, stock: 0, category: 'Moda', manufacturer: 'Urbano', location: 'D-02-1', markets: ['allegro', 'empik', 'kaufland'] },
];

export const DEMO_FIRST = ['Anna', 'Piotr', 'Katarzyna', 'Tomasz', 'Magdalena', 'Michał', 'Agnieszka', 'Paweł', 'Joanna', 'Krzysztof', 'Ewa', 'Marcin', 'Aleksandra', 'Jakub', 'Natalia', 'Łukasz'];
export const DEMO_LAST = ['Nowak', 'Kowalski', 'Wiśniewska', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowska', 'Zieliński', 'Szymańska', 'Woźniak', 'Dąbrowski', 'Kozłowska', 'Jankowski', 'Mazur', 'Krawczyk'];
export const DEMO_CITIES: [string, string, string][] = [
  ['Warszawa', '00-001', 'ul. Marszałkowska'],
  ['Kraków', '30-001', 'ul. Długa'],
  ['Wrocław', '50-001', 'ul. Świdnicka'],
  ['Poznań', '60-001', 'ul. Półwiejska'],
  ['Gdańsk', '80-001', 'ul. Grunwaldzka'],
  ['Łódź', '90-001', 'ul. Piotrkowska'],
  ['Lublin', '20-001', 'ul. Lipowa'],
  ['Katowice', '40-001', 'ul. Mariacka'],
  ['Szczecin', '70-001', 'al. Wojska Polskiego'],
  ['Białystok', '15-001', 'ul. Lipowa'],
];

export const DEMO_DELIVERY: Record<string, { name: string; price: number; point?: boolean; cod?: boolean }[]> = {
  allegro: [
    { name: 'Allegro Paczkomaty InPost', price: 9.99, point: true },
    { name: 'Allegro Kurier DPD', price: 14.99 },
    { name: 'Allegro One Box, DPD', price: 7.99, point: true },
    { name: 'Allegro Kurier DPD pobranie', price: 19.99, cod: true },
    { name: 'Allegro Odbiór w Punkcie ORLEN Paczka', price: 7.49, point: true },
  ],
  empik: [
    { name: 'Paczkomaty InPost', price: 9.99, point: true },
    { name: 'Kurier DPD', price: 12.99 },
    { name: 'Odbiór w salonie Empik', price: 0, point: true },
  ],
  kaufland: [
    { name: 'Standard (DHL)', price: 11.99 },
    { name: 'Standard (InPost Kurier)', price: 12.99 },
  ],
};

export function rnd<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function rndInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
