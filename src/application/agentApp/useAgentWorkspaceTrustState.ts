import { useCallback, useRef, useState, type SetStateAction } from "react";
import type { WorkspaceTrustState } from "../../domain/trust";

interface WorkspaceTrustPublication {
  readonly base: WorkspaceTrustState | null;
  readonly trust: WorkspaceTrustState | null;
  readonly workspace: object;
}

export function useAgentWorkspaceTrustState(
  activeWorkspace: object | null,
  loadedTrust: WorkspaceTrustState | null,
) {
  const [publication, setPublication] = useState<WorkspaceTrustPublication | null>(null);
  const workspaceTrust = effectiveTrust(publication, activeWorkspace, loadedTrust);
  const latestRef = useRef({ activeWorkspace, loadedTrust, workspaceTrust });
  latestRef.current = { activeWorkspace, loadedTrust, workspaceTrust };

  const setWorkspaceTrust = useCallback((update: SetStateAction<WorkspaceTrustState | null>) => {
    const { activeWorkspace: workspace, loadedTrust: base } = latestRef.current;
    if (workspace === null) return;
    setPublication((current) => {
      const previous = effectiveTrust(current, workspace, base);
      const trust = typeof update === "function" ? update(previous) : update;
      if (current && current.workspace === workspace && current.trust === trust) return current;
      return { base, trust, workspace };
    });
  }, []);

  return { setWorkspaceTrust, workspaceTrust };
}

function effectiveTrust(
  publication: WorkspaceTrustPublication | null,
  activeWorkspace: object | null,
  loadedTrust: WorkspaceTrustState | null,
): WorkspaceTrustState | null {
  if (publication === null || activeWorkspace === null) return loadedTrust;
  if (publication.workspace !== activeWorkspace || publication.base !== loadedTrust) {
    return loadedTrust;
  }
  return publication.trust;
}
