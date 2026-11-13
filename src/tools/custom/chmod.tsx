/** Unix permission calculator: checkboxes, octal and symbolic forms, with ready commands. */
import { useState } from 'preact/hooks';
import { chmodSymbolic, octal, type Permissions, parsePermissions, symbolic, toMode } from '../../lib/devops';
import { errorMessage } from '../../lib/errors';
import { CodeOutput } from '../../ui/CodeOutput';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

const WHO = ['Owner', 'Group', 'Others'] as const;
const WHAT = ['Read', 'Write', 'Execute'] as const;

function read(stored: Values | undefined): Permissions {
  try {
    return parsePermissions(typeof stored?.mode === 'string' ? stored.mode : '755');
  } catch {
    return parsePermissions('755');
  }
}

function Chmod({ toolId }: { toolId: string }) {
  const [perms, setPerms] = usePersistentState<Permissions>(toolId, read, (p) => ({ mode: octal(toMode(p)) }));
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [file, setFile] = useState('script.sh');
  const mode = toMode(perms);
  const shown = text ?? octal(mode);

  const toggle = (who: number, what: number) =>
    setPerms((previous) => {
      const bits = previous.bits.map((triple, w) => triple.map((on, b) => (w === who && b === what ? !on : on))) as unknown as Permissions['bits'];
      return { ...previous, bits };
    });

  const typed = (value: string) => {
    setText(value);
    try {
      setPerms(parsePermissions(value));
      setProblem(null);
    } catch (error) {
      setProblem(errorMessage(error));
    }
  };

  const umask = (~mode & 0o777).toString(8).padStart(4, '0');
  const target = file.trim() || 'file';
  return (
    <section class="tool tool-chmod" data-testid="tool" data-state={problem ? 'error' : 'done'}>
      <div class="chmod-layout">
        <div class="pane chmod-pane">
          <div class="pane-header">
            <span class="pane-title">Permissions</span>
          </div>
          <div class="chmod-body">
            <table class="chmod-grid">
              <thead>
                <tr>
                  <th />
                  {WHAT.map((what) => (
                    <th key={what} scope="col">
                      {what}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {WHO.map((who, w) => (
                  <tr key={who}>
                    <th scope="row">{who}</th>
                    {WHAT.map((what, b) => (
                      <td key={what}>
                        <input
                          type="checkbox"
                          aria-label={`${who} ${what.toLowerCase()}`}
                          checked={perms.bits[w]?.[b] === true}
                          onChange={() => {
                            setText(null);
                            setProblem(null);
                            toggle(w, b);
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div class="chmod-special">
              {(
                [
                  ['setuid', 'Set user ID (run as owner)'],
                  ['setgid', 'Set group ID (new files take the folder’s group)'],
                  ['sticky', 'Sticky (only owners may delete, as in /tmp)'],
                ] as const
              ).map(([flag, label]) => (
                <label key={flag} class="toggle" for={`chmod-${flag}`}>
                  <input
                    id={`chmod-${flag}`}
                    type="checkbox"
                    role="switch"
                    aria-checked={perms[flag]}
                    checked={perms[flag]}
                    onChange={(event) => {
                      setText(null);
                      setPerms((previous) => ({ ...previous, [flag]: event.currentTarget.checked }));
                    }}
                  />
                  <span class="toggle-track" aria-hidden="true" />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div class="chmod-summary">
          <label class="control">
            <span class="control-label">Mode (octal or rwx)</span>
            <input class={`input input-mono chmod-input${problem ? ' is-invalid' : ''}`} value={shown} onInput={(event) => typed(event.currentTarget.value)} data-testid="chmod-input" />
          </label>
          {problem && <p class="control-help tone-bad">{problem}</p>}
          <dl class="fields">
            <div class="field">
              <dt>Octal</dt>
              <dd class="mono" data-testid="chmod-octal">
                {octal(mode)}
              </dd>
            </div>
            <div class="field">
              <dt>ls -l shows</dt>
              <dd class="mono">-{symbolic(perms)}</dd>
            </div>
            <div class="field">
              <dt>Symbolic</dt>
              <dd class="mono">{chmodSymbolic(perms)}</dd>
            </div>
            <div class="field">
              <dt>umask giving this for new folders</dt>
              <dd class="mono">{umask}</dd>
            </div>
          </dl>
          <label class="control">
            <span class="control-label">File or folder</span>
            <input class="input input-mono" value={file} onInput={(event) => setFile(event.currentTarget.value)} />
          </label>
        </div>
      </div>
      <CodeOutput
        baseName="chmod"
        outputs={[
          {
            label: 'Commands',
            language: 'text',
            code: `chmod ${octal(mode)} ${target}\nchmod ${chmodSymbolic(perms)} ${target}\n\n# Apply to a folder and everything inside it:\nchmod -R ${octal(mode)} ${target}\n\n# Folders and files separately (common for web roots):\nfind ${target} -type d -exec chmod 755 {} +\nfind ${target} -type f -exec chmod 644 {} +\n`,
          },
        ]}
      />
    </section>
  );
}

export default defineCustomTool(Chmod);
