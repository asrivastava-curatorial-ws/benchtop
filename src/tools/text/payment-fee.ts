import { defineTextTool, type Field } from '../types';

const money = (cents: number): string => (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export interface FeeInputs {
  /** Amount in the smallest currency unit (cents). */
  readonly amount: number;
  readonly percent: number;
  /** Fixed fee in cents. */
  readonly fixed: number;
}

/** Fee on a charge, rounded half-up to the cent as card processors do. */
export function feeOn({ amount, percent, fixed }: FeeInputs): number {
  return Math.round((amount * percent) / 100 + fixed);
}

/** The amount to charge so that `amount` is left after the fee is deducted. */
export function chargeFor({ amount, percent, fixed }: FeeInputs): number {
  let charge = Math.ceil((amount + fixed) / (1 - percent / 100));
  // Rounding of the fee can leave the payout a cent off; correct in whole cents.
  while (charge - feeOn({ amount: charge, percent, fixed }) < amount) charge++;
  while (charge > 0 && charge - 1 - feeOn({ amount: charge - 1, percent, fixed }) >= amount) charge--;
  return charge;
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'amount', label: 'Amount', type: 'number', default: 100, min: 0, max: 100000000, step: 0.01 },
    { key: 'percent', label: 'Percentage fee', type: 'number', default: 2.9, min: 0, max: 99, step: 0.05, unit: '%' },
    { key: 'fixed', label: 'Fixed fee per charge', type: 'number', default: 0.3, min: 0, max: 100, step: 0.01 },
    {
      key: 'surcharge',
      label: 'Extra percentage',
      type: 'number',
      default: 0,
      min: 0,
      max: 50,
      step: 0.1,
      unit: '%',
      help: 'For example +1.5% for international cards or +1% for currency conversion.',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const amount = Math.round(o.amount * 100);
    const percent = o.percent + o.surcharge;
    const fixed = Math.round(o.fixed * 100);
    const fee = feeOn({ amount, percent, fixed });
    const charge = chargeFor({ amount, percent, fixed });
    const chargeFee = feeOn({ amount: charge, percent, fixed });
    const fields: Field[] = [
      { label: `If you charge ${money(amount)}`, value: '' },
      { label: 'Processing fee', value: money(fee), mono: true },
      { label: 'You receive', value: money(amount - fee), mono: true, tone: amount - fee < 0 ? 'bad' : 'ok' },
      { label: 'Effective rate', value: amount > 0 ? `${((fee / amount) * 100).toFixed(2)}%` : '—', mono: true },
      { label: `To receive ${money(amount)}`, value: '' },
      { label: 'Charge the customer', value: money(charge), mono: true, tone: 'ok' },
      { label: 'Fee on that charge', value: money(chargeFee), mono: true },
      { label: 'You receive', value: money(charge - chargeFee), mono: true },
    ];
    return {
      fields,
      info: `Fee = ${percent.toFixed(2).replace(/\.?0+$/, '')}% + ${money(fixed)} per successful charge`,
      warnings: ['Rates differ by country, card type and contract. The defaults (2.9% + 0.30) are the standard US online card rate; enter your own.'],
    };
  },
});
