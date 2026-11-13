import { defineVisualTool } from '../types';
import { css, html, inline, px, rule, tailwind } from './_shared';

const ITEM = [
  { key: 'grow', label: 'Grow', type: 'number', min: 0, max: 10, step: 1, default: 0 },
  { key: 'shrink', label: 'Shrink', type: 'number', min: 0, max: 10, step: 1, default: 1 },
  { key: 'basis', label: 'Basis', type: 'text', default: 'auto', mono: true },
  { key: 'alignSelf', label: 'Align self', type: 'select', choices: ['auto', 'flex-start', 'center', 'flex-end', 'stretch', 'baseline'], default: 'auto' },
  { key: 'order', label: 'Order', type: 'number', min: -10, max: 10, step: 1, default: 0 },
] as const;

const controls = [
  { key: 'direction', label: 'flex-direction', type: 'select', choices: ['row', 'row-reverse', 'column', 'column-reverse'], default: 'row' },
  { key: 'wrap', label: 'flex-wrap', type: 'select', choices: ['nowrap', 'wrap', 'wrap-reverse'], default: 'wrap' },
  { key: 'justify', label: 'justify-content', type: 'select', choices: ['flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly'], default: 'flex-start' },
  { key: 'alignItems', label: 'align-items', type: 'select', choices: ['stretch', 'flex-start', 'center', 'flex-end', 'baseline'], default: 'stretch' },
  { key: 'alignContent', label: 'align-content', type: 'select', choices: ['normal', 'flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'stretch'], default: 'normal' },
  { key: 'gap', label: 'gap', type: 'range', min: 0, max: 48, step: 1, unit: 'px', default: 12 },
  {
    key: 'items',
    label: 'Items',
    type: 'list',
    item: ITEM,
    min: 1,
    max: 12,
    itemLabel: 'Item',
    default: [
      { grow: 0, shrink: 1, basis: 'auto', alignSelf: 'auto', order: 0 },
      { grow: 1, shrink: 1, basis: 'auto', alignSelf: 'auto', order: 0 },
      { grow: 0, shrink: 1, basis: '120px', alignSelf: 'auto', order: 0 },
      { grow: 0, shrink: 1, basis: 'auto', alignSelf: 'auto', order: 0 },
    ],
  },
] as const;

interface Item {
  readonly grow: number;
  readonly shrink: number;
  readonly basis: string;
  readonly alignSelf: string;
  readonly order: number;
}

const TW_JUSTIFY: Record<string, string> = {
  'flex-start': 'justify-start',
  center: 'justify-center',
  'flex-end': 'justify-end',
  'space-between': 'justify-between',
  'space-around': 'justify-around',
  'space-evenly': 'justify-evenly',
};
const TW_ALIGN: Record<string, string> = { stretch: 'items-stretch', 'flex-start': 'items-start', center: 'items-center', 'flex-end': 'items-end', baseline: 'items-baseline' };
const TW_CONTENT: Record<string, string> = {
  normal: '',
  'flex-start': 'content-start',
  center: 'content-center',
  'flex-end': 'content-end',
  'space-between': 'content-between',
  'space-around': 'content-around',
  stretch: 'content-stretch',
};
const TW_DIRECTION: Record<string, string> = { row: 'flex-row', 'row-reverse': 'flex-row-reverse', column: 'flex-col', 'column-reverse': 'flex-col-reverse' };
const TW_SELF: Record<string, string> = { auto: '', 'flex-start': 'self-start', center: 'self-center', 'flex-end': 'self-end', stretch: 'self-stretch', baseline: 'self-baseline' };

function itemDeclarations(item: Item): [string, string][] {
  const out: [string, string][] = [];
  if (item.grow !== 0 || item.shrink !== 1 || item.basis.trim() !== 'auto') out.push(['flex', `${item.grow} ${item.shrink} ${item.basis.trim() || 'auto'}`]);
  if (item.alignSelf !== 'auto') out.push(['align-self', item.alignSelf]);
  if (item.order !== 0) out.push(['order', String(item.order)]);
  return out;
}

export default defineVisualTool({
  controls,
  presets: [
    {
      name: 'Navbar',
      values: {
        direction: 'row',
        wrap: 'nowrap',
        justify: 'space-between',
        alignItems: 'center',
        items: [
          { grow: 0, shrink: 0, basis: 'auto', alignSelf: 'auto', order: 0 },
          { grow: 1, shrink: 1, basis: 'auto', alignSelf: 'auto', order: 0 },
          { grow: 0, shrink: 0, basis: 'auto', alignSelf: 'auto', order: 0 },
        ],
      },
    },
    { name: 'Centred', values: { direction: 'row', wrap: 'nowrap', justify: 'center', alignItems: 'center', items: [{ grow: 0, shrink: 1, basis: 'auto', alignSelf: 'auto', order: 0 }] } },
    {
      name: 'Card row',
      values: {
        direction: 'row',
        wrap: 'wrap',
        justify: 'flex-start',
        alignItems: 'stretch',
        gap: 16,
        items: Array.from({ length: 5 }, () => ({ grow: 1, shrink: 1, basis: '160px', alignSelf: 'auto', order: 0 })),
      },
    },
    {
      name: 'Sidebar',
      values: {
        direction: 'row',
        wrap: 'nowrap',
        justify: 'flex-start',
        alignItems: 'stretch',
        items: [
          { grow: 0, shrink: 0, basis: '200px', alignSelf: 'auto', order: 0 },
          { grow: 1, shrink: 1, basis: '0', alignSelf: 'auto', order: 0 },
        ],
      },
    },
  ],
  render(v) {
    const items = v.items as readonly Item[];
    const container: [string, string][] = [
      ['display', 'flex'],
      ['flex-direction', v.direction],
      ['flex-wrap', v.wrap],
      ['justify-content', v.justify],
      ['align-items', v.alignItems],
    ];
    if (v.alignContent !== 'normal') container.push(['align-content', v.alignContent]);
    if (v.gap > 0) container.push(['gap', px(v.gap)]);
    const itemRules = items
      .map((item, index) => ({ index, declarations: itemDeclarations(item) }))
      .filter((entry) => entry.declarations.length > 0)
      .map((entry) => rule(`.item-${entry.index + 1}`, entry.declarations))
      .join('\n');
    const markup = `<div class="container">\n${items.map((_, index) => `  <div class="item item-${index + 1}">${index + 1}</div>`).join('\n')}\n</div>\n`;
    const twItems = items
      .map((item, index) => {
        const classes = [
          item.grow !== 0 || item.shrink !== 1 || item.basis.trim() !== 'auto' ? `flex-[${item.grow}_${item.shrink}_${(item.basis.trim() || 'auto').replace(/\s+/g, '_')}]` : '',
          TW_SELF[item.alignSelf] ?? '',
          item.order !== 0 ? `order-[${item.order}]` : '',
        ].filter(Boolean);
        return `  <div class="${classes.join(' ')}">${index + 1}</div>`;
      })
      .join('\n');
    const containerClasses = [
      'flex',
      TW_DIRECTION[v.direction],
      v.wrap === 'nowrap' ? 'flex-nowrap' : v.wrap === 'wrap' ? 'flex-wrap' : 'flex-wrap-reverse',
      TW_JUSTIFY[v.justify],
      TW_ALIGN[v.alignItems],
      TW_CONTENT[v.alignContent],
      v.gap > 0 ? `gap-[${v.gap}px]` : '',
    ].filter(Boolean);
    const vertical = v.direction.startsWith('column');
    return {
      preview: (
        <div class="pv-flex" style={inline(container)}>
          {items.map((item, index) => (
            <div key={index} class="pv-flex-item" style={inline(itemDeclarations(item))}>
              <span>{index + 1}</span>
              {itemDeclarations(item).length > 0 && (
                <small>
                  {itemDeclarations(item)
                    .map(([p, value]) => `${p}: ${value}`)
                    .join('; ')}
                </small>
              )}
            </div>
          ))}
        </div>
      ),
      css: `.pv-flex { width: 100%; min-height: ${vertical ? 420 : 260}px; padding: 12px; border: 2px dashed var(--line-strong); border-radius: 6px; background: var(--panel); } .pv-flex-item { min-width: 48px; min-height: 48px; padding: 8px 12px; display: grid; place-content: center; gap: 2px; text-align: center; border-radius: 4px; background: var(--accent); color: #fff; font: 600 15px/1.2 var(--font-ui); } .pv-flex-item:nth-child(3n+2) { background: var(--brass); padding-block: 20px; } .pv-flex-item:nth-child(3n) { background: #475569; } .pv-flex-item small { font: 400 10px/1.2 var(--font-mono); opacity: .9; }`,
      outputs: [
        css(`${rule('.container', container)}${itemRules ? `\n${itemRules}` : ''}`),
        html(markup),
        tailwind([containerClasses.join(' ')], undefined),
        { label: 'Tailwind items', language: 'html', code: `<div class="${containerClasses.join(' ')}">\n${twItems}\n</div>\n` },
      ],
    };
  },
});
