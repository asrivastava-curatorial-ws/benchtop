/** Colour palettes that are free to use, with where they come from and their licence. */
export interface Palette {
  readonly id: string;
  readonly name: string;
  readonly group: 'Charts and maps' | 'Colour-blind safe' | 'Editor themes' | 'Design systems' | 'Flags and identity';
  readonly source: string;
  readonly licence: string;
  readonly colors: readonly (readonly [name: string, hex: string])[];
}

const named = (list: string): [string, string][] =>
  list
    .trim()
    .split(/\s*,\s*/)
    .map((pair) => {
      const [name, hex] = pair.split('=');
      return [name?.trim() ?? '', (hex ?? '').trim()];
    });
const plain = (list: string): [string, string][] =>
  list
    .trim()
    .split(/\s+/)
    .map((hex, i) => [String(i + 1), hex]);

export const PALETTES: readonly Palette[] = [
  {
    id: 'okabe-ito',
    name: 'Okabe–Ito',
    group: 'Colour-blind safe',
    source: 'Okabe and Ito, Color Universal Design (2008)',
    licence: 'Free to use',
    colors: named('Orange=#E69F00, Sky blue=#56B4E9, Bluish green=#009E73, Yellow=#F0E442, Blue=#0072B2, Vermillion=#D55E00, Reddish purple=#CC79A7, Black=#000000'),
  },
  {
    id: 'tol-bright',
    name: 'Paul Tol bright',
    group: 'Colour-blind safe',
    source: 'Paul Tol, SRON technical note',
    licence: 'Free to use',
    colors: named('Blue=#4477AA, Red=#EE6677, Green=#228833, Yellow=#CCBB44, Cyan=#66CCEE, Purple=#AA3377, Grey=#BBBBBB'),
  },
  {
    id: 'tol-muted',
    name: 'Paul Tol muted',
    group: 'Colour-blind safe',
    source: 'Paul Tol, SRON technical note',
    licence: 'Free to use',
    colors: named('Indigo=#332288, Cyan=#88CCEE, Teal=#44AA99, Green=#117733, Olive=#999933, Sand=#DDCC77, Rose=#CC6677, Wine=#882255, Purple=#AA4499'),
  },
  {
    id: 'viridis',
    name: 'Viridis',
    group: 'Charts and maps',
    source: 'Smith and van der Walt, matplotlib',
    licence: 'CC0',
    colors: plain('#440154 #46327E #365C8D #277F8E #1FA187 #4AC16D #A0DA39 #FDE725'),
  },
  {
    id: 'magma',
    name: 'Magma',
    group: 'Charts and maps',
    source: 'Smith and van der Walt, matplotlib',
    licence: 'CC0',
    colors: plain('#000004 #1C1044 #4F127B #812581 #B5367A #E55964 #FB8761 #FEC287 #FCFDBF'),
  },
  {
    id: 'brewer-set2',
    name: 'ColorBrewer Set2',
    group: 'Charts and maps',
    source: 'Cynthia Brewer, ColorBrewer',
    licence: 'Apache-2.0',
    colors: plain('#66C2A5 #FC8D62 #8DA0CB #E78AC3 #A6D854 #FFD92F #E5C494 #B3B3B3'),
  },
  {
    id: 'brewer-dark2',
    name: 'ColorBrewer Dark2',
    group: 'Charts and maps',
    source: 'Cynthia Brewer, ColorBrewer',
    licence: 'Apache-2.0',
    colors: plain('#1B9E77 #D95F02 #7570B3 #E7298A #66A61E #E6AB02 #A6761D #666666'),
  },
  {
    id: 'brewer-paired',
    name: 'ColorBrewer Paired',
    group: 'Charts and maps',
    source: 'Cynthia Brewer, ColorBrewer',
    licence: 'Apache-2.0',
    colors: plain('#A6CEE3 #1F78B4 #B2DF8A #33A02C #FB9A99 #E31A1C #FDBF6F #FF7F00 #CAB2D6 #6A3D9A #FFFF99 #B15928'),
  },
  {
    id: 'brewer-rdylbu',
    name: 'ColorBrewer Red–Yellow–Blue',
    group: 'Charts and maps',
    source: 'Cynthia Brewer, ColorBrewer (diverging)',
    licence: 'Apache-2.0',
    colors: plain('#D73027 #F46D43 #FDAE61 #FEE090 #FFFFBF #E0F3F8 #ABD9E9 #74ADD1 #4575B4'),
  },
  {
    id: 'tableau10',
    name: 'Tableau 10',
    group: 'Charts and maps',
    source: 'd3-scale-chromatic',
    licence: 'ISC',
    colors: plain('#4E79A7 #F28E2C #E15759 #76B7B2 #59A14F #EDC949 #AF7AA1 #FF9DA7 #9C755F #BAB0AB'),
  },
  {
    id: 'github-dark',
    name: 'GitHub dark (Primer)',
    group: 'Editor themes',
    source: 'GitHub Primer primitives',
    licence: 'MIT',
    colors: named('Canvas=#0D1117, Canvas subtle=#161B22, Border=#30363D, Text=#E6EDF3, Muted text=#7D8590, Accent=#2F81F7, Success=#3FB950, Attention=#D29922, Danger=#F85149, Done=#A371F7'),
  },
  {
    id: 'nord',
    name: 'Nord',
    group: 'Editor themes',
    source: 'Arctic Ice Studio',
    licence: 'MIT',
    colors: named(
      'Polar night 0=#2E3440, Polar night 1=#3B4252, Polar night 2=#434C5E, Polar night 3=#4C566A, Snow storm 0=#D8DEE9, Snow storm 1=#E5E9F0, Snow storm 2=#ECEFF4, Frost 0=#8FBCBB, Frost 1=#88C0D0, Frost 2=#81A1C1, Frost 3=#5E81AC, Red=#BF616A, Orange=#D08770, Yellow=#EBCB8B, Green=#A3BE8C, Purple=#B48EAD',
    ),
  },
  {
    id: 'solarized',
    name: 'Solarized',
    group: 'Editor themes',
    source: 'Ethan Schoonover',
    licence: 'MIT',
    colors: named(
      'base03=#002B36, base02=#073642, base01=#586E75, base00=#657B83, base0=#839496, base1=#93A1A1, base2=#EEE8D5, base3=#FDF6E3, Yellow=#B58900, Orange=#CB4B16, Red=#DC322F, Magenta=#D33682, Violet=#6C71C4, Blue=#268BD2, Cyan=#2AA198, Green=#859900',
    ),
  },
  {
    id: 'dracula',
    name: 'Dracula',
    group: 'Editor themes',
    source: 'Zeno Rocha and contributors',
    licence: 'MIT',
    colors: named(
      'Background=#282A36, Current line=#44475A, Foreground=#F8F8F2, Comment=#6272A4, Cyan=#8BE9FD, Green=#50FA7B, Orange=#FFB86C, Pink=#FF79C6, Purple=#BD93F9, Red=#FF5555, Yellow=#F1FA8C',
    ),
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    group: 'Editor themes',
    source: 'Catppuccin',
    licence: 'MIT',
    colors: named(
      'Rosewater=#F5E0DC, Flamingo=#F2CDCD, Pink=#F5C2E7, Mauve=#CBA6F7, Red=#F38BA8, Maroon=#EBA0AC, Peach=#FAB387, Yellow=#F9E2AF, Green=#A6E3A1, Teal=#94E2D5, Sky=#89DCEB, Sapphire=#74C7EC, Blue=#89B4FA, Lavender=#B4BEFE, Text=#CDD6F4, Base=#1E1E2E, Mantle=#181825, Crust=#11111B',
    ),
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox dark',
    group: 'Editor themes',
    source: 'Pavel Pertsev',
    licence: 'MIT',
    colors: named('Background=#282828, Red=#CC241D, Green=#98971A, Yellow=#D79921, Blue=#458588, Purple=#B16286, Aqua=#689D6A, Grey=#A89984, Orange=#D65D0E, Foreground=#EBDBB2'),
  },
  {
    id: 'material2',
    name: 'Material Design 2 (500 shades)',
    group: 'Design systems',
    source: 'Google Material Design',
    licence: 'Apache-2.0',
    colors: named(
      'Red=#F44336, Pink=#E91E63, Purple=#9C27B0, Deep purple=#673AB7, Indigo=#3F51B5, Blue=#2196F3, Light blue=#03A9F4, Cyan=#00BCD4, Teal=#009688, Green=#4CAF50, Light green=#8BC34A, Lime=#CDDC39, Yellow=#FFEB3B, Amber=#FFC107, Orange=#FF9800, Deep orange=#FF5722, Brown=#795548, Grey=#9E9E9E, Blue grey=#607D8B',
    ),
  },
  {
    id: 'bootstrap5',
    name: 'Bootstrap 5 theme colours',
    group: 'Design systems',
    source: 'Bootstrap',
    licence: 'MIT',
    colors: named('Primary=#0D6EFD, Secondary=#6C757D, Success=#198754, Info=#0DCAF0, Warning=#FFC107, Danger=#DC3545, Light=#F8F9FA, Dark=#212529'),
  },
  {
    id: 'india-flag',
    name: 'Flag of India (screen colours)',
    group: 'Flags and identity',
    source: 'Common screen values for the tricolour and Ashoka Chakra',
    licence: 'Public domain',
    colors: named('Saffron=#FF9933, White=#FFFFFF, India green=#138808, Navy blue=#000080'),
  },
];

/** The palette as files people use. */
export function paletteExports(p: Palette): { css: string; json: string; gpl: string; scss: string } {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'colour';
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  return {
    css: `/* ${p.name}: ${p.source} (${p.licence}) */\n:root {\n${p.colors.map(([n, h]) => `  --${p.id}-${slug(n)}: ${h.toLowerCase()};`).join('\n')}\n}\n`,
    scss: `// ${p.name}: ${p.source} (${p.licence})\n${p.colors.map(([n, h]) => `$${p.id}-${slug(n)}: ${h.toLowerCase()};`).join('\n')}\n`,
    json: `${JSON.stringify({ name: p.name, source: p.source, licence: p.licence, colors: Object.fromEntries(p.colors.map(([n, h]) => [n, h.toLowerCase()])) }, null, 2)}\n`,
    gpl: `GIMP Palette\nName: ${p.name}\nColumns: ${Math.min(8, p.colors.length)}\n# ${p.source} (${p.licence})\n${p.colors
      .map(([n, h]) => {
        const [r, g, b] = rgb(h);
        return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${n}`;
      })
      .join('\n')}\n`,
  };
}
