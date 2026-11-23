/**
 * Guesses what produced a hash or password-hash string from its prefix, length
 * and alphabet.  Plain hex digests of the same length are indistinguishable,
 * so those return every common candidate, most likely first.
 */
export interface HashGuess {
  /** The candidates, most likely first. */
  readonly names: readonly string[];
  /** What the format is used for, or why it is not a hash. */
  readonly note: string;
  /** A password hash with its own salt and work factor (safe to store passwords with). */
  readonly password?: boolean;
}

const PREFIXES: readonly [RegExp, string, string, boolean?][] = [
  [/^\$2[abxy]?\$\d{2}\$[./A-Za-z0-9]{53}$/, 'bcrypt', 'Password hash with a salt and a cost factor (the number after $2b$).', true],
  [/^\$argon2(id|i|d)\$/, 'Argon2', 'Modern password hash (memory-hard); the parameters follow the prefix.', true],
  [/^\$scrypt\$|^\$7\$/, 'scrypt', 'Memory-hard password hash.', true],
  [/^\$y\$/, 'yescrypt', 'Password hash used by recent Debian, Ubuntu and Fedora in /etc/shadow.', true],
  [/^\$gy\$/, 'gost-yescrypt', 'yescrypt variant from libxcrypt.', true],
  [/^\$6\$/, 'SHA-512 crypt', 'Unix password hash (/etc/shadow) with salt and rounds.', true],
  [/^\$5\$/, 'SHA-256 crypt', 'Unix password hash with salt and rounds.', true],
  [/^\$1\$/, 'MD5 crypt', 'Old Unix password hash; weak by today’s standards.', true],
  [/^\$apr1\$/, 'Apache MD5 (apr1)', 'Apache .htpasswd password hash; weak by today’s standards.', true],
  [/^\{SHA\}[A-Za-z0-9+/]{27}=$/, 'SHA-1 (htpasswd {SHA})', 'Unsalted SHA-1 in Base64; weak.'],
  [/^\{SSHA\}/, 'Salted SHA-1 (LDAP {SSHA})', 'LDAP password hash; weak by today’s standards.', true],
  [/^\{SSHA512\}/, 'Salted SHA-512 (LDAP {SSHA512})', 'LDAP password hash.', true],
  [/^pbkdf2_sha256\$\d+\$/, 'PBKDF2-SHA256 (Django)', 'Django’s default password hash.', true],
  [/^pbkdf2_sha1\$\d+\$/, 'PBKDF2-SHA1 (Django)', 'Older Django password hash.', true],
  [/^argon2\$argon2/, 'Argon2 (Django)', 'Django’s Argon2 password hash.', true],
  [/^bcrypt_sha256\$/, 'bcrypt SHA-256 (Django)', 'Django’s bcrypt password hash.', true],
  [/^\$pbkdf2(-sha(1|256|512))?\$/, 'PBKDF2 (passlib)', 'PBKDF2 password hash in passlib’s format.', true],
  [/^\$P\$|^\$H\$/, 'phpass (WordPress, phpBB)', 'Portable PHP password hash, based on MD5.', true],
  [/^\$S\$/, 'Drupal 7 SHA-512', 'Drupal 7 password hash.', true],
  [/^\*[0-9A-F]{40}$/, 'MySQL 4.1+ PASSWORD()', 'Double SHA-1, unsalted; weak.'],
  [/^sha(256|384|512)-[A-Za-z0-9+/]+=*$/, 'Subresource Integrity', 'The integrity value of a <script> or <link> tag: a Base64 SHA-2 digest.'],
  [/^0x[0-9a-fA-F]{64}$/, 'Keccak-256 (Ethereum)', 'An Ethereum transaction or block hash, or another 256-bit value.'],
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'UUID', 'An identifier, not a hash (version 3 and 5 UUIDs are built from MD5 and SHA-1).'],
  [/^eyJ[\w-]*\.eyJ[\w-]*\.[\w-]*$/, 'JSON Web Token', 'A signed token, not a hash: decode it with the JWT Decoder.'],
];

const HEX: Record<number, readonly string[]> = {
  8: ['CRC-32', 'Adler-32', 'FNV-1a 32', 'xxHash32'],
  16: ['xxHash64', 'CRC-64', 'MySQL 3.23 PASSWORD()', 'SipHash'],
  32: ['MD5', 'NTLM', 'MD4', 'LM', 'RIPEMD-128', 'xxHash128'],
  40: ['SHA-1', 'RIPEMD-160', 'Git object ID'],
  48: ['Tiger-192'],
  56: ['SHA-224', 'SHA3-224', 'SHA-512/224'],
  64: ['SHA-256', 'SHA3-256', 'BLAKE2s-256', 'BLAKE3', 'Keccak-256', 'SHA-512/256'],
  96: ['SHA-384', 'SHA3-384'],
  128: ['SHA-512', 'SHA3-512', 'BLAKE2b-512', 'Whirlpool'],
};

/** Base64 digest lengths (with padding) by digest size. */
const BASE64: Record<number, readonly string[]> = {
  24: ['MD5 (Base64)'],
  28: ['SHA-1 (Base64)'],
  44: ['SHA-256 (Base64)', 'BLAKE2s-256 (Base64)'],
  64: ['SHA-384 (Base64)'],
  88: ['SHA-512 (Base64)', 'BLAKE2b-512 (Base64)'],
};

export function identifyHash(raw: string): HashGuess | null {
  const text = raw.trim();
  if (text === '') return null;
  for (const [pattern, name, note, password] of PREFIXES) if (pattern.test(text)) return { names: [name], note, ...(password ? { password } : {}) };
  if (/^[0-9a-fA-F]+$/.test(text)) {
    const names = HEX[text.length];
    if (names) {
      const upper = text === text.toUpperCase() && /[A-F]/.test(text);
      // LM and NTLM are usually written in upper case.
      const ordered = text.length === 32 && upper ? ['NTLM', 'LM', 'MD5', 'MD4', 'RIPEMD-128', 'xxHash128'] : names;
      return { names: ordered, note: `${text.length * 4}-bit hex digest. Unsalted fast hashes like these are fine for checksums but not for storing passwords.` };
    }
    return { names: [], note: `${text.length} hex characters (${text.length * 4} bits) matches no common hash length.` };
  }
  const base64 = BASE64[text.length];
  if (base64 && /^[A-Za-z0-9+/]+={0,2}$/.test(text)) return { names: base64, note: 'A digest written in Base64 instead of hex.' };
  if (/^[A-Za-z0-9_-]{43}$/.test(text)) return { names: ['SHA-256 (Base64url)'], note: 'A 256-bit digest in URL-safe Base64 without padding.' };
  return { names: [], note: 'Not a recognised hash format.' };
}
