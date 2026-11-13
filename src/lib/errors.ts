/** An error whose message is safe and useful to show to the user as-is. */
export class ToolError extends Error {
  readonly line?: number;
  readonly column?: number;

  constructor(message: string, position?: { line?: number; column?: number }) {
    super(message);
    this.name = 'ToolError';
    this.line = position?.line;
    this.column = position?.column;
  }
}

/** Converts a character offset into a 1-based line/column pair. */
export function lineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(offset, text.length);
  for (let i = 0; i < end; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown error';
}
