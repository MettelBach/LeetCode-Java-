# План рекламы SellHub в Google Ads и Meta Ads

Документ — рабочий план запуска платной рекламы SaaS-сервиса для продавцов на Allegro, Empik и Kaufland (аналог BaseLinker). Рынок — Польша, язык объявлений — польский. Все цифры по стоимости — **оценки по открытым бенчмаркам**. Перед запуском проверьте их в Google Keyword Planner и Meta Ads Manager. Цены — нетто, PLN.

---

## 1. Кратко

| Что | Решение |
|---|---|
| Цель | Регистрации на 14-дневный пробный период → оплаченные подписки |
| Главная метрика | CAC платящего клиента ≤ 900 PLN, окупаемость ≤ 12 мес., LTV:CAC ≥ 3 |
| Основной канал | Google Search (горячий спрос: «program do Allegro», «alternatywa BaseLinker», «integracja Empik/Kaufland») |
| Второй канал | Meta (Facebook/Instagram): охват продавцов Allegro, ремаркетинг, look-alike по клиентам |
| Стартовый бюджет | 9 000 PLN/мес. (Google 6 000 / Meta 3 000) на 2 тестовых месяца, затем масштабирование по CAC |
| Главная ставка | Продавцы, недовольные ростом цен BaseLinker, и новые продавцы Allegro, которым BaseLinker слишком сложен и дорог |
| Обязательно до запуска | Consent Mode v2, GA4 + GTM, Meta Pixel + Conversions API, импорт офлайн-конверсий «оплатил подписку» |

---

## 2. Рынок и позиционирование

### 2.1 Рынок
- Allegro: более 130 тыс. активных польских продавцов 3P, 22+ млн покупателей, GMV более 15 млрд EUR. Allegro — 70–80 % оборота маркетплейсов в Польше.
- Empik Marketplace и Kaufland.pl — второй канал для продавцов, которые уже работают на Allegro. Именно им нужна система, которая собирает заказы и синхронизирует остатки.
- Конкуренты: BaseLinker (лидер), Apilo, Sellasist, IDEAerp, Sellingo. На форуме spolecznosc.allegro.pl есть темы «alternatywa dla BaseLinker»: продавцы жалуются на ежегодный рост цен, расчёт по числу заказов, офферов и товаров, и на навязывание тарифа Enterprise.

### 2.2 Целевые сегменты (по приоритету)

| # | Сегмент | Боль | Сообщение | Каналы |
|---|---|---|---|---|
| A | Продавцы Allegro, 50–1 000 заказов/мес., уже на BaseLinker | Цена растёт каждый год, сложно, платят за ненужное | «Те же функции, прозрачная цена от 49 zł, перенос за 1 день» | Google: бренд конкурента и «alternatywa»; Meta: интересы + ремаркетинг |
| B | Продавцы Allegro, которые хотят выйти на Empik/Kaufland | Ручной перенос заказов и остатков, overselling | «Allegro + Empik + Kaufland в одном окне, общий склад» | Google: «integracja Empik / Kaufland», Meta: look-alike |
| C | Новые продавцы (до 50 заказов/мес.) | Excel, ручные счета и этикетки | «Заказы, счета и этикетки InPost за 1 клик, 14 дней бесплатно» | Meta (холодная аудитория), Google: «program do sprzedaży na Allegro» |
| D | Агентства и бухгалтерии e-commerce | Много клиентов | Партнёрская программа (позже, не в первом квартале) | LinkedIn / прямые продажи |

### 2.3 Уникальное торговое предложение (УТП)
1. **Прозрачная цена**: 49 / 99 / 199 zł, без расчёта по офферам и товарам. Ускорение синхронизации («Akceleracje») оплачивается по дням и только по желанию.
2. **Только то, что нужно продавцу маркетплейсов**: Allegro, Empik, Kaufland, склад, счета, отправки, возвраты, автоматические действия.
3. **Привычный интерфейс**: продавец, который работал в BaseLinker, разберётся за минуты.
4. **Перенос бесплатно**: поддержка помогает перенести статусы и автоматические действия (вход поддержки в аккаунт уже есть в панели).
5. **Поддержка на польском** в чате и тикетах, ответ в течение рабочего дня.

