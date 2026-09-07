import type { AgentGitHistoryGateway } from "../../application/useAgentGitHistory";
import type { AgentGitHistoryScope } from "./agentGitHistoryTarget";
import type { AgentWorkbenchDiffChrome } from "./agentWorkbenchChrome";
import type { AgentHistoryRepositories } from "./agentHistoryRepositories";
import { AgentHistoryRepositoryBrowser } from "./AgentHistoryRepositoryBrowser";
import { AgentHistoryContent } from "./AgentHistoryContent";

export interface AgentSurfaceHistoryProps extends AgentWorkbenchDiffChrome {
  readonly scope: AgentGitHistoryScope;
  readonly gateway: AgentGitHistoryGateway | null;
  readonly repositories?: AgentHistoryRepositories | null;
}

export function AgentSurfaceHistory({ repositories, ...props }: AgentSurfaceHistoryProps) {
  if (repositories === undefined || repositories === null)
    return <AgentHistoryContent {...props} />;
  return (
    <AgentHistoryRepositoryBrowser
      key={repositories.identity}
      repositories={repositories}
      {...props}
    />
  );
}
