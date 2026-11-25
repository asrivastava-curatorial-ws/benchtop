/**
 * Print Production Studio: what a job needs between the design and the
 * press.  Four parts share one tool: colour (ICC profiles, a soft proof and
 * conversion to the press's four inks), printer's marks around the pages of
 * a PDF, nesting of pieces on sheets or a roll, and a planner that finds the
 * paper and layout that print a job for least.
 */
import { useState } from 'preact/hooks';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';
import { type ColourSettings, ColourTab, readColour } from './print-colour';
import { type MarkSettings, MarksTab, readMarks } from './print-marks';
import { type NestSettings, NestTab, readNest } from './print-nest';
import { readSheets, type SheetSettings, SheetsTab } from './print-sheets';

type Part = 'colour' | 'marks' | 'nest' | 'sheets';

interface Settings {
  readonly part: Part;
  readonly colour: ColourSettings;
  readonly marks: MarkSettings;
  readonly nest: NestSettings;
  readonly sheets: SheetSettings;
}

const PARTS: readonly { readonly value: Part; readonly label: string }[] = [
  { value: 'colour', label: 'Colour and proof' },
  { value: 'marks', label: 'Printer’s marks' },
  { value: 'nest', label: 'Nesting' },
  { value: 'sheets', label: 'Sheet planner' },
];

const group = (value: unknown): Values | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Values) : undefined);

const read = (v: Values | undefined): Settings => ({
  part: v?.part === 'marks' || v?.part === 'nest' || v?.part === 'sheets' ? v.part : 'colour',
  colour: readColour(group(v?.colour)),
  marks: readMarks(group(v?.marks)),
  nest: readNest(group(v?.nest)),
  sheets: readSheets(group(v?.sheets)),
});
const write = (s: Settings): Values => ({ part: s.part, colour: { ...s.colour }, marks: { ...s.marks }, nest: { ...s.nest }, sheets: { ...s.sheets } });

function PrintStudio({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, write);
  // A part stays as it was left when another is opened: its files and results are kept until the tool is closed.
  const [seen, setSeen] = useState<readonly Part[]>([settings.part]);
  const go = (part: Part) => {
    setSettings((s) => ({ ...s, part }));
    setSeen((list) => (list.includes(part) ? list : [...list, part]));
  };
  const { part } = settings;
  return (
    <div data-testid="tool" class="tool pp" data-part={part}>
      <div class="pp-tabs">
        <Segmented value={part} choices={PARTS} onChange={go} label="Part of the studio" small={false} />
      </div>
      {seen.includes('colour') && (
        <div hidden={part !== 'colour'}>
          <ColourTab settings={settings.colour} set={(patch) => setSettings((s) => ({ ...s, colour: { ...s.colour, ...patch } }))} />
        </div>
      )}
      {seen.includes('marks') && (
        <div hidden={part !== 'marks'}>
          <MarksTab settings={settings.marks} set={(patch) => setSettings((s) => ({ ...s, marks: { ...s.marks, ...patch } }))} />
        </div>
      )}
      {seen.includes('nest') && (
        <div hidden={part !== 'nest'}>
          <NestTab settings={settings.nest} set={(patch) => setSettings((s) => ({ ...s, nest: { ...s.nest, ...patch } }))} />
        </div>
      )}
      {seen.includes('sheets') && (
        <div hidden={part !== 'sheets'}>
          <SheetsTab settings={settings.sheets} set={(patch) => setSettings((s) => ({ ...s, sheets: { ...s.sheets, ...patch } }))} />
        </div>
      )}
    </div>
  );
}

export default defineCustomTool(PrintStudio);
