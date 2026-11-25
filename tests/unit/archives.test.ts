import { gzipSync, strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { archiveToZip, openArchive, safeEntryName } from '../../src/lib/archives';

/** A TAR (ustar) with the given files. */
function tar(files: [string, string][]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const [name, text] of files) {
    const data = new TextEncoder().encode(text);
    const header = new Uint8Array(512);
    const put = (at: number, value: string) => header.set(new TextEncoder().encode(value), at);
    put(0, name);
    put(100, '0000644\0');
    put(108, '0000000\0');
    put(116, '0000000\0');
    put(124, `${data.length.toString(8).padStart(11, '0')}\0`);
    put(136, '00000000000\0');
    header.fill(32, 148, 156);
    put(156, '0');
    put(257, 'ustar\0');
    put(263, '00');
    put(
      148,
      `${header
        .reduce((sum, b) => sum + b, 0)
        .toString(8)
        .padStart(6, '0')}\0 `,
    );
    const body = new Uint8Array(Math.ceil(data.length / 512) * 512);
    body.set(data);
    blocks.push(header, body);
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((sum, b) => sum + b.length, 0));
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

describe('archives', () => {
  it('turn TAR and .tar.gz files into ZIPs', async () => {
    const source = tar([
      ['notes/plan.txt', 'Plan the visit.'],
      ['notes/plan.txt', 'A second copy.'],
      ['../escape.txt', 'Kept inside.'],
    ]);
    for (const [name, bytes] of [
      ['notes.tar', source],
      ['notes.tar.gz', gzipSync(source)],
    ] as const) {
      const files = unzipSync(await archiveToZip(name, bytes));
      expect(Object.keys(files).sort()).toEqual(['escape.txt', 'notes/plan (2).txt', 'notes/plan.txt']);
      expect(strFromU8(files['notes/plan.txt'] as Uint8Array)).toBe('Plan the visit.');
    }
    expect((await openArchive('one.txt.gz', gzipSync(new TextEncoder().encode('hello')), '')).map((e) => e.name)).toEqual(['one.txt']);
    await expect(archiveToZip('x.rar', new Uint8Array([0x52, 0x61, 0x72, 0x21]))).rejects.toThrow('not a ZIP, TAR');
  });

  it('keep entry names inside the archive', () => {
    expect(safeEntryName('/etc/passwd')).toBe('etc/passwd');
    expect(safeEntryName('C:\\Users\\a\\..\\b.txt')).toBe('Users/a/b.txt');
    expect(safeEntryName('../../')).toBe('file');
  });
});
