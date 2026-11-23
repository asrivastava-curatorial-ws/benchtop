/**
 * Material 3 colour schemes from one seed colour, with Google's Material
 * Color Utilities, and their export as Android XML, Jetpack Compose, Flutter,
 * CSS and JSON.
 */
import {
  customColor,
  DynamicScheme,
  Hct,
  hexFromArgb,
  MaterialDynamicColors,
  SchemeContent,
  SchemeExpressive,
  SchemeFidelity,
  SchemeFruitSalad,
  SchemeMonochrome,
  SchemeNeutral,
  SchemeRainbow,
  SchemeTonalSpot,
  SchemeVibrant,
  TonalPalette,
} from '@material/material-color-utilities';

export const VARIANTS = [
  { id: 'tonalSpot', label: 'Tonal spot (Android default)' },
  { id: 'vibrant', label: 'Vibrant' },
  { id: 'expressive', label: 'Expressive' },
  { id: 'fidelity', label: 'Fidelity (keeps the seed colour)' },
  { id: 'content', label: 'Content (for pictures)' },
  { id: 'neutral', label: 'Neutral' },
  { id: 'monochrome', label: 'Monochrome' },
  { id: 'rainbow', label: 'Rainbow' },
  { id: 'fruitSalad', label: 'Fruit salad' },
] as const;

export type VariantId = (typeof VARIANTS)[number]['id'];
export type Spec = '2021' | '2025';

/** Colour roles in the order Material's theme builder lists them. */
export const ROLES = [
  'primary',
  'onPrimary',
  'primaryContainer',
  'onPrimaryContainer',
  'secondary',
  'onSecondary',
  'secondaryContainer',
  'onSecondaryContainer',
  'tertiary',
  'onTertiary',
  'tertiaryContainer',
  'onTertiaryContainer',
  'error',
  'onError',
  'errorContainer',
  'onErrorContainer',
  'background',
  'onBackground',
  'surface',
  'onSurface',
  'surfaceVariant',
  'onSurfaceVariant',
  'outline',
  'outlineVariant',
  'shadow',
  'scrim',
  'inverseSurface',
  'inverseOnSurface',
  'inversePrimary',
  'surfaceTint',
  'surfaceDim',
  'surfaceBright',
  'surfaceContainerLowest',
  'surfaceContainerLow',
  'surfaceContainer',
  'surfaceContainerHigh',
  'surfaceContainerHighest',
  'primaryFixed',
  'primaryFixedDim',
  'onPrimaryFixed',
  'onPrimaryFixedVariant',
  'secondaryFixed',
  'secondaryFixedDim',
  'onSecondaryFixed',
  'onSecondaryFixedVariant',
  'tertiaryFixed',
  'tertiaryFixedDim',
  'onTertiaryFixed',
  'onTertiaryFixedVariant',
] as const;

export type Role = (typeof ROLES)[number];
export type SchemeColors = Readonly<Record<Role, string>>;

/** Core colours that replace the ones worked out from the seed. */
export interface Overrides {
  readonly secondary?: string;
  readonly tertiary?: string;
  readonly error?: string;
  readonly neutral?: string;
}

/** A brand or status colour (success, warning...) that gets its own four roles. */
export interface CustomColor {
  readonly name: string;
  readonly hex: string;
  /** Shift the hue a little towards the seed so it sits well with the theme. */
  readonly blend: boolean;
}

export interface CustomRoles {
  readonly color: string;
  readonly onColor: string;
  readonly colorContainer: string;
  readonly onColorContainer: string;
}

export interface CustomGroup {
  readonly name: string;
  /** Lower camel case, for code: "Brand blue" → brandBlue. */
  readonly key: string;
  readonly light: CustomRoles;
  readonly dark: CustomRoles;
}

export interface Theme {
  readonly seed: string;
  readonly light: SchemeColors;
  readonly dark: SchemeColors;
  readonly custom: readonly CustomGroup[];
  /** Tones 0 to 100 of the six key palettes. */
  readonly palettes: Readonly<Record<'primary' | 'secondary' | 'tertiary' | 'neutral' | 'neutralVariant' | 'error', Readonly<Record<number, string>>>>;
}

export const TONES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 95, 98, 99, 100] as const;

