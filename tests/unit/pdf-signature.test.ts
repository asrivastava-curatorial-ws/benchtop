import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPdfSignatures } from '../../src/lib/pdf-signature';
import pdfSignature from '../../src/tools/text/pdf-signature';
import { fileOf, run } from './helpers';

// Fixtures: minimal PDFs signed with OpenSSL CMS (adbe.pkcs7.detached), made by scripts/make_signed_pdf.py.
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../fixtures/pdf/${name}`, import.meta.url)));

describe('PDF signatures', () => {
  it('verifies an RSA signature over the whole file', async () => {
    const [signature] = await checkPdfSignatures(fixture('signed-rsa.pdf'));
    expect(signature).toMatchObject({ integrity: true, signatureValid: true, coversWholeFile: true, isTimestamp: false, digestAlgorithm: 'SHA-256', subFilter: 'adbe.pkcs7.detached' });
    expect(signature?.reason).toBe('Unit test');
    expect(signature?.location).toBe('Bengaluru');
    expect(signature?.signer?.subject).toMatch(/Benchtop Test Signer \(RSA\)/);
  });

  it('verifies an ECDSA P-256 signature', async () => {
    const [signature] = await checkPdfSignatures(fixture('signed-ec.pdf'));
    expect(signature).toMatchObject({ integrity: true, signatureValid: true, coversWholeFile: true });
  });

  it('detects a change inside the signed bytes', async () => {
    const [signature] = await checkPdfSignatures(fixture('tampered.pdf'));
    expect(signature?.integrity).toBe(false);
  });

  it('notices content added after signing', async () => {
    const [signature] = await checkPdfSignatures(fixture('appended.pdf'));
    expect(signature).toMatchObject({ integrity: true, signatureValid: true, coversWholeFile: false });
  });

  it('reports the result in the tool', async () => {
    const result = await run(pdfSignature, '', {}, { file: fileOf('signed-rsa.pdf', fixture('signed-rsa.pdf'), 'application/pdf') });
    expect(result.fields?.[0]).toMatchObject({ label: 'Signatures', value: '1' });
    expect(result.fields?.find((field) => field.label === 'Signature 1')?.tone).toBe('ok');
    const unsigned = await run(pdfSignature, '', {}, { file: fileOf('plain.pdf', new TextEncoder().encode('%PDF-1.4\n%%EOF\n'), 'application/pdf') });
    expect(unsigned.fields?.[0]?.value).toMatch(/^None/);
  });
});
