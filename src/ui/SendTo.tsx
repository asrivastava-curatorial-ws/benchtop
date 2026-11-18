/** "Send to": offers the tools that can open a result, and opens the chosen one with it. */
import { useState } from 'preact/hooks';
import { DropDialog } from '../app/DropDialog';
import { Icon } from './icons';
import { attempt } from './toast';

export function SendTo({ make, from, disabled = false, small = true }: { make: () => File | null | Promise<File | null>; from: string; disabled?: boolean; small?: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  return (
    <>
      <button
        type="button"
        class={`button${small ? ' button-small' : ''}`}
        disabled={disabled}
        title="Open the result in another tool"
        data-testid="send-to"
        onClick={() =>
          attempt(async () => {
            const made = await make();
            if (made) setFile(made);
          })
        }
      >
        <Icon name="share" size={14} />
        Send to…
      </button>
      {file && <DropDialog files={[file]} from={from} onClose={() => setFile(null)} />}
    </>
  );
}