> Название BaseLinker можно использовать как ключевое слово (Google разрешает это в ЕС), но **не в тексте объявлений и не в виде логотипа**. На лендинге сравнение допустимо, только если оно корректное и проверяемое (сравнительная реклама по закону ZNK, ст. 16 ust. 3). Перед запуском согласуйте текст сравнения с юристом.

---

## 3. Юнит-экономика и целевые показатели

| Показатель | Значение | Комментарий |
|---|---|---|
| ARPA (средний платёж) | ~115 PLN/мес. | Смесь Start/Business/Pro ≈ 100 PLN + Akceleracje ≈ 15 PLN |
| Валовая маржа | ~85 % | Хостинг, SMTP, поддержка |
| Отток | 3–4 %/мес. | Ориентир для SMB SaaS; срок жизни клиента ≈ 25–30 мес. |
| LTV | ≈ 115 × 0,85 × 28 ≈ **2 700 PLN** | |
| Целевой CAC | **≤ 900 PLN** (LTV:CAC ≥ 3) | Медиана рынка LTV:CAC ≈ 3,6:1 |
| Окупаемость CAC | ≤ 9–12 мес. | Медиана SMB SaaS — 8–12 мес. |
| Конверсия trial → paid | цель 15–20 % | Медиана B2B SaaS ≈ 18,5 % (триал без карты); со всеми SaaS ≈ 8 % |
| Допустимая стоимость регистрации (CPL) | ≤ 135 PLN при 15 % и ≤ 180 PLN при 20 % | CAC × конверсия trial → paid |
| Конверсия лендинга в регистрацию | цель 4–8 % (Search), 1,5–3 % (Meta) | |

**Как проверять экономику**: CAC = расходы на рекламу за месяц / число новых платящих клиентов, у которых первый клик был в этом месяце. Считать когортами по месяцам регистрации, а не по месяцам оплаты.

**Триал с картой или без?** С картой (opt-out) конверсия выше (≈ 48,8 % против ≈ 18,2 %), но регистраций в 2–4 раза меньше. На старте — **без карты** (больше данных для оптимизации рекламы). A/B-тест с картой — после 300+ регистраций.

---

## 4. Подготовка (неделя 0–2) — без этого не запускаться

### 4.1 Лендинги
Отдельная страница под каждую группу запросов (Quality Score и конверсия выше):

| URL | Для каких запросов | Главный блок |
|---|---|---|
| `/` | Бренд SellHub, общие | Скриншот списка заказов, 3 выгоды, «Wypróbuj 14 dni za darmo» |
| `/alternatywa-dla-baselinker` | Конкуренты | Таблица «что есть» (без логотипов чужих брендов), калькулятор цены, «Przeniesiemy Twoje konto za darmo» |
| `/integracja-allegro` | Allegro | Синхронизация заказов, остатков, номеров отслеживания, выставление офферов |
| `/integracja-empik` | Empik | Автоприём заказов, OR21/OR23/OR24 в понятных словах |
| `/integracja-kaufland` | Kaufland | Заказы, units, отправка трек-номеров |
| `/cennik` | «cena», «ile kosztuje» | Тарифы, калькулятор, FAQ |
| `/program-do-faktur-allegro`, `/etykiety-inpost-allegro` | Узкие задачи | Демо-видео 30–60 с |

Требования: загрузка < 2,5 с (LCP), форма регистрации из 4 полей прямо на странице, социальное доказательство (отзывы, число заказов в системе), ссылка на регламент и политику конфиденциальности, баннер согласия на cookies.

