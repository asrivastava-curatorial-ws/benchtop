import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { angles, ayanamsa, chart, dms, gunaMilan, karanaName, manglik, panchang, runningDasha, varga, vargaSign, vimshottari, YONI_POINTS } from '../../src/lib/kundli';

const ist = (local: string) => new Date(`${local}+05:30`);
const sun = (c: ReturnType<typeof chart>) => c.grahas.find((g) => g.graha === 'sun')?.longitude ?? Number.NaN;
const DELHI = { lat: 28.6139, lon: 77.209 };

describe('the sidereal zodiac', () => {
  it('uses the Lahiri ayanamsa of Indian panchangs', () => {
    expect(ayanamsa(new Date(Date.UTC(2000, 0, 1, 12))).mean).toBeCloseTo(23.8617, 3);
    expect(ayanamsa(new Date()).true - ayanamsa(new Date()).mean).toBeLessThan(0.006);
    expect(ayanamsa(new Date(), 'tropical').true).toBe(0);
  });

  it('puts the Sun’s sankrantis within a minute of the published times', () => {
    // Makara Sankranti 2026: 15:13 IST; Mesha Sankranti 2026: 09:38 IST (Drik Panchang).
    expect(sun(chart(ist('2026-01-14T15:12:30'), DELHI.lat, DELHI.lon))).toBeLessThan(270);
    expect(sun(chart(ist('2026-01-14T15:14:30'), DELHI.lat, DELHI.lon))).toBeGreaterThan(270);
    expect(sun(chart(ist('2026-04-14T09:38:00'), DELHI.lat, DELHI.lon))).toBeGreaterThan(359.99);
    expect(sun(chart(ist('2026-04-14T09:40:30'), DELHI.lat, DELHI.lon))).toBeLessThan(0.01);
  });

  it('places the ascendant on the eastern horizon and the midheaven on the meridian', () => {
    const place = { lat: 12.9716, lon: 77.5946 };
    const observer = new Astronomy.Observer(place.lat, place.lon, 0);
    const rise = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, 1, ist('2026-06-21T00:00:00'), 1);
    const noon = Astronomy.SearchHourAngle(Astronomy.Body.Sun, observer, 0, ist('2026-06-21T00:00:00'));
    const at = (t: Astronomy.AstroTime) => {
      const a = angles(t, place.lat, place.lon);
      const s = Astronomy.SunPosition(t).elon;
      return { asc: a.asc - s, mc: a.mc - s };
    };
    if (!rise) throw new Error('no sunrise');
    expect(Math.abs(at(rise).asc)).toBeLessThan(2);
    expect(Math.abs(at(noon.time).mc)).toBeLessThan(0.3);
  });
});

describe('a chart', () => {
  const c = chart(ist('2026-01-14T15:13:00'), DELHI.lat, DELHI.lon);

  it('gives each graha its sign, nakshatra, pada and house', () => {
    const moon = c.grahas.find((g) => g.graha === 'moon');
    // Drik Panchang for this moment: Moon in Vrishchika, in Anuradha.
    expect(moon?.sign).toBe(7);
    expect(moon?.nakshatra).toBe(16);
    expect(moon?.pada).toBeGreaterThanOrEqual(1);
    const rahu = c.grahas.find((g) => g.graha === 'rahu');
    const ketu = c.grahas.find((g) => g.graha === 'ketu');
    expect(rahu?.retrograde).toBe(true);
    expect(Math.abs(((ketu?.longitude ?? 0) - (rahu?.longitude ?? 0) + 360) % 360)).toBeCloseTo(180, 6);
    for (const g of c.grahas) expect(g.house).toBe(((g.sign - c.lagna.sign + 12) % 12) + 1);
    // The true node stays within two degrees of the mean one.
    const t = chart(ist('2026-01-14T15:13:00'), DELHI.lat, DELHI.lon, { node: 'true' }).grahas.find((g) => g.graha === 'rahu');
    expect(Math.abs((((t?.longitude ?? 0) - (rahu?.longitude ?? 0) + 540) % 360) - 180)).toBeLessThan(2);
  });

  it('works out divisional signs by Parashara’s rules', () => {
    expect(vargaSign(0, 9)).toBe(0);
    expect(vargaSign(3.5, 9)).toBe(1);
    expect(vargaSign(30, 9)).toBe(9);
    expect(vargaSign(60, 9)).toBe(6);
    expect(vargaSign(5, 2)).toBe(4);
    expect(vargaSign(35, 2)).toBe(3);
    expect(vargaSign(45 + 1, 3)).toBe((1 + 4) % 12);
    expect(vargaSign(31, 10)).toBe(9);
    expect(vargaSign(359, 12)).toBe(10);
    expect(varga(c, 9).grahas).toHaveLength(9);
  });

  it('flags Mars by the Manglik houses', () => {
    const m = manglik(c);
    expect(m.fromLagna).toBeGreaterThanOrEqual(1);
    expect(m.manglik).toBe([1, 2, 4, 7, 8, 12].includes(m.fromLagna) || [1, 2, 4, 7, 8, 12].includes(m.fromMoon));
  });
});

