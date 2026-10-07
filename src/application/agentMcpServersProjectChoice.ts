export interface AgentMcpServersProjectChoice {
  chosen(scope: string | null): string | null;
  choose(scope: string | null, repositoryRoot: string): void;
  subscribe(listener: () => void): () => void;
}

interface Choice {
  readonly scope: string | null;
  readonly repositoryRoot: string;
}

export class AgentMcpServersProjectChoiceStore implements AgentMcpServersProjectChoice {
  private current: Choice | null = null;
  private readonly listeners = new Set<() => void>();

  chosen(scope: string | null): string | null {
    if (this.current === null || this.current.scope !== scope) return null;
    return this.current.repositoryRoot;
  }

  choose(scope: string | null, repositoryRoot: string): void {
    if (this.chosen(scope) === repositoryRoot) return;
    this.current = Object.freeze({ scope, repositoryRoot });
    for (const listener of [...this.listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