### 4.2 Трекинг и согласия
1. **CMP (баннер согласия)** с сертификацией Google (Cookiebot, CookieYes, Usercentrics и т. п.) и **Consent Mode v2** (`ad_storage`, `analytics_storage`, `ad_user_data`, `ad_personalization`). С июля 2025 года в ЕЭЗ без Consent Mode v2 не работают ремаркетинг и измерение конверсий.
2. **GTM + GA4**. События:
   - `sign_up` — регистрация (основная конверсия на старте);
   - `integration_connected` — подключена первая интеграция (активация);
   - `first_order_imported` — импортирован первый заказ (активация);
   - `purchase` — первая оплата подписки (value = сумма, currency = PLN).
3. **Google Ads**: конверсии `sign_up` (основная → затем вторичная), `purchase` через **импорт офлайн-конверсий** по GCLID (или Enhanced Conversions for Leads по хешу e-mail). Через 4–6 недель, когда будет 30+ оплат в месяц, оптимизировать на `purchase` с ценностью.
4. **Meta**: Pixel + **Conversions API** (серверные события `Lead` = регистрация, `StartTrial`, `Subscribe` = оплата, `event_id` для дедупликации). Качество сопоставления событий (EMQ) ≥ 6.
5. **В приложении**: при регистрации сохранять `gclid`, `gbraid`, `wbraid`, `fbclid`, `_fbp`, `_fbc`, UTM-метки и лендинг. Сохранённые метки видны в админке, для импорта офлайн-конверсий есть CSV-выгрузка (см. раздел 11).
6. Единые UTM: `utm_source=google|meta`, `utm_medium=cpc|paid_social`, `utm_campaign={название}`, `utm_content={объявление}`, `utm_term={keyword}`.

### 4.3 Онбординг (влияет на CAC сильнее ставок)
- Демо-данные при регистрации (уже есть), чек-лист «подключи Allegro → импортируй заказы → выстави счёт → создай этикетку».
- Письма: день 0 (как начать), день 1 (подключите Allegro), день 3 (автоматические действия), день 7 (кейс клиента), день 11 (триал заканчивается, скидка 20 % на 3 месяца при оплате за год), день 14 (аккаунт приостановлен, данные сохранены).
- Персональный звонок или чат регистрациям с > 100 заказов/мес. (поле при регистрации или после подключения Allegro).

---

## 5. Google Ads

### 5.1 Структура кампаний

| Кампания | Тип / соответствие | Доля бюджета | Ставки на старте | Цель |
|---|---|---|---|---|
| G1 Brand — SellHub | Search, exact + phrase | 5–10 % | Max clicks → tCPA | Защита бренда, дешёвые конверсии |
| G2 Competitors | Search, exact + phrase | 20–25 % | Max conversions | Сегмент A |
| G3 Category — high intent | Search, phrase + exact | 35–40 % | Max conversions → tCPA 120 PLN | Сегменты A–C |
| G4 Marketplace integrations | Search, phrase | 15–20 % | Max conversions | Сегмент B |
| G5 Remarketing | Demand Gen / Display (посетители 30 дней без регистрации) | 5–10 % | tCPA | Возврат |
| G6 YouTube / Demand Gen | Демо-видео, look-alike по клиентам | 0 % → 10 % с 3-го месяца | | Охват |
| PMax | — | **не запускать**, пока нет 50–100 оплат в месяц | | Без данных PMax покупает дешёвый мусорный трафик |

Принцип: **мало кампаний, много данных** на каждой (Smart Bidding нужно 30+ конверсий за 30 дней на кампанию). Если конверсий мало — объедините G3 и G4.

Настройки для всех кампаний: только Search Network (без Search Partners и без Display Expansion на старте), только Польша, язык польский, таргетинг «Presence: people in or regularly in», расписание: пн–пт 7:00–22:00 с повышающей корректировкой, выходные −30 % (B2B), устройства: десктоп основной, мобильные −20 % после 2 недель данных.

