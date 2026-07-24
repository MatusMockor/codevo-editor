import { useCallback } from "react";
import type { WorkspaceFileGateway } from "../domain/workspace";
import { loadConfiguredNodeLaunch } from "./nodeLaunchConfigurationLoader";
import {
  boundedNodeDebugConfigurationMessage,
  prepareNodeDebugLaunch,
  type PreparedNodeDebugLaunch,
} from "./useNodeDebugConfigurationLauncher";
import { isDebuggableNodeScriptPath } from "./workbenchDebugCommands";

interface ConfiguredNodeLaunchStarterOptions {
  getActiveDocumentPath(): string | null;
  isDebugStartBlocked(): boolean;
  isWorkspaceCurrent(rootPath: string, workspaceId: string): boolean;
  isWorkspaceTrusted(): boolean;
  openDebugPanel(): void;
  reportWarning(message: string): void;
  startDebug(prepared: PreparedNodeDebugLaunch): Promise<boolean>;
  workspaceFiles: Pick<
    WorkspaceFileGateway,
    "readDirectory" | "readTextFile" | "readTextFileBounded"
  >;
}

export function useConfiguredNodeLaunchStarter({
  getActiveDocumentPath,
  isDebugStartBlocked,
  isWorkspaceCurrent,
  isWorkspaceTrusted,
  openDebugPanel,
  reportWarning,
  startDebug,
  workspaceFiles,
}: ConfiguredNodeLaunchStarterOptions) {
  return useCallback(
    async (
      workspaceRoot: string,
      documentPath: string,
      workspaceId: string | null,
    ): Promise<boolean> => {
      if (!isDebuggableNodeScriptPath(documentPath)) return false;
      if (workspaceId === null) {
        return !(
          safelyCall(isWorkspaceTrusted) &&
          !safelyCall(isDebugStartBlocked, true) &&
          getActiveDocumentPath() === documentPath
        );
      }
      const remainsAdmitted = () =>
        safelyCall(() => isWorkspaceCurrent(workspaceRoot, workspaceId)) &&
        safelyCall(isWorkspaceTrusted) &&
        !safelyCall(isDebugStartBlocked, true) &&
        getActiveDocumentPath() === documentPath;
      if (!remainsAdmitted()) return true;
      const result = await loadConfiguredNodeLaunch({
        workspaceRoot,
        documentPath,
        readDirectory: (path) => workspaceFiles.readDirectory(path),
        readFile: (path) => workspaceFiles.readTextFile(path),
        ...(workspaceFiles.readTextFileBounded
          ? {
              readFileBounded: (path, maxBytes) =>
                workspaceFiles.readTextFileBounded!(path, maxBytes),
            }
          : {}),
        isCurrent: remainsAdmitted,
      });
      if (result.kind === "stale") return true;
      if (result.kind === "invalid") {
        if (!remainsAdmitted()) return true;
        reportWarning(boundedNodeDebugConfigurationMessage(`Debug: ${result.message}`));
        return true;
      }
      if (result.kind === "none") return remainsAdmitted() ? false : true;
      if (!remainsAdmitted()) return true;
      const prepared = prepareNodeDebugLaunch(
        result.entry.configuration,
        workspaceRoot,
        result.entry,
      );
      if (prepared.kind !== "supported") {
        reportWarning("Node debug configuration could not be started.");
        return true;
      }
      openDebugPanel();
      if (!remainsAdmitted()) return true;
      await startDebug(prepared.value);
      return true;
    },
    [
      getActiveDocumentPath,
      isDebugStartBlocked,
      isWorkspaceCurrent,
      isWorkspaceTrusted,
      openDebugPanel,
      reportWarning,
      startDebug,
      workspaceFiles,
    ],
  );
}

function safelyCall(callback: () => boolean, fallback = false): boolean {
  try {
    return callback();
  } catch {
    return fallback;
  }
}
