/**
 * Reference names for the parts of a circuit (R1, C2, Q1…), shared by the
 * analyses, the drawing and the SPICE export.
 */
import type { PlacedPart } from './netlist';

export const PREFIX: Readonly<Record<string, string>> = {
  resistor: 'R',
  capacitor: 'C',
  inductor: 'L',
  potentiometer: 'RV',
  switch: 'S',
  pushbutton: 'S',
  spdt: 'S',
  relay: 'K',
  battery: 'V',
  'ac-source': 'V',
  'current-source': 'I',
  rail: 'V',
  diode: 'D',
  zener: 'D',
  led: 'D',
  npn: 'Q',
  pnp: 'Q',
  nmos: 'M',
  pmos: 'M',
  njfet: 'J',
  pjfet: 'J',
  opamp: 'U',
  comparator: 'U',
  regulator: 'U',
  timer555: 'U',
  vcvs: 'E',
  vccs: 'G',
  ccvs: 'H',
  cccs: 'F',
  transformer: 'T',
  laplace: 'X',
  lamp: 'LA',
  motor: 'MOT',
  buzzer: 'BZ',
  voltmeter: 'VM',
  ammeter: 'AM',
  probe: 'P',
  ground: 'GND',
};

/** Reference names for the parts (R1, C2, Q1, P1…): a part's own name if it has one, otherwise numbered by kind in drawing order. */
export function partNames(doc: { readonly parts: readonly PlacedPart[] }): Map<string, string> {
  const names = new Map<string, string>();
  const taken = new Set<string>();
  for (const p of doc.parts) {
    const own = p.name?.trim();
    if (own) {
      names.set(p.id, own);
      taken.add(own);
    }
  }
  const counts = new Map<string, number>();
  for (const p of doc.parts) {
    if (names.has(p.id)) continue;
    const prefix = PREFIX[p.type] ?? 'U';
    let n = counts.get(prefix) ?? 0;
    let name: string;
    do {
      n++;
      name = `${prefix}${n}`;
    } while (taken.has(name));
    counts.set(prefix, n);
    taken.add(name);
    names.set(p.id, name);
  }
  return names;
}
