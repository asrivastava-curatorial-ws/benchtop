import { stringify } from 'yaml';
import { composeDocument, dockerRunToCompose } from '../../lib/docker-compose';
import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

const SAMPLE = `docker run -d --name kiosk-api \\
  -p 8080:3000 \\
  -e NODE_ENV=production -e TZ=Asia/Kolkata \\
  -v kiosk-data:/app/data \\
  -v ./config:/app/config:ro \\
  --restart unless-stopped \\
  --health-cmd "curl -f http://localhost:3000/health || exit 1" \\
  ghcr.io/example/kiosk-api:2.4 node server.js

docker run -d --name cache -p 6379:6379 redis:7-alpine`;

export default defineTextTool({
  input: { label: 'docker run commands', language: 'text', sample: SAMPLE, placeholder: 'One or more docker run commands, separated by blank lines' },
  output: { label: 'compose.yaml', language: 'yaml' },
  options: [],
  run(input) {
    // Join continued lines, then treat every remaining "docker run" as a separate command.
    const commands = input
      .replace(/\\\r?\n/g, ' ')
      .replace(/`\r?\n/g, ' ')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    if (commands.length === 0) throw new ToolError('Paste a docker run command.');
    const conversions = commands.map(dockerRunToCompose);
    const document = composeDocument(conversions);
    const warnings = conversions.flatMap((conversion) => conversion.warnings.map((warning) => `${conversion.name}: ${warning}`));
    return { output: stringify(document, { lineWidth: 0 }), warnings, filename: 'compose.yaml', info: 'Start it with: docker compose up -d' };
  },
});