describe('the panchang', () => {
  it('matches the published panchang for Makara Sankranti 2026', () => {
    const p = panchang(ist('2026-01-14T15:13:00'), DELHI.lat, DELHI.lon, 'Asia/Kolkata');
    expect(p.tithi.name).toBe('Krishna Ekadashi');
    expect(p.nakshatra.name).toBe('Anuradha');
    expect(p.karana.name).toBe('Balava');
    expect(p.vara).toBe(3);
    expect(p.paksha).toBe('krishna');
    // Pausha in the amanta reckoning, Magha in the purnimanta one.
    expect(p.amanta).toBe(9);
    expect(p.purnimanta).toBe(10);
    expect(p.vikramSamvat).toBe(2082);
    expect(p.shakaSamvat).toBe(1947);
    expect(p.tithi.ends && p.tithi.ends > ist('2026-01-14T15:13:00')).toBe(true);
    expect(p.sunrise?.getTime()).toBeLessThan(ist('2026-01-14T07:30:00').getTime());
  });

  it('starts the day at sunrise', () => {
    const before = panchang(ist('2026-01-14T05:00:00'), DELHI.lat, DELHI.lon, 'Asia/Kolkata');
    expect(before.vara).toBe(2);
    expect(karanaName(0)).toBe('Kimstughna');
    expect(karanaName(59)).toBe('Naga');
  });
});

describe('dashas', () => {
  it('runs Vimshottari from the Moon’s nakshatra', () => {
    const birth = new Date(Date.UTC(1990, 0, 1));
    const ashwini = vimshottari(0, birth);
    expect(ashwini.dashas[0]?.lord).toBe('ketu');
    expect(ashwini.balance).toBeCloseTo(7, 9);
    const rohini = vimshottari(3 * (360 / 27) + 360 / 54, birth);
    expect(rohini.dashas[0]?.lord).toBe('moon');
    expect(rohini.balance).toBeCloseTo(5, 9);
    expect(rohini.dashas.map((d) => d.lord)).toEqual(['moon', 'mars', 'rahu', 'jupiter', 'saturn', 'mercury', 'ketu', 'venus', 'sun']);
    const years = (rohini.dashas.at(-1)?.end.getTime() ?? 0) - (rohini.dashas[0]?.start.getTime() ?? 0);
    expect(years / (365.2425 * 86400e3)).toBeCloseTo(120, 6);
    const now = runningDasha(rohini.dashas, birth);
    expect(now?.maha.lord).toBe('moon');
    // Halfway through the Moon's 10 years: Moon, Mars, Rahu and Jupiter antardashas take 4.25 years, Saturn's runs to 5.83.
    expect(now?.antar.lord).toBe('saturn');
  });
});

describe('matching', () => {
  it('scores the eight kootas', () => {
    const same = gunaMilan(10, 10);
    expect(same.kootas.map((k) => k.points)).toEqual([1, 2, 3, 4, 5, 6, 7, 0]);
    expect(same.total).toBe(28);
    expect(same.nadiDosha).toBe(true);
    // Rohini bride, Mula groom.
    const m = gunaMilan(45, 245);
    expect(m.kootas.map((k) => k.points)).toEqual([1, 1, 1.5, 2, 0.5, 0, 0, 8]);
    expect(m.total).toBe(14);
    expect(m.bhakootDosha).toBe(true);
  });

  it('keeps the yoni table symmetric, with the seven sworn enemies at zero', () => {
    for (let i = 0; i < 14; i++) for (let j = 0; j < 14; j++) expect(YONI_POINTS[i]?.[j]).toBe(YONI_POINTS[j]?.[i]);
    const zeros = YONI_POINTS.flatMap((row, i) => row.map((v, j) => (v === 0 && i < j ? `${i}-${j}` : ''))).filter(Boolean);
    expect(zeros).toEqual(['0-8', '1-13', '2-11', '3-12', '4-10', '5-6', '7-9']);
  });

  it('formats angles', () => {
    expect(dms(23.2619)).toBe('23°15′43″');
    expect(dms(0.5)).toBe('0°30′00″');
  });
});
