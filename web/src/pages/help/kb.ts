/** Knowledge base articles of the help center ("Pomoc i kontakt"). */
type L = { pl: string; en: string; ru: string };

export interface Article {
  slug: string;
  category: 'start' | 'orders' | 'products' | 'integrations' | 'shipping' | 'invoices' | 'automation' | 'account';
  title: L;
  body: L;
}

export const KB_CATEGORIES: Record<Article['category'], L> = {
  start: { pl: 'Pierwsze kroki', en: 'Getting started', ru: 'Первые шаги' },
  orders: { pl: 'Zamówienia', en: 'Orders', ru: 'Заказы' },
  products: { pl: 'Magazyn i produkty', en: 'Inventory and products', ru: 'Склад и товары' },
  integrations: { pl: 'Integracje', en: 'Integrations', ru: 'Интеграции' },
  shipping: { pl: 'Wysyłki', en: 'Shipping', ru: 'Отправки' },
  invoices: { pl: 'Faktury i paragony', en: 'Invoices and receipts', ru: 'Счета и чеки' },
  automation: { pl: 'Akcje automatyczne', en: 'Automatic actions', ru: 'Автоматические действия' },
  account: { pl: 'Konto i płatności', en: 'Account and billing', ru: 'Аккаунт и оплата' },
};

