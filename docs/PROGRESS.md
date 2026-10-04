# SellHub — прогресс разработки (клон BaseLinker)

Этот файл — «память» проекта: план, собранные данные и статус. Обновляется по ходу работы.

## Задача (от пользователя)
1. Очистить репозиторий (LeetCode-файлы удалены).
2. Сделать копию BaseLinker: тот же дизайн и функционал, интеграции только **Allegro, Empik, Kaufland**.
3. После завершения приложения — детальный план рекламы через **Google Ads и Meta Ads** (docs/MARKETING_PLAN.md).
4. Вести заметки в файлах (этот файл), коммитить и пушить в `claude/upbeat-darwin-kpx1l0`.

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
- [ ] Каркас монорепо
- [ ] Бэкенд: БД, auth, заказы, статусы, товары/склад, фактуры, отправки, возвраты, автоматические действия, дашборд, настройки
- [ ] Интеграции Allegro / Empik / Kaufland + планировщик синхронизации
- [ ] Фронтенд всех модулей, i18n (pl/en/ru)
- [ ] Тесты, скриншоты, Docker, README
- [ ] План рекламы Google Ads + Meta Ads

## Журнал
- 2026-10-04: исследование дизайна и API, очистка репозитория, установка зависимостей.
