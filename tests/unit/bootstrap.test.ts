import { describe, expect, it } from 'vitest';
import { themeCatalogue } from '../../src/lib/bootstrap-catalogue';
import { compileTheme, ThemeCompileError } from '../../src/lib/bootstrap-compile';
import {
  buildEntry,
  cleanValue,
  entryFile,
  kindOf,
  orderedOverrides,
  parseOverrides,
  parseTheme,
  parseVariables,
  serializeTheme,
  THEME_PRESETS,
  validateOverride,
  variablesFile,
} from '../../src/lib/bootstrap-theme';

const theme = (overrides: Record<string, string> = {}, extraScss = '') => ({ name: 'Test', overrides, extraScss });

describe('Bootstrap variable catalogue', () => {
  const catalogue = themeCatalogue();
  const byName = new Map(catalogue.map((variable) => [variable.name, variable]));

  it('lists every !default variable of Bootstrap 5.3', () => {
    expect(catalogue.length).toBeGreaterThan(1000);
    expect(new Set(catalogue.map((variable) => variable.name)).size).toBe(catalogue.length);
  });

  it('reads values, including multi-line maps and font stacks', () => {
    expect(byName.get('primary')).toMatchObject({ value: '$blue', kind: 'color', group: 'Color system' });
    expect(byName.get('enable-rounded')).toMatchObject({ value: 'true', kind: 'boolean', group: 'Options' });
    expect(byName.get('spacer')).toMatchObject({ value: '1rem', kind: 'length', group: 'Spacing' });
    expect(byName.get('spacers')?.kind).toBe('map');
    expect(byName.get('spacers')?.value).toMatch(/^\([\s\S]*5: \$spacer \* 3,?[\s\S]*\)$/);
    expect(byName.get('font-family-sans-serif')?.kind).toBe('font');
    expect(byName.get('font-family-sans-serif')?.value).toContain('system-ui');
    expect(byName.get('btn-padding-y')?.group).toBe('Buttons');
    expect(byName.get('body-bg-dark')).toMatchObject({ dark: true });
    expect(byName.get('body-bg-dark')?.group).toMatch(/^Dark mode/);
  });

  it('classifies values', () => {
    expect(kindOf('foo', '#fff')).toBe('color');
    expect(kindOf('table-bg', 'transparent')).toBe('color');
    expect(kindOf('box-shadow', '0 .5rem 1rem rgba($black, .15)')).toBe('other');
    expect(kindOf('line-height-base', '1.5')).toBe('number');
    expect(kindOf('enable-shadows', 'false')).toBe('boolean');
  });

  it('parses an isolated snippet with headings', () => {
    const vars = parseVariables('// Buttons\n//\n$a: 1px !default; // note\n$b:\n  (x: 1, y: 2) !default;\n$c: 3;\n');
    expect(vars).toEqual([
      { name: 'a', value: '1px', group: 'Buttons', kind: 'length', dark: false },
      { name: 'b', value: '(x: 1, y: 2)', group: 'Buttons', kind: 'map', dark: false },
    ]);
  });
});

