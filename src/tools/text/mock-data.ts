import Papa from 'papaparse';
import { v4 } from 'uuid';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';
import { randomBetween } from './random-generator';

const FIRST = [
  'Aarav',
  'Ananya',
  'Arjun',
  'Diya',
  'Ishaan',
  'Kavya',
  'Meera',
  'Nikhil',
  'Priya',
  'Rahul',
  'Riya',
  'Rohan',
  'Saanvi',
  'Siddharth',
  'Tara',
  'Vikram',
  'Zara',
  'Amelia',
  'Noah',
  'Olivia',
  'Liam',
  'Sofia',
  'Mateo',
  'Yuki',
  'Kenji',
  'Amara',
  'Kwame',
  'Lucas',
  'Elena',
  'Omar',
  'Fatima',
  'Chen',
  'Mei',
  'Ivan',
  'Anika',
  'Leila',
];
const LAST = [
  'Sharma',
  'Iyer',
  'Reddy',
  'Nair',
  'Patel',
  'Gupta',
  'Rao',
  'Menon',
  'Das',
  'Singh',
  'Khan',
  'Bose',
  'Kulkarni',
  'Hegde',
  'Pillai',
  'Smith',
  'Garcia',
  'Müller',
  'Tanaka',
  'Okafor',
  'Rossi',
  'Kowalski',
  'Haddad',
  'Silva',
  'Wang',
  'Novak',
  'Ahmed',
  'Jensen',
  'Costa',
  'Dubois',
];
const CITIES = [
  ['Bengaluru', 'Karnataka', '560001'],
  ['Mysuru', 'Karnataka', '570001'],
  ['Chennai', 'Tamil Nadu', '600001'],
  ['Hyderabad', 'Telangana', '500001'],
  ['Mumbai', 'Maharashtra', '400001'],
  ['Pune', 'Maharashtra', '411001'],
  ['Kolkata', 'West Bengal', '700001'],
  ['New Delhi', 'Delhi', '110001'],
  ['Kochi', 'Kerala', '682001'],
  ['Ahmedabad', 'Gujarat', '380001'],
  ['Jaipur', 'Rajasthan', '302001'],
  ['Guwahati', 'Assam', '781001'],
] as const;
const STREETS = ['MG Road', 'Residency Road', 'Church Street', 'Brigade Road', 'Station Road', 'Lake View Lane', 'Temple Street', 'Park Avenue', 'Market Road', 'Ring Road'];
const COMPANIES = ['Nimbus Labs', 'Tarang Systems', 'Kaveri Works', 'Orbit Analytics', 'Lotus Robotics', 'Saffron Studio', 'Monsoon Data', 'Peacock Logistics', 'Vega Instruments', 'Banyan Health'];
const WORDS = ['science', 'museum', 'gallery', 'robot', 'planet', 'engine', 'circuit', 'magnet', 'orbit', 'fossil', 'prism', 'turbine', 'signal', 'lens', 'atom', 'river', 'forest', 'comet'];
const DOMAINS = ['example.org', 'example.com', 'example.net', 'mail.example.in'];

const pick = <T>(list: readonly T[]): T => list[randomBetween(0, list.length - 1)] as T;

