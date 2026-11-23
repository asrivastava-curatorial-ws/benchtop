import { identifyHash } from '../../lib/hash-identify';
import { escapeHtml } from '../../lib/text';
import { defineTextTool } from '../types';

const SAMPLE = `5f4dcc3b5aa765d61d8327deb882cf99
8846F7EAEE8FB117AD06BDD830B7586C
5baa61e4c9b93f3f0682250b6cf8331b7ee68fd8
$2b$12$KIXQJ6Rz0pUg6vQ7qJmIPOqVJ0c3YQ9r0m1N8rK3nW2xYb5uZ0e6C
$argon2id$v=19$m=65536,t=3,p=4$c2FsdHNhbHQ$aGFzaGhhc2hoYXNoaGFzaA
$6$rounds=5000$saltsalt$abcdefghijklmnopqrstuvwxyz0123456789./ABCDEFGHIJKLMN
sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K/uxy9rx7HNQlGYl1kPzQho1wx4JwY8wC`;

export default defineTextTool({
  input: { label: 'Hashes (one per line)', sample: SAMPLE },
  output: { label: 'Likely algorithms' },
  options: [],
  run(input) {
    const rows = input
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 500)
      .map((hash) => ({ hash, guess: identifyHash(hash) }));
    if (rows.length === 0) return '';
    const short = (hash: string) => (hash.length > 48 ? `${hash.slice(0, 45)}…` : hash);
    const output = rows.map(({ hash, guess }) => `${short(hash)}\n  ${guess && guess.names.length > 0 ? guess.names.join(', ') : 'Unknown'}${guess ? `\n  ${guess.note}` : ''}`).join('\n\n');
    const html = `<table class="lint-table"><thead><tr><th>Hash</th><th>Most likely</th><th>Also possible</th><th>About</th></tr></thead><tbody>${rows
      .map(
        ({ hash, guess }) =>
          `<tr><td><code>${escapeHtml(short(hash))}</code></td><td>${escapeHtml(guess?.names[0] ?? 'Unknown')}</td><td>${escapeHtml(guess?.names.slice(1).join(', ') ?? '')}</td><td>${escapeHtml(guess?.note ?? '')}</td></tr>`,
      )
      .join('')}</tbody></table>`;
    return {
      output,
      preview: { kind: 'html', html },
      info: 'Hex digests of the same length look alike, so the length narrows the choice and the order shows what is most common. Confirm by hashing a known input with the Hash and HMAC tool.',
    };
  },
});
