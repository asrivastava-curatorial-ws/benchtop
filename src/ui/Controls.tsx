/**
 * Renders a list of option definitions as form controls.
 *
 * Two layouts are supported: `bar` (compact, inline, used above editors) and
 * `panel` (stacked with labels on top, used in side panels).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { alphaOf, hexOf, isColor, withAlpha } from '../lib/color';
import { choicesOf, newListItem } from '../tools/options';
import type { ColorOption, ListOption, NumberOption, OptionDef, SelectOption, TextOption, Values } from '../tools/types';
import { Icon } from './icons';

interface FormProps {
  readonly defs: readonly OptionDef[];
  readonly values: Values;
  readonly onChange: (patch: Values) => void;
  readonly layout: 'bar' | 'panel';
  readonly idPrefix: string;
}

export function ControlsForm({ defs, values, onChange, layout, idPrefix }: FormProps) {
  return (
    <div class={`controls controls-${layout}`}>
      {defs.map((def) => {
        if (def.showIf && !def.showIf(values)) return null;
        if (def.type === 'heading') {
          return (
            <h3 key={def.key} class="control-heading">
              {def.label}
            </h3>
          );
        }
        const id = `${idPrefix}-${def.key}`;
        const set = (value: unknown) => onChange({ [def.key]: value });
        const value = values[def.key];
        const wide = (def.type === 'text' && (def.wide || def.multiline)) || def.type === 'list';
        const inlineLabel = def.type === 'toggle';
        return (
          <div key={def.key} class={`control control-${def.type}${wide ? ' control-wide' : ''}`} data-option={def.key}>
            {!inlineLabel && (
              <label class="control-label" for={def.type === 'segmented' || def.type === 'list' ? undefined : id} id={`${id}-label`}>
                {def.label}
              </label>
            )}
            {def.type === 'select' && <SelectControl id={id} def={def} value={String(value)} onChange={set} />}
            {def.type === 'segmented' && <SegmentedControl id={id} def={def} value={String(value)} onChange={set} />}
            {def.type === 'toggle' && (
              <label class="toggle" for={id} title={def.help}>
                <input id={id} type="checkbox" role="switch" aria-checked={value === true} checked={value === true} onChange={(event) => set(event.currentTarget.checked)} />
                <span class="toggle-track" aria-hidden="true" />
                <span class="toggle-text">{def.label}</span>
              </label>
            )}
            {(def.type === 'number' || def.type === 'range') && <NumberControl id={id} def={def} value={Number(value)} onChange={set} />}
            {def.type === 'text' && <TextControl id={id} def={def} value={String(value ?? '')} onChange={set} />}
            {def.type === 'color' && <ColorControl id={id} def={def} value={String(value ?? '')} onChange={set} />}
            {def.type === 'list' && <ListControl id={id} def={def} value={Array.isArray(value) ? (value as Values[]) : []} onChange={set} />}
            {def.help && layout === 'panel' && <p class="control-help">{def.help}</p>}
          </div>
        );
      })}
    </div>
  );
}

function SelectControl({ id, def, value, onChange }: { id: string; def: SelectOption; value: string; onChange: (value: string) => void }) {
  return (
    <select id={id} class="input" value={value} title={def.help} onChange={(event) => onChange(event.currentTarget.value)}>
      {choicesOf(def).map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </select>
  );
}

function SegmentedControl({ id, def, value, onChange }: { id: string; def: SelectOption; value: string; onChange: (value: string) => void }) {
  return (
    <div class="segmented" role="radiogroup" aria-labelledby={`${id}-label`}>
      {choicesOf(def).map((choice) => (
        <button key={choice.value} type="button" role="radio" aria-checked={choice.value === value} class={choice.value === value ? 'is-active' : ''} onClick={() => onChange(choice.value)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/** Lets the user type freely ("-", "1.") and commits only valid numbers. */
function NumberField({ id, value, min, max, step, onChange, label }: { id: string; value: number; min?: number; max?: number; step?: number; onChange: (value: number) => void; label?: string }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  const commit = (raw: string) => {
    setText(raw);
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed)) return;
    const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed));
    if (clamped === parsed) onChange(parsed);
  };
  return (
    <input
      id={id}
      class="input input-number"
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step ?? 'any'}
      aria-label={label}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
        const parsed = Number(text);
        const valid = text.trim() !== '' && Number.isFinite(parsed);
        const clamped = valid ? Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, parsed)) : value;
        if (clamped !== value) onChange(clamped);
        setText(String(clamped));
      }}
      onInput={(event) => commit(event.currentTarget.value)}
    />
  );
}

function NumberControl({ id, def, value, onChange }: { id: string; def: NumberOption; value: number; onChange: (value: number) => void }) {
  if (def.type === 'range') {
    return (
      <div class="range">
        <input id={id} type="range" min={def.min} max={def.max} step={def.step ?? 1} value={value} title={def.help} onInput={(event) => onChange(Number(event.currentTarget.value))} />
        <NumberField id={`${id}-number`} value={value} min={def.min} max={def.max} step={def.step} onChange={onChange} label={`${def.label} value`} />
        {def.unit && <span class="unit">{def.unit}</span>}
      </div>
    );
  }
  return (
    <div class="number">
      <NumberField id={id} value={value} min={def.min} max={def.max} step={def.step} onChange={onChange} />
      {def.unit && <span class="unit">{def.unit}</span>}
    </div>
  );
}

