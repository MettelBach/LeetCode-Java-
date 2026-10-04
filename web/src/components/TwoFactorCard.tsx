import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { Field, Modal, useAction } from './ui';

interface Client {
  get<T = any>(path: string): Promise<T>;
  post<T = any>(path: string, body?: unknown): Promise<T>;
}

/** Enable / disable two-factor authentication (TOTP) for the signed-in user. */
export default function TwoFactorCard({ client, base, disabled }: { client: Client; base: string; disabled?: boolean }) {
  const t = useT();
  const run = useAction();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['2fa', base], queryFn: () => client.get<{ enabled: boolean }>(base) });
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [turningOff, setTurningOff] = useState(false);
  const [password, setPassword] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['2fa', base] });

  useEffect(() => {
    if (!setup) return;
    QRCode.toDataURL(setup.otpauth, { width: 200, margin: 1 }).then(setQr, () => setQr(''));
  }, [setup]);

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  const enabled = !!q.data?.enabled;

  return (
    <div className="card card-pad mt" style={{ maxWidth: 560 }}>
      <div className="card-title mb row" style={{ gap: 8 }}>
        <ShieldCheck size={20} color={enabled ? 'var(--green)' : '#8a9199'} /> {t('Two-factor authentication')}
      </div>
      <p className="text-muted" style={{ marginTop: 0 }}>
        {enabled
          ? t('Enabled. When logging in, you enter a code from the authenticator app after the password.')
          : t('Protect the account with a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).')}
      </p>
      {!disabled &&
        (enabled ? (
          <button className="btn" onClick={() => (setPassword(''), setCode(''), setTurningOff(true))}>
            {t('Turn off')}
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={async () => {
              const r = await run(() => client.post<{ secret: string; otpauth: string }>(`${base}/setup`));
              if (r) {
                setCode('');
                setSetup(r);
              }
            }}
          >
            {t('Turn on')}
          </button>
        ))}

      {setup && (
        <Modal
          title={t('Turn on two-factor authentication')}
          onClose={() => setSetup(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSetup(null)}>
                {t('Cancel')}
              </button>
              <button
                className="btn btn-primary"
                disabled={code.length !== 6}
                onClick={async () => {
                  const r = await run(() => client.post(`${base}/enable`, { code }), t('Two-factor authentication enabled'));
                  if (r) {
                    setSetup(null);
                    refresh();
                  }
                }}
              >
                {t('Turn on')}
              </button>
            </>
          }
        >
          <ol style={{ paddingLeft: 18, marginTop: 0 }}>
            <li>{t('Scan the QR code with the authenticator app.')}</li>
            <li>{t('Enter the 6-digit code shown in the app.')}</li>
          </ol>
          <div style={{ textAlign: 'center' }}>
            {qr && <img src={qr} width={200} height={200} alt="QR" />}
            <div className="text-small text-muted">{t('Or enter the key manually:')}</div>
            <div className="code" style={{ display: 'inline-block', marginTop: 4, wordBreak: 'break-all' }}>
              {setup.secret.replace(/(.{4})/g, '$1 ').trim()}
            </div>
          </div>
          <Field label={t('Code from the authenticator app')}>
            <input className="input" value={code} onChange={(e) => setCode(digits(e.target.value))} inputMode="numeric" autoComplete="one-time-code" autoFocus style={{ letterSpacing: '0.3em', fontSize: 18 }} />
          </Field>
        </Modal>
      )}

      {turningOff && (
        <Modal
          title={t('Turn off two-factor authentication')}
          onClose={() => setTurningOff(false)}
          footer={
            <>
              <button className="btn" onClick={() => setTurningOff(false)}>
                {t('Cancel')}
              </button>
              <button
                className="btn btn-danger"
                disabled={!password || code.length !== 6}
                onClick={async () => {
                  const r = await run(() => client.post(`${base}/disable`, { password, code }), t('Two-factor authentication disabled'));
                  if (r) {
                    setTurningOff(false);
                    refresh();
                  }
                }}
              >
                {t('Turn off')}
              </button>
            </>
          }
        >
          <Field label={t('Current password')}>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label={t('Code from the authenticator app')}>
            <input className="input" value={code} onChange={(e) => setCode(digits(e.target.value))} inputMode="numeric" autoComplete="one-time-code" style={{ letterSpacing: '0.3em', fontSize: 18 }} />
          </Field>
        </Modal>
      )}
    </div>
  );
}
