import { useCallback } from "react";
import { isNodeDebugPort, type DebugLaunchTarget } from "../domain/debug";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkbenchPrompter } from "./workbenchPrompter";

interface NodeDebugAttachOptions {
  readonly getWorkspaceRoot: () => string | null;
  readonly hasJavaScriptTypeScriptWorkspace: () => boolean;
  readonly isDebugSessionBusy: () => boolean;
  readonly isWorkspaceTrusted: () => boolean;
  readonly openDebugPanel: () => void;
  readonly prompter: Pick<WorkbenchPrompter, "prompt">;
  readonly reportWarning: (message: string) => void;
  readonly startDebug: (launch: DebugLaunchTarget) => Promise<void>;
}

export async function attachNodeDebugger({
  getWorkspaceRoot,
  hasJavaScriptTypeScriptWorkspace,
  isDebugSessionBusy,
  isWorkspaceTrusted,
  openDebugPanel,
  prompter,
  reportWarning,
  startDebug,
}: NodeDebugAttachOptions): Promise<void> {
  const requestedRoot = getWorkspaceRoot();
  if (
    !requestedRoot ||
    !hasJavaScriptTypeScriptWorkspace() ||
    !isWorkspaceTrusted() ||
    isDebugSessionBusy()
  ) {
    return;
  }
  const input = prompter.prompt("Node inspector port", "9229");
  if (input === null) return;
  const normalized = input.trim();
  const port = /^\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  if (!isNodeDebugPort(port)) {
    reportWarning("Debug: inspector port must be an integer between 1 and 65535.");
    return;
  }
  if (
    !workspaceRootKeysEqual(requestedRoot, getWorkspaceRoot()) ||
    !hasJavaScriptTypeScriptWorkspace() ||
    !isWorkspaceTrusted() ||
    isDebugSessionBusy()
  ) {
    return;
  }
  openDebugPanel();
  await startDebug({ kind: "node-attach", port });
}

export function useNodeDebugAttach(options: NodeDebugAttachOptions) {
  const {
    getWorkspaceRoot,
    hasJavaScriptTypeScriptWorkspace,
    isDebugSessionBusy,
    isWorkspaceTrusted,
    openDebugPanel,
    prompter,
    reportWarning,
    startDebug,
  } = options;
  return useCallback(
    () =>
      attachNodeDebugger({
        getWorkspaceRoot,
        hasJavaScriptTypeScriptWorkspace,
        isDebugSessionBusy,
        isWorkspaceTrusted,
        openDebugPanel,
        prompter,
        reportWarning,
        startDebug,
      }),
    [
      getWorkspaceRoot,
      hasJavaScriptTypeScriptWorkspace,
      isDebugSessionBusy,
      isWorkspaceTrusted,
      openDebugPanel,
      prompter,
      reportWarning,
      startDebug,
    ],
  );
}
