import { defineTextTool, type Field } from '../types';

/** Luhn (mod 10) check used by payment cards, IMEIs and many ID numbers. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return digits.length > 0 && sum % 10 === 0;
}

export function luhnCheckDigit(partial: string): number {
  for (let digit = 0; digit <= 9; digit++) if (luhnValid(partial + digit)) return digit;
  return 0;
}

const BRANDS: { name: string; test: RegExp; lengths: number[] }[] = [
  { name: 'American Express', test: /^3[47]/, lengths: [15] },
  { name: 'Diners Club', test: /^3(0[0-5]|[689])/, lengths: [14, 16, 19] },
  { name: 'JCB', test: /^35(2[89]|[3-8])/, lengths: [16, 17, 18, 19] },
  { name: 'RuPay', test: /^(508[5-9]|60(69|7[0-9]|8[0-4])|65(2[1-9]|30)|81|82|353|356)/, lengths: [16] },
  { name: 'Visa', test: /^4/, lengths: [13, 16, 19] },
  { name: 'Mastercard', test: /^(5[1-5]|2(2[2-9][1-9]|2[3-9]\d|[3-6]\d\d|7[01]\d|720))/, lengths: [16] },
  { name: 'Discover', test: /^(6011|64[4-9]|65)/, lengths: [16, 17, 18, 19] },
  { name: 'UnionPay', test: /^62/, lengths: [16, 17, 18, 19] },
  { name: 'Maestro', test: /^(5[06-9]|6\d)/, lengths: [12, 13, 14, 15, 16, 17, 18, 19] },
];

export const brandOf = (digits: string) => BRANDS.find((brand) => brand.test.test(digits));

/** Numbers published by payment gateways for sandbox testing; they never charge real accounts. */
const TEST_NUMBERS = [
  ['Visa (Stripe test)', '4242 4242 4242 4242'],
  ['Visa debit (Stripe test)', '4000 0566 5566 5556'],
  ['Mastercard (Stripe test)', '5555 5555 5555 4444'],
  ['Mastercard 2-series (Stripe test)', '2223 0031 2200 3222'],
  ['American Express (Stripe test)', '3782 822463 10005'],
  ['Discover (Stripe test)', '6011 1111 1111 1117'],
  ['Diners Club (Stripe test)', '3056 9300 0902 0004'],
  ['JCB (Stripe test)', '3566 0020 2036 0505'],
  ['UnionPay (Stripe test)', '6200 0000 0000 0005'],
  ['Mastercard India (Razorpay test)', '5267 3181 8797 5449'],
  ['Visa India (Razorpay test)', '4111 1111 1111 1111'],
] as const;

export default defineTextTool({
  input: { label: 'Card numbers', placeholder: 'One per line', sample: '4242 4242 4242 4242\n5555-5555-5555-4445' },
  output: { label: 'Results' },
  options: [{ key: 'showTests', label: 'List gateway test numbers', type: 'toggle', default: false }],
  runOnEmpty: true,
  run(input, o) {
    const lines = input.split(/\r?\n/).filter((line) => line.trim() !== '');
    const fields: Field[] = [];
    const out = lines.map((line) => {
      const digits = line.replace(/[\s-]/g, '');
      if (!/^\d{8,19}$/.test(digits)) return `${line.trim()}\tnot a card number`;
      const valid = luhnValid(digits);
      const brand = brandOf(digits);
      const lengthOk = !brand || brand.lengths.includes(digits.length);
      if (lines.length === 1) {
        fields.push(
          { label: 'Luhn check', value: valid ? 'Passes' : `Fails; the last digit should be ${luhnCheckDigit(digits.slice(0, -1))}`, tone: valid ? 'ok' : 'bad' },
          { label: 'Network', value: brand?.name ?? 'Unknown' },
          { label: 'Length', value: `${digits.length} digits${lengthOk ? '' : ` (${brand?.name} uses ${brand?.lengths.join(' or ')})`}`, tone: lengthOk ? undefined : 'warn' },
          { label: 'Issuer number (IIN/BIN)', value: digits.slice(0, 6), mono: true },
        );
      }
      return `${(digits.match(/.{1,4}/g) ?? []).join(' ')}\t${valid && lengthOk ? 'valid' : 'INVALID'}\t${brand?.name ?? 'unknown network'}`;
    });
    if (o.showTests) out.push('', '# Gateway test numbers (sandbox only)', ...TEST_NUMBERS.map(([name, number]) => `${number}\t${name}`));
    return { output: out.join('\n'), fields, info: 'Checks the number’s structure only, on this computer. A valid structure does not mean an account exists.' };
  },
});
