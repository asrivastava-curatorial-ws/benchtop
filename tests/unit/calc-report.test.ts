import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calcPdf, decodeState, encodeState, summarise } from '../../src/calc/report';
import { setFontLoader } from '../../src/lib/pdf-text';

setFontLoader(async (file) => new Uint8Array(readFileSync(new URL(`../../public/fonts/${file}`, import.meta.url))));

describe('calculator links, history and reports', () => {
  it('puts the values in a link and reads them back', () => {
    const state = { typed: { p: '10,00,000', r: '8.5' }, units: { n: 'year' }, choices: { mode: 1 } };
    const text = encodeState(state);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeState(text)).toEqual(state);
    expect(decodeState('not base64 at all!')).toBeNull();
    expect(decodeState(encodeState({ typed: { p: 'x'.repeat(100) }, units: {}, choices: {} }))).toBeNull();
  });

  it('summarises results before the values they came from', () => {
    const rows = [
      { label: 'Loan', value: '₹10,00,000', typed: true },
      { label: 'EMI', value: '₹12,399', typed: false },
    ];
    expect(summarise(rows)).toBe('EMI ₹12,399 (from Loan ₹10,00,000)');
    expect(summarise(rows, 10)).toHaveLength(10);
  });

  it('makes a PDF report, with Benchtop Sans when the text needs it', async () => {
    const report = { title: 'Loan EMI', description: 'Monthly instalment of a loan.', formula: ['emi = p * r * (1 + r)^n / ((1 + r)^n - 1)'], when: new Date('2026-11-17T10:00:00Z') };
    const latin = await calcPdf({ ...report, rows: [{ label: 'Loan', value: '$100,000', typed: true }] });
    expect(new TextDecoder().decode(latin.subarray(0, 5))).toBe('%PDF-');
    const rupee = await calcPdf({ ...report, rows: [{ label: 'Loan', value: '₹10,00,000', typed: true }] });
    // Helvetica has no rupee sign, so the font that has one is embedded (whole, so it is large).
    expect(latin.length).toBeLessThan(20_000);
    expect(rupee.length).toBeGreaterThan(100_000);
  });
});
