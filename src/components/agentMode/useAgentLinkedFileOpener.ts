import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  openOrClassifyLinkedFile,
  type LinkedFileDirectoryReader,
} from "../../application/agentLinkedFileProbe";
import {
  openOutsideLinkedFile,
  type AgentOutsideTextFilePort,
} from "../../application/agentOutsideLinkedFile";
import type { OpenProblemNoticeOptions } from "../../application/useWorkbenchNavigation";
import type { WorkbenchNotice, WorkbenchNoticePosition } from "../../domain/workbenchNotice";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import { openThenRevealFiles } from "./openThenRevealFiles";
import type { AgentFileLocationOpener } from "./useAgentLocalFileLinks";

export interface AgentLinkedFileOpenerWorkspace {
  readonly root: string | null;
  readonly tabs: ReadonlyArray<string>;
  readonly workspaceId: string | null;
  readonly admissionToken: number | null;
}

export interface AgentLinkedFileOpenerDependencies {
  readonly files: LinkedFileDirectoryReader;
  readonly outsideFiles: AgentOutsideTextFilePort;
  readonly workspace: AgentLinkedFileOpenerWorkspace;
  openProblemNotice(notice: WorkbenchNotice, options?: OpenProblemNoticeOptions): Promise<boolean>;
  revealEditorSurface(): void;
}

export function useAgentLinkedFileOpener({
  files,
  outsideFiles,
  workspace,
  openProblemNotice,
  revealEditorSurface,
}: AgentLinkedFileOpenerDependencies): AgentFileLocationOpener {
  const rootKey = normalizedWorkspaceRootKey(workspace.root);
  const { workspaceId, admissionToken } = workspace;
  const generation = useMemo(
    () => ({ rootKey, workspaceId, admissionToken }),
    [rootKey, workspaceId, admissionToken],
  );
  const generationRef = useRef<object | null>(generation);
  generationRef.current = generation;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  useEffect(
    () => () => {
      generationRef.current = null;
    },
    [],
  );
  return useCallback<AgentFileLocationOpener>(
    ({ location, root }) => {
      const position = { column: location.column ?? 1, lineNumber: location.line ?? 1 };
      const open = (path: string, options?: OpenProblemNoticeOptions) =>
        openThenRevealFiles(
          () => openLinkNotice(openProblemNotice, linkNotice(path, position), options),
          revealEditorSurface,
        );
      if (root !== null) {
        return openOrClassifyLinkedFile(() => open(location.path), location.path, root, files);
      }
      const requested = generationRef.current;
      const isCurrent = () => requested !== null && generationRef.current === requested;
      return openOutsideLinkedFile(location.path, {
        outsideFiles,
        directories: files,
        workspace: () => workspaceRef.current,
        isCurrent,
        open: (path) => open(path, { shouldCommit: isCurrent }),
        openSnapshot: (path, read) =>
          open(path, { readOnlySnapshot: read, shouldCommit: isCurrent }),
      });
    },
    [files, openProblemNotice, outsideFiles, revealEditorSurface],
  );
}

function openLinkNotice(
  openProblemNotice: AgentLinkedFileOpenerDependencies["openProblemNotice"],
  notice: WorkbenchNotice,
  options: OpenProblemNoticeOptions | undefined,
): Promise<boolean> {
  if (options === undefined) return openProblemNotice(notice);
  return openProblemNotice(notice, options);
}

function linkNotice(path: string, position: WorkbenchNoticePosition): WorkbenchNotice {
  return {
    id: `agent-link:${path}:${position.lineNumber}:${position.column}`,
    message: path,
    navigationTarget: { path, range: { end: position, start: position } },
    severity: "info",
    source: "Agent",
  };
}
