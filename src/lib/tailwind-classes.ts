/**
 * A searchable reference of Tailwind CSS v4 utilities and the CSS they
 * produce, generated from the default theme (spacing unit 0.25rem).
 */
export interface Utility {
  readonly cls: string;
  readonly css: string;
  readonly group: string;
}

const out: Utility[] = [];
const add = (group: string, cls: string, css: string) => out.push({ group, cls, css });

const SPACING = [
  '0',
  'px',
  '0.5',
  '1',
  '1.5',
  '2',
  '2.5',
  '3',
  '3.5',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
  '14',
  '16',
  '20',
  '24',
  '28',
  '32',
  '36',
  '40',
  '44',
  '48',
  '52',
  '56',
  '60',
  '64',
  '72',
  '80',
  '96',
];
const space = (n: string) => (n === 'px' ? '1px' : n === '0' ? '0' : `calc(var(--spacing) * ${n}) /* ${Number(n) * 0.25}rem */`);

// Layout
for (const d of ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents', 'table', 'flow-root', 'list-item']) add('Layout', d, `display: ${d};`);
add('Layout', 'hidden', 'display: none;');
for (const p of ['static', 'fixed', 'absolute', 'relative', 'sticky']) add('Layout', p, `position: ${p};`);
for (const o of ['auto', 'hidden', 'clip', 'visible', 'scroll']) {
  add('Layout', `overflow-${o}`, `overflow: ${o};`);
  add('Layout', `overflow-x-${o}`, `overflow-x: ${o};`);
  add('Layout', `overflow-y-${o}`, `overflow-y: ${o};`);
}
for (const z of ['0', '10', '20', '30', '40', '50']) add('Layout', `z-${z}`, `z-index: ${z};`);
add('Layout', 'z-auto', 'z-index: auto;');
for (const side of ['inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left']) {
  const props = side === 'inset' ? ['inset'] : side === 'inset-x' ? ['left', 'right'] : side === 'inset-y' ? ['top', 'bottom'] : [side];
  for (const v of ['0', '1', '2', '4', 'full', 'auto', '1/2'])
    add('Layout', `${side}-${v}`, props.map((p) => `${p}: ${v === 'full' ? '100%' : v === 'auto' ? 'auto' : v === '1/2' ? '50%' : space(v)};`).join(' '));
}
for (const v of ['visible', 'invisible', 'collapse']) add('Layout', v, `visibility: ${v === 'invisible' ? 'hidden' : v};`);
for (const f of ['contain', 'cover', 'fill', 'none', 'scale-down']) add('Layout', `object-${f}`, `object-fit: ${f};`);
add('Layout', 'aspect-square', 'aspect-ratio: 1 / 1;');
add('Layout', 'aspect-video', 'aspect-ratio: var(--aspect-video) /* 16 / 9 */;');
add('Layout', 'aspect-auto', 'aspect-ratio: auto;');
add('Layout', 'box-border', 'box-sizing: border-box;');
add('Layout', 'box-content', 'box-sizing: content-box;');
add('Layout', 'container', 'width: 100%; /* with max-width at each breakpoint */');

// Flexbox and grid
for (const [c, v] of [
  ['flex-row', 'flex-direction: row;'],
  ['flex-row-reverse', 'flex-direction: row-reverse;'],
  ['flex-col', 'flex-direction: column;'],
  ['flex-col-reverse', 'flex-direction: column-reverse;'],
  ['flex-wrap', 'flex-wrap: wrap;'],
  ['flex-nowrap', 'flex-wrap: nowrap;'],
  ['flex-1', 'flex: 1;'],
  ['flex-auto', 'flex: auto;'],
  ['flex-initial', 'flex: 0 auto;'],
  ['flex-none', 'flex: none;'],
  ['grow', 'flex-grow: 1;'],
  ['grow-0', 'flex-grow: 0;'],
  ['shrink', 'flex-shrink: 1;'],
  ['shrink-0', 'flex-shrink: 0;'],
] as const)
  add('Flex and grid', c, v);
for (let n = 1; n <= 12; n++) {
  add('Flex and grid', `grid-cols-${n}`, `grid-template-columns: repeat(${n}, minmax(0, 1fr));`);
  add('Flex and grid', `col-span-${n}`, `grid-column: span ${n} / span ${n};`);
}
for (let n = 1; n <= 6; n++) {
  add('Flex and grid', `grid-rows-${n}`, `grid-template-rows: repeat(${n}, minmax(0, 1fr));`);
  add('Flex and grid', `row-span-${n}`, `grid-row: span ${n} / span ${n};`);
}
add('Flex and grid', 'col-span-full', 'grid-column: 1 / -1;');
for (const v of SPACING.slice(0, 20)) {
  add('Flex and grid', `gap-${v}`, `gap: ${space(v)};`);
  add('Flex and grid', `gap-x-${v}`, `column-gap: ${space(v)};`);
  add('Flex and grid', `gap-y-${v}`, `row-gap: ${space(v)};`);
}
for (const [k, v] of [
  ['start', 'flex-start'],
  ['end', 'flex-end'],
  ['center', 'center'],
  ['between', 'space-between'],
  ['around', 'space-around'],
  ['evenly', 'space-evenly'],
  ['stretch', 'stretch'],
] as const) {
  add('Flex and grid', `justify-${k}`, `justify-content: ${v};`);
  add('Flex and grid', `content-${k}`, `align-content: ${v};`);
}
for (const [k, v] of [
  ['start', 'flex-start'],
  ['end', 'flex-end'],
  ['center', 'center'],
  ['baseline', 'baseline'],
  ['stretch', 'stretch'],
] as const) {
  add('Flex and grid', `items-${k}`, `align-items: ${v};`);
  add('Flex and grid', `self-${k}`, `align-self: ${v};`);
}
for (const k of ['start', 'end', 'center', 'stretch']) {
  add('Flex and grid', `place-items-${k}`, `place-items: ${k};`);
  add('Flex and grid', `justify-items-${k}`, `justify-items: ${k};`);
}

// Spacing
const SIDES: Record<string, string[]> = {
  '': [''],
  x: ['-left', '-right'],
  y: ['-top', '-bottom'],
  t: ['-top'],
  r: ['-right'],
  b: ['-bottom'],
  l: ['-left'],
  s: ['-inline-start'],
  e: ['-inline-end'],
};
for (const [prefix, prop] of [
  ['p', 'padding'],
  ['m', 'margin'],
] as const)
  for (const [side, suffixes] of Object.entries(SIDES)) for (const v of SPACING) add('Spacing', `${prefix}${side}-${v}`, suffixes.map((s) => `${prop}${s}: ${space(v)};`).join(' '));
for (const side of ['', 'x', 'y']) add('Spacing', `m${side}-auto`, (SIDES[side] ?? ['']).map((s) => `margin${s}: auto;`).join(' '));
for (const v of ['1', '2', '4', '6', '8']) {
  add('Spacing', `space-x-${v}`, `& > * + * { margin-inline-start: ${space(v)}; }`);
  add('Spacing', `space-y-${v}`, `& > * + * { margin-block-start: ${space(v)}; }`);
}

// Sizing
const CONTAINERS: Record<string, string> = {
  '3xs': '16rem',
  '2xs': '18rem',
  xs: '20rem',
  sm: '24rem',
  md: '28rem',
  lg: '32rem',
  xl: '36rem',
  '2xl': '42rem',
  '3xl': '48rem',
  '4xl': '56rem',
  '5xl': '64rem',
  '6xl': '72rem',
  '7xl': '80rem',
};
for (const [p, prop] of [
  ['w', 'width'],
  ['h', 'height'],
  ['size', 'width'],
] as const) {
  for (const v of SPACING) add('Sizing', `${p}-${v}`, p === 'size' ? `width: ${space(v)}; height: ${space(v)};` : `${prop}: ${space(v)};`);
  for (const [k, v] of [
    ['full', '100%'],
    ['auto', 'auto'],
    ['min', 'min-content'],
    ['max', 'max-content'],
    ['fit', 'fit-content'],
    ['1/2', '50%'],
    ['1/3', '33.333333%'],
    ['2/3', '66.666667%'],
    ['1/4', '25%'],
    ['3/4', '75%'],
  ] as const)
    add('Sizing', `${p}-${k}`, p === 'size' ? `width: ${v}; height: ${v};` : `${prop}: ${v};`);
}
add('Sizing', 'w-screen', 'width: 100vw;');
add('Sizing', 'h-screen', 'height: 100vh;');
add('Sizing', 'h-dvh', 'height: 100dvh;');
add('Sizing', 'min-h-screen', 'min-height: 100vh;');
add('Sizing', 'min-w-0', 'min-width: 0;');
for (const [k, v] of Object.entries(CONTAINERS)) add('Sizing', `max-w-${k}`, `max-width: var(--container-${k}) /* ${v} */;`);
add('Sizing', 'max-w-full', 'max-width: 100%;');
add('Sizing', 'max-w-prose', 'max-width: 65ch;');
add('Sizing', 'max-w-none', 'max-width: none;');

// Typography
const TEXT: Record<string, [string, string]> = {
  xs: ['0.75rem', '1rem'],
  sm: ['0.875rem', '1.25rem'],
  base: ['1rem', '1.5rem'],
  lg: ['1.125rem', '1.75rem'],
  xl: ['1.25rem', '1.75rem'],
  '2xl': ['1.5rem', '2rem'],
  '3xl': ['1.875rem', '2.25rem'],
  '4xl': ['2.25rem', '2.5rem'],
  '5xl': ['3rem', '1'],
  '6xl': ['3.75rem', '1'],
  '7xl': ['4.5rem', '1'],
  '8xl': ['6rem', '1'],
  '9xl': ['8rem', '1'],
};
for (const [k, [size, lh]] of Object.entries(TEXT)) add('Typography', `text-${k}`, `font-size: ${size}; line-height: ${lh === '1' ? '1' : `calc(${lh} / ${size})`};`);
for (const [k, w] of Object.entries({ thin: 100, extralight: 200, light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, extrabold: 800, black: 900 }))
  add('Typography', `font-${k}`, `font-weight: ${w};`);
for (const f of ['sans', 'serif', 'mono']) add('Typography', `font-${f}`, `font-family: var(--font-${f});`);
for (const [k, v] of Object.entries({ tighter: '-0.05em', tight: '-0.025em', normal: '0em', wide: '0.025em', wider: '0.05em', widest: '0.1em' }))
  add('Typography', `tracking-${k}`, `letter-spacing: ${v};`);
for (const [k, v] of Object.entries({ none: '1', tight: '1.25', snug: '1.375', normal: '1.5', relaxed: '1.625', loose: '2' })) add('Typography', `leading-${k}`, `line-height: ${v};`);
for (const a of ['left', 'center', 'right', 'justify', 'start', 'end']) add('Typography', `text-${a}`, `text-align: ${a};`);
for (const [c, v] of [
  ['uppercase', 'text-transform: uppercase;'],
  ['lowercase', 'text-transform: lowercase;'],
  ['capitalize', 'text-transform: capitalize;'],
  ['normal-case', 'text-transform: none;'],
  ['italic', 'font-style: italic;'],
  ['not-italic', 'font-style: normal;'],
  ['underline', 'text-decoration-line: underline;'],
  ['line-through', 'text-decoration-line: line-through;'],
  ['no-underline', 'text-decoration-line: none;'],
  ['truncate', 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'],
  ['whitespace-nowrap', 'white-space: nowrap;'],
  ['whitespace-pre-wrap', 'white-space: pre-wrap;'],
  ['break-words', 'overflow-wrap: break-word;'],
  ['break-all', 'word-break: break-all;'],
  ['tabular-nums', 'font-variant-numeric: tabular-nums;'],
  ['antialiased', '-webkit-font-smoothing: antialiased;'],
  ['line-clamp-2', 'overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2;'],
  ['list-disc', 'list-style-type: disc;'],
  ['list-none', 'list-style-type: none;'],
] as const)
  add('Typography', c, v);

// Borders
for (const [k, v] of Object.entries({
  none: '0',
  xs: '0.125rem',
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  '4xl': '2rem',
  full: 'calc(infinity * 1px)',
}))
  add('Borders', `rounded-${k}`, `border-radius: ${v};`);
add('Borders', 'rounded', 'border-radius: 0.25rem;');
for (const w of ['', '-0', '-2', '-4', '-8']) add('Borders', `border${w}`, `border-width: ${w ? `${w.slice(1)}px` : '1px'};`);
for (const s of ['solid', 'dashed', 'dotted', 'double', 'none']) add('Borders', `border-${s}`, `border-style: ${s};`);
for (const w of ['', '-0', '-2', '-4']) add('Borders', `ring${w}`, `box-shadow: 0 0 0 ${w ? w.slice(1) : '1'}px var(--tw-ring-color, currentcolor);`);
add('Borders', 'outline-none', 'outline: 2px solid transparent; outline-offset: 2px;');
add('Borders', 'divide-y', '& > * + * { border-top-width: 1px; }');
add('Borders', 'divide-x', '& > * + * { border-left-width: 1px; }');

// Effects
const SHADOWS: Record<string, string> = {
  '2xs': '0 1px rgb(0 0 0 / 0.05)',
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  none: '0 0 #0000',
};
for (const [k, v] of Object.entries(SHADOWS)) add('Effects', `shadow-${k}`, `box-shadow: ${v};`);
for (let o = 0; o <= 100; o += 5) add('Effects', `opacity-${o}`, `opacity: ${o / 100};`);
for (const [k, v] of Object.entries({ xs: '4px', sm: '8px', md: '12px', lg: '16px', xl: '24px', '2xl': '40px', '3xl': '64px' })) {
  add('Effects', `blur-${k}`, `filter: blur(${v});`);
  add('Effects', `backdrop-blur-${k}`, `backdrop-filter: blur(${v});`);
}
for (const m of ['multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference']) add('Effects', `mix-blend-${m}`, `mix-blend-mode: ${m};`);
add('Effects', 'grayscale', 'filter: grayscale(100%);');

// Transitions and transforms
add(
  'Motion',
  'transition',
  'transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, translate, scale, rotate, filter, backdrop-filter; transition-duration: 150ms;',
);
add('Motion', 'transition-colors', 'transition-property: color, background-color, border-color, text-decoration-color, fill, stroke; transition-duration: 150ms;');
add('Motion', 'transition-transform', 'transition-property: transform, translate, scale, rotate; transition-duration: 150ms;');
for (const d of ['75', '100', '150', '200', '300', '500', '700', '1000']) add('Motion', `duration-${d}`, `transition-duration: ${d}ms;`);
for (const [k, v] of Object.entries({ linear: 'linear', in: 'cubic-bezier(0.4, 0, 1, 1)', out: 'cubic-bezier(0, 0, 0.2, 1)', 'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)' }))
  add('Motion', `ease-${k}`, `transition-timing-function: ${v};`);
for (const a of ['spin', 'ping', 'pulse', 'bounce']) add('Motion', `animate-${a}`, `animation: var(--animate-${a});`);
for (const s of ['0', '50', '75', '90', '95', '100', '105', '110', '125', '150']) add('Motion', `scale-${s}`, `scale: ${s}% ${s}%;`);
for (const r of ['0', '1', '2', '3', '6', '12', '45', '90', '180']) add('Motion', `rotate-${r}`, `rotate: ${r}deg;`);
for (const v of ['0', '1', '2', '4', 'full', '1/2']) {
  add('Motion', `translate-x-${v}`, `translate: ${v === 'full' ? '100%' : v === '1/2' ? '50%' : space(v)} var(--tw-translate-y);`);
  add('Motion', `-translate-y-${v}`, `translate: var(--tw-translate-x) -${v === 'full' ? '100%' : v === '1/2' ? '50%' : space(v)};`);
}

// Interactivity
for (const c of ['auto', 'default', 'pointer', 'wait', 'text', 'move', 'not-allowed', 'grab', 'zoom-in']) add('Interactivity', `cursor-${c}`, `cursor: ${c};`);
for (const s of ['none', 'text', 'all', 'auto']) add('Interactivity', `select-${s}`, `user-select: ${s};`);
add('Interactivity', 'pointer-events-none', 'pointer-events: none;');
add('Interactivity', 'pointer-events-auto', 'pointer-events: auto;');
add('Interactivity', 'scroll-smooth', 'scroll-behavior: smooth;');
add('Interactivity', 'snap-x', 'scroll-snap-type: x var(--tw-scroll-snap-strictness);');
add('Interactivity', 'snap-center', 'scroll-snap-align: center;');
add('Interactivity', 'resize', 'resize: both;');
add('Interactivity', 'resize-y', 'resize: vertical;');
add('Interactivity', 'sr-only', 'position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border-width: 0;');

// Breakpoints and states
for (const [k, v] of Object.entries({ sm: '40rem (640px)', md: '48rem (768px)', lg: '64rem (1024px)', xl: '80rem (1280px)', '2xl': '96rem (1536px)' }))
  add('Breakpoints and states', `${k}:…`, `@media (width >= ${v}) { … }`);
for (const [k, v] of [
  ['hover:…', '&:hover { … } (only on devices that hover)'],
  ['focus:…', '&:focus { … }'],
  ['focus-visible:…', '&:focus-visible { … }'],
  ['active:…', '&:active { … }'],
  ['disabled:…', '&:disabled { … }'],
  ['dark:…', '@media (prefers-color-scheme: dark) { … }'],
  ['motion-reduce:…', '@media (prefers-reduced-motion: reduce) { … }'],
  ['first:…', '&:first-child { … }'],
  ['last:…', '&:last-child { … }'],
  ['odd:…', '&:nth-child(odd) { … }'],
  ['group-hover:…', '.group:hover & { … }'],
  ['peer-checked:…', '.peer:checked ~ & { … }'],
  ['print:…', '@media print { … }'],
] as const)
  add('Breakpoints and states', k, v);

// Colours
for (const [k, v] of [
  ['bg-{colour}-{shade}', 'background-color: var(--color-{colour}-{shade}); e.g. bg-sky-500'],
  ['text-{colour}-{shade}', 'color: var(--color-{colour}-{shade});'],
  ['border-{colour}-{shade}', 'border-color: var(--color-{colour}-{shade});'],
  ['bg-{colour}-{shade}/50', 'background-color with 50% opacity (color-mix in oklab)'],
  ['bg-white', 'background-color: var(--color-white);'],
  ['bg-black', 'background-color: var(--color-black);'],
  ['bg-transparent', 'background-color: transparent;'],
  ['text-current', 'color: currentColor;'],
  ['bg-linear-to-r', 'background-image: linear-gradient(to right, var(--tw-gradient-stops));'],
  ['from-{colour}-{shade}', 'Gradient start colour'],
  ['to-{colour}-{shade}', 'Gradient end colour'],
] as const)
  add('Colours', k, v);

export const UTILITIES: readonly Utility[] = out;
export const UTILITY_GROUPS: readonly string[] = [...new Set(out.map((u) => u.group))];
