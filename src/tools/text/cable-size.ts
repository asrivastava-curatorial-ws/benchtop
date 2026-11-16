import {
  ALUMINIUM_FACTOR,
  AWG_SIZES,
  type Conductor,
  currentFor,
  GROUPING_FACTOR,
  IEC_AMPACITY,
  IEC_SIZES,
  lookupFactor,
  NEC_AMPACITY,
  resistanceAt,
  SMALL_CONDUCTOR_LIMIT,
  TEMPERATURE_FACTOR,
  voltageDrop,
} from '../../lib/electrical';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';
import { ESTIMATE, heading, num, PF, PHASE, STANDARD, VOLTAGE } from './_calc';

interface Candidate {
  readonly conductor: Conductor;
  readonly ampacity: number;
  readonly drop: number;
}

export default defineTextTool({
  input: false,
  output: false,
  options: [
    STANDARD,
    {
      key: 'loadBy',
      label: 'Load given as',
      type: 'segmented',
      choices: [
        { value: 'amps', label: 'Current' },
        { value: 'kw', label: 'Power' },
      ],
      default: 'kw',
    },
    { key: 'load', label: 'Load', type: 'number', default: 22, min: 0, step: 0.1, help: 'Amperes, or kilowatts of real power.' },
    PHASE,
    VOLTAGE,
    PF,
    { key: 'length', label: 'One-way cable length', type: 'number', default: 60, min: 0, step: 1, unit: 'm' },
    {
      key: 'maxDrop',
      label: 'Allowed voltage drop',
      type: 'number',
      default: 5,
      min: 0.5,
      max: 20,
      step: 0.5,
      unit: '%',
      help: 'IEC 60364-5-52 suggests 3% for lighting and 5% for other uses; NEC suggests 3% for a branch circuit.',
    },
    {
      key: 'metal',
      label: 'Conductor',
      type: 'segmented',
      choices: [
        { value: 'cu', label: 'Copper' },
        { value: 'al', label: 'Aluminium' },
      ],
      default: 'cu',
    },
    {
      key: 'insulation',
      label: 'Insulation',
      type: 'segmented',
      choices: [
        { value: 'pvc', label: 'PVC 70 °C' },
        { value: 'xlpe', label: 'XLPE 90 °C' },
      ],
      default: 'pvc',
      showIf: (v) => v.standard === 'iec',
    },
    {
      key: 'column',
      label: 'Terminal rating',
      type: 'segmented',
      choices: [
        { value: '0', label: '60 °C' },
        { value: '1', label: '75 °C' },
        { value: '2', label: '90 °C' },
      ],
      default: '1',
      showIf: (v) => v.standard === 'nec',
    },
    { key: 'ambient', label: 'Ambient temperature', type: 'number', default: 40, min: 10, max: 70, step: 5, unit: '°C', showIf: (v) => v.standard === 'iec' },
    { key: 'grouped', label: 'Circuits run together', type: 'number', default: 1, min: 1, max: 20, step: 1, showIf: (v) => v.standard === 'iec' },
    { key: 'continuous', label: 'Continuous load (125%)', type: 'toggle', default: false, showIf: (v) => v.standard === 'nec' },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const pf = o.phase === 'dc' ? 1 : o.pf;
    const amps = o.loadBy === 'amps' ? o.load : currentFor(o.load * 1000, o.volts, o.phase as '1' | '3' | 'dc', pf);
    if (!(amps > 0)) throw new ToolError('Enter the load.');
    const aluminium = o.metal === 'al';
    const fields: Field[] = [{ label: 'Design current', value: `${num(amps, 1)} A`, mono: true }];
    const candidates: Candidate[] = [];
    let required = amps;
    if (o.standard === 'iec') {
      const derate = lookupFactor(TEMPERATURE_FACTOR[o.insulation as 'pvc' | 'xlpe'], o.ambient) * lookupFactor(GROUPING_FACTOR, o.grouped);
      required = amps / derate;
      fields.push({ label: 'Correction factors', value: `temperature × grouping = ${num(derate, 2)}; the cable must carry ${num(required, 1)} A in the tables` });
      for (const conductor of IEC_SIZES) {
        const r20 = aluminium ? conductor.rAl : conductor.rCu;
        if (r20 === undefined) continue;
        const pair = IEC_AMPACITY[o.insulation as 'pvc' | 'xlpe'][conductor.size];
        if (!pair) continue;
        const rated = (o.phase === '3' ? pair[1] : pair[0]) * (aluminium ? ALUMINIUM_FACTOR : 1);
        const r = resistanceAt(r20, o.insulation === 'xlpe' ? 90 : 70, aluminium);
        candidates.push({ conductor, ampacity: rated * derate, drop: voltageDrop(amps, o.length, r, o.phase as '1' | '3' | 'dc', pf) });
      }
    } else {
      if (o.continuous) required = amps * 1.25;
      for (const conductor of AWG_SIZES) {
        const row = NEC_AMPACITY[conductor.size];
        const r = aluminium ? conductor.rAl : conductor.rCu;
        if (!row || r === undefined) continue;
        let rated = aluminium ? (row.al ?? 0) : (row.cu[Number(o.column)] ?? 0);
        if (!aluminium && SMALL_CONDUCTOR_LIMIT[conductor.size]) rated = Math.min(rated, SMALL_CONDUCTOR_LIMIT[conductor.size] as number);
        if (rated === 0) continue;
        candidates.push({ conductor, ampacity: rated, drop: voltageDrop(amps, o.length, r, o.phase as '1' | '3' | 'dc', pf) });
      }
    }
    const allowed = (o.maxDrop / 100) * o.volts;
    const byCurrent = candidates.find((candidate) => candidate.ampacity >= required - 1e-9);
    const byBoth = candidates.find((candidate) => candidate.ampacity >= required - 1e-9 && candidate.drop <= allowed);
    const unit = o.standard === 'iec' ? ' mm²' : '';
    if (!byCurrent) throw new ToolError('No size in the table carries this current; use parallel runs or busbar.');
    fields.push(
      heading('Result'),
      { label: 'Smallest size for the current', value: `${byCurrent.conductor.size}${unit} (carries ${num(byCurrent.ampacity, 0)} A)`, mono: true },
      byBoth
        ? { label: 'Size for current and voltage drop', value: `${byBoth.conductor.size}${unit} ${aluminium ? 'aluminium' : 'copper'}`, mono: true, tone: 'ok' }
        : { label: 'Size for current and voltage drop', value: 'Even the largest size drops too much: shorten the run, raise the voltage or run cables in parallel', tone: 'bad' },
    );
    const chosen = byBoth ?? byCurrent;
    fields.push(
      { label: 'Voltage drop', value: `${num(chosen.drop, 2)} V (${num((chosen.drop / o.volts) * 100, 2)}%)`, mono: true, tone: chosen.drop <= allowed ? 'ok' : 'bad' },
      { label: 'Voltage at the load', value: `${num(o.volts - chosen.drop, 1)} V`, mono: true },
      { label: 'Power lost in the cable', value: `${num((chosen.drop * amps * (o.phase === '3' ? Math.sqrt(3) : 1) * pf) / 1000, 3)} kW`, mono: true },
    );
    if (byBoth && byBoth !== byCurrent)
      fields.push({
        label: 'Note',
        value: `Voltage drop, not current, decides the size here (${byCurrent.conductor.size}${unit} would drop ${num((byCurrent.drop / o.volts) * 100, 1)}%).`,
        tone: 'warn',
      });
    return {
      fields,
      info: `${ESTIMATE} ${o.standard === 'iec' ? 'Ratings: multicore cable clipped direct (method C). Other installation methods carry less.' : 'Ratings: NEC 310.16, not more than three current-carrying conductors in a raceway, 30 °C ambient.'}`,
    };
  },
});
