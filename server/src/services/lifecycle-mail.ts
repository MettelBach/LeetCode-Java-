/**
 * Onboarding e-mails for trial accounts: help to connect a marketplace, show
 * automatic actions, remind about the end of the trial. Each message is sent
 * once per account (keys stored in accounts.settings.lifecycle).
 */
import { config } from '../config.js';
import { parseJson, platformDb, tenantDb } from '../db/index.js';
import { platformMail } from './platform.js';

type Lang = 'pl' | 'en' | 'ru';
type Msg = Record<Lang, { subject: string; body: string }>;

const sign = { pl: `Zespół ${config.brandName}`, en: `The ${config.brandName} team`, ru: `Команда ${config.brandName}` };

const MESSAGES: Record<string, Msg> = {
  connect: {
    pl: {
      subject: 'Podłącz Allegro, Empik lub Kaufland w 2 minuty',
      body: `Dzień dobry {name},\n\nTwoje konto jest gotowe, ale nie podłączyłeś jeszcze żadnego marketplace.\nWejdź w Integracje → Dodaj integrację i wybierz Allegro, Empik lub Kaufland — zamówienia zaczną spływać automatycznie.\n\n{url}/integrations/add\n\nPotrzebujesz pomocy? Odpowiedz na tę wiadomość lub napisz w Pomoc i kontakt.`,
    },
    en: {
      subject: 'Connect Allegro, Empik or Kaufland in 2 minutes',
      body: `Hello {name},\n\nyour account is ready, but no marketplace is connected yet.\nGo to Integrations → Add integration and choose Allegro, Empik or Kaufland — orders will start coming in automatically.\n\n{url}/integrations/add\n\nNeed help? Reply to this e-mail or write in Help & contact.`,
    },
    ru: {
      subject: 'Подключите Allegro, Empik или Kaufland за 2 минуты',
      body: `Здравствуйте, {name}!\n\nВаш аккаунт готов, но маркетплейс ещё не подключён.\nОткройте Интеграции → Добавить интеграцию и выберите Allegro, Empik или Kaufland — заказы начнут поступать автоматически.\n\n{url}/integrations/add\n\nНужна помощь? Ответьте на это письмо или напишите в «Помощь и контакты».`,
    },
  },
  automation: {
    pl: {
      subject: 'Niech zamówienia obsługują się same',
      body: `Dzień dobry {name},\n\nakcje automatyczne zrobią za Ciebie powtarzalną pracę, np.:\n• zamówienie opłacone → status „Do wysłania" i e-mail do kupującego,\n• klient chce fakturę → faktura wystawia się sama,\n• status „Do wysłania" → przesyłka InPost i etykieta.\n\n{url}/automation\n\nW Pomocy znajdziesz gotowe przykłady.`,
    },
    en: {
      subject: 'Let orders process themselves',
      body: `Hello {name},\n\nautomatic actions do the repetitive work for you, e.g.:\n• order paid → status "To send" and an e-mail to the buyer,\n• the customer wants an invoice → the invoice is issued automatically,\n• status "To send" → an InPost shipment and a label.\n\n{url}/automation\n\nYou will find ready-made examples in the Help center.`,
    },
    ru: {
      subject: 'Пусть заказы обрабатываются сами',
      body: `Здравствуйте, {name}!\n\nАвтоматические действия выполнят рутинную работу за вас, например:\n• заказ оплачен → статус «К отправке» и письмо покупателю,\n• клиент хочет счёт → счёт выставляется сам,\n• статус «К отправке» → отправка InPost и этикетка.\n\n{url}/automation\n\nГотовые примеры есть в разделе «Помощь».`,
    },
  },
  trial_ending: {
    pl: {
      subject: 'Okres próbny kończy się za {days} dni',
      body: `Dzień dobry {name},\n\nTwój okres próbny kończy się {date}. Aby dalej pobierać zamówienia i synchronizować stany, wybierz plan w Ustawienia → Abonament.\n\n{url}/settings/subscription\n\nWszystkie dane i konfiguracja zostaną zachowane.`,
    },
    en: {
      subject: 'Your trial ends in {days} days',
      body: `Hello {name},\n\nyour trial ends on {date}. To keep downloading orders and synchronizing stock, choose a plan in Settings → Subscription.\n\n{url}/settings/subscription\n\nAll your data and configuration will be kept.`,
    },
    ru: {
      subject: 'Пробный период заканчивается через {days} дн.',
      body: `Здравствуйте, {name}!\n\nВаш пробный период заканчивается {date}. Чтобы продолжить загрузку заказов и синхронизацию остатков, выберите тариф в Настройки → Подписка.\n\n{url}/settings/subscription\n\nВсе данные и настройки сохранятся.`,
    },
  },
  trial_ended: {
    pl: {
      subject: 'Okres próbny zakończył się — Twoje dane czekają',
      body: `Dzień dobry {name},\n\nokres próbny dobiegł końca i konto jest w trybie tylko do odczytu. Zamówienia nie są pobierane.\nWybierz plan, aby wznowić pracę — wszystko jest tak, jak zostawiłeś.\n\n{url}/settings/subscription\n\nMasz pytania o cenę lub potrzebujesz więcej czasu? Odpowiedz na tę wiadomość.`,
    },
    en: {
      subject: 'Your trial has ended — your data is waiting',
      body: `Hello {name},\n\nthe trial has ended and the account is read-only. Orders are not downloaded.\nChoose a plan to continue — everything is just as you left it.\n\n{url}/settings/subscription\n\nQuestions about pricing or need more time? Reply to this e-mail.`,
    },
    ru: {
      subject: 'Пробный период завершён — ваши данные ждут',
      body: `Здравствуйте, {name}!\n\nПробный период закончился, аккаунт доступен только для чтения. Заказы не загружаются.\nВыберите тариф, чтобы продолжить — всё осталось так, как вы оставили.\n\n{url}/settings/subscription\n\nЕсть вопросы о цене или нужно больше времени? Ответьте на это письмо.`,
    },
  },
};

