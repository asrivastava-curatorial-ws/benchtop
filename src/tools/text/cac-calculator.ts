import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

const money = (value: number): string => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'h1', type: 'heading', label: 'Spend in the period' },
    { key: 'marketing', label: 'Marketing spend', type: 'number', default: 20000, min: 0, max: 1e12, step: 100 },
    { key: 'sales', label: 'Sales spend', type: 'number', default: 15000, min: 0, max: 1e12, step: 100 },
    { key: 'overhead', label: 'Salaries, tools, overhead', type: 'number', default: 10000, min: 0, max: 1e12, step: 100 },
    { key: 'customers', label: 'New customers won', type: 'number', default: 90, min: 0, max: 1e9, step: 1 },
    { key: 'h2', type: 'heading', label: 'Customer value' },
    { key: 'revenue', label: 'Revenue per customer per month', type: 'number', default: 120, min: 0, max: 1e9, step: 1 },
    { key: 'margin', label: 'Gross margin', type: 'number', default: 80, min: 0, max: 100, step: 1, unit: '%' },
    { key: 'churn', label: 'Monthly churn', type: 'number', default: 3, min: 0, max: 100, step: 0.1, unit: '%' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (o.customers <= 0) throw new ToolError('Enter the number of new customers won in the period (more than zero).');
    const spend = o.marketing + o.sales + o.overhead;
    const cac = spend / o.customers;
    const contribution = o.revenue * (o.margin / 100);
    const fields: Field[] = [
      { label: 'Total acquisition spend', value: money(spend), mono: true },
      { label: 'Fully loaded CAC', value: money(cac), mono: true, tone: 'ok' },
      { label: 'Paid-only CAC (marketing spend only)', value: money(o.marketing / o.customers), mono: true },
    ];
    if (contribution > 0) {
      const payback = cac / contribution;
      fields.push({
        label: 'CAC payback period',
        value: `${payback.toFixed(1)} months  — ${payback <= 12 ? 'within the common 12-month benchmark' : payback <= 18 ? 'slower than the 12-month benchmark' : 'slow: more than 18 months'}`,
        tone: payback <= 12 ? 'ok' : payback <= 18 ? 'warn' : 'bad',
      });
    }
    if (o.churn > 0 && contribution > 0) {
      const lifetime = 100 / o.churn;
      const ltv = contribution * lifetime;
      const ratio = ltv / cac;
      fields.push(
        { label: 'Average customer lifetime', value: `${lifetime.toFixed(1)} months`, mono: true },
        { label: 'Lifetime value (LTV)', value: money(ltv), mono: true },
        {
          label: 'LTV : CAC',
          value: `${ratio.toFixed(2)} : 1  — ${ratio >= 5 ? 'very efficient; you may be under-investing in growth' : ratio >= 3 ? 'healthy (3:1 or better)' : ratio >= 1 ? 'below the 3:1 benchmark' : 'losing money on each customer'}`,
          tone: ratio >= 3 ? 'ok' : ratio >= 1 ? 'warn' : 'bad',
        },
      );
    } else if (o.churn === 0) {
      fields.push({ label: 'LTV : CAC', value: 'Enter a churn rate above zero to estimate lifetime value', tone: 'muted' });
    }
    return {
      fields,
      info: 'CAC = (marketing + sales + overhead) ÷ new customers · LTV = monthly revenue × margin ÷ churn',
      warnings: ['The 3:1 and 12-month figures are common rules of thumb for subscription businesses, not targets for every company.'],
    };
  },
});
