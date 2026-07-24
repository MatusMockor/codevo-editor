import type { EditorSurfaceCommandInvocationScope } from "./editorSurfaceCommand";

/** Atomic, presentation-owned package.json snapshot for the contextual npm command. */
export interface NpmRunSelectedScriptContextCapture {
  readonly anchorOffset: number;
  readonly content: string;
  readonly documentPath: string;
  readonly modelIdentity: object;
  readonly modelVersion: number;
}

/** Shared command contract consumed by pure domain projections and application registries. */
export interface CommandContext {
  hasWorkspace: boolean;
  hasActiveDocument: boolean;
  activeDocumentDirty: boolean;
  editorSurfaceScope?: EditorSurfaceCommandInvocationScope;
  npmRunSelectedScriptCapture?: NpmRunSelectedScriptContextCapture;
}

export interface Command {
  id: string;
  title: string;
  category: string;
  shortcut?: string;
  /** Defaults to true. Context-only actions can remain registry-callable without leaking into palettes. */
  visibleInCommandPalette?: boolean;
  isEnabled(context: CommandContext): boolean;
  run(context?: CommandContext): void | Promise<void>;
}