function TextControl({ id, def, value, onChange }: { id: string; def: TextOption; value: string; onChange: (value: string) => void }) {
  const [revealed, setRevealed] = useState(false);
  const className = `input${def.mono ? ' input-mono' : ''}`;
  if (def.multiline) {
    return (
      <textarea
        id={id}
        class={className}
        rows={Math.min(8, Math.max(2, value.split('\n').length))}
        value={value}
        placeholder={def.placeholder}
        spellcheck={false}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
    );
  }
  if (def.secret) {
    return (
      <div class="secret">
        <input
          id={id}
          class={className}
          type={(revealed ? 'text' : 'password') as 'text'}
          value={value}
          placeholder={def.placeholder}
          autocomplete="off"
          spellcheck={false}
          onInput={(event) => onChange(event.currentTarget.value)}
        />
        <button type="button" class="icon-button" aria-label={revealed ? 'Hide' : 'Show'} aria-pressed={revealed} title={revealed ? 'Hide' : 'Show'} onClick={() => setRevealed(!revealed)}>
          <Icon name="eye" />
        </button>
      </div>
    );
  }
  return (
    <input
      id={id}
      class={className}
      type="text"
      value={value}
      placeholder={def.placeholder}
      title={def.help}
      autocomplete="off"
      spellcheck={false}
      onInput={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function ColorControl({ id, def, value, onChange }: { id: string; def: ColorOption; value: string; onChange: (value: string) => void }) {
  const valid = isColor(value);
  const alpha = valid ? alphaOf(value) : 1;
  return (
    <div class="color">
      <input
        type="color"
        class="color-swatch"
        aria-label={`${def.label}: pick a colour`}
        value={valid ? hexOf(value) : '#000000'}
        onInput={(event) => onChange(def.alpha && alpha < 1 ? withAlpha(event.currentTarget.value, alpha) : event.currentTarget.value)}
      />
      <input
        id={id}
        class={`input input-mono${valid ? '' : ' is-invalid'}`}
        type="text"
        value={value}
        spellcheck={false}
        autocomplete="off"
        aria-invalid={!valid}
        title="Any CSS colour: #hex, rgb(), hsl(), oklch(), or a name"
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {def.alpha && (
        <input
          type="range"
          class="color-alpha"
          min={0}
          max={100}
          step={1}
          value={Math.round(alpha * 100)}
          aria-label={`${def.label}: opacity`}
          title={`Opacity ${Math.round(alpha * 100)}%`}
          disabled={!valid}
          onInput={(event) => onChange(withAlpha(value, Number(event.currentTarget.value) / 100))}
        />
      )}
    </div>
  );
}

function ListControl({ id, def, value, onChange }: { id: string; def: ListOption; value: Values[]; onChange: (value: Values[]) => void }) {
  const min = def.min ?? 0;
  const max = def.max ?? 50;
  const name = def.itemLabel ?? 'Item';
  const move = (from: number, to: number) => {
    const next = [...value];
    const [item] = next.splice(from, 1);
    if (item) next.splice(to, 0, item);
    onChange(next);
  };
  return (
    <div class="list" aria-labelledby={`${id}-label`} role="group">
      {value.map((item, index) => (
        <fieldset key={index} class="list-item">
          <legend>
            {name} {index + 1}
          </legend>
          <div class="list-actions">
            <button type="button" class="icon-button" aria-label={`Move ${name} ${index + 1} up`} title="Move up" disabled={index === 0} onClick={() => move(index, index - 1)}>
              <Icon name="up" size={14} />
            </button>
            <button type="button" class="icon-button" aria-label={`Move ${name} ${index + 1} down`} title="Move down" disabled={index === value.length - 1} onClick={() => move(index, index + 1)}>
              <Icon name="down" size={14} />
            </button>
            <button
              type="button"
              class="icon-button"
              aria-label={`Remove ${name} ${index + 1}`}
              title="Remove"
              disabled={value.length <= min}
              onClick={() => onChange(value.filter((_item, position) => position !== index))}
            >
              <Icon name="close" size={14} />
            </button>
          </div>
          <ControlsForm
            defs={def.item}
            values={item}
            layout="panel"
            idPrefix={`${id}-${index}`}
            onChange={(patch) => onChange(value.map((existing, position) => (position === index ? { ...existing, ...patch } : existing)))}
          />
        </fieldset>
      ))}
      <button type="button" class="button button-small" disabled={value.length >= max} onClick={() => onChange([...value, newListItem(def.item)])}>
        <Icon name="plus" size={14} /> Add {name.toLowerCase()}
      </button>
    </div>
  );
}
