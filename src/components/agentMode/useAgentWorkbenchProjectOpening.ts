import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { DirectoryListingGateway } from "../../domain/directoryListing";
import { NO_SCOPE_STATE, type AgentNavigationSession } from "./useAgentThreadNavigation";
import type {
  AgentAddedProjectReceipt,
  AgentWorkbenchAddProjectChrome,
} from "./agentWorkbenchChrome";
import type { AgentWorkbenchScreenWorkbench } from "./AgentWorkbenchScreen";

export const ADD_PROJECT_REFUSED_REASON = "Unable to add that project.";

export interface AgentPendingProjectOpen {
  readonly epoch: number;
  readonly rootPath: string;
}

export function useAgentWorkbenchProjectOpening({
  directoryListingGateway,
  openWorkspaceRootWithReceipt,
  navigationSession,
  addProjectPending,
}: {
  readonly directoryListingGateway: DirectoryListingGateway;
  readonly openWorkspaceRootWithReceipt: AgentWorkbenchScreenWorkbench["openWorkspaceRootWithReceipt"];
  readonly navigationSession: AgentNavigationSession;
  readonly addProjectPending: RefObject<AgentPendingProjectOpen | null>;
}): AgentWorkbenchAddProjectChrome {
  const [addedProjectReceipt, setAddedProjectReceipt] = useState<AgentAddedProjectReceipt | null>(
    null,
  );
  const addSelectionEpoch = useRef(0);
  const publishedEpoch = useRef<number | null>(null);
  const publishedReceiptStale = addedProjectReceipt !== null && !addedProjectReceipt.isCurrent();
  useLayoutEffect(() => {
    if (!publishedReceiptStale) return;
    if (addProjectPending.current?.epoch === publishedEpoch.current)
      addProjectPending.current = null;
    setAddedProjectReceipt(null);
  }, [publishedReceiptStale, addProjectPending]);
  const addMounted = useRef(true);
  useLayoutEffect(() => {
    addMounted.current = true;
    return () => {
      addMounted.current = false;
      addSelectionEpoch.current += 1;
    };
  }, [addProjectPending]);
  const cancelAddSelection = useCallback(() => {
    addProjectPending.current = null;
    addSelectionEpoch.current += 1;
  }, [addProjectPending]);
  const consumeAddSelection = useCallback(
    (receipt: AgentAddedProjectReceipt) => {
      if (receipt.isCurrent()) addProjectPending.current = null;
      setAddedProjectReceipt((current) => (current === receipt ? null : current));
    },
    [addProjectPending],
  );
  return useMemo(
    () => ({
      gateway: directoryListingGateway,
      receipt: addedProjectReceipt,
      cancelSelection: cancelAddSelection,
      consumeSelection: consumeAddSelection,
      addProject: async (path: string) => {
        const epoch = ++addSelectionEpoch.current;
        addProjectPending.current = { epoch, rootPath: path };
        navigationSession.current = {
          selectedThreadId: null,
          selectedThreadOwnerKey: null,
          scopeState: NO_SCOPE_STATE,
        };
        const clearPending = () => {
          if (addProjectPending.current?.epoch === epoch) addProjectPending.current = null;
        };
        const { outcome, isCurrent } = await openWorkspaceRootWithReceipt(path).catch(
          (error: unknown) => {
            clearPending();
            throw error;
          },
        );
        if (outcome.kind !== "opened") {
          clearPending();
          throw new Error(ADD_PROJECT_REFUSED_REASON);
        }
        if (outcome.receipt.kind !== "registeredWorkspaceOpenReceipt") {
          clearPending();
          throw new Error(ADD_PROJECT_REFUSED_REASON);
        }
        const receipt = {
          rootPath: outcome.receipt.selectedPath,
          ownerId: outcome.receipt.workspaceId,
          isCurrent: () =>
            addMounted.current &&
            addSelectionEpoch.current === epoch &&
            addProjectPending.current?.epoch === epoch &&
            isCurrent(),
        };
        if (receipt.isCurrent()) {
          publishedEpoch.current = epoch;
          setAddedProjectReceipt(receipt);
          return receipt;
        }
        clearPending();
        return receipt;
      },
    }),
    [
      addProjectPending,
      navigationSession,
      addedProjectReceipt,
      cancelAddSelection,
      consumeAddSelection,
      directoryListingGateway,
      openWorkspaceRootWithReceipt,
    ],
  );
}
