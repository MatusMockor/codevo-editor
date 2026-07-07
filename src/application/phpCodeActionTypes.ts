/**
 * Shared shape for synthesized PHP code actions. Kept application-level because
 * these descriptors bridge domain planners and the Monaco/LSP adapter.
 */
export interface PhpCodeActionTextEditRange {
  endColumn: number;
  endLineNumber: number;
  startColumn: number;
  startLineNumber: number;
}

export interface PhpCodeActionTextEdit {
  range: PhpCodeActionTextEditRange;
  text: string;
}

/**
 * A brand-new file a code action creates as part of its workspace edit.
 */
export interface PhpCodeActionNewFile {
  content: string;
  path: string;
  title?: string;
}

export interface PhpCodeActionDescriptor {
  edits: PhpCodeActionTextEdit[];
  /**
   * When true, marks this action as the single most-likely choice for the
   * current cursor / selection.
   */
  isPreferred?: boolean;
  kind?: string;
  newFile?: PhpCodeActionNewFile;
  title: string;
}

/**
 * Cursor / selection covered by a PHP code-action request, expressed as
 * 0-based character offsets into the source.
 */
export interface PhpCodeActionRange {
  end: number;
  start: number;
}