export const FIELDS: Record<string, (row: Record<string, unknown>, index: number) => unknown> = {
  id: (_row, index) => index + 1,
  uuid: () => v4(),
  firstName: () => pick(FIRST),
  lastName: () => pick(LAST),
  name: (row) => `${row.firstName ?? pick(FIRST)} ${row.lastName ?? pick(LAST)}`,
  email: (row) =>
    `${String(row.firstName ?? pick(FIRST)).toLowerCase()}.${String(row.lastName ?? pick(LAST))
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')}${randomBetween(1, 99)}@${pick(DOMAINS)}`,
  phone: () => `+91 ${randomBetween(6, 9)}${String(randomBetween(0, 999999999)).padStart(9, '0')}`.replace(/^(\+91 \d{5})(\d{5})$/, '$1 $2'),
  company: () => pick(COMPANIES),
  street: () => `${randomBetween(1, 250)}, ${pick(STREETS)}`,
  city: (row) => {
    const city = pick(CITIES);
    row._city = city;
    return city[0];
  },
  state: (row) => ((row._city as (typeof CITIES)[number] | undefined) ?? pick(CITIES))[1],
  pincode: (row) => ((row._city as (typeof CITIES)[number] | undefined) ?? pick(CITIES))[2].slice(0, 3) + String(randomBetween(0, 99)).padStart(3, '0'),
  country: () => 'India',
  date: () => new Date(Date.UTC(randomBetween(2018, 2026), randomBetween(0, 11), randomBetween(1, 28))).toISOString().slice(0, 10),
  datetime: () => new Date(Date.UTC(2026, randomBetween(0, 10), randomBetween(1, 28), randomBetween(0, 23), randomBetween(0, 59))).toISOString(),
  age: () => randomBetween(5, 80),
  amount: () => randomBetween(100, 500000) / 100,
  quantity: () => randomBetween(1, 50),
  rating: () => randomBetween(10, 50) / 10,
  active: () => randomBetween(0, 1) === 1,
  word: () => pick(WORDS),
  sentence: () =>
    `${Array.from({ length: randomBetween(5, 11) }, () => pick(WORDS))
      .join(' ')
      .replace(/^./, (char) => char.toUpperCase())}.`,
  colour: () => `#${randomBetween(0, 0xffffff).toString(16).padStart(6, '0')}`,
  ip: () => `192.0.2.${randomBetween(1, 254)}`,
  url: () => `https://${pick(DOMAINS)}/${pick(WORDS)}/${randomBetween(1, 999)}`,
};

export default defineTextTool({
  input: false,
  output: { label: 'Data' },
  options: [
    {
      key: 'fields',
      label: 'Fields',
      type: 'text',
      default: 'id, name, email, phone, city, state, pincode, date, amount, active',
      mono: true,
      wide: true,
      help: `Any of: ${Object.keys(FIELDS).join(', ')}. Rename with "label:field", e.g. "joined:date".`,
    },
    { key: 'count', label: 'Rows', type: 'number', default: 20, min: 1, max: 10000, step: 1 },
    {
      key: 'format',
      label: 'Format',
      type: 'select',
      choices: [
        { value: 'json', label: 'JSON' },
        { value: 'csv', label: 'CSV' },
        { value: 'sql', label: 'SQL INSERT' },
        { value: 'ndjson', label: 'JSON lines' },
      ],
      default: 'json',
    },
  ],
  action: 'Generate',
  runOnEmpty: true,
  run(_input, o) {
    const columns = o.fields
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [label, field = label] = part.split(':').map((piece) => piece.trim());
        if (!FIELDS[field as string]) throw new ToolError(`"${field}" is not a field. Use: ${Object.keys(FIELDS).join(', ')}.`);
        return { label: label as string, field: field as string };
      });
    if (columns.length === 0) throw new ToolError('List at least one field.');
    const rows = Array.from({ length: o.count }, (_, index) => {
      const scratch: Record<string, unknown> = {};
      // Names first, so email and name agree with each other.
      for (const key of ['firstName', 'lastName']) scratch[key] = (FIELDS[key] as (row: Record<string, unknown>, index: number) => unknown)(scratch, index);
      const row: Record<string, unknown> = {};
      for (const column of columns) row[column.label] = (FIELDS[column.field] as (row: Record<string, unknown>, index: number) => unknown)(scratch, index);
      return row;
    });
    let output: string;
    if (o.format === 'csv') output = `${Papa.unparse(rows)}\n`;
    else if (o.format === 'ndjson') output = `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
    else if (o.format === 'sql') {
      const value = (cell: unknown) => (typeof cell === 'number' ? String(cell) : typeof cell === 'boolean' ? (cell ? 'TRUE' : 'FALSE') : `'${String(cell).replace(/'/g, "''")}'`);
      output = `INSERT INTO people (${columns.map((column) => column.label).join(', ')}) VALUES\n${rows.map((row) => `  (${Object.values(row).map(value).join(', ')})`).join(',\n')};\n`;
    } else output = `${JSON.stringify(rows, null, 2)}\n`;
    return {
      output,
      language: o.format === 'json' ? 'json' : 'text',
      filename: `mock-data.${o.format === 'ndjson' ? 'jsonl' : o.format}`,
      info: 'Fictional people and companies; email addresses use reserved example domains.',
    };
  },
});
