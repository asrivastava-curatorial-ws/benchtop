/**
 * Material Theme Builder: Material 3 light and dark colour schemes from one
 * colour or a picture, with exports for Android, Compose, Flutter and CSS.
 */
import { argbFromRgb, Hct, hexFromArgb, QuantizerCelebi, Score } from '@material/material-color-utilities';
import { strToU8, zipSync } from 'fflate';
import { useMemo, useState } from 'preact/hooks';
import {
  androidColorsXml,
  androidThemesXml,
  buildTheme,
  type CustomColor,
  composeColorKt,
  composeThemeKt,
  contrastRatio,
  cssVariables,
  flutterColorScheme,
  type Overrides,
  parseHex,
  ROLES,
  type Role,
  type SchemeColors,
  type Spec,
  type Theme,
  TONES,
  themeJson,
  VARIANTS,
  type VariantId,
} from '../../lib/material-theme';
import { copyText, pickFile } from '../../platform';
import { CodeOutput } from '../../ui/CodeOutput';
import { context2d, createCanvas, loadImage } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import type { CodeOutput as Output } from '../types';
import { defineCustomTool, type Values } from '../types';
import { type SegmentChoice, Segmented, usePersistentState } from './_shared';

type OverrideKey = keyof Overrides;

interface Design {
  readonly seed: string;
  readonly variant: VariantId;
  readonly contrast: number;
  readonly spec: Spec;
  readonly overrides: Readonly<Record<OverrideKey, string>>;
  readonly custom: readonly CustomColor[];
  readonly mode: 'light' | 'dark';
  readonly pkg: string;
}

const INITIAL: Design = {
  seed: '#17694E',
  variant: 'tonalSpot',
  contrast: 0,
  spec: '2021',
  overrides: { secondary: '', tertiary: '', error: '', neutral: '' },
  custom: [],
  mode: 'light',
  pkg: 'com.example.app.ui.theme',
};

const isHex = (v: unknown): v is string => typeof v === 'string' && parseHex(v) !== null;
const normal = (v: string) => (v.startsWith('#') ? v : `#${v}`).toUpperCase();

function readDesign(stored: Values | undefined): Design {
  if (!stored) return INITIAL;
  const o = (stored.overrides ?? {}) as Record<string, unknown>;
  const over = (k: OverrideKey) => (isHex(o[k]) ? normal(o[k] as string) : '');
  const custom = Array.isArray(stored.custom)
    ? (stored.custom as unknown[])
        .filter((c): c is CustomColor => !!c && typeof c === 'object' && isHex((c as CustomColor).hex))
        .slice(0, 6)
        .map((c) => ({ name: String(c.name ?? '').slice(0, 30), hex: normal(c.hex), blend: c.blend !== false }))
    : [];
  return {
    seed: isHex(stored.seed) ? normal(stored.seed) : INITIAL.seed,
    variant: VARIANTS.some((v) => v.id === stored.variant) ? (stored.variant as VariantId) : INITIAL.variant,
    contrast: [-1, 0, 0.5, 1].includes(stored.contrast as number) ? (stored.contrast as number) : 0,
    spec: stored.spec === '2025' ? '2025' : '2021',
    overrides: { secondary: over('secondary'), tertiary: over('tertiary'), error: over('error'), neutral: over('neutral') },
    custom,
    mode: stored.mode === 'dark' ? 'dark' : 'light',
    pkg: typeof stored.pkg === 'string' && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(stored.pkg) ? stored.pkg : INITIAL.pkg,
  };
}

/** The colours a picture would suggest as seeds, best first. */
async function seedsFromPicture(file: File): Promise<string[]> {
  const source = await loadImage(file);
  const scale = Math.min(1, 128 / Math.max(source.width, source.height));
  const canvas = createCanvas(Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)));
  const context = context2d(canvas, true);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const pixels: number[] = [];
  for (let i = 0; i < data.length; i += 4) if ((data[i + 3] as number) === 255) pixels.push(argbFromRgb(data[i] as number, data[i + 1] as number, data[i + 2] as number));
  if (!pixels.length) throw new Error('The picture has no opaque pixels to take colours from.');
  const ranked = Score.score(QuantizerCelebi.quantize(pixels, 128), { desired: 5, filter: true, fallbackColorARGB: 0xff4285f4 });
  return ranked.map((argb) => hexFromArgb(argb).toUpperCase());
}

/* --------------------------------------------------------------- swatches -- */

const words = (role: string) => {
  const spaced = role.replace(/([A-Z])/g, ' $1').toLowerCase();
  return spaced[0]?.toUpperCase() + spaced.slice(1);
};

