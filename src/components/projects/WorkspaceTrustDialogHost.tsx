import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import type {
  WorkspaceTrustDecision,
  WorkspaceTrustPromptCoordinator,
} from "../../application/workspaceTrustPrompt";
import { WorkspaceTrustDialog } from "./WorkspaceTrustDialog";

export interface WorkspaceTrustDialogHostProps {
  readonly prompt: WorkspaceTrustPromptCoordinator;
  readonly workspaceScope: string | null;
}

export function WorkspaceTrustDialogHost({
  prompt,
  workspaceScope,
}: WorkspaceTrustDialogHostProps) {
  const request = useSyncExternalStore(prompt.subscribe, prompt.getSnapshot, prompt.getSnapshot);
  useEffect(() => prompt.acquireHostLease(), [prompt]);
  useLayoutEffect(() => {
    prompt.setWorkspaceScope(workspaceScope);
  }, [prompt, workspaceScope]);
  const decide = useCallback(
    (decision: WorkspaceTrustDecision) => {
      if (request !== null) prompt.resolve(request, decision);
    },
    [prompt, request],
  );
  return <WorkspaceTrustDialog onDecide={decide} request={request} />;
}