function scheme(variant: VariantId, source: Hct, dark: boolean, contrast: number, spec: Spec): DynamicScheme {
  switch (variant) {
    case 'vibrant':
      return new SchemeVibrant(source, dark, contrast, spec);
    case 'expressive':
      return new SchemeExpressive(source, dark, contrast, spec);
    case 'fidelity':
      return new SchemeFidelity(source, dark, contrast, spec);
    case 'content':
      return new SchemeContent(source, dark, contrast, spec);
    case 'neutral':
      return new SchemeNeutral(source, dark, contrast, spec);
    case 'monochrome':
      return new SchemeMonochrome(source, dark, contrast, spec);
    case 'rainbow':
      return new SchemeRainbow(source, dark, contrast, spec);
    case 'fruitSalad':
      return new SchemeFruitSalad(source, dark, contrast, spec);
    default:
      return new SchemeTonalSpot(source, dark, contrast, spec);
  }
}

const hex = (argb: number) => hexFromArgb(argb).toUpperCase();

function colorsOf(s: DynamicScheme): SchemeColors {
  const out = {} as Record<Role, string>;
  const table = MaterialDynamicColors as unknown as Record<string, { getArgb: (s: DynamicScheme) => number }>;
  for (const role of ROLES) {
    const color = table[role];
    out[role] = color ? hex(color.getArgb(s)) : '#000000';
  }
  return out;
}

const tones = (palette: TonalPalette) => Object.fromEntries(TONES.map((t) => [t, hex(palette.tone(t))]));

export function parseHex(text: string): number | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(text.trim());
  if (!m) return null;
  const hex = (m[1] as string).length === 3 ? [...(m[1] as string)].map((c) => c + c).join('') : (m[1] as string);
  return (0xff000000 | Number.parseInt(hex, 16)) >>> 0;
}

function withOverrides(base: DynamicScheme, overrides: Overrides): DynamicScheme {
  const palette = (value: string | undefined, fallback: TonalPalette) => {
    const argb = value ? parseHex(value) : null;
    return argb === null ? fallback : TonalPalette.fromInt(argb);
  };
  if (!overrides.secondary && !overrides.tertiary && !overrides.error && !overrides.neutral) return base;
  const neutral = overrides.neutral ? parseHex(overrides.neutral) : null;
  return new DynamicScheme({
    sourceColorHct: base.sourceColorHct,
    variant: base.variant,
    contrastLevel: base.contrastLevel,
    isDark: base.isDark,
    platform: base.platform,
    specVersion: base.specVersion,
    primaryPalette: base.primaryPalette,
    secondaryPalette: palette(overrides.secondary, base.secondaryPalette),
    tertiaryPalette: palette(overrides.tertiary, base.tertiaryPalette),
    errorPalette: palette(overrides.error, base.errorPalette),
    // A neutral override keeps the hue but stays as muted as the variant wants.
    neutralPalette: neutral === null ? base.neutralPalette : TonalPalette.fromHueAndChroma(Hct.fromInt(neutral).hue, base.neutralPalette.chroma),
    neutralVariantPalette: neutral === null ? base.neutralVariantPalette : TonalPalette.fromHueAndChroma(Hct.fromInt(neutral).hue, base.neutralVariantPalette.chroma),
  });
}

/** "Brand blue" → brandBlue; falls back to custom1, custom2... */
export function customKey(name: string, index: number): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return `custom${index + 1}`;
  const key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]?.toUpperCase() + w.slice(1).toLowerCase())).join('');
  return /^[0-9]/.test(key) ? `c${key}` : key;
}