/** Pairs of [background role, text role]; null picks black or white. */
const SWATCH_GROUPS: readonly { title: string; tiles: readonly (readonly [Role, Role | null])[] }[] = [
  {
    title: 'Primary',
    tiles: [
      ['primary', 'onPrimary'],
      ['onPrimary', 'primary'],
      ['primaryContainer', 'onPrimaryContainer'],
      ['onPrimaryContainer', 'primaryContainer'],
    ],
  },
  {
    title: 'Secondary',
    tiles: [
      ['secondary', 'onSecondary'],
      ['onSecondary', 'secondary'],
      ['secondaryContainer', 'onSecondaryContainer'],
      ['onSecondaryContainer', 'secondaryContainer'],
    ],
  },
  {
    title: 'Tertiary',
    tiles: [
      ['tertiary', 'onTertiary'],
      ['onTertiary', 'tertiary'],
      ['tertiaryContainer', 'onTertiaryContainer'],
      ['onTertiaryContainer', 'tertiaryContainer'],
    ],
  },
  {
    title: 'Error',
    tiles: [
      ['error', 'onError'],
      ['onError', 'error'],
      ['errorContainer', 'onErrorContainer'],
      ['onErrorContainer', 'errorContainer'],
    ],
  },
  {
    title: 'Surfaces',
    tiles: [
      ['surfaceDim', 'onSurface'],
      ['surface', 'onSurface'],
      ['surfaceBright', 'onSurface'],
      ['surfaceContainerLowest', 'onSurface'],
      ['surfaceContainerLow', 'onSurface'],
      ['surfaceContainer', 'onSurface'],
      ['surfaceContainerHigh', 'onSurface'],
      ['surfaceContainerHighest', 'onSurface'],
      ['onSurface', 'surface'],
      ['onSurfaceVariant', 'surface'],
      ['outline', null],
      ['outlineVariant', 'onSurface'],
    ],
  },
  {
    title: 'Inverse, scrim and shadow',
    tiles: [
      ['inverseSurface', 'inverseOnSurface'],
      ['inverseOnSurface', 'inverseSurface'],
      ['inversePrimary', 'inverseSurface'],
      ['scrim', null],
      ['shadow', null],
    ],
  },
  {
    title: 'Fixed (same in light and dark)',
    tiles: [
      ['primaryFixed', 'onPrimaryFixed'],
      ['primaryFixedDim', 'onPrimaryFixedVariant'],
      ['secondaryFixed', 'onSecondaryFixed'],
      ['secondaryFixedDim', 'onSecondaryFixedVariant'],
      ['tertiaryFixed', 'onTertiaryFixed'],
      ['tertiaryFixedDim', 'onTertiaryFixedVariant'],
    ],
  },
];

const readable = (bg: string) => (contrastRatio(bg, '#000000') >= contrastRatio(bg, '#FFFFFF') ? '#000000' : '#FFFFFF');

function Swatch({ bg, fg, label }: { bg: string; fg: string; label: string }) {
  return (
    <button
      type="button"
      class="mt-swatch"
      style={{ background: bg, color: fg }}
      aria-label={`Copy ${label} ${bg}`}
      onClick={() =>
        attempt(async () => {
          await copyText(bg);
          notify(`Copied ${bg}`);
        })
      }
    >
      <span>{label}</span>
      <code>{bg}</code>
    </button>
  );
}

/* ---------------------------------------------------------------- preview -- */

