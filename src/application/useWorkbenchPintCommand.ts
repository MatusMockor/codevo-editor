import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PintFormatResult, PintGateway } from "../infrastructure/tauriPintGateway";

export interface WorkbenchPintActions {
  formatActiveFile(): Promise<void>;
  formatChangedFiles(): Promise<void>;
  isRunning: boolean;
}

export interface WorkbenchPintCommandOptions {
  activeDocument: EditorDocument | null;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  gateway: PintGateway;
  setMessage: Dispatch<SetStateAction<string | null>>;
  workspaceRoot: string | null;
}

function pintMessage(result: PintFormatResult): string {
  if (result.status === "unavailable") {
    return result.message ?? "Laravel Pint is unavailable in this workspace.";
  }

  if (result.status === "error") {
    return result.message;
  }

  if (result.changedFiles === 0) {
    return "Pint made no changes";
  }

  if (result.changedFiles !== undefined) {
    const noun = result.changedFiles === 1 ? "file" : "files";
    return `Pint formatted ${result.changedFiles} ${noun}`;
  }

  return "Pint formatting completed";
}

export function useWorkbenchPintCommand({
  activeDocument,
  currentWorkspaceRootRef,
  gateway,
  setMessage,
  workspaceRoot,
}: WorkbenchPintCommandOptions): WorkbenchPintActions {
  const inFlightRef = useRef(false);
  const [isRunning, setIsRunning] = useState(false);

  const format = useCallback(async (relativePath: string | null) => {
    if (!workspaceRoot || inFlightRef.current) {
      return;
    }

    const requestedRoot = workspaceRoot;
    inFlightRef.current = true;
    setIsRunning(true);

    try {
      const result = await gateway.format(requestedRoot, relativePath);

      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(pintMessage(result));
    } catch (error) {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) {
        return;
      }

      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      inFlightRef.current = false;
      setIsRunning(false);
    }
  }, [currentWorkspaceRootRef, gateway, setMessage, workspaceRoot]);

  const formatChangedFiles = useCallback(async () => {
    await format(null);
  }, [format]);

  const formatActiveFile = useCallback(async () => {
    if (!workspaceRoot || !activeDocument) {
      return;
    }

    const relativePath = workspaceRelativePath(workspaceRoot, activeDocument.path);

    if (!relativePath || !relativePath.endsWith(".php")) {
      return;
    }

    await format(relativePath);
  }, [activeDocument, format, workspaceRoot]);

  return { formatActiveFile, formatChangedFiles, isRunning };
}
