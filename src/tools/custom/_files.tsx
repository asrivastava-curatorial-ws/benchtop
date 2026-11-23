/** A drop area for one or many files, shared by the tools that take several pictures. */
import { useIncomingFiles } from '../../app/handoff';
import { pickFiles } from '../../platform';
import { Icon, type IconName } from '../../ui/icons';
import { attempt } from '../../ui/toast';

interface Props {
  readonly onFiles: (files: File[]) => void;
  readonly accept: string;
  readonly title: string;
  readonly hint?: string;
  readonly compact?: boolean;
  readonly testId?: string;
  /** Files dropped on the window or sent from another tool are taken when they pass this test. */
  readonly wants?: (file: File) => boolean;
  readonly icon?: IconName;
}

export const isImageFile = (file: File) => file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name);

export function MultiDrop({ onFiles, accept, title, hint, compact, testId, wants, icon = 'image' }: Props) {
  useIncomingFiles(onFiles, wants);
  return (
    <button
      type="button"
      class={`dropzone${compact ? ' dropzone-compact' : ''}`}
      onClick={() => attempt(async () => onFiles(await pickFiles(accept)))}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length) {
          e.preventDefault();
          onFiles(files);
        }
      }}
      data-testid={testId}
    >
      <Icon name={icon} size={compact ? 20 : 30} />
      <span class="dropzone-title">{title}</span>
      {hint && !compact && <span class="dropzone-hint">{hint}</span>}
    </button>
  );
}
