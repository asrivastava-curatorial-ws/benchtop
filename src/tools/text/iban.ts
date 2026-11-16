import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

/** IBAN lengths by country (SWIFT IBAN registry). */
export const IBAN_LENGTHS: Record<string, number> = {
  AD: 24,
  AE: 23,
  AL: 28,
  AT: 20,
  AZ: 28,
  BA: 20,
  BE: 16,
  BG: 22,
  BH: 22,
  BI: 27,
  BR: 29,
  BY: 28,
  CH: 21,
  CR: 22,
  CY: 28,
  CZ: 24,
  DE: 22,
  DJ: 27,
  DK: 18,
  DO: 28,
  EE: 20,
  EG: 29,
  ES: 24,
  FI: 18,
  FK: 18,
  FO: 18,
  FR: 27,
  GB: 22,
  GE: 22,
  GI: 23,
  GL: 18,
  GR: 27,
  GT: 28,
  HN: 28,
  HR: 21,
  HU: 28,
  IE: 22,
  IL: 23,
  IQ: 23,
  IS: 26,
  IT: 27,
  JO: 30,
  KW: 30,
  KZ: 20,
  LB: 28,
  LC: 32,
  LI: 21,
  LT: 20,
  LU: 20,
  LV: 21,
  LY: 25,
  MC: 27,
  MD: 24,
  ME: 22,
  MK: 19,
  MN: 20,
  MR: 27,
  MT: 31,
  MU: 30,
  NI: 28,
  NL: 18,
  NO: 15,
  OM: 23,
  PK: 24,
  PL: 28,
  PS: 29,
  PT: 25,
  QA: 29,
  RO: 24,
  RS: 22,
  RU: 33,
  SA: 24,
  SC: 31,
  SD: 18,
  SE: 24,
  SI: 19,
  SK: 24,
  SM: 27,
  SO: 23,
  ST: 25,
  SV: 28,
  TL: 23,
  TN: 24,
  TR: 26,
  UA: 29,
  VA: 22,
  VG: 24,
  XK: 20,
  YE: 30,
};

/** ISO 7064 MOD 97-10 over the rearranged IBAN; 1 means valid. */
export function ibanRemainder(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder;
}

export function checkDigitsFor(country: string, bban: string): string {
  return String(98 - ibanRemainder(`${country}00${bban}`)).padStart(2, '0');
}

export default defineTextTool({
  input: { label: 'IBANs', placeholder: 'One per line, with or without spaces', sample: 'GB82 WEST 1234 5698 7654 32\nDE89370400440532013000' },
  output: { label: 'Formatted' },
  options: [],
  run(input) {
    const lines = input.split(/\r?\n/).filter((line) => line.trim() !== '');
    const fields: Field[] = [];
    const out = lines.map((line, index) => {
      const iban = line.replace(/[\s-]/g, '').toUpperCase();
      if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(iban)) throw new ToolError(`Line ${index + 1} is not shaped like an IBAN (two letters, two digits, then letters and digits).`, { line: index + 1 });
      const country = iban.slice(0, 2);
      const expected = IBAN_LENGTHS[country];
      const valid = ibanRemainder(iban) === 1;
      const lengthOk = expected === undefined || iban.length === expected;
      const formatted = (iban.match(/.{1,4}/g) ?? []).join(' ');
      if (lines.length === 1) {
        fields.push(
          {
            label: 'Valid',
            value:
              valid && lengthOk
                ? 'Yes'
                : !lengthOk
                  ? `No: ${country} IBANs have ${expected} characters, this has ${iban.length}`
                  : `No: the check digits should be ${checkDigitsFor(country, iban.slice(4))}`,
            tone: valid && lengthOk ? 'ok' : 'bad',
          },
          { label: 'Country', value: expected === undefined ? `${country} (not in the IBAN registry)` : country },
          { label: 'Check digits', value: iban.slice(2, 4), mono: true },
          { label: 'Account (BBAN)', value: iban.slice(4), mono: true },
          { label: 'Electronic format', value: iban, mono: true },
        );
      }
      return `${formatted}\t${valid && lengthOk ? 'valid' : 'INVALID'}`;
    });
    return { output: out.join('\n'), fields, info: 'India does not use IBANs; Indian accounts are identified by an IFSC code and account number.' };
  },
});