### 5.2 Ключевые слова (стартовый набор)

**G1 Brand**: `sellhub`, `sellhub logowanie`, `sellhub cennik`.

**G2 Competitors** (каждый конкурент — отдельная группа объявлений):
- `[baselinker]`, `"baselinker cennik"`, `"baselinker cena"`, `"baselinker alternatywa"`, `"alternatywa dla baselinker"`, `"baselinker opinie"`, `"base.com"`, `"baselinker podwyżka"`;
- `"apilo"`, `"apilo cennik"`, `"sellasist"`, `"sellasist cennik"`, `"idea erp"`.
- Исключить: `logowanie`, `login`, `zaloguj`, `api`, `praca`, `kariera`, `pomoc` (это действующие клиенты, которым нужен вход, а не реклама).

**G3 Category — high intent**:
- `"program do obsługi zamówień allegro"`, `"program do zarządzania sprzedażą allegro"`, `"system do obsługi zamówień"`, `"program do sprzedaży na allegro"`, `"integrator marketplace"`, `"zarządzanie sprzedażą wielokanałową"`, `"program do wystawiania aukcji allegro"`, `"automatyzacja sprzedaży allegro"`, `"synchronizacja stanów magazynowych allegro"`, `"program magazynowy dla sklepu internetowego"`, `"program do etykiet inpost allegro"`, `"faktury do zamówień allegro automatycznie"`.

**G4 Marketplace integrations**:
- `"integracja empik marketplace"`, `"empik marketplace program"`, `"jak sprzedawać na empik"`, `"empik marketplace integracja z allegro"`;
- `"integracja kaufland"`, `"kaufland marketplace integracja"`, `"jak sprzedawać na kaufland.pl"`, `"kaufland seller api"`;
- `"allegro i empik jeden magazyn"`, `"sprzedaż allegro empik kaufland"`.

**Общие минус-слова** (список на уровне аккаунта): `darmowy program` (на 2-й неделе проверить), `praca`, `kurs`, `szkolenie`, `pdf`, `chomikuj`, `crack`, `allegro lokalnie`, `allegro smart`, `allegro kontakt`, `zwrot allegro`, `jak kupić`, `kupujący`, `infolinia`, `reklamacja`, `allegro.pl logowanie`, `empik bilety`, `empik karta`, `kaufland gazetka`, `kaufland promocje`, `kaufland godziny`, `kaufland praca`.

Каждую неделю просматривайте отчёт «Search terms», добавляйте минус-слова и новые точные ключи.

### 5.3 Объявления (RSA) — примеры на польском

**G2 Competitors** (без чужих брендов в тексте):
- Заголовки: `Szukasz Alternatywy?` · `Stała Cena od 49 zł/mies.` · `Bez Opłat za Oferty i Produkty` · `Przeniesiemy Konto Za Darmo` · `Allegro, Empik i Kaufland` · `Znajomy Interfejs, Niższa Cena` · `14 Dni Za Darmo, Bez Karty` · `Wsparcie po Polsku`
- Описания: `Zamówienia, magazyn, faktury i etykiety w jednym panelu. Płacisz za plan, nie za liczbę ofert.` · `Przejdź w 1 dzień — pomożemy przenieść statusy i akcje automatyczne. Załóż konto testowe.`

**G3 Category**:
- Заголовки: `Obsługa Zamówień Allegro` · `Zamówienia z 3 Marketplace w 1 Panelu` · `Faktury i Etykiety Jednym Kliknięciem` · `Wspólny Magazyn = Brak Oversellingu` · `Automatyczne Statusy i Maile` · `Sprawdź 14 Dni Za Darmo`
- Описания: `Pobieraj zamówienia z Allegro, Empik i Kaufland, synchronizuj stany i wysyłaj numery przesyłek automatycznie.` · `Prosty cennik od 49 zł netto miesięcznie. Bez umowy, anulujesz w każdej chwili.`

