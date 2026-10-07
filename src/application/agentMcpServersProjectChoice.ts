import {
  agentMcpServersProjectKey,
  type AgentMcpServersProject,
} from "../domain/agentMcpServersTarget";

export interface AgentMcpServersProjectChoice {
  chosen(scope: string | null): AgentMcpServersProject | null;
  choose(scope: string | null, project: AgentMcpServersProject): void;
  subscribe(listener: () => void): () => void;
}

interface Choice {
  readonly scope: string | null;
  readonly key: string;
  readonly project: AgentMcpServersProject;
}

export class AgentMcpServersProjectChoiceStore implements AgentMcpServersProjectChoice {
  private current: Choice | null = null;
  private readonly listeners = new Set<() => void>();

  chosen(scope: string | null): AgentMcpServersProject | null {
    if (this.current === null || this.current.scope !== scope) return null;
    return this.current.project;
  }

  choose(scope: string | null, project: AgentMcpServersProject): void {
    const key = agentMcpServersProjectKey(project);
    if (this.current?.scope === scope && this.current.key === key) return;
    this.current = Object.freeze({ scope, key, project: Object.freeze({ ...project }) });
    for (const listener of [...this.listeners]) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
