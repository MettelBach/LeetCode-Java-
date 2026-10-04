import { Link } from 'react-router-dom';
import { BRAND } from '../brand';
import { LogoMark } from '../components/ui';
import { useI18n } from '../i18n';

/**
 * Template legal documents. They must be reviewed and completed by a lawyer
 * (company data, data processing agreement) before going live.
 */
const TERMS: Record<string, string[]> = {
  pl: [
    '§1. Postanowienia ogólne. Regulamin określa zasady korzystania z usługi {brand} — systemu do zarządzania sprzedażą internetową świadczonego drogą elektroniczną.',
    '§2. Konto. Do korzystania z usługi wymagana jest rejestracja konta. Użytkownik odpowiada za poufność danych logowania oraz za działania wykonane z jego konta.',
    '§3. Okres próbny i opłaty. Nowe konto otrzymuje bezpłatny okres próbny. Po jego zakończeniu korzystanie z usługi wymaga wyboru planu i opłacenia abonamentu zgodnie z cennikiem. Akceleracje rozliczane są za każdy dzień aktywności.',
    '§4. Integracje. Usługa łączy się z serwisami zewnętrznymi (Allegro, Empik, Kaufland) na podstawie danych dostępowych przekazanych przez użytkownika. Dostawca nie odpowiada za niedostępność lub zmiany API serwisów zewnętrznych.',
    '§5. Wsparcie techniczne. Pracownicy wsparcia mogą zalogować się do konta wyłącznie w celu rozwiązania zgłoszenia; każde takie logowanie jest rejestrowane.',
    '§6. Dane osobowe. Dostawca przetwarza dane osobowe kupujących w imieniu użytkownika jako podmiot przetwarzający na podstawie umowy powierzenia (art. 28 RODO).',
    '§7. Reklamacje. Reklamacje można składać przez formularz „Pomoc i kontakt". Odpowiedź udzielana jest w ciągu 14 dni.',
    '§8. Rozwiązanie umowy. Użytkownik może w każdej chwili zrezygnować z usługi. Dane konta są usuwane na żądanie lub po 90 dniach od zamknięcia konta.',
  ],
  en: [
    '§1. General. These terms govern the use of {brand} — an online sales management system provided electronically.',
    '§2. Account. Registration is required. The user is responsible for keeping login data confidential and for actions performed from the account.',
    '§3. Trial and fees. New accounts get a free trial. Afterwards, a plan must be chosen and the subscription paid according to the price list. Accelerations are billed for each active day.',
    '§4. Integrations. The service connects to external services (Allegro, Empik, Kaufland) using credentials provided by the user. The provider is not responsible for unavailability or changes of external APIs.',
    '§5. Support. Support staff may log in to an account only to resolve a ticket; every such login is recorded.',
    "§6. Personal data. The provider processes buyers' personal data on behalf of the user as a processor under a data processing agreement (Art. 28 GDPR).",
    '§7. Complaints. Complaints can be submitted via "Help and contact". The answer is given within 14 days.',
    '§8. Termination. The user may cancel the service at any time. Account data is deleted on request or 90 days after the account is closed.',
  ],
};

const PRIVACY: Record<string, string[]> = {
  pl: [
    'Administratorem danych osobowych użytkowników konta jest operator usługi {brand}.',
    'Dane przetwarzamy w celu świadczenia usługi, rozliczeń i obsługi zgłoszeń (art. 6 ust. 1 lit. b, c i f RODO).',
    'Dane kupujących (z zamówień) przetwarzamy wyłącznie na polecenie użytkownika, jako podmiot przetwarzający.',
    'Dane każdego konta przechowywane są w odrębnej bazie danych. Hasła są przechowywane w postaci zahaszowanej (bcrypt).',
    'Przysługuje Ci prawo dostępu do danych, ich sprostowania, usunięcia, ograniczenia przetwarzania, przenoszenia oraz wniesienia skargi do Prezesa UODO.',
    'Panel używa wyłącznie niezbędnej pamięci przeglądarki (token sesji, ustawienia widoku). Nie stosujemy plików cookie śledzących.',
  ],
  en: [
    'The controller of account users’ personal data is the operator of {brand}.',
    'Data is processed to provide the service, for billing and handling tickets (Art. 6(1)(b), (c) and (f) GDPR).',
    "Buyers' data (from orders) is processed only on the user's instructions, as a processor.",
    'Each account’s data is stored in a separate database. Passwords are stored hashed (bcrypt).',
    'You have the right to access, rectify, erase, restrict processing, data portability and to lodge a complaint with the supervisory authority.',
    'The panel uses only strictly necessary browser storage (session token, view settings). No tracking cookies are used.',
  ],
};

export function LegalPage({ kind }: { kind: 'terms' | 'privacy' }) {
  const { lang } = useI18n();
  const src = kind === 'terms' ? TERMS : PRIVACY;
  const paras = src[lang === 'pl' ? 'pl' : 'en'];
  const title = kind === 'terms' ? (lang === 'pl' ? 'Regulamin' : 'Terms of service') : lang === 'pl' ? 'Polityka prywatności' : 'Privacy policy';
  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '40px 20px' }}>
      <Link to="/" className="row" style={{ color: 'var(--text)', fontWeight: 700, fontSize: 20, gap: 10, textDecoration: 'none', marginBottom: 20 }}>
        <LogoMark /> {BRAND.name}
      </Link>
      <div className="card card-pad" style={{ lineHeight: 1.7 }}>
        <h1 style={{ fontSize: 26, marginBottom: 16 }}>{title}</h1>
        {paras.map((p, i) => (
          <p key={i}>{p.replace('{brand}', BRAND.name)}</p>
        ))}
      </div>
    </div>
  );
}
