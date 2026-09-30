export interface AgentComposerPreviousWorktree {
  readonly threadId: string;
  readonly worktreePath: string;
  readonly branch: string | null;
}

export interface AgentComposerPreviousWorktreeChoice {
  readonly available: AgentComposerPreviousWorktree;
  readonly selected: boolean;
  onSelect(): void;
}