function Phone({ colors, label }: { colors: SchemeColors; label: string }) {
  const style: Record<string, string> = {};
  for (const role of ROLES) style[`--m-${role}`] = colors[role];
  return (
    <figure class="mt-phone-wrap">
      <div class="mt-phone" style={style} aria-hidden="true">
        <div class="mt-appbar">
          <span class="mt-appbar-title">Gallery notes</span>
          <span class="mt-avatar">A</span>
        </div>
        <div class="mt-search">Search notes</div>
        <div class="mt-chips">
          <span class="mt-chip is-on">All</span>
          <span class="mt-chip">Starred</span>
          <span class="mt-chip">Shared</span>
        </div>
        <div class="mt-card">
          <strong>Morning walk-through</strong>
          <span>Lights on by 9:30. Check the kiosk audio in hall 2.</span>
          <span class="mt-actions">
            <span class="mt-btn is-text">Later</span>
            <span class="mt-btn is-filled">Open</span>
          </span>
        </div>
        <div class="mt-card is-tonal">
          <strong>3 tasks due today</strong>
          <span class="mt-progress">
            <span />
          </span>
        </div>
        <div class="mt-row">
          <span class="mt-btn is-outlined">Outlined</span>
          <span class="mt-btn is-tonal">Tonal</span>
          <span class="mt-btn is-tertiary">Tertiary</span>
        </div>
        <div class="mt-list-item">
          <span>Notifications</span>
          <span class="mt-switch">
            <span />
          </span>
        </div>
        <div class="mt-error-row">
          <span class="mt-badge">2</span>
          <span>Two labels failed to print</span>
        </div>
        <span class="mt-fab">+</span>
        <div class="mt-nav">
          <span class="mt-nav-item is-on">
            <span class="mt-nav-pill" />
            Notes
          </span>
          <span class="mt-nav-item">
            <span class="mt-nav-pill" />
            Search
          </span>
          <span class="mt-nav-item">
            <span class="mt-nav-pill" />
            Settings
          </span>
        </div>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/* ---------------------------------------------------------------- outputs -- */

function outputsFor(theme: Theme, design: Design, overrides: Overrides): Output[] {
  return [
    { label: 'CSS', language: 'css', code: cssVariables(theme), filename: 'material-theme.css' },
    { label: 'colors.xml', language: 'xml', code: androidColorsXml(theme), filename: 'colors.xml' },
    { label: 'themes.xml', language: 'xml', code: androidThemesXml('light'), filename: 'themes.xml' },
    { label: 'night/themes.xml', language: 'xml', code: androidThemesXml('dark'), filename: 'themes-night.xml' },
    { label: 'Compose Color.kt', language: 'text', code: composeColorKt(theme, design.pkg), filename: 'Color.kt' },
    { label: 'Compose Theme.kt', language: 'text', code: composeThemeKt(theme, design.pkg), filename: 'Theme.kt' },
    { label: 'Flutter', language: 'text', code: flutterColorScheme(theme), filename: 'color_schemes.dart' },
    { label: 'JSON', language: 'json', code: themeJson(theme, design.variant, design.contrast, design.spec, overrides), filename: 'material-theme.json' },
  ];
}

function zipAll(theme: Theme, design: Design, overrides: Overrides): Uint8Array {
  const pkgPath = design.pkg.replace(/\./g, '/');
  return zipSync(
    {
      'android/app/src/main/res/values/colors.xml': strToU8(androidColorsXml(theme)),
      'android/app/src/main/res/values/themes.xml': strToU8(androidThemesXml('light')),
      'android/app/src/main/res/values-night/themes.xml': strToU8(androidThemesXml('dark')),
      [`compose/${pkgPath}/Color.kt`]: strToU8(composeColorKt(theme, design.pkg)),
      [`compose/${pkgPath}/Theme.kt`]: strToU8(composeThemeKt(theme, design.pkg)),
      'flutter/lib/theme/color_schemes.dart': strToU8(flutterColorScheme(theme)),
      'web/material-theme.css': strToU8(cssVariables(theme)),
      'material-theme.json': strToU8(themeJson(theme, design.variant, design.contrast, design.spec, overrides)),
    },
    { level: 6 },
  );
}

/* --------------------------------------------------------------------- UI -- */

const CONTRASTS: readonly SegmentChoice<string>[] = [
  { value: '-1', label: 'Reduced' },
  { value: '0', label: 'Standard' },
  { value: '0.5', label: 'Medium' },
  { value: '1', label: 'High' },
];
const SPECS: readonly SegmentChoice<Spec>[] = [
  { value: '2021', label: 'Material 3 (2021)' },
  { value: '2025', label: 'Expressive (2025)' },
];
const MODES: readonly SegmentChoice<'light' | 'dark'>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const OVERRIDE_LABELS: readonly { key: OverrideKey; label: string; fallback: string }[] = [
  { key: 'secondary', label: 'Secondary', fallback: '#6B5778' },
  { key: 'tertiary', label: 'Tertiary', fallback: '#B7861B' },
  { key: 'error', label: 'Error', fallback: '#B3261E' },
  { key: 'neutral', label: 'Neutral', fallback: '#5F6B75' },
];

function HexField({ value, onChange, label, testId }: { value: string; onChange: (hex: string) => void; label: string; testId?: string }) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const shown = focused ? draft : value;
  return (
    <span class="mt-hex">
      <input type="color" class="color-swatch" value={value.toLowerCase()} aria-label={`${label}: pick a colour`} onInput={(e) => onChange(normal(e.currentTarget.value))} />
      <input
        class={`input input-mono${parseHex(shown) === null ? ' is-invalid' : ''}`}
        type="text"
        value={shown}
        aria-label={label}
        spellcheck={false}
        autocomplete="off"
        maxLength={7}
        onFocus={() => {
          setDraft(value);
          setFocused(true);
        }}
        onBlur={() => setFocused(false)}
        onInput={(e) => {
          const text = e.currentTarget.value;
          setDraft(text);
          if (parseHex(text) !== null) onChange(normal(text));
        }}
        data-testid={testId}
      />
    </span>
  );
}

function MaterialTheme({ toolId }: { toolId: string }) {
  const [design, setDesign] = usePersistentState(toolId, readDesign, (d: Design): Values => ({ ...d }));
  const [candidates, setCandidates] = useState<string[]>([]);
  const set = (patch: Partial<Design>) => setDesign((d) => ({ ...d, ...patch }));

  const overrides = useMemo<Overrides>(() => {
    const out: Record<string, string> = {};
    for (const { key } of OVERRIDE_LABELS) if (design.overrides[key]) out[key] = design.overrides[key];
    return out;
  }, [design.overrides]);

  const theme = useMemo(
    () => buildTheme(design.seed, design.variant, design.contrast, design.spec, overrides, design.custom),
    [design.seed, design.variant, design.contrast, design.spec, overrides, design.custom],
  );
  const outputs = useMemo(() => outputsFor(theme, design, overrides), [theme, design.pkg, design.variant, design.contrast, design.spec, overrides]);
  const seedHct = Hct.fromInt(parseHex(design.seed) ?? 0);
  const colors = theme[design.mode];

  const fromPicture = () =>
    attempt(async () => {
      const file = await pickFile('image/*');
      if (!file) return;
      const list = await seedsFromPicture(file);
      setCandidates(list);
      if (list[0]) set({ seed: list[0] });
    });

  const setCustom = (index: number, patch: Partial<CustomColor>) => set({ custom: design.custom.map((c, i) => (i === index ? { ...c, ...patch } : c)) });

  return (
    <section class="tool mt-tool" data-testid="tool" data-state="done">
      <div class="mt-grid">
        <div class="mt-controls">
          <div class="control">
            <span class="control-label">Seed colour</span>
            <div class="icon-row">
              <HexField value={design.seed} onChange={(seed) => set({ seed })} label="Seed colour" testId="mt-seed" />
              <button type="button" class="button button-small" onClick={fromPicture} data-testid="mt-picture">
                <Icon name="image" size={14} /> From a picture
              </button>
            </div>
            <span class="control-help">
              Hue {Math.round(seedHct.hue)}°, chroma {Math.round(seedHct.chroma)}, tone {Math.round(seedHct.tone)}
            </span>
          </div>
          {candidates.length > 1 && (
            <div class="control">
              <span class="control-label">Colours in the picture</span>
              <div class="mt-candidates">
                {candidates.map((c) => (
                  <button
                    key={c}
                    type="button"
                    class={`mt-candidate${c === design.seed ? ' is-on' : ''}`}
                    style={{ background: c }}
                    aria-label={`Use ${c}`}
                    aria-pressed={c === design.seed}
                    onClick={() => set({ seed: c })}
                  />
                ))}
              </div>
            </div>
          )}
          <label class="control">
            <span class="control-label">Scheme style</span>
            <select class="input" value={design.variant} onChange={(e) => set({ variant: e.currentTarget.value as VariantId })} data-testid="mt-variant">
              {VARIANTS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <div class="control">
            <span class="control-label">Contrast</span>
            <Segmented label="Contrast" value={String(design.contrast)} choices={CONTRASTS} onChange={(v) => set({ contrast: Number(v) })} />
          </div>
          <div class="control">
            <span class="control-label">Colour rules</span>
            <Segmented label="Colour rules" value={design.spec} choices={SPECS} onChange={(spec) => set({ spec })} />
          </div>

          <details class="mt-more">
            <summary>Core colours</summary>
            <p class="control-help">Replace a colour that would otherwise come from the seed, as in Google’s Material Theme Builder.</p>
            {OVERRIDE_LABELS.map(({ key, label, fallback }) => (
              <div class="mt-override" key={key}>
                <label class="toggle">
                  <input type="checkbox" checked={!!design.overrides[key]} onChange={(e) => set({ overrides: { ...design.overrides, [key]: e.currentTarget.checked ? fallback : '' } })} />
                  <span class="toggle-track" aria-hidden="true" />
                  {label}
                </label>
                {design.overrides[key] && <HexField value={design.overrides[key]} onChange={(hex) => set({ overrides: { ...design.overrides, [key]: hex } })} label={`${label} colour`} />}
              </div>
            ))}
          </details>

          <details class="mt-more" open={design.custom.length > 0}>
            <summary>Custom colours ({design.custom.length})</summary>
            <p class="control-help">Brand or status colours, such as success or warning, each with its own colour, container and text roles for light and dark.</p>
            {design.custom.map((c, i) => (
              <div class="mt-custom" key={`custom-${i}`}>
                <input class="input" type="text" value={c.name} placeholder="Name" aria-label={`Name of custom colour ${i + 1}`} onInput={(e) => setCustom(i, { name: e.currentTarget.value })} />
                <HexField value={c.hex} onChange={(hex) => setCustom(i, { hex })} label={`Custom colour ${i + 1}`} />
                <label class="toggle" title="Shift the hue slightly towards the seed colour">
                  <input type="checkbox" checked={c.blend} onChange={(e) => setCustom(i, { blend: e.currentTarget.checked })} />
                  <span class="toggle-track" aria-hidden="true" />
                  Harmonise
                </label>
                <button type="button" class="icon-button" aria-label={`Remove custom colour ${i + 1}`} onClick={() => set({ custom: design.custom.filter((_, j) => j !== i) })}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
            {design.custom.length < 6 && (
              <button
                type="button"
                class="button button-small"
                onClick={() => set({ custom: [...design.custom, { name: design.custom.length ? `Custom ${design.custom.length + 1}` : 'Success', hex: '#2E7D32', blend: true }] })}
                data-testid="mt-add-custom"
              >
                <Icon name="plus" size={14} /> Add a custom colour
              </button>
            )}
          </details>

          <label class="control">
            <span class="control-label">Kotlin package</span>
            <input
              class="input input-mono"
              type="text"
              value={design.pkg}
              spellcheck={false}
              onInput={(e) => /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(e.currentTarget.value) && set({ pkg: e.currentTarget.value })}
            />
          </label>
        </div>

        <div class="mt-results">
          <div class="mt-phones" data-testid="mt-preview">
            <Phone colors={theme.light} label="Light" />
            <Phone colors={theme.dark} label="Dark" />
          </div>

          <div class="mt-swatch-head">
            <h3>Colour roles</h3>
            <Segmented label="Scheme shown" value={design.mode} choices={MODES} onChange={(mode) => set({ mode })} />
          </div>
          <div class="mt-swatches" data-testid="mt-swatches">
            {SWATCH_GROUPS.map((group) => (
              <div class="mt-swatch-group" key={group.title}>
                <h4>{group.title}</h4>
                <div class="mt-swatch-row">
                  {group.tiles.map(([bg, fg]) => (
                    <Swatch key={bg} bg={colors[bg]} fg={fg ? colors[fg] : readable(colors[bg])} label={words(bg)} />
                  ))}
                </div>
              </div>
            ))}
            {theme.custom.map((g) => (
              <div class="mt-swatch-group" key={g.key}>
                <h4>{g.name}</h4>
                <div class="mt-swatch-row">
                  <Swatch bg={g[design.mode].color} fg={g[design.mode].onColor} label={g.name} />
                  <Swatch bg={g[design.mode].onColor} fg={g[design.mode].color} label={`On ${g.name.toLowerCase()}`} />
                  <Swatch bg={g[design.mode].colorContainer} fg={g[design.mode].onColorContainer} label={`${g.name} container`} />
                  <Swatch bg={g[design.mode].onColorContainer} fg={g[design.mode].colorContainer} label={`On ${g.name.toLowerCase()} container`} />
                </div>
              </div>
            ))}
          </div>

          <h3>Tonal palettes</h3>
          <div class="mt-palettes">
            {(Object.keys(theme.palettes) as (keyof Theme['palettes'])[]).map((name) => (
              <div class="mt-palette" key={name}>
                <span class="mt-palette-name">{words(name)}</span>
                <div class="mt-tones">
                  {TONES.map((tone) => {
                    const bg = theme.palettes[name][tone] as string;
                    return (
                      <span key={tone} class="mt-tone" style={{ background: bg, color: readable(bg) }} title={`${words(name)} ${tone}: ${bg}`}>
                        {tone}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <CodeOutput outputs={outputs} baseName="material-theme" downloads={[{ label: 'All files (ZIP)', filename: 'material-theme.zip', make: () => zipAll(theme, design, overrides) }]} />
        </div>
      </div>
    </section>
  );
}

export default defineCustomTool(MaterialTheme);