export const ARTICLES: Article[] = [
  {
    slug: 'first-steps',
    category: 'start',
    title: { pl: 'Jak zacząć — konfiguracja konta w 10 minut', en: 'How to start — account setup in 10 minutes', ru: 'Как начать — настройка аккаунта за 10 минут' },
    body: {
      pl: `1. Uzupełnij dane firmy: Ustawienia → Dane firmy. Są one drukowane na fakturach i etykietach.
2. Dodaj integrację z marketplace: Integracje → Dodaj integrację → Allegro, Empik lub Kaufland. Możesz zacząć od trybu demo.
3. Dodaj produkty do magazynu (ręcznie, z pliku CSV lub z ofert marketplace przyciskiem „Dodaj do magazynu").
4. Powiąż oferty z produktami (Produkty → Oferty marketplace) — wtedy stany będą synchronizowane automatycznie.
5. Skonfiguruj statusy zamówień i akcje automatyczne, np. „opłacone → do wysłania".
6. Gotowe! Nowe zamówienia pobierają się automatycznie co 10 minut.`,
      en: `1. Fill in your company details: Settings → Company details. They are printed on invoices and labels.
2. Add a marketplace integration: Integrations → Add integration → Allegro, Empik or Kaufland. You can start in demo mode.
3. Add products to the inventory (manually, from a CSV file or from marketplace offers with "Add to inventory").
4. Link offers with products (Products → Marketplace offers) — stock will then be synchronized automatically.
5. Configure order statuses and automatic actions, e.g. "paid → to send".
6. Done! New orders are downloaded automatically every 10 minutes.`,
      ru: `1. Заполните данные компании: Настройки → Данные компании. Они печатаются на счетах и этикетках.
2. Добавьте интеграцию с маркетплейсом: Интеграции → Добавить интеграцию → Allegro, Empik или Kaufland. Можно начать с демо-режима.
3. Добавьте товары на склад (вручную, из CSV или из офферов маркетплейса кнопкой «Добавить на склад»).
4. Свяжите офферы с товарами (Товары → Офферы маркетплейсов) — остатки будут синхронизироваться автоматически.
5. Настройте статусы заказов и автоматические действия, например «оплачен → к отправке».
6. Готово! Новые заказы загружаются автоматически каждые 10 минут.`,
    },
  },
  {
    slug: 'order-statuses',
    category: 'orders',
    title: { pl: 'Statusy zamówień i grupy statusów', en: 'Order statuses and status groups', ru: 'Статусы заказов и группы статусов' },
    body: {
      pl: `Statusy odzwierciedlają etapy realizacji zamówienia. Możesz tworzyć dowolną liczbę statusów w Ustawienia → Statusy zamówień.
Każdy status ma kolor, nazwę krótką (widoczną w tabeli) i nazwę pełną (widoczną dla klienta na stronie zamówienia).
Grupy statusów pozwalają uporządkować listę w lewej kolumnie — grupę można zwinąć klikając jej nazwę.
Statusy systemowe (Nowe, Opłacone, Do wysłania, Wysłane, Anulowane) można zmieniać, ale nie usuwać. Przejście do „Anulowane" przywraca stany magazynowe.`,
      en: `Statuses reflect the fulfilment stages of an order. You can create any number of statuses in Settings → Order statuses.
Each status has a colour, a short name (shown in the table) and a full name (shown to the buyer on the order page).
Status groups keep the left column tidy — click a group name to collapse it.
System statuses (New, Paid, To send, Sent, Canceled) can be renamed but not deleted. Moving an order to "Canceled" returns its stock.`,
      ru: `Статусы отражают этапы обработки заказа. Создавать статусы можно в Настройки → Статусы заказов.
У статуса есть цвет, короткое название (в таблице) и полное (видно покупателю на странице заказа).
Группы статусов упорядочивают левую колонку — группу можно свернуть кликом по названию.
Системные статусы (Новые, Оплаченные, К отправке, Отправленные, Отменённые) можно переименовать, но не удалить. Переход в «Отменённые» возвращает остатки на склад.`,
    },
  },
  {
    slug: 'order-search',
    category: 'orders',
    title: { pl: 'Wyszukiwanie i filtrowanie zamówień', en: 'Searching and filtering orders', ru: 'Поиск и фильтрация заказов' },
    body: {
      pl: `Pole wyszukiwania na górze panelu przeszukuje numery zamówień, klientów, e-maile, telefony, produkty i numery przesyłek.
Przycisk „Wyszukiwanie zaawansowane" na liście zamówień pozwala filtrować po źródle, koncie marketplace, płatności, pobraniu, metodzie dostawy, kraju, dacie, kwocie, fakturze i przesyłce.
Aktywne filtry widać jako „chipy" nad tabelą — kliknij ×, aby usunąć filtr. Filtry działają razem z wybranym statusem.`,
      en: `The search box at the top searches order numbers, buyers, e-mails, phones, products and tracking numbers.
The "Advanced search" button on the order list filters by source, marketplace account, payment, cash on delivery, shipping method, country, date, amount, invoice and shipment.
Active filters are shown as chips above the table — click × to remove one. Filters work together with the selected status.`,
      ru: `Поиск вверху панели ищет по номерам заказов, покупателям, e-mail, телефонам, товарам и номерам отправлений.
Кнопка «Расширенный поиск» в списке заказов фильтрует по источнику, аккаунту маркетплейса, оплате, наложенному платежу, способу доставки, стране, дате, сумме, счёту и отправке.
Активные фильтры показаны «чипами» над таблицей — нажмите ×, чтобы убрать фильтр. Фильтры работают вместе с выбранным статусом.`,
    },
  },
  {
    slug: 'warehouses',
    category: 'products',
    title: { pl: 'Katalogi, magazyny i dokumenty magazynowe', en: 'Catalogs, warehouses and stock documents', ru: 'Каталоги, склады и складские документы' },
    body: {
      pl: `Katalog to osobna lista produktów (np. dla różnych marek). Magazyn to miejsce, w którym przechowujesz towar — produkt może mieć stany w kilku magazynach.
Stany zmieniasz dokumentami magazynowymi:
• PZ — przyjęcie zewnętrzne (dostawa od dostawcy, aktualizuje cenę zakupu),
• PW — przyjęcie wewnętrzne,
• WZ — wydanie zewnętrzne,
• RW — rozchód wewnętrzny,
• MM — przesunięcie między magazynami.
Zamówienia z marketplace zdejmują stany z magazynu ustawionego w integracji. W integracji wybierasz też, które magazyny są wysyłane jako stan oferty.`,
      en: `A catalog is a separate list of products (e.g. for different brands). A warehouse is a place where you keep goods — a product can have stock in several warehouses.
Stock is changed with warehouse documents:
• PZ — goods received from a supplier (updates the purchase price),
• PW — internal receipt,
• WZ — goods issued,
• RW — internal issue,
• MM — transfer between warehouses.
Marketplace orders deduct stock from the warehouse set in the integration. The integration also defines which warehouses are sent as offer stock.`,
      ru: `Каталог — отдельный список товаров (например, для разных брендов). Склад — место хранения товара; у товара могут быть остатки на нескольких складах.
Остатки меняются складскими документами:
• PZ — приход от поставщика (обновляет закупочную цену),
• PW — внутренний приход,
• WZ — отгрузка,
• RW — внутреннее списание,
• MM — перемещение между складами.
Заказы с маркетплейсов списывают остатки со склада, указанного в интеграции. Там же выбираются склады, остатки которых отправляются в офферы.`,
    },
  },
  {
    slug: 'allegro',
    category: 'integrations',
    title: { pl: 'Integracja z Allegro', en: 'Allegro integration', ru: 'Интеграция с Allegro' },
    body: {
      pl: `1. Zarejestruj aplikację na apps.developer.allegro.pl (typ: urządzenie / device).
2. W panelu: Integracje → Allegro → wklej Client ID i Client Secret → Zapisz.
3. Kliknij „Autoryzuj konto Allegro", otworzy się allegro.pl — potwierdź dostęp kodem.
4. Zamówienia ze statusem „gotowe do realizacji" pobierają się automatycznie. Mapowanie statusów (zakładka Zamówienia) wysyła status realizacji do Allegro.
5. Numery przesyłek są przekazywane do Allegro automatycznie po utworzeniu przesyłki.
6. W „Zarządzaj ofertami" możesz wystawiać produkty z magazynu, kończyć i wznawiać oferty.`,
      en: `1. Register an application at apps.developer.allegro.pl (type: device).
2. In the panel: Integrations → Allegro → paste Client ID and Client Secret → Save.
3. Click "Authorize Allegro account", allegro.pl opens — confirm access with the code.
4. Orders "ready for processing" are downloaded automatically. Status mapping (Orders tab) sends the fulfilment status to Allegro.
5. Tracking numbers are sent to Allegro automatically when a shipment is created.
6. In "Manage offers" you can list inventory products, end and renew offers.`,
      ru: `1. Зарегистрируйте приложение на apps.developer.allegro.pl (тип: устройство / device).
2. В панели: Интеграции → Allegro → вставьте Client ID и Client Secret → Сохранить.
3. Нажмите «Авторизовать аккаунт Allegro», откроется allegro.pl — подтвердите доступ кодом.
4. Заказы «готовые к обработке» загружаются автоматически. Маппинг статусов (вкладка «Заказы») отправляет статус выполнения в Allegro.
5. Номера отправлений передаются в Allegro автоматически при создании отправки.
6. В «Управлении офферами» можно выставлять товары со склада, завершать и возобновлять офферы.`,
    },
  },
  {
    slug: 'empik-kaufland',
    category: 'integrations',
    title: { pl: 'Integracja z Empik i Kaufland', en: 'Empik and Kaufland integration', ru: 'Интеграция с Empik и Kaufland' },
    body: {
      pl: `Empik Marketplace działa na platformie Mirakl. Klucz API wygenerujesz w panelu sprzedawcy Empik (Ustawienia użytkownika → Klucz API). Nowe zamówienia mogą być akceptowane automatycznie.
Kaufland: w Seller Portal (Ustawienia → API) wygeneruj Client Key i Secret Key. Zapytania są podpisywane HMAC — zegar serwera musi być poprawny.
W obu przypadkach oferty są dopasowywane do produktów po EAN lub SKU, a nowe oferty wystawiasz podając EAN produktu.`,
      en: `Empik Marketplace runs on Mirakl. Generate the API key in the Empik seller panel (User settings → API key). New orders can be accepted automatically.
Kaufland: generate Client Key and Secret Key in the Seller Portal (Settings → API). Requests are HMAC-signed — the server clock must be correct.
In both cases offers are matched with products by EAN or SKU; new offers require the product EAN.`,
      ru: `Empik Marketplace работает на платформе Mirakl. Ключ API создаётся в кабинете продавца Empik (Настройки пользователя → API key). Новые заказы могут приниматься автоматически.
Kaufland: в Seller Portal (Settings → API) создайте Client Key и Secret Key. Запросы подписываются HMAC — часы сервера должны быть точными.
В обоих случаях офферы сопоставляются с товарами по EAN или SKU; для выставления нового оффера нужен EAN товара.`,
    },
  },
  {
    slug: 'accelerations',
    category: 'integrations',
    title: { pl: 'Akceleracje — szybsza synchronizacja', en: 'Accelerations — faster synchronization', ru: 'Акселерации — ускоренная синхронизация' },
    body: {
      pl: `Standardowo stany wysyłane są co 60 minut, ceny raz na dobę, a zamówienia pobierane co 10 minut.
W Integracje → Akceleracje możesz w dowolnym momencie przyspieszyć synchronizację (np. na czas promocji). Opłata naliczana jest za każdy dzień, w którym akceleracja była włączona.`,
      en: `By default stock is sent every 60 minutes, prices once a day and orders are downloaded every 10 minutes.
In Integrations → Accelerations you can speed up synchronization at any time (e.g. during a promotion). You pay for each day the acceleration was active.`,
      ru: `По умолчанию остатки отправляются каждые 60 минут, цены — раз в сутки, заказы загружаются каждые 10 минут.
В Интеграции → Акселерации можно в любой момент ускорить синхронизацию (например, на время акции). Оплата начисляется за каждый день, когда ускорение было включено.`,
    },
  },
  {
    slug: 'shipments',
    category: 'shipping',
    title: { pl: 'Tworzenie przesyłek i druk etykiet', en: 'Creating shipments and printing labels', ru: 'Создание отправок и печать этикеток' },
    body: {
      pl: `Przesyłkę utworzysz w karcie zamówienia (przycisk „Pakuj" lub wybór kuriera w sekcji Przesyłki) albo dla wielu zamówień naraz niebieskim przyciskiem z ciężarówką na liście zamówień.
Etykiety 10×15 cm z kodem kreskowym drukujesz z karty zamówienia lub z modułu Wysyłki (zaznacz przesyłki → Drukuj etykiety). Tam też wygenerujesz protokół odbioru dla kuriera.
Jeśli zamówienie pochodzi z marketplace, numer przesyłki jest do niego automatycznie przekazywany.`,
      en: `Create a shipment in the order card ("Pack" button or choose a courier in the Shipments section) or for many orders at once with the blue truck button on the order list.
Print 10×15 cm barcode labels from the order card or from the Shipments module (select shipments → Print labels). There you can also generate the pickup protocol for the courier.
If the order comes from a marketplace, the tracking number is sent there automatically.`,
      ru: `Отправку можно создать в карточке заказа (кнопка «Упаковать» или выбор курьера в разделе «Отправки») или сразу для многих заказов синей кнопкой с грузовиком в списке заказов.
Этикетки 10×15 см со штрихкодом печатаются из карточки заказа или из модуля «Отправки» (выберите отправки → Печать этикеток). Там же формируется протокол передачи курьеру.
Если заказ с маркетплейса, номер отправления передаётся туда автоматически.`,
    },
  },
  {
    slug: 'invoices',
    category: 'invoices',
    title: { pl: 'Faktury, paragony i korekty', en: 'Invoices, receipts and corrections', ru: 'Счета-фактуры, чеки и корректировки' },
    body: {
      pl: `Fakturę lub paragon wystawisz w karcie zamówienia (Wystaw fakturę / Utwórz paragon) albo masowo z listy zamówień. Numeracja jest ciągła w ramach serii — format ustawisz w Ustawienia → Numeracja faktur (%N — numer, %M — miesiąc, %Y — rok).
Korektę wystawisz z widoku faktury („Wystaw korektę"), podając wartości po korekcie. Usunąć można tylko ostatni dokument w serii.
Akcja automatyczna „Wystaw fakturę" może robić to automatycznie dla klientów, którzy jej żądają.`,
      en: `Issue an invoice or receipt in the order card (Issue an invoice / Create receipt) or in bulk from the order list. Numbering is continuous within a series — set the format in Settings → Invoice numbering (%N — number, %M — month, %Y — year).
Issue a correction from the invoice view ("Issue correction") by entering values after correction. Only the last document of a series can be deleted.
The automatic action "Issue invoice" can do it automatically for customers who request one.`,
      ru: `Счёт или чек выставляется в карточке заказа (Выставить счёт / Создать чек) или массово из списка заказов. Нумерация сквозная в пределах серии — формат задаётся в Настройки → Нумерация счетов (%N — номер, %M — месяц, %Y — год).
Корректировка выставляется из просмотра счёта («Выставить корректировку») с указанием значений после корректировки. Удалить можно только последний документ серии.
Автоматическое действие «Выставить счёт» может делать это само для клиентов, которые его запросили.`,
    },
  },
  {
    slug: 'automation',
    category: 'automation',
    title: { pl: 'Akcje automatyczne — przykłady', en: 'Automatic actions — examples', ru: 'Автоматические действия — примеры' },
    body: {
      pl: `Akcja automatyczna = zdarzenie + warunki + akcje.
Przykłady:
• Zdarzenie „Zamówienie opłacone" → akcja „Zmień status na Do wysłania".
• „Nowe zamówienie" + warunek „Pobranie = tak" → „Zmień status na Do wysłania".
• „Zmiana statusu" + „Status = Do wysłania" + „Klient chce fakturę" → „Wystaw fakturę".
• „Utworzono przesyłkę" → „Wyślij e-mail z numerem przesyłki".
Akcje z zdarzeniem „Uruchom ręcznie" wywołasz z listy zamówień (menu ≡ → Uruchom akcję automatyczną).`,
      en: `Automatic action = event + conditions + actions.
Examples:
• Event "Order paid" → action "Change status to To send".
• "New order" + condition "Cash on delivery = yes" → "Change status to To send".
• "Status changed" + "Status = To send" + "Customer requests an invoice" → "Issue invoice".
• "Shipment created" → "Send e-mail with the tracking number".
Actions with the event "Run manually" are started from the order list (≡ menu → Run automatic action).`,
      ru: `Автоматическое действие = событие + условия + действия.
Примеры:
• Событие «Заказ оплачен» → действие «Сменить статус на К отправке».
• «Новый заказ» + условие «Наложенный платёж = да» → «Сменить статус на К отправке».
• «Смена статуса» + «Статус = К отправке» + «Клиент хочет счёт» → «Выставить счёт».
• «Создана отправка» → «Отправить e-mail с номером отправления».
Действия с событием «Запуск вручную» вызываются из списка заказов (меню ≡ → Запустить автоматическое действие).`,
    },
  },
  {
    slug: 'billing',
    category: 'account',
    title: { pl: 'Abonament, okres próbny i płatności', en: 'Subscription, trial and payments', ru: 'Подписка, пробный период и оплата' },
    body: {
      pl: `Nowe konto ma bezpłatny okres próbny ze wszystkimi funkcjami. Po jego zakończeniu konto przechodzi w tryb tylko do odczytu, dopóki nie wybierzesz planu i nie opłacisz abonamentu.
Plan zmienisz w Ustawienia → Abonament. Tam znajdziesz też saldo, historię naliczeń (abonament, akceleracje) oraz dane do przelewu.
Masz pytania o płatności? Napisz do nas z kategorią „Płatności".`,
      en: `A new account gets a free trial with all features. After it ends the account becomes read-only until you choose a plan and pay the subscription.
Change the plan in Settings → Subscription. There you also find the balance, charge history (subscription, accelerations) and payment details.
Questions about payments? Contact us with the "Billing" category.`,
      ru: `Новый аккаунт получает бесплатный пробный период со всеми функциями. После его окончания аккаунт переходит в режим только для чтения, пока вы не выберете тариф и не оплатите подписку.
Тариф меняется в Настройки → Подписка. Там же баланс, история начислений (подписка, акселерации) и реквизиты для оплаты.
Вопросы об оплате? Напишите нам с категорией «Оплата».`,
    },
  },
  {
    slug: 'users',
    category: 'account',
    title: { pl: 'Użytkownicy i uprawnienia', en: 'Users and permissions', ru: 'Пользователи и права' },
    body: {
      pl: `Właściciel konta i administratorzy mogą dodawać użytkowników w Ustawienia → Użytkownicy. Rola „Użytkownik" obsługuje zamówienia i produkty, ale nie zmienia ustawień, integracji ani abonamentu.
Wsparcie techniczne może zalogować się do Twojego konta tylko w celu rozwiązania zgłoszenia — każde takie logowanie jest zapisywane, a działania są oznaczane w historii zamówień jako „Support".`,
      en: `The account owner and administrators can add users in Settings → Users. The "User" role handles orders and products but cannot change settings, integrations or the subscription.
Support can log in to your account only to resolve a ticket — every such login is recorded and actions are marked "Support" in order history.`,
      ru: `Владелец аккаунта и администраторы добавляют пользователей в Настройки → Пользователи. Роль «Пользователь» работает с заказами и товарами, но не меняет настройки, интеграции и подписку.
Поддержка может войти в ваш аккаунт только для решения обращения — каждый такой вход записывается, а действия помечаются в истории заказов как «Support».`,
    },
  },
  {
    slug: 'rest-api',
    category: 'integrations',
    title: { pl: 'API — połączenie ze sklepem internetowym lub ERP', en: 'API — connecting your online store or ERP', ru: 'API — подключение интернет-магазина или ERP' },
    body: {
      pl: `API pozwala własnemu sklepowi, systemowi ERP lub skryptom pobierać zamówienia, dodawać zamówienia oraz aktualizować stany i ceny produktów.

1. Wejdź w Ustawienia → API i kliknij „Wygeneruj token". Skopiuj token — jest wyświetlany tylko raz.
2. Wysyłaj zapytania na adres /api/v1 z nagłówkiem X-Api-Token: sh_… (lista metod i przykład są na stronie Ustawienia → API).
3. Limit to 100 zapytań na minutę. Możesz go zwiększyć do 300 lub 500 w Integracje → Akceleracje.
4. Token można w każdej chwili unieważnić — integracje, które go używają, przestaną działać.

Wskazówka: do przyrostowego pobierania zamówień używaj parametru id_from (zamówienia od podanego ID).`,
      en: `The API lets your own store, ERP or scripts download and create orders and update product stock and prices.

1. Go to Settings → API and click "Generate token". Copy the token — it is shown only once.
2. Send requests to /api/v1 with the header X-Api-Token: sh_… (the list of methods and an example are on the Settings → API page).
3. The limit is 100 requests per minute. You can raise it to 300 or 500 in Integrations → Accelerations.
4. A token can be revoked at any time — integrations using it will stop working.

Tip: to download orders incrementally use the id_from parameter (orders from the given ID).`,
      ru: `API позволяет вашему магазину, ERP или скриптам получать и создавать заказы, обновлять остатки и цены товаров.

1. Откройте Настройки → API и нажмите «Сгенерировать токен». Скопируйте токен — он показывается только один раз.
2. Отправляйте запросы на адрес /api/v1 с заголовком X-Api-Token: sh_… (список методов и пример — на странице Настройки → API).
3. Лимит — 100 запросов в минуту. Его можно увеличить до 300 или 500 в разделе Интеграции → Акселерации.
4. Токен можно отозвать в любой момент — интеграции, которые его используют, перестанут работать.

Совет: для постепенной загрузки заказов используйте параметр id_from (заказы начиная с указанного ID).`,
    },
  },
];
