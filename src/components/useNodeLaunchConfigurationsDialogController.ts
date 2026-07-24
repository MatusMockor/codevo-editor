import { useCallback, useEffect, useRef, useState } from "react";
import {
  NODE_LAUNCH_CONFIGURATION_PATH,
  parseNodeLaunchConfigurations,
  serializeNodeLaunchConfigurations,
  type NodeLaunchConfiguration,
} from "../domain/nodeLaunchConfiguration";
import {
  joinWorkspacePath,
  type WorkspaceFileGateway,
  type WorkspaceOwnerFileGateway,
  type WorkspaceTextFileSnapshot,
  type WorkspaceWriteResult,
} from "../domain/workspace";
import type { NodeLaunchConfigurationsDialogProps } from "./NodeLaunchConfigurationsDialog";

export type NodeLaunchConfigurationFileGateway = Pick<
  WorkspaceFileGateway,
  "readDirectory" | "readTextFileSnapshot"
> &
  WorkspaceOwnerFileGateway;

export interface UseNodeLaunchConfigurationsDialogControllerOptions {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly rootPath: string | null;
  readonly workspaceFiles: NodeLaunchConfigurationFileGateway;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
}

interface ControllerState {
  readonly configurations: readonly NodeLaunchConfiguration[];
  readonly error: string | null;
  readonly loading: boolean;
  readonly saving: boolean;
}

const EMPTY_STATE: ControllerState = {
  configurations: [],
  error: null,
  loading: false,
  saving: false,
};

export function useNodeLaunchConfigurationsDialogController({
  isOpen,
  onClose,
  rootPath,
  workspaceFiles,
  workspaceId,
  workspaceTrusted,
}: UseNodeLaunchConfigurationsDialogControllerOptions): NodeLaunchConfigurationsDialogProps {
  const [states, setStates] = useState<Record<string, ControllerState>>({});
  const sequence = useRef(0);
  const workspaceKey = workspaceId && rootPath ? `${workspaceId}\u0000${rootPath}` : null;
  const currentKeyRef = useRef(workspaceKey);
  currentKeyRef.current = workspaceKey;
  const state = workspaceKey ? (states[workspaceKey] ?? EMPTY_STATE) : EMPTY_STATE;

  const load = useCallback(async () => {
    if (!workspaceKey || !rootPath) return;
    const request = ++sequence.current;
    const current = () => currentKeyRef.current === workspaceKey && sequence.current === request;
    setStates((states) => ({
      ...states,
      [workspaceKey]: { ...(states[workspaceKey] ?? EMPTY_STATE), error: null, loading: true },
    }));
    try {
      const file = await inspectConfigurationFile(workspaceFiles, rootPath, current);
      if (!current()) return;
      if (file.kind === "missing") {
        setStates((states) => ({ ...states, [workspaceKey]: EMPTY_STATE }));
        return;
      }
      const parsed = parseNodeLaunchConfigurations(file.snapshot.content);
      setStates((states) => ({
        ...states,
        [workspaceKey]:
          parsed.kind === "ok"
            ? { configurations: parsed.configurations, error: null, loading: false, saving: false }
            : { configurations: [], error: parsed.message, loading: false, saving: false },
      }));
    } catch (error) {
      if (!current()) return;
      setStates((states) => ({
        ...states,
        [workspaceKey]: {
          ...(states[workspaceKey] ?? EMPTY_STATE),
          error: errorMessage(error),
          loading: false,
        },
      }));
    }
  }, [rootPath, workspaceFiles, workspaceKey]);

  useEffect(() => {
    if (isOpen) void load();
    else sequence.current += 1;
  }, [isOpen, load]);

  const onSave = useCallback(
    async (configurations: readonly NodeLaunchConfiguration[]): Promise<boolean> => {
      if (!workspaceKey || !rootPath || !workspaceId) return false;
      if (!workspaceTrusted) {
        setStates((states) => ({
          ...states,
          [workspaceKey]: {
            ...(states[workspaceKey] ?? EMPTY_STATE),
            error: "Trust this workspace to save launch configurations.",
          },
        }));
        return false;
      }
      const serialized = serializeNodeLaunchConfigurations(configurations);
      if (serialized.kind === "error") {
        setStates((states) => ({
          ...states,
          [workspaceKey]: { ...(states[workspaceKey] ?? EMPTY_STATE), error: serialized.message },
        }));
        return false;
      }
      const request = ++sequence.current;
      const current = () => currentKeyRef.current === workspaceKey && sequence.current === request;
      setStates((states) => ({
        ...states,
        [workspaceKey]: { ...(states[workspaceKey] ?? EMPTY_STATE), error: null, saving: true },
      }));
      try {
        const file = await inspectConfigurationFile(workspaceFiles, rootPath, current);
        if (!current()) return false;
        const path = joinWorkspacePath(rootPath, NODE_LAUNCH_CONFIGURATION_PATH);
        let result: WorkspaceWriteResult;
        if (file.kind === "missing") {
          if (!file.directoryExists) {
            await workspaceFiles.createDirectoryForWorkspace(
              workspaceId,
              joinWorkspacePath(rootPath, ".codevo"),
            );
            if (!current()) return false;
          }
          result = await workspaceFiles.createTextFileWithContentForWorkspace(
            workspaceId,
            path,
            serialized.source,
          );
        } else {
          if (!file.snapshot.revision) {
            throw new Error(
              "Revision-aware workspace reads are required to save launch configurations.",
            );
          }
          result = await workspaceFiles.writeTextFileForWorkspace(
            workspaceId,
            path,
            serialized.source,
            file.snapshot.revision,
          );
        }
        if (!current()) return false;
        const writeError = workspaceWriteError(result);
        if (writeError) {
          await refreshAfterWriteFailure(workspaceFiles, rootPath, current);
          if (!current()) return false;
        }
        setStates((states) => ({
          ...states,
          [workspaceKey]: writeError
            ? { ...(states[workspaceKey] ?? EMPTY_STATE), error: writeError, saving: false }
            : {
                configurations: serialized.configurations,
                error: null,
                loading: false,
                saving: false,
              },
        }));
        return !writeError;
      } catch (error) {
        if (!current()) return false;
        setStates((states) => ({
          ...states,
          [workspaceKey]: {
            ...(states[workspaceKey] ?? EMPTY_STATE),
            error: errorMessage(error),
            saving: false,
          },
        }));
        return false;
      }
    },
    [rootPath, workspaceFiles, workspaceId, workspaceKey, workspaceTrusted],
  );

  return {
    configurations: state.configurations,
    error: state.error,
    isOpen,
    loading: state.loading,
    onClose,
    onSave,
    saving: state.saving,
    workspaceTrusted,
  };
}

