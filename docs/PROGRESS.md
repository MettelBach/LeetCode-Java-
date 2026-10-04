# SellHub — прогресс разработки (клон BaseLinker)

Этот файл — «память» проекта: план, собранные данные и статус. Обновляется по ходу работы.

## Задача (от пользователя)
1. Очистить репозиторий (LeetCode-файлы удалены).
2. Сделать копию BaseLinker: тот же дизайн и функционал, интеграции только **Allegro, Empik, Kaufland**.
3. После завершения приложения — детальный план рекламы через **Google Ads и Meta Ads** (docs/MARKETING_PLAN.md).
4. Вести заметки в файлах (этот файл), коммитить и пушить в `claude/upbeat-darwin-kpx1l0`.

## Доп. требования (сообщение пользователя №2)
- Нужен **прод-продукт** (SaaS), а не демо.
- **Склады и каталоги** как в BaseLinker: несколько каталогов (Katalogi), несколько складов (Magazyny) с остатками по складам, складские документы (PZ, PW, WZ, RW, MM).
- Заказы и **фильтры как в BaseLinker** (есть: колонка статусов, расширенный поиск).
- **Pomoc i kontakt**: база знаний + форма обращения → тикет, переписка с поддержкой.
- **Панель поддержки и администратора**: список аккаунтов клиентов, статистика, вход поддержки в аккаунт клиента (impersonation с аудитом), очередь тикетов — взять тикет, ответить, решить; управление сотрудниками.
- **Zarządzaj ofertami**: менеджер офферов — выставление товаров со склада на Allegro/Empik/Kaufland, завершение/активация, массовое редактирование цен/остатков.
- **Akceleracje** (раздел в Integracje): платное ускорение синхронизаций — частота остатков (8ч→1ч→5мин), цен (24ч→12ч→4ч→5мин), загрузки заказов (10мин→1мин), лимит API; посуточная оплата.
- **Integracje**: каталог интеграций с выбором для подключения (как в BaseLinker).
- Не забыть: план рекламы Google Ads + Meta Ads, финальный QA (баги, логика, UX, дизайн, безопасность).

- (сообщение №3) После выполнения всего: найти, что ещё нужно доделать/улучшить, и сделать это.

## Архитектура мультиаккаунтности (решение)
- `data/platform.db` — платформа: accounts (клиенты/тенанты, план, статус, триал), users (пользователи клиентов), staff (поддержка/админы), tickets + ticket_messages, audit_log, billing (начисления akceleracji/подписки).
- `data/tenants/<account_id>.db` — отдельная SQLite БД на каждого клиента (полная изоляция данных).
- `db` в server/src/db/index.ts — Proxy поверх AsyncLocalStorage: в контексте запроса/фоновой задачи указывает на БД текущего тенанта. Код сервисов не меняется.
- JWT: {typ:'user', sub, acc} / {typ:'staff', sub} / impersonation {typ:'user', acc, sub, imp: staffId}.

## Стек
- `server/` — Node 22 + Express 5 + TypeScript + better-sqlite3 (SQLite), JWT-аутентификация, pdfkit (PDF фактур/этикеток), node-cron (синхронизация), nodemailer (письма).
- `web/` — React 19 + Vite + TypeScript + React Router + TanStack Query + Recharts. Свой CSS, повторяющий BaseLinker.
- Имя продукта — **SellHub** (своё, чтобы не нарушать товарный знак BaseLinker; меняется в `web/src/brand.ts`).

