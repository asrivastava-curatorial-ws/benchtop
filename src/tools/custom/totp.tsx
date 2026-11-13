/** Time-based one-time passwords: current code, verification and authenticator set-up. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { buildOtpAuthUri, decodeSecret, newSecret, type OtpAlgorithm, parseOtpAuthUri, totp, verifyTotp } from '../../lib/totp';
import { copyText } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

interface Settings {
  readonly issuer: string;
  readonly account: string;
  readonly algorithm: OtpAlgorithm;
  readonly digits: 6 | 8;
  readonly period: 30 | 60;
}

/** The secret is never written to disk; it survives only while the app is open. */
let sessionSecret = '';

function readSettings(stored: Values | undefined): Settings {
  return {
    issuer: typeof stored?.issuer === 'string' ? stored.issuer : 'Benchtop',
    account: typeof stored?.account === 'string' ? stored.account : 'me@example.org',
    algorithm: stored?.algorithm === 'SHA256' || stored?.algorithm === 'SHA512' ? stored.algorithm : 'SHA1',
    digits: stored?.digits === 8 ? 8 : 6,
    period: stored?.period === 60 ? 60 : 30,
  };
}

const group = (code: string) => (code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : `${code.slice(0, 4)} ${code.slice(4)}`);

function Totp({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, readSettings, (s) => ({ ...s }));
  const [secret, setSecret] = useState(sessionSecret);
  const [now, setNow] = useState(Date.now());
  const [check, setCheck] = useState('');
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    sessionSecret = secret;
  }, [secret]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const key = useMemo((): { bytes: Uint8Array } | { error: string } | null => {
    if (secret.trim() === '') return null;
    try {
      return { bytes: decodeSecret(secret) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [secret]);

  const options = { algorithm: settings.algorithm, digits: settings.digits, period: settings.period };
  const step = Math.floor(now / 1000 / settings.period);
  const remaining = settings.period - (Math.floor(now / 1000) % settings.period);
  const uri = key && 'bytes' in key ? buildOtpAuthUri({ ...settings, secret }) : '';

  useEffect(() => {
    if (!uri) {
      setQr(null);
      return;
    }
    let cancelled = false;
    import('bwip-js/generic').then(
      ({ toSVG }) => {
        const svg = toSVG({ bcid: 'qrcode', text: uri, scale: 4, eclevel: 'M', backgroundcolor: 'FFFFFF', paddingwidth: 4, paddingheight: 4 } as never);
        if (!cancelled) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      },
      () => setQr(null),
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const pasteSecret = (text: string) => {
    if (/^otpauth:\/\//i.test(text.trim())) {
      try {
        const parsed = parseOtpAuthUri(text);
        setSecret(parsed.secret);
        setSettings({ issuer: parsed.issuer, account: parsed.account, algorithm: parsed.algorithm, digits: parsed.digits === 8 ? 8 : 6, period: parsed.period === 60 ? 60 : 30 });
        return;
      } catch (error) {
        notify(errorMessage(error), 'error');
      }
    }
    setSecret(text);
  };

  const copy = (text: string, what: string) =>
    attempt(async () => {
      await copyText(text);
      notify(`Copied ${what}`);
    });

  const verdict = (() => {
    if (!key || !('bytes' in key) || check.replace(/\s/g, '') === '') return null;
    const offset = verifyTotp(key.bytes, check, now, { ...options, window: 1 });
    if (offset === null) return { text: 'Not valid now', tone: 'bad' };
    return { text: offset === 0 ? 'Valid (current code)' : offset < 0 ? 'Valid (previous code, still accepted by most servers)' : 'Valid (next code: this clock may be behind)', tone: 'ok' };
  })();

  return (
    <section class="tool layout-form" data-testid="tool" data-state={key === null ? 'idle' : 'error' in key ? 'error' : 'done'}>
      <aside class="tool-side">
        <div class="tool-options">
          <label class="control">
            <span class="control-label">Secret (Base32) or otpauth:// link</span>
            <input
              class={`input input-mono${key && 'error' in key ? ' is-invalid' : ''}`}
              type="text"
              value={secret}
              spellcheck={false}
              autocomplete="off"
              placeholder="JBSWY3DPEHPK3PXP"
              onInput={(event) => pasteSecret(event.currentTarget.value)}
              data-testid="totp-secret"
            />
          </label>
          <div class="button-row">
            <button type="button" class="button button-small" onClick={() => setSecret(newSecret())}>
              <Icon name="refresh" size={14} />
              New secret
            </button>
            {secret && (
              <button type="button" class="button button-small button-quiet" onClick={() => setSecret('')}>
                Clear
              </button>
            )}
          </div>
          {key && 'error' in key && <p class="control-help tone-bad">{key.error}</p>}
          <div class="control">
            <span class="control-label">Algorithm</span>
            <Segmented
              label="Algorithm"
              value={settings.algorithm}
              onChange={(algorithm) => setSettings((previous) => ({ ...previous, algorithm }))}
              choices={[
                { value: 'SHA1', label: 'SHA-1' },
                { value: 'SHA256', label: 'SHA-256' },
                { value: 'SHA512', label: 'SHA-512' },
              ]}
            />
          </div>
          <div class="control">
            <span class="control-label">Digits and period</span>
            <div class="button-row">
              <Segmented
                label="Digits"
                value={String(settings.digits) as '6' | '8'}
                onChange={(digits) => setSettings((previous) => ({ ...previous, digits: digits === '8' ? 8 : 6 }))}
                choices={[
                  { value: '6', label: '6 digits' },
                  { value: '8', label: '8 digits' },
                ]}
              />
              <Segmented
                label="Period"
                value={String(settings.period) as '30' | '60'}
                onChange={(period) => setSettings((previous) => ({ ...previous, period: period === '60' ? 60 : 30 }))}
                choices={[
                  { value: '30', label: '30 s' },
                  { value: '60', label: '60 s' },
                ]}
              />
            </div>
          </div>
          <label class="control">
            <span class="control-label">Issuer (shown in the app)</span>
            <input class="input" value={settings.issuer} onInput={(event) => setSettings((previous) => ({ ...previous, issuer: event.currentTarget.value }))} />
          </label>
          <label class="control">
            <span class="control-label">Account</span>
            <input class="input" value={settings.account} onInput={(event) => setSettings((previous) => ({ ...previous, account: event.currentTarget.value }))} />
          </label>
          <p class="control-help">The secret is kept only while Benchtop is open and is never saved to disk.</p>
        </div>
      </aside>
      <div class="tool-main">
        {key && 'bytes' in key ? (
          <>
            <div class="totp-card">
              <div>
                <div class="pane-meta">Current code</div>
                <button type="button" class="totp-code" onClick={() => copy(totp(key.bytes, now, options), 'the code')} title="Copy" data-testid="totp-code">
                  {group(totp(key.bytes, now, options))}
                </button>
                <div class="totp-bar" aria-hidden="true">
                  <span style={`width: ${(remaining / settings.period) * 100}%;`} />
                </div>
                <div class="pane-meta">
                  Changes in {remaining} s. Previous {group(totp(key.bytes, (step - 1) * settings.period * 1000, options))}, next {group(totp(key.bytes, (step + 1) * settings.period * 1000, options))}
                  .
                </div>
              </div>
              <label class="control totp-check">
                <span class="control-label">Check a code</span>
                <input class="input input-mono" inputMode="numeric" value={check} onInput={(event) => setCheck(event.currentTarget.value)} placeholder="123 456" />
                {verdict && <span class={`tone-${verdict.tone}`}>{verdict.text}</span>}
              </label>
            </div>
            <div class="pane totp-setup">
              <div class="pane-header">
                <span class="pane-title">Add to an authenticator app</span>
                <div class="pane-actions">
                  <button type="button" class="button button-small" onClick={() => copy(uri, 'the link')}>
                    <Icon name="copy" size={14} />
                    Copy link
                  </button>
                </div>
              </div>
              <div class="totp-setup-body">
                {qr && <img src={qr} alt="QR code with the otpauth link" width={200} height={200} />}
                <div>
                  <code class="totp-uri">{uri}</code>
                  <p class="control-help">Scan the code with Aegis, FreeOTP, Google Authenticator or another TOTP app. Anyone who sees this code or link can generate your codes.</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div class="empty-state">
            <Icon name="info" size={20} />
            <p>Paste the secret a service shows when you turn on two-factor sign-in, or press "New secret" to set up your own.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(Totp);
