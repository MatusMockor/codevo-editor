/** Shared command contract consumed by pure domain projections and application registries. */
export interface CommandContext {
  hasWorkspace: boolean;
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