type ConfigurationFileInspection =
  | { readonly kind: "missing"; readonly directoryExists: boolean }
  | { readonly kind: "present"; readonly snapshot: WorkspaceTextFileSnapshot };

async function inspectConfigurationFile(
  files: NodeLaunchConfigurationFileGateway,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<ConfigurationFileInspection> {
  const directoryPath = joinWorkspacePath(rootPath, ".codevo");
  const configurationPath = joinWorkspacePath(rootPath, NODE_LAUNCH_CONFIGURATION_PATH);
  const rootEntries = await files.readDirectory(rootPath);
  if (!isCurrent()) return { kind: "missing", directoryExists: false };
  const directoryExists = rootEntries.some(
    (entry) => entry.kind === "directory" && entry.name === ".codevo",
  );
  if (!directoryExists) return { kind: "missing", directoryExists: false };
  const directoryEntries = await files.readDirectory(directoryPath);
  if (!isCurrent()) return { kind: "missing", directoryExists: true };
  if (!directoryEntries.some((entry) => entry.kind === "file" && entry.name === "launch.json")) {
    return { kind: "missing", directoryExists: true };
  }
  if (!files.readTextFileSnapshot) {
    throw new Error("Revision-aware workspace reads are required to save launch configurations.");
  }
  return { kind: "present", snapshot: await files.readTextFileSnapshot(configurationPath) };
}

async function refreshAfterWriteFailure(
  files: NodeLaunchConfigurationFileGateway,
  rootPath: string,
  isCurrent: () => boolean,
): Promise<void> {
  try {
    await inspectConfigurationFile(files, rootPath, isCurrent);
  } catch {
    // Preserve the original write failure; the next explicit save performs a fresh read again.
  }
}

function workspaceWriteError(result: WorkspaceWriteResult | void): string | null {
  if (!result || result.status === "success") return null;
  return result.message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
