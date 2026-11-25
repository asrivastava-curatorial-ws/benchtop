import { describe, expect, it } from 'vitest';
import { joinHubs, memoryHub, pictureNamer, pictureUrl } from '../../src/lib/quiz-hub';

const settle = () => new Promise<void>((done) => queueMicrotask(done));

describe('the quiz hub inside one page', () => {
  it('passes messages to the presenter and gives each device its own view', async () => {
    const { host, guest } = memoryHub();
    const heard: [string, unknown][] = [];
    host.onMessage = (from, message) => heard.push([from, message]);
    const a = guest('a');
    const b = guest('b');
    const seen: Record<string, unknown[]> = { a: [], b: [] };
    a.onView = (view) => seen.a?.push(view);
    b.onView = (view) => seen.b?.push(view);
    await settle();
    // Nothing has been published yet.
    expect(seen).toEqual({ a: [null], b: [null] });
    a.send({ kind: 'join', name: 'Asha' });
    await settle();
    expect(heard).toEqual([['a', { kind: 'join', name: 'Asha' }]]);
    host.publish({ a: { phase: 'lobby' } }, { phase: 'join' });
    expect(seen.a?.at(-1)).toEqual({ phase: 'lobby' });
    expect(seen.b?.at(-1)).toEqual({ phase: 'join' });
    // A device that arrives late is shown how things stand.
    const late = guest('a');
    const got: unknown[] = [];
    late.onView = (view, now) => got.push([view, typeof now]);
    await settle();
    expect(got).toEqual([[{ phase: 'lobby' }, 'number']]);
    // Closing the first link to "a" leaves the one that replaced it.
    a.close();
    host.publish({ a: { phase: 'open' } }, { phase: 'join' });
    expect(got.at(-1)).toEqual([{ phase: 'open' }, 'number']);
    host.drop('b');
    host.publish({}, { phase: 'ended' });
    expect(seen.b?.at(-1)).toEqual({ phase: 'join' });
  });

  it('joins several hubs into one', async () => {
    const one = memoryHub();
    const two = memoryHub();
    const all = joinHubs([one.host, two.host]);
    const heard: string[] = [];
    all.onMessage = (from) => heard.push(from);
    const a = one.guest('a');
    const b = two.guest('b');
    const seen: unknown[] = [];
    a.onView = (view) => seen.push(['a', view]);
    b.onView = (view) => seen.push(['b', view]);
    await settle();
    seen.length = 0;
    a.send({ kind: 'chat' });
    b.send({ kind: 'chat' });
    await settle();
    expect(heard).toEqual(['a', 'b']);
    all.publish({ a: 1, b: 2 }, 0);
    expect(seen).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    all.file('p1', 'data:image/png;base64,AAAA');
    expect(a.fileUrl('p1')).toBe('data:image/png;base64,AAAA');
    expect(b.fileUrl('p1')).toBe('data:image/png;base64,AAAA');
  });

  it('sends a picture once and names it afterwards', () => {
    const files: [string, string][] = [];
    const named = pictureNamer({ file: (key, data) => files.push([key, data]) });
    const picture = 'data:image/png;base64,iVBORw0KGgo=';
    const view = { slide: { image: picture, options: [{ text: 'A', image: picture }, { text: 'B', image: 'data:image/jpeg;base64,/9j/' }, { text: 'data: not a picture' }] }, title: 'Quiz' };
    expect(named(view)).toEqual({ slide: { image: 'img:p1', options: [{ text: 'A', image: 'img:p1' }, { text: 'B', image: 'img:p2' }, { text: 'data: not a picture' }] }, title: 'Quiz' });
    named(view);
    expect(files).toEqual([
      ['p1', picture],
      ['p2', 'data:image/jpeg;base64,/9j/'],
    ]);
    const link = { fileUrl: (key: string) => `/q/file/${key}` };
    expect(pictureUrl(link, 'img:p2')).toBe('/q/file/p2');
    expect(pictureUrl(link, picture)).toBe(picture);
    expect(pictureUrl(link, '')).toBe('');
    expect(pictureUrl(link, undefined)).toBe('');
  });
});