export function buildTheme(seedHex: string, variant: VariantId, contrast: number, spec: Spec, overrides: Overrides = {}, customColors: readonly CustomColor[] = []): Theme {
  const argb = parseHex(seedHex);
  if (argb === null) throw new RangeError('The seed must be a colour such as #4285F4.');
  const source = Hct.fromInt(argb);
  const light = withOverrides(scheme(variant, source, false, contrast, spec), overrides);
  const dark = withOverrides(scheme(variant, source, true, contrast, spec), overrides);
  const seen = new Set<string>();
  const custom: CustomGroup[] = [];
  customColors.forEach((c, index) => {
    const value = parseHex(c.hex);
    if (value === null) return;
    let key = customKey(c.name, index);
    while (seen.has(key)) key = `${key}${index + 1}`;
    seen.add(key);
    const group = customColor(argb, { value, name: key, blend: c.blend });
    const roles = (g: { color: number; onColor: number; colorContainer: number; onColorContainer: number }): CustomRoles => ({
      color: hex(g.color),
      onColor: hex(g.onColor),
      colorContainer: hex(g.colorContainer),
      onColorContainer: hex(g.onColorContainer),
    });
    custom.push({ name: c.name.trim() || key, key, light: roles(group.light), dark: roles(group.dark) });
  });
  return {
    seed: hex(argb),
    light: colorsOf(light),
    dark: colorsOf(dark),
    custom,
    palettes: {
      primary: tones(light.primaryPalette),
      secondary: tones(light.secondaryPalette),
      tertiary: tones(light.tertiaryPalette),
      neutral: tones(light.neutralPalette),
      neutralVariant: tones(light.neutralVariantPalette),
      error: tones(light.errorPalette),
    },
  };
}

/* ---------------------------------------------------------------- exports -- */

const kebab = (role: string) => role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const snake = (role: string) => role.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const cap = (role: string) => role[0]?.toUpperCase() + role.slice(1);

/** Material Components for Android theme attributes, by role. */
const ANDROID_ATTRS: Partial<Record<Role, string>> = {
  primary: 'colorPrimary',
  onPrimary: 'colorOnPrimary',
  primaryContainer: 'colorPrimaryContainer',
  onPrimaryContainer: 'colorOnPrimaryContainer',
  secondary: 'colorSecondary',
  onSecondary: 'colorOnSecondary',
  secondaryContainer: 'colorSecondaryContainer',
  onSecondaryContainer: 'colorOnSecondaryContainer',
  tertiary: 'colorTertiary',
  onTertiary: 'colorOnTertiary',
  tertiaryContainer: 'colorTertiaryContainer',
  onTertiaryContainer: 'colorOnTertiaryContainer',
  error: 'colorError',
  onError: 'colorOnError',
  errorContainer: 'colorErrorContainer',
  onErrorContainer: 'colorOnErrorContainer',
  background: 'android:colorBackground',
  onBackground: 'colorOnBackground',
  surface: 'colorSurface',
  onSurface: 'colorOnSurface',
  surfaceVariant: 'colorSurfaceVariant',
  onSurfaceVariant: 'colorOnSurfaceVariant',
  outline: 'colorOutline',
  outlineVariant: 'colorOutlineVariant',
  inverseSurface: 'colorSurfaceInverse',
  inverseOnSurface: 'colorOnSurfaceInverse',
  inversePrimary: 'colorPrimaryInverse',
  surfaceDim: 'colorSurfaceDim',
  surfaceBright: 'colorSurfaceBright',
  surfaceContainerLowest: 'colorSurfaceContainerLowest',
  surfaceContainerLow: 'colorSurfaceContainerLow',
  surfaceContainer: 'colorSurfaceContainer',
  surfaceContainerHigh: 'colorSurfaceContainerHigh',
  surfaceContainerHighest: 'colorSurfaceContainerHighest',
  primaryFixed: 'colorPrimaryFixed',
  primaryFixedDim: 'colorPrimaryFixedDim',
  onPrimaryFixed: 'colorOnPrimaryFixed',
  onPrimaryFixedVariant: 'colorOnPrimaryFixedVariant',
  secondaryFixed: 'colorSecondaryFixed',
  secondaryFixedDim: 'colorSecondaryFixedDim',
  onSecondaryFixed: 'colorOnSecondaryFixed',
  onSecondaryFixedVariant: 'colorOnSecondaryFixedVariant',
  tertiaryFixed: 'colorTertiaryFixed',
  tertiaryFixedDim: 'colorTertiaryFixedDim',
  onTertiaryFixed: 'colorOnTertiaryFixed',
  onTertiaryFixedVariant: 'colorOnTertiaryFixedVariant',
};

const CUSTOM_ROLES = ['color', 'onColor', 'colorContainer', 'onColorContainer'] as const;
/** color → brandBlue, onColor → onBrandBlue, colorContainer → brandBlueContainer. */
const customRoleName = (key: string, role: (typeof CUSTOM_ROLES)[number]) =>
  role === 'color' ? key : role === 'onColor' ? `on${cap(key)}` : role === 'colorContainer' ? `${key}Container` : `on${cap(key)}Container`;