**G4 Integrations** (Empik):
- `Integracja z Empik Marketplace` · `Automatyczna Akceptacja Zamówień` · `Stany z Allegro na Empik` · `Numery Przesyłek Wysyłane Same`.

Закрепляйте (pin) один заголовок с ключом на позицию 1 и одну выгоду с ценой на позицию 2. Цель — Ad Strength «Good» или выше, 2 RSA в каждой группе объявлений.

**Расширения**: sitelinks (Cennik, Integracja Allegro, Integracja Empik, Integracja Kaufland, Przeniesienie z innego systemu, Pomoc), callouts (Bez karty, Wsparcie PL, Faktury VAT, Dane w UE), structured snippets (Funkcje: Zamówienia, Magazyn, Faktury, Wysyłki, Zwroty, Automatyzacja), price assets (3 тарифа), логотип и название компании, lead form asset — тестировать только в G3.

### 5.4 Ставки и оптимизация
1. Недели 1–2: Maximize Clicks с лимитом CPC (оценка: 3–6 PLN для категорийных запросов, 1,5–4 PLN для конкурентов; проверьте в Keyword Planner) — сбор данных.
2. С 15+ конверсиями в кампании → Maximize Conversions; с 30+ за 30 дней → Target CPA (начать с фактического CPA + 10 %).
3. После 30+ офлайн-оплат в месяц → основная конверсия `purchase` (ценность = годовой платёж) и стратегия Target ROAS; `sign_up` перевести во вторичные конверсии.
4. Quality Score: цель 7+. Рост QS с 6 до 8 снижает CPC на 22–35 %. Методы: группа объявлений = 1 тема, ключ в заголовке и в H1 лендинга, быстрый лендинг.
5. Не меняйте стратегию и бюджет чаще раза в 7 дней и больше чем на 20–30 % за раз (период обучения).

### 5.5 Ремаркетинг (G5)
- Аудитории: посетители 30 дней без регистрации; регистрация без подключения интеграции (из CRM); триал закончился, нет оплаты (Customer Match, только с согласием на маркетинг).
- Креативы: «Twój okres próbny czeka», «Podłącz Allegro w 2 minuty — zobacz wideo», скидка на год.
- Ограничение частоты: 3 показа в день.

---

## 6. Meta Ads (Facebook + Instagram)

### 6.1 Роль канала
Meta не ловит горячий спрос, а **создаёт** его: охватывает продавцов, которые не ищут смену системы, но страдают от ручной работы или цены. В B2B у Meta ниже CPM (в 2–3 раза ниже LinkedIn), но выше доля нецелевых лидов. Поэтому оптимизируем не на «Lead» в форме, а на **регистрацию на сайте** с серверным событием, а позже — на `Subscribe`.

Бенчмарки: средний CPL по лидогенерации ≈ 27,66 USD (≈ 110 PLN), средняя конверсия ≈ 2,2 %; CPM в 2025 году вырос примерно на 20 %, стоимость B2B-привлечения тоже примерно на 20 %.

### 6.2 Структура

| Кампания | Цель / оптимизация | Аудитории | Доля |
|---|---|---|---|
| M1 Prospecting — Advantage+ / широкая | Sales → конверсия `Lead` (регистрация, CAPI) | Польша, 23–60 лет, широкая или с подсказками интересов: Allegro, sprzedaż internetowa, e-commerce, WooCommerce, Shopify, PrestaShop, InPost, przedsiębiorczość; look-alike 1–3 % по клиентам | 55–60 % |
| M2 Lead magnet | Leads → Instant Form или лендинг | Те же интересы | 15–20 % (тест на 2 мес.) |
| M3 Retargeting | Sales → `Lead`/`Subscribe` | Посетители сайта 30 дней, зрители видео 50 %+, взаимодействия с профилем, триал без оплаты | 20–25 % |