## Дизайн BaseLinker (по скриншотам из base.com/help)
- Слева узкая тёмная полоса иконок (~52px, цвет #2b3138), сверху логотип; модули: Home (dashboard), Orders, Products, Integrations, Help; ниже — ярлыки маркетплейсов (All / Ce / Re…).
- Верхняя белая шапка: кнопка сворачивания меню, «Quick access ▾», большой поиск-«пилюля» по центру, справа «?», колокольчик, аватар-кружок (синий) + имя аккаунта ▾.
- Фон контента #f3f4f6, шрифт Open Sans.
- Второй столбец (≈220px) в заказах: большая синяя кнопка-пилюля «+ Add order», список статусов: «All», цветные квадратики-счётчики + название, группы статусов (сворачиваемые, «To send ^», «Ended ^»), Archive, Bin, «+ Add status» и иконка обновления.
- Заголовок страницы крупный светлый («All orders»), справа кнопка-контур «Advanced search».
- Панель инструментов: группы кнопок с рамкой (чекбокс▾, звезда | флажок, письмо, документ, принтер | синяя кнопка грузовик | склад▾ | меню▾ | сортировка), справа пагинация «1-10 of 10 items» + < >.
- Таблица заказов: Number (in shop) / Name Surname (order source) / Items / Information / Price / Additional information (shipping method) / Order date (in status). Номер — синяя ссылка, звезда, чекбокс. Статус — цветной бейдж. Иконки P/N (оплата), $ , грузовик, документ.
- Карточка заказа: «☆ Order 19412011  John Doe, 18.08.2021 19:13», кнопки < > и «Return to the list of orders». Таблица товаров (фото, Prod. ID, Product name [EAN][SKU], Quantity, Price, Tax, Weight, Date, Actions ⋮ → Edit/Delete/Stock levels history). «+ Add products to order…», «Operations on products ▾».
- Блок «Order information»: Paid: [красный/зелёный бейдж суммы] of X PLN, Edit payment; Client (login), E-mail, Phone, Order source; Shipping method/price, Payment method; Pole dodatkowe 1/2, Comments. Справа: Status [селект с цветом] Change ▾, Receipt CREATE RECEIPT, Invoice ISSUE AN INVOICE | PRO FORMA | 🖨; Order date, Date in status, Stock levels ✓ Completed (deducted); заметка; ссылка на страницу заказа. Кнопки «Printouts and exports ▾», «Pack ▾», «Actions ▾».
- Карточки: Delivery address / Invoice data (жёлтое предупреждение «The customer requests an invoice») / Pickup at point.
- Shipments: таблица (дата, курьер, аккаунт, номер посылки, статус-прогресс, LABEL 🖨 PROTOKÓŁ, ✕) и сетка кнопок курьеров.
- Цвета статусов: New orders #0f74d4 (синий), To send #f0803c (оранжевый), Sent #219653 (зелёный), Canceled #d9363e (красный), Sample #495057.

## API маркетплейсов (собранные данные)
### Allegro (REST, https://api.allegro.pl, sandbox https://api.allegro.pl.allegrosandbox.pl)
- Accept/Content-Type: `application/vnd.allegro.public.v1+json`.
- OAuth device flow: POST `https://allegro.pl/auth/oauth/device` (Basic client_id:secret, `client_id=`) → device_code, user_code, verification_uri_complete; poll POST `/auth/oauth/token?grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code=…`. Refresh: `grant_type=refresh_token`.
- Заказы: GET `/order/checkout-forms?status=READY_FOR_PROCESSING&updatedAt.gte=…&limit=100&offset=`.
- Статус: PUT `/order/checkout-forms/{id}/fulfillment` `{status: NEW|PROCESSING|READY_FOR_SHIPMENT|READY_FOR_PICKUP|SENT|PICKED_UP|CANCELLED|SUSPENDED|RETURNED}`.
- Трекинг: POST `/order/checkout-forms/{id}/shipments` `{carrierId, waybill, lineItems:[{id}]}`.
- Офферы: GET `/sale/offers?limit=1000&offset=`; обновление: PATCH `/sale/product-offers/{id}` `{stock:{available}, sellingMode:{price:{amount,currency}}}`.
### Empik (Mirakl, base по умолчанию https://marketplace.empik.com, заголовок `Authorization: <API key>`)
- OR11 GET `/api/orders?order_state_codes=…&start_update_date=…&max=100&offset=`.
- OR21 PUT `/api/orders/{id}/accept` `{order_lines:[{accepted:true,id}]}`; OR23 PUT `/api/orders/{id}/tracking`; OR24 PUT `/api/orders/{id}/ship`; OR29 PUT `/api/orders/{id}/cancel`.
- OF21 GET `/api/offers?max=100&offset=`; OF24 POST `/api/offers` `{offers:[{shop_sku, price, quantity, state_code:"11", update_delete:"update", product_id, product_id_type}]}`.
### Kaufland (https://sellerapi.kaufland.com/v2)
- Заголовки: Accept, Shop-Client-Key, Shop-Timestamp, Shop-Signature, User-Agent.
- Подпись: hex(HMAC-SHA256(secret, METHOD\nFULL_URI\nBODY\nTIMESTAMP)). Тест-вектор: POST, `https://sellerapi.kaufland.com/v2/units/`, body "", ts 1411055926, secret `a7d0cb1d…dd403` → `da0b65f5…df2e2a`.
- GET `/order-units?storefront=pl&status=need_to_be_sent&ts_created_from_iso=…&limit=100&offset=` (позиции; группировать по id_order; цены в центах/грошах).
- PATCH `/order-units/{id}/send` `{carrier_code, tracking_numbers:[…]}`; PATCH `/order-units/{id}/cancel` `{reason}`.
- GET `/units?storefront=pl&embedded=product`; PATCH `/units/{id_unit}?storefront=pl` `{amount, listing_price}`.

Каждая интеграция имеет **демо-режим** (генерация реалистичных заказов/офферов без ключей).

## Модули (план) и статус
- [x] Каркас монорепо
- [x] Бэкенд: БД, auth, заказы, статусы, товары/склад, фактуры, отправки, возвраты, автоматические действия, дашборд, настройки (server/src, smoke-тест API пройден)
- [x] Интеграции Allegro / Empik / Kaufland + планировщик синхронизации (server/src/integrations; демо-режим работает)
- [ ] Фронтенд всех модулей, i18n (pl/en/ru)
- [ ] Тесты, скриншоты, Docker, README
- [ ] План рекламы Google Ads + Meta Ads

## Журнал
- 2026-10-04: исследование дизайна и API, очистка репозитория, установка зависимостей.
- 2026-10-04: бэкенд готов и закоммичен (c2079b1). Структура server/src: db/ (schema, seed), services/ (orders, order-query, stock, invoices, pdf, shipments, returns, email, automation, events, demo-seed), integrations/ (allegro, empik, kaufland, demo, sync), routes/ (auth, orders, statuses, products, integrations+offers, documents=shipments/invoices/returns, misc=rules/dashboard/settings/search/public).
  Запуск API: `cd server && DB_FILE=... PORT=3001 npx tsx src/index.ts`. Setup: POST /api/auth/setup {email,name,password,demo:true}.
  Следующий шаг: фронтенд (web/).
- 2026-10-04: SaaS-рефакторинг бэкенда готов: platform.db + tenants/<id>.db (db/index.ts Proxy+AsyncLocalStorage), auth (register/login/forgot/reset/me, users аккаунта, лимиты тарифа), admin API (/api/admin: login, stats, accounts, impersonate, payments, tickets, staff, audit), support API (/api/support/tickets), billing+akceleracje (/api/billing), склады/каталоги/документы (/api/warehouses, /api/catalogs, /api/warehouse-docs), менеджер офферов (/api/offers/list, bulk-status, bulk-price, listing-options), планировщик по аккаунтам (integrations/sync.ts tick()). Тесты: server/src/api.test.ts + unit.test.ts — 21 зелёный.
  Публичная страница заказа: /order/<accountId>/<orderId>/<token> (API /api/public/order/...).
  Суперадмин создаётся из ADMIN_EMAIL/ADMIN_PASSWORD при старте.
  Следующий шаг: фронтенд — Login/Register/Forgot/Reset, App-роутер, Settings, Help (Pomoc i kontakt + тикеты), Admin-панель (/admin/*), склады/каталоги/документы UI, менеджер офферов UI, Akceleracje UI, каталог интеграций, подписка; i18n pl/ru.
- 2026-10-04: фронтенд SaaS готов (auth, /admin, help, склады, офферы, акселерации, настройки, подписка), переводы PL/RU (web/src/i18n, проверка `npm run i18n:check`), Docker/README. Скриншоты сверены.
  Следующие шаги: (1) docs/MARKETING_PLAN.md — Google Ads + Meta Ads; (2) финальный QA + security review; (3) поиск доработок (публичный API с токенами — нужен для акселерации «лимит API», и др.).

## Маркетинг — собранные данные (для docs/MARKETING_PLAN.md)
- Рынок: Allegro — >130 тыс. активных польских продавцов 3P (прогноз 140 тыс. в 2025), 22 млн+ покупателей, GMV >15 млрд EUR (zunapro.com, wiadomoscihandlowe.pl). Allegro ~70–80% объёма маркетплейсов PL.
- Конкуренты BaseLinker: Apilo, Sellasist (WMS дешевле), IDEAerp; продавцы жалуются на ежегодный рост цен BaseLinker и дорогой тариф Enterprise (spolecznosc.allegro.pl, тема «alternatywa dla BaseLinker»). → УТП: прозрачная цена, оплата за дни акселераций, нет навязанного Enterprise.
- Google Ads B2B SaaS 2026 (saashero.net, tripledart, prosemedia): структура — Brand (exact, 10–15% бюджета), Competitor (exact+phrase, 15–20%), Category high intent (phrase+broad, 30–40%), Category broad (15–20%), Demand Gen/YouTube (10–15%), PMax только при 100+ конверсиях/мес. Меньше кампаний = лучше Smart Bidding. QS 5→8 снижает CPC на ~28%. Обязателен импорт офлайн-конверсий (платящий клиент).
- EU: Consent Mode v2 обязателен для показа рекламы и измерения в ЕЭЗ; с 21.07.2025 без него конверсии/ремаркетинг в ЕС не работают (до 60% потерь данных).
- Товарные знаки конкурентов: Google в ЕС не запрещает ключевые слова с чужим брендом; в тексте объявления использовать чужой бренд нельзя без риска (CJEU — нарушение при введении в заблуждение).
- Meta B2B SaaS: воронка — охват → лид-магнит (CPL на 40–60% ниже, чем прямой оффер) → прямой отклик/ретаргет. Advantage+ работает для ретаргетинга и lookalike по списку клиентов, хуже для холодного точного B2B (CPL ниже на 14%, но cost per MQL ~2x). Регистрация на триал = событие Lead через Pixel + Conversions API. CPM Meta в 2–3 раза ниже LinkedIn.
- Средний CPC B2B ~2–5 USD (общие данные), для PL точные данные — через Keyword Planner.
- Бенчмарки (поиск 04.10.2026): Meta lead-gen средний CPL ≈ $27.66 (2025), CR ≈ 2.2%; стоимость B2B-привлечения на Meta +20% в 2025. Trial→paid: медиана ~8% (все SaaS, 2026), B2B медиана ~18.5%; триал с картой (opt-out) ~48.8% vs без карты (opt-in) ~18.2%. CAC payback медиана 15–20 мес. (SMB 8–12). LTV:CAC медиана ~3.6:1.

## Безопасность — ревью 04.10.2026
- HIGH (исправлено df63464): SSRF через `base_url` Empik → разрешены только https://*.empik.com / *.mirakl.net, проверка при сохранении и перед запросом; HTTP-клиент маркетплейсов `redirect: 'error'`.
- MEDIUM (исправлено): SMTP клиента — хост должен резолвиться в публичный IP, порты 25/465/587/2525.
- LOW (исправлено): смена пароля повышает token_version, возвращается новый токен.
- Проверено без находок: SQL-инъекции (все ORDER BY/поля по белым спискам), межтенантный доступ, JWT, маскирование секретов, XSS (React, safeHref), webhooks (assertPublicHttpsUrl + manual redirect).

## Улучшения (задача 18) — бэклог по приоритету
1. ✅ Публичный REST API `/api/v1` (токены в Настройки → API, лимит из акселерации, заказы/статусы/товары/остатки/цены, статья в базе знаний) (как BaseLinker connector.php + X-BLToken): сейчас акселерация «лимит API» оплачивается, а API нет — нелогично.
2. ✅ Чек-лист первых шагов на дашборде (подключить интеграцию → заказы → счёт → отправка) — для конверсии trial→paid.
3. ⏳ Онбординг-письма платформы (дни 0/1/3/7/11/14) по расписанию.
4. ⏳ Шифрование секретов интеграций в БД (AES-GCM, ключ из env).
5. ⏳ Скрипт бэкапа (`sqlite .backup` всех БД) + инструкция.