export function androidColorsXml(theme: Theme): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', '<!-- res/values/colors.xml -->', '<resources>', `    <color name="seed">${theme.seed}</color>`];
  for (const mode of ['light', 'dark'] as const) for (const role of ROLES) lines.push(`    <color name="md_theme_${mode}_${snake(role)}">${theme[mode][role]}</color>`);
  for (const group of theme.custom)
    for (const mode of ['light', 'dark'] as const)
      for (const role of CUSTOM_ROLES) lines.push(`    <color name="md_custom_${mode}_${snake(customRoleName(group.key, role))}">${group[mode][role]}</color>`);
  lines.push('</resources>', '');
  return lines.join('\n');
}

export function androidThemesXml(mode: 'light' | 'dark', name = 'AppTheme'): string {
  const parent = mode === 'light' ? 'Theme.Material3.Light.NoActionBar' : 'Theme.Material3.Dark.NoActionBar';
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    mode === 'light' ? '<!-- res/values/themes.xml -->' : '<!-- res/values-night/themes.xml -->',
    '<resources>',
    `    <style name="${name}" parent="${parent}">`,
  ];
  for (const role of ROLES) {
    const attr = ANDROID_ATTRS[role];
    if (attr) lines.push(`        <item name="${attr}">@color/md_theme_${mode}_${snake(role)}</item>`);
  }
  lines.push('    </style>', '</resources>', '');
  return lines.join('\n');
}

/** Compose's Color(0xAARRGGBB). */
const composeColor = (h: string) => `Color(0xFF${h.slice(1)})`;
/** Roles Compose's ColorScheme takes (Material 3 1.3+). */
const COMPOSE_ROLES = ROLES.filter(
  (r) =>
    ![
      'shadow',
      'primaryFixed',
      'primaryFixedDim',
      'onPrimaryFixed',
      'onPrimaryFixedVariant',
      'secondaryFixed',
      'secondaryFixedDim',
      'onSecondaryFixed',
      'onSecondaryFixedVariant',
      'tertiaryFixed',
      'tertiaryFixedDim',
      'onTertiaryFixed',
      'onTertiaryFixedVariant',
    ].includes(r),
);