- Look-alike строить по списку **платящих** клиентов (≥ 100 записей, только с согласием), а не по всем регистрациям.
- Исключать из M1: действующих клиентов, зарегистрировавшихся за 30 дней.
- В M1 — 1 кампания с бюджетом на уровне кампании (Advantage campaign budget), 3–5 креативов в каждой группе.

### 6.3 Лид-магниты (M2)
Лид-магнит снижает CPL на 40–60 % по сравнению с прямым предложением, но лиды холоднее, поэтому после них нужна цепочка писем:
1. «Kalkulator: ile kosztuje Cię ręczna obsługa zamówień?» (интерактив на сайте).
2. PDF «Jak zacząć sprzedawać na Empik i Kaufland, mając konto na Allegro — checklista 2026».
3. Вебинар раз в месяц «Automatyzacja sprzedaży na Allegro w 30 минут» (запись → ремаркетинг).

### 6.4 Креативы (обновлять каждые 2–3 недели, следить за частотой > 3)
| Формат | Идея | Текст (PL) |
|---|---|---|
| Видео 15–30 с, 9:16, Reels/Stories | Скринкаст: 40 заказов → массово «Wygeneruj etykiety» → готово | «40 paczek w 2 minuty. Allegro + Empik + Kaufland w jednym panelu.» |
| Статика «до/после» | Excel и 3 вкладки браузера → один список заказов | «Koniec z przełączaniem kart.» |
| Сравнение цены | Калькулятор: 500 заказов в мес. → «49/99 zł» | «Płacisz za plan, nie za oferty i produkty.» |
| UGC / отзыв продавца | Продавец на складе, 20–30 с | «Przeszłam w jeden dzień, wsparcie wszystko przeniosło.» |
| Карусель | 5 функций: заказы, склад, счета, отправки, автоматические действия | «5 rzeczy, które zrobisz automatycznie od dziś» |

Основной текст коротко (125 символов), CTA «Zarejestruj się» / «Dowiedz się więcej». Все видео — с субтитрами (85 %+ смотрят без звука). Показывайте реальный интерфейс приложения: это лучший креатив для SaaS.

### 6.5 Технические требования
- Подтверждённый домен, Aggregated Event Measurement с приоритетами `Subscribe` > `StartTrial` > `Lead`.
- Conversions API: сервер отправляет `Lead` при регистрации и `Subscribe` при первой оплате; `event_id` совпадает с событием Pixel; передаётся хеш e-mail, телефона, `fbp`, `fbc`, IP и user-agent — **только при согласии `ad_user_data`**.
- Атрибуция: 7 дней клик / 1 день просмотр. Сверяйте с GA4 и данными приложения по `fbclid`.

---

## 7. Бюджет и медиаплан

### 7.1 Первые 90 дней

| Месяц | Google | Meta | Итого | Цели |
|---|---|---|---|---|
| 1 (тест) | 6 000 | 3 000 | 9 000 PLN | 70–110 регистраций, CPL ≤ 130 PLN, отчёты по поисковым запросам, 6+ креативов Meta |
| 2 (оптимизация) | 6 000 | 3 000 | 9 000 PLN | CPL ≤ 110 PLN, первые 10–20 оплат, импорт офлайн-конверсий |
| 3 (масштаб) | 8 000–10 000 | 4 000–5 000 | 12 000–15 000 PLN | Рост, если CAC ≤ 900 PLN; YouTube/Demand Gen 10 % |

Распределение Google в 1-м месяце: G1 500 · G2 1 500 · G3 2 300 · G4 1 100 · G5 600.
Распределение Meta в 1-м месяце: M1 1 700 · M2 600 · M3 700.

**Правило масштабирования**: +20–30 % бюджета в неделю на кампанию с CAC (когорта) ≤ цели. Если 2 недели подряд CPL > 150 % от цели — урезать бюджет или остановить кампанию и пересмотреть ключи, креатив и лендинг.