describe('Bootstrap overrides and files', () => {
  const catalogue = themeCatalogue();

  it('validates and cleans values', () => {
    expect(cleanValue('  #fff !default; ')).toBe('#fff');
    expect(validateOverride('primary', '#123456')).toBeNull();
    expect(validateOverride('primary', '')).toMatch(/Enter a value/);
    expect(validateOverride('primary', 'red; } body { color: red')).toMatch(/cannot contain/);
    expect(validateOverride('primary', 'rgba(0, 0, 0')).toMatch(/unclosed/);
    expect(validateOverride('font-family-base', '"a;b", sans-serif')).toBeNull();
    expect(validateOverride('9bad', '1')).toMatch(/not a valid/);
  });

  it('orders overrides like Bootstrap so references resolve', () => {
    const ordered = orderedOverrides({ 'btn-padding-y': '1rem', primary: 'red', zzz: '1' }, catalogue);
    expect(ordered.map(([name]) => name)).toEqual(['zzz', 'primary', 'btn-padding-y']);
    const { scss, lineToVariable } = buildEntry(theme({ primary: 'red' }, '.x { color: $primary; }'), catalogue);
    expect(scss).toBe('$primary: red;\n@import "bootstrap";\n\n.x { color: $primary; }\n');
    expect(lineToVariable.get(1)).toBe('primary');
  });

  it('writes variables and entry files', () => {
    const t = theme({ primary: '#6f42c1', 'enable-rounded': 'false' });
    expect(variablesFile(t, catalogue)).toContain('$primary: #6f42c1;\n$enable-rounded: false;\n');
    expect(entryFile(t, catalogue)).toContain('@import "bootstrap/scss/bootstrap";');
    expect(variablesFile(theme(), catalogue)).toContain('No variables changed');
  });

  it('reads overrides back from exported Sass', () => {
    const t = theme({ primary: '#6f42c1', 'font-family-sans-serif': '"Inter", sans-serif' });
    const { overrides, skipped } = parseOverrides(variablesFile(t, catalogue));
    expect(overrides).toEqual(t.overrides);
    expect(skipped).toBe(0);
    expect(parseOverrides('$a: 1 !default;\n/* $b: 2; */\n$c : (x: 1,\n  y: 2);\n').overrides).toEqual({ a: '1', c: '(x: 1,   y: 2)' });
  });

  it('round-trips theme files and rejects foreign JSON', () => {
    const t = theme({ primary: 'red' }, '.a{}');
    expect(parseTheme(serializeTheme(t, catalogue))).toEqual(t);
    expect(() => parseTheme('{"a":1}')).toThrow(/not a Benchtop/);
    expect(() => parseTheme('nope')).toThrow(/not valid JSON/);
    expect(parseTheme(JSON.stringify({ format: 'benchtop-bootstrap-theme', overrides: { ok: '1', bad: 'x;y', n: 5 } })).overrides).toEqual({ ok: '1' });
  });
});

describe('Bootstrap compilation', () => {
  it('compiles stock Bootstrap', () => {
    const result = compileTheme(theme());
    expect(result.css).toContain('--bs-primary: #0d6efd;');
    expect(result.css).toContain('.btn-primary {');
    expect(result.css.length).toBeGreaterThan(200_000);
    expect(result.warnings).toEqual([]);
  });

  it('applies overrides everywhere Bootstrap derives from them', () => {
    const result = compileTheme(theme({ primary: '#6f42c1', 'enable-rounded': 'false', 'font-size-base': '.875rem' }));
    expect(result.css).toContain('--bs-primary: #6f42c1;');
    expect(result.css).toContain('--bs-primary-rgb: 111, 66, 193;');
    expect(result.css).toMatch(/\.btn-primary \{[^}]*--bs-btn-bg: #6f42c1;/);
    expect(result.css).toContain('--bs-body-font-size: 0.875rem;');
    expect(result.css).not.toMatch(/--bs-btn-border-radius: 0\.375rem/);
  });

  it('compiles the presets', () => {
    for (const preset of THEME_PRESETS) {
      expect(() => compileTheme(theme(preset.overrides as Record<string, string>)), preset.name).not.toThrow();
    }
  });

  it('runs extra Sass with Bootstrap mixins available', () => {
    const result = compileTheme(theme({}, '.brand { @include button-variant(#123456, #123456); }'), 'compressed');
    expect(result.css).toMatch(/\.brand\{[^}]*--bs-btn-bg: ?#123456/);
  });

  it('points errors at the variable that caused them', () => {
    let error: unknown;
    try {
      compileTheme(theme({ spacer: '1rem', primary: 'notacolour(' }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ThemeCompileError);
    const failure = error as ThemeCompileError;
    expect(failure.variable ?? failure.message).toMatch(/primary/);
  });

  it('reports type errors raised inside Bootstrap', () => {
    expect(() => compileTheme(theme({ primary: '12px' }))).toThrow(ThemeCompileError);
  });

  it('reports errors in the extra Sass with its own line number', () => {
    expect(() => compileTheme(theme({ primary: 'red' }, '.a {\n  color: $nope;\n}'))).toThrow(/Extra Sass, line 2/);
  });
});
