/** Helpers for the WireGuard generator and the time zone planner. */
import { x25519 } from '@noble/curves/ed25519.js';
import { fromBase64, toBase64 } from './bytes';

/** A WireGuard key pair: a clamped random X25519 private key and its public key, both Base64. */
export function wireguardKeys(): { privateKey: string; publicKey: string } {
  const secret = x25519.utils.randomSecretKey();
  return { privateKey: toBase64(secret), publicKey: toBase64(x25519.getPublicKey(secret)) };
}

export const publicFor = (privateKey: string): string => toBase64(x25519.getPublicKey(fromBase64(privateKey.trim())));

/** Offset of `zone` from UTC at `when`, in minutes. */
export function offsetMinutes(zone: string, when: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(when);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(when.getTime() / 1000) * 1000) / 60000);
}

/** The instant when the wall clock in `zone` shows `local` (YYYY-MM-DDTHH:MM). */
export function instantIn(zone: string, local: string): Date {
  const [d, t] = local.split('T');
  const [y, mo, da] = (d ?? '').split('-').map(Number);
  const [h, mi] = (t ?? '00:00').split(':').map(Number);
  const guess = Date.UTC(y ?? 1970, (mo ?? 1) - 1, da ?? 1, h ?? 0, mi ?? 0);
  let when = new Date(guess - offsetMinutes(zone, new Date(guess)) * 60000);
  when = new Date(guess - offsetMinutes(zone, when) * 60000);
  return when;
}