### 7.2 Сезонность
- Пик подготовки продавцов: август–октябрь (перед Black Friday и Рождеством) — время повышать бюджет.
- Январь: продавцы ищут замену системы после новогоднего роста цен у конкурентов. Усилить G2 и сообщение «stała cena».
- Декабрь: продавцы заняты, конверсия в регистрацию ниже → бюджет −30 %, упор на ремаркетинг.

---

## 8. Воронка и KPI

| Этап | Метрика | Цель | Где смотреть |
|---|---|---|---|
| Показы → клик | CTR Search | ≥ 6 % (бренд ≥ 15 %), Meta CTR ≥ 1 % | Google Ads, Ads Manager |
| Клик → регистрация | CR лендинга | Search 4–8 %, Meta 1,5–3 % | GA4 |
| Регистрация → активация | Подключена интеграция за 3 дня | ≥ 45 % | Админка (статистика аккаунтов) |
| Активация → оплата | trial → paid | 15–20 % | Админка / биллинг |
| Экономика | CAC, LTV:CAC, окупаемость | ≤ 900 PLN, ≥ 3, ≤ 12 мес. | Таблица когорт |

**Ритм работы**:
- Ежедневно (10 мин.): расходы, аномалии, отклонённые объявления.
- Еженедельно: поисковые запросы и минус-слова, ставки, частота и усталость креативов, 1 A/B-тест (заголовок лендинга, оффер, креатив).
- Ежемесячно: когортный отчёт CAC/LTV, перераспределение бюджета между каналами, новые креативы.

**План A/B-тестов** (по одному за раз, 2 недели или 100+ конверсий на вариант):
1. Заголовок лендинга: цена против времени («49 zł» против «2 minuty na 40 paczek»).
2. Длина формы: 4 поля против e-mail + пароль.
3. Триал 14 против 30 дней.
4. Скидка за годовую оплату 20 % против 2 месяцев бесплатно.
5. Видео на первом экране лендинга против скриншота.

---

## 9. Право и комплаенс (Польша и ЕС)
- **RODO/GDPR**: согласие на маркетинговые cookies до загрузки тегов; Customer Match и Custom Audiences — только для контактов с согласием на маркетинг; договор обработки данных с Google и Meta (принимается в настройках аккаунтов).
- **Consent Mode v2** обязателен в ЕЭЗ.
- **Товарные знаки**: чужой бренд как ключевое слово — допустимо; в тексте объявления — нет. «Allegro», «Empik», «Kaufland» на сайте — только для описания интеграции («integracja z Allegro»), без стилизации под их логотипы и без «oficjalny partner», пока нет партнёрского статуса.
- **Сравнительная реклама**: сравнивать только проверяемые факты (цены с датой проверки и ссылкой на источник).
- **DSA**: Meta и Google публикуют объявления в библиотеках рекламы — тексты должны совпадать с реальными условиями.
- **Цены**: в рекламе B2B указывать «netto». Если рекламируете цену — условия (лимит заказов) на лендинге рядом.

---

## 10. Риски и что с ними делать
| Риск | Признак | Действие |
|---|---|---|
| Дорогой клик по конкурентам | CPC > 6 PLN, CR < 3 % | Только exact, лучший лендинг сравнения, ремаркетинг вместо широкого охвата |
| Мусорные регистрации с Meta | Активация < 20 % | Оптимизировать на `StartTrial`/активацию, исключить Audience Network, добавить вопрос «ile zamówień miesięcznie» в форму |
| Мало данных для Smart Bidding | < 30 конверсий в кампании | Объединить кампании, оптимизировать на «микроконверсию» (регистрация) |
| Конкурент поднимет ставки по бренду SellHub | CPC бренда растёт | Бренд-кампания с высоким QS, жалоба в Google, если в тексте есть наш бренд |
| Потеря атрибуции из-за cookies | В GA4 и в Ads сильно меньше конверсий, чем в приложении | Enhanced conversions, CAPI, офлайн-импорт, моделирование Consent Mode |

