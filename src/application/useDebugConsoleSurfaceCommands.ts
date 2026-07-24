import { useCallback, useRef, useState } from "react";
import type { UseDebugConsoleResult } from "./useDebugConsole";

export interface DebugConsoleFocusRequest {
  readonly generation: number;
  readonly workspaceOwnerKey: string;
}

export interface UseDebugConsoleSurfaceCommandsOptions {
  readonly console: Pick<UseDebugConsoleResult, "clear" | "state">;
  readonly isWorkspaceTrusted: () => boolean;
  readonly openDebugPanel: () => void;
  readonly workspaceOwnerKey: string | null;
}

export interface UseDebugConsoleSurfaceCommandsResult {
  readonly canClear: boolean;
  readonly focusRequest: DebugConsoleFocusRequest | null;
  readonly workspaceOwnerKey: string | null;
  acknowledgeFocusRequest(request: DebugConsoleFocusRequest): void;
  clear(): void;
  focus(): void;
}

/**
 * Coordinates Debug Console commands without coupling application code to the
 * panel's DOM lifetime. A focus request carries its workspace owner so a panel
 * mounted after a workspace switch cannot consume a stale request.
 */
export function useDebugConsoleSurfaceCommands({
  console,
  isWorkspaceTrusted,
  openDebugPanel,
  workspaceOwnerKey,
}: UseDebugConsoleSurfaceCommandsOptions): UseDebugConsoleSurfaceCommandsResult {
  const [storedFocusRequest, setStoredFocusRequest] = useState<{
    readonly ownerEpoch: number;
    readonly request: DebugConsoleFocusRequest;
  } | null>(null);
  const focusGenerationRef = useRef(0);
  const ownerRef = useRef({ epoch: 0, workspaceOwnerKey });
  if (ownerRef.current.workspaceOwnerKey !== workspaceOwnerKey) {
    ownerRef.current = { epoch: ownerRef.current.epoch + 1, workspaceOwnerKey };
  }
  const consoleSessionId = console.state.owner?.sessionId ?? null;
  const consoleOwnershipRef = useRef({
    admitted: true,
    blockedSessionId: null as number | null,
    workspaceOwnerKey,
  });
  if (consoleOwnershipRef.current.workspaceOwnerKey !== workspaceOwnerKey) {
    consoleOwnershipRef.current = {
      admitted: consoleSessionId === null,
      blockedSessionId: consoleSessionId,
      workspaceOwnerKey,
    };
  } else if (
    !consoleOwnershipRef.current.admitted &&
    consoleSessionId !== consoleOwnershipRef.current.blockedSessionId
  ) {
    consoleOwnershipRef.current.admitted = true;
  }
  const consoleOwnershipAdmitted = consoleOwnershipRef.current.admitted;
  const currentRef = useRef({
    console,
    consoleOwnershipAdmitted,
    isWorkspaceTrusted,
    openDebugPanel,
    workspaceOwnerKey,
  });
  currentRef.current = {
    console,
    consoleOwnershipAdmitted,
    isWorkspaceTrusted,
    openDebugPanel,
    workspaceOwnerKey,
  };

  const canClear =
    workspaceOwnerKey !== null &&
    consoleOwnershipAdmitted &&
    workspaceTrustedNow(isWorkspaceTrusted) &&
    (console.state.entries.length > 0 || console.state.pendingRequestIds.length > 0);

  const acknowledgeFocusRequest = useCallback((request: DebugConsoleFocusRequest) => {
    const currentOwnerEpoch = ownerRef.current.epoch;
    setStoredFocusRequest((stored) =>
      stored?.ownerEpoch === currentOwnerEpoch &&
      stored.request.generation === request.generation &&
      stored.request.workspaceOwnerKey === request.workspaceOwnerKey
        ? null
        : stored,
    );
  }, []);

  const clear = useCallback(() => {
    const current = currentRef.current;
    if (
      current.workspaceOwnerKey === null ||
      !current.consoleOwnershipAdmitted ||
      !workspaceTrustedNow(current.isWorkspaceTrusted)
    )
      return;
    if (
      current.console.state.entries.length === 0 &&
      current.console.state.pendingRequestIds.length === 0
    )
      return;
    current.console.clear();
  }, []);

  const focus = useCallback(() => {
    const current = currentRef.current;
    if (current.workspaceOwnerKey === null || !workspaceTrustedNow(current.isWorkspaceTrusted))
      return;
    focusGenerationRef.current += 1;
    current.openDebugPanel();
    setStoredFocusRequest({
      ownerEpoch: ownerRef.current.epoch,
      request: {
        generation: focusGenerationRef.current,
        workspaceOwnerKey: current.workspaceOwnerKey,
      },
    });
  }, []);

  const focusRequest =
    storedFocusRequest?.ownerEpoch === ownerRef.current.epoch ? storedFocusRequest.request : null;
  return { acknowledgeFocusRequest, canClear, clear, focus, focusRequest, workspaceOwnerKey };
}

function workspaceTrustedNow(isWorkspaceTrusted: () => boolean): boolean {
  try {
    return isWorkspaceTrusted();
  } catch {
    return false;
  }
}
