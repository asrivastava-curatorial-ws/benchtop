/** Password hashes understood by Apache httpd and nginx `auth_basic_user_file`. */
import { md5, sha1 } from '@noble/hashes/legacy.js';
import bcrypt from 'bcryptjs';
import { concatBytes, randomInt, toBase64, utf8Encode } from './bytes';

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function to64(value: number, length: number): string {
  let out = '';
  let rest = value;
  for (let i = 0; i < length; i++) {
    out += ITOA64[rest & 0x3f];
    rest >>>= 6;
  }
  return out;
}

export function randomSalt(length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ITOA64[randomInt(64)];
  return out;
}

/** Apache's "apr1" variant of MD5-crypt (1000 rounds, salt of up to 8 characters). */
export function apr1(password: string, salt: string): string {
  const magic = '$apr1$';
  const pw = utf8Encode(password);
  const saltBytes = utf8Encode(salt.slice(0, 8));
  let final = md5(concatBytes(pw, saltBytes, pw));
  const first = md5.create().update(pw).update(utf8Encode(magic)).update(saltBytes);
  for (let remaining = pw.length; remaining > 0; remaining -= 16) first.update(final.subarray(0, Math.min(16, remaining)));
  for (let i = pw.length; i > 0; i >>= 1) first.update(i & 1 ? Uint8Array.of(0) : pw.subarray(0, 1));
  final = first.digest();
  for (let round = 0; round < 1000; round++) {
    const context = md5.create();
    context.update(round & 1 ? pw : final);
    if (round % 3) context.update(saltBytes);
    if (round % 7) context.update(pw);
    context.update(round & 1 ? final : pw);
    final = context.digest();
  }
  const f = final as Uint8Array & { [index: number]: number };
  const encoded =
    to64((f[0] << 16) | (f[6] << 8) | f[12], 4) +
    to64((f[1] << 16) | (f[7] << 8) | f[13], 4) +
    to64((f[2] << 16) | (f[8] << 8) | f[14], 4) +
    to64((f[3] << 16) | (f[9] << 8) | f[15], 4) +
    to64((f[4] << 16) | (f[10] << 8) | f[5], 4) +
    to64(f[11], 2);
  return `${magic}${salt.slice(0, 8)}$${encoded}`;
}

/** `{SHA}` + Base64(SHA-1): unsalted, kept only for legacy systems. */
export function shaEntry(password: string): string {
  return `{SHA}${toBase64(sha1(utf8Encode(password)))}`;
}

/** bcrypt with the `$2y$` prefix that `htpasswd -B` writes. */
export function bcryptEntry(password: string, cost: number): string {
  return bcrypt.hashSync(password, cost).replace(/^\$2[abxy]\$/, '$2y$');
}

/** bcrypt only uses the first 72 bytes of a password. */
export function bcryptTruncates(password: string): boolean {
  return utf8Encode(password).length > 72;
}

export type HashKind = 'bcrypt' | 'apr1' | 'sha1' | 'unknown';

export function hashKind(hash: string): HashKind {
  if (/^\$2[abxy]\$\d\d\$[./A-Za-z0-9]{53}$/.test(hash)) return 'bcrypt';
  if (/^\$apr1\$[./A-Za-z0-9]{1,8}\$[./A-Za-z0-9]{22}$/.test(hash)) return 'apr1';
  if (/^\{SHA\}[A-Za-z0-9+/]{27}=$/.test(hash)) return 'sha1';
  return 'unknown';
}

/** Checks a password against an htpasswd hash.  Returns `null` for unsupported hash types. */
export function verifyPassword(password: string, hash: string): boolean | null {
  switch (hashKind(hash)) {
    case 'bcrypt':
      // bcryptjs accepts the $2a/$2b/$2y prefixes; the algorithm is identical.
      return bcrypt.compareSync(password, hash.replace(/^\$2[xy]\$/, '$2b$'));
    case 'apr1':
      return apr1(password, hash.split('$')[2] ?? '') === hash;
    case 'sha1':
      return shaEntry(password) === hash;
    default:
      return null;
  }
}