---

## 11. Что нужно доработать в продукте под рекламу
1. ✅ Сохранять при регистрации UTM-метки, `gclid`/`gbraid`/`wbraid`, `fbclid`/`_fbp`/`_fbc` и страницу входа; показывать источник клиента в панели поддержки; CSV-выгрузка платящих клиентов для импорта офлайн-конверсий в Google Ads (сделано вместе с этим планом).
2. Публичный сайт-лендинг (отдельно от приложения) со страницами из раздела 4.1, блогом и калькулятором.
3. Отправка серверных событий в Meta CAPI и Google Enhanced Conversions (нужен токен Meta и Google Ads API — подключать на проде).
4. Цепочка онбординг-писем (раздел 4.3) и чек-лист первых шагов в приложении.
5. Партнёрская и реферальная программа («poleć znajomemu — miesiąc gratis»): самый дешёвый канал после бренда.

---

## 12. Чек-лист запуска
- [ ] Лендинги `/`, `/alternatywa-dla-baselinker`, `/integracja-allegro`, `/integracja-empik`, `/integracja-kaufland`, `/cennik`
- [ ] CMP + Consent Mode v2 (проверить в Tag Assistant)
- [ ] GTM, GA4, события `sign_up`, `integration_connected`, `first_order_imported`, `purchase`
- [ ] Google Ads: конверсии, связь с GA4, автоимпорт офлайн-конверсий (по расписанию из CSV или через API)
- [ ] Meta: Business Manager, подтверждение домена, Pixel + CAPI, приоритет событий
- [ ] Минус-слова на уровне аккаунта, исключение логинов конкурентов
- [ ] 2 RSA на группу объявлений, все расширения
- [ ] 6+ креативов для Meta (2 видео, 2 статики, 1 карусель, 1 UGC)
- [ ] Онбординг-письма на дни 0/1/3/7/11/14
- [ ] Таблица когорт (регистрации → активация → оплата → CAC)
- [ ] Юрист проверил регламент, политику конфиденциальности, текст сравнения

## 13. Источники
- Рынок Allegro: zunapro.com, wiadomoscihandlowe.pl
- Жалобы продавцов на цены BaseLinker: [spolecznosc.allegro.pl — alternatywa dla BaseLinker](https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/alternatywa-dla-baselinker-podwy%C5%BCka-od-stycznia-i-enterprise-od/m-p/883309), [блог base.com о новых ценах](https://base.com/pl-PL/blog/?p=16018)
- Структура Google Ads B2B SaaS: saashero.net, tripledart.com, prosemedia
- Бенчмарки CPC и Quality Score: [metricnexus.ai](https://metricnexus.ai/blog/google-ads-benchmarks-2026), [growthspreeofficial.com](https://www.growthspreeofficial.com/blogs/b2b-saas-google-ads-quality-score-benchmarks-2026-by-keyword-tier-vertical-cpc-impact), [visionary-marketing.co.uk](https://visionary-marketing.co.uk/blog/google-ads-benchmarks-2026)
- Meta: [influee.co — benchmarki Facebook Ads 2026](https://influee.co/pl/blog/facebook-ads-benchmarks), [trendtrack.io — Meta ad spend 2025](https://www.trendtrack.io/blog-post/meta-ad-spend-by-industry), [adamigo.ai — CPM by country](https://www.adamigo.ai/blog/meta-ads-cpm-cpc-benchmarks-by-country-2026)
- Consent Mode v2: документация Google Ads (обязателен в ЕЭЗ)
- Trial → paid, LTV:CAC, окупаемость CAC: открытые отчёты по SaaS-метрикам 2025–2026 (Kyle Poyar / Growth Unhinged, First Page Sage, ChartMogul)
