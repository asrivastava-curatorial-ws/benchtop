/** Lists the AI engine and models: download, import from a folder, or remove them. */
import { defineCustomTool } from '../types';
import { AiModelsPanel } from './_ai';

function AiModels(_props: { toolId: string }) {
  return (
    <div data-testid="tool" class="tool ai-models-page">
      <AiModelsPanel />
    </div>
  );
}

export default defineCustomTool(AiModels);
