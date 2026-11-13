import { copyText } from '../platform';
import type { Field } from '../tools/types';
import { Icon } from './icons';
import { attempt, notify } from './toast';

/** Labelled results with one-click copy.  A field with an empty value acts as a group heading. */
export function FieldList({ fields }: { fields: readonly Field[] }) {
  if (fields.length === 0) return null;
  return (
    <dl class="fields" data-testid="fields">
      {fields.map((field, index) =>
        field.value === '' ? (
          <div key={index} class="field field-heading">
            <dt>{field.label}</dt>
          </div>
        ) : (
          <div key={index} class={`field${field.tone ? ` tone-${field.tone}` : ''}`}>
            <dt>{field.label}</dt>
            <dd>
              {field.swatch && <span class="swatch" style={{ background: field.swatch }} aria-hidden="true" />}
              <span class={`field-value${field.mono ? ' mono' : ''}`}>{field.value}</span>
              <button
                type="button"
                class="icon-button field-copy"
                aria-label={`Copy ${field.label}`}
                title="Copy"
                onClick={() =>
                  attempt(async () => {
                    await copyText(field.value);
                    notify('Copied');
                  })
                }
              >
                <Icon name="copy" size={14} />
              </button>
            </dd>
          </div>
        ),
      )}
    </dl>
  );
}