const DAY = 86400_000;
const parseUtc = (s: string) => new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');

interface Row {
  id: number;
  status: string;
  language: string;
  settings: string;
  trial_ends_at: string | null;
  paid_until: string | null;
  created_at: string;
  email: string;
  name: string;
}

/** Which lifecycle message (if any) is due for an account now. */
export function dueMessage(a: Row, now: Date, hasIntegration: boolean, sent: string[]): string | null {
  const age = (now.getTime() - parseUtc(a.created_at).getTime()) / DAY;
  const trialEnd = a.trial_ends_at ? parseUtc(a.trial_ends_at).getTime() : null;
  const due: string[] = [];
  if (a.status === 'trial') {
    if (age >= 1 && age < 6 && !hasIntegration) due.push('connect');
    if (age >= 3 && age < 10) due.push('automation');
    if (trialEnd && trialEnd - now.getTime() <= 3 * DAY && trialEnd > now.getTime()) due.push('trial_ending');
  }
  if (a.status === 'suspended' && !a.paid_until && trialEnd && now.getTime() - trialEnd < 7 * DAY) due.push('trial_ended');
  return due.find((k) => !sent.includes(k)) ?? null;
}

export async function sendLifecycleMails(now = new Date()) {
  const rows = platformDb
    .prepare(
      `SELECT a.id, a.status, a.language, a.settings, a.trial_ends_at, a.paid_until, a.created_at, u.email, u.name
       FROM accounts a JOIN users u ON u.account_id = a.id AND u.role = 'owner' AND u.active = 1
       WHERE a.status IN ('trial', 'suspended')`,
    )
    .all() as Row[];
  let count = 0;
  for (const a of rows) {
    try {
      const settings = parseJson<any>(a.settings, {});
      if (settings.lifecycle_mails === false) continue;
      const sent: string[] = settings.lifecycle ?? [];
      const hasIntegration = !!tenantDb(a.id).prepare('SELECT 1 FROM integrations WHERE demo = 0').get();
      const key = dueMessage(a, now, hasIntegration, sent);
      if (!key) continue;
      const lang = (['pl', 'en', 'ru'].includes(a.language) ? a.language : 'pl') as Lang;
      const m = MESSAGES[key][lang];
      const trialEnd = a.trial_ends_at ? parseUtc(a.trial_ends_at) : now;
      const vars: Record<string, string> = {
        name: a.name,
        url: config.appUrl,
        days: String(Math.max(1, Math.ceil((trialEnd.getTime() - now.getTime()) / DAY))),
        date: trialEnd.toISOString().slice(0, 10).split('-').reverse().join('.'),
      };
      const fill = (s: string) => s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
      // Mark as sent first: a failing SMTP server must not cause repeated e-mails every day.
      settings.lifecycle = [...sent, key];
      platformDb.prepare('UPDATE accounts SET settings = ? WHERE id = ?').run(JSON.stringify(settings), a.id);
      await platformMail(a.email, fill(m.subject), `${fill(m.body)}\n\n${sign[lang]}`);
      count++;
    } catch (e) {
      console.error(`[lifecycle] account ${a.id}`, e);
    }
  }
  return count;
}