export function composeColorKt(theme: Theme, packageName = 'com.example.app.ui.theme'): string {
  const lines = [`package ${packageName}`, '', 'import androidx.compose.ui.graphics.Color', ''];
  for (const mode of ['light', 'dark'] as const) {
    for (const role of ROLES) lines.push(`val ${role}${cap(mode)} = ${composeColor(theme[mode][role])}`);
    lines.push('');
  }
  for (const group of theme.custom) {
    for (const mode of ['light', 'dark'] as const) for (const role of CUSTOM_ROLES) lines.push(`val ${customRoleName(group.key, role)}${cap(mode)} = ${composeColor(group[mode][role])}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function composeThemeKt(theme: Theme, packageName = 'com.example.app.ui.theme'): string {
  const scheme = (mode: 'Light' | 'Dark') => COMPOSE_ROLES.map((r) => `    ${r} = ${r}${mode},`).join('\n');
  return `package ${packageName}

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColors = lightColorScheme(
${scheme('Light')}
)

private val DarkColors = darkColorScheme(
${scheme('Dark')}
)

@Composable
fun AppTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Material You colours from the wallpaper on Android 12 and later.
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }
    MaterialTheme(colorScheme = colorScheme, content = content)
}
${composeExtended(theme)}`;
}

function composeExtended(theme: Theme): string {
  if (!theme.custom.length) return '';
  const family = (mode: 'Light' | 'Dark') => theme.custom.map((g) => `    ${g.key} = ColorFamily(${CUSTOM_ROLES.map((r) => `${customRoleName(g.key, r)}${mode}`).join(', ')}),`).join('\n');
  return `
@Immutable
data class ColorFamily(val color: Color, val onColor: Color, val colorContainer: Color, val onColorContainer: Color)

@Immutable
data class ExtendedColorScheme(
${theme.custom.map((g) => `    val ${g.key}: ColorFamily,`).join('\n')}
)

val extendedLight = ExtendedColorScheme(
${family('Light')}
)

val extendedDark = ExtendedColorScheme(
${family('Dark')}
)
`;
}

/** Flutter's ColorScheme parameters (Flutter 3.22 and later). */
const FLUTTER_NAMES: Partial<Record<Role, string>> = {
  inverseOnSurface: 'onInverseSurface',
};
const FLUTTER_SKIP = new Set<Role>(['background', 'onBackground', 'surfaceVariant']);

export function flutterColorScheme(theme: Theme): string {
  const block = (mode: 'light' | 'dark') =>
    ROLES.filter((r) => !FLUTTER_SKIP.has(r))
      .map((r) => `  ${FLUTTER_NAMES[r] ?? r}: Color(0xFF${theme[mode][r].slice(1)}),`)
      .join('\n');
  return `import 'package:flutter/material.dart';

const lightColorScheme = ColorScheme(
  brightness: Brightness.light,
${block('light')}
);

const darkColorScheme = ColorScheme(
  brightness: Brightness.dark,
${block('dark')}
);
${flutterCustom(theme)}
// MaterialApp(theme: ThemeData(colorScheme: lightColorScheme), darkTheme: ThemeData(colorScheme: darkColorScheme))
`;
}

function flutterCustom(theme: Theme): string {
  if (!theme.custom.length) return '';
  const fields = theme.custom.flatMap((g) => CUSTOM_ROLES.map((r) => customRoleName(g.key, r)));
  const values = (mode: 'light' | 'dark') => theme.custom.flatMap((g) => CUSTOM_ROLES.map((r) => `  ${customRoleName(g.key, r)}: Color(0xFF${g[mode][r].slice(1)}),`)).join('\n');
  return `
/// Custom colours. Add with ThemeData(extensions: [lightCustomColors]).
@immutable
class CustomColors extends ThemeExtension<CustomColors> {
  const CustomColors({
${fields.map((f) => `    required this.${f},`).join('\n')}
  });

${fields.map((f) => `  final Color ${f};`).join('\n')}

  @override
  CustomColors copyWith({${fields.map((f) => `Color? ${f}`).join(', ')}}) => CustomColors(
${fields.map((f) => `        ${f}: ${f} ?? this.${f},`).join('\n')}
      );

  @override
  CustomColors lerp(CustomColors? other, double t) {
    if (other is! CustomColors) return this;
    return CustomColors(
${fields.map((f) => `      ${f}: Color.lerp(${f}, other.${f}, t)!,`).join('\n')}
    );
  }
}

const lightCustomColors = CustomColors(
${values('light')}
);

const darkCustomColors = CustomColors(
${values('dark')}
);
`;
}

export function cssVariables(theme: Theme): string {
  const block = (mode: 'light' | 'dark', indent: string) =>
    [
      ...ROLES.map((r) => `${indent}--md-sys-color-${kebab(r)}: ${theme[mode][r]};`),
      ...theme.custom.flatMap((g) => CUSTOM_ROLES.map((r) => `${indent}--md-custom-color-${kebab(customRoleName(g.key, r))}: ${g[mode][r]};`)),
    ].join('\n');
  return `/* Material 3 colour roles. Seed ${theme.seed}. */
:root {
  color-scheme: light dark;
${block('light', '  ')}
}

@media (prefers-color-scheme: dark) {
  :root:not(.light) {
${block('dark', '    ')}
  }
}

:root.dark {
${block('dark', '  ')}
}
`;
}

export function themeJson(theme: Theme, variant: VariantId, contrast: number, spec: Spec, overrides: Overrides = {}): string {
  const extended = theme.custom.map((g) => ({ name: g.name, key: g.key, light: g.light, dark: g.dark }));
  return `${JSON.stringify({ seed: theme.seed, variant, contrastLevel: contrast, specVersion: spec, coreColors: { primary: theme.seed, ...overrides }, schemes: { light: theme.light, dark: theme.dark }, extendedColors: extended, palettes: theme.palettes }, null, 2)}\n`;
}

/** Relative luminance contrast of two #RRGGBB colours (WCAG 2). */
export function contrastRatio(a: string, b: string): number {
  const lum = (h: string) => {
    const n = Number.parseInt(h.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (ch[0] as number) + 0.7152 * (ch[1] as number) + 0.0722 * (ch[2] as number);
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
