import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  openOrClassifyLinkedFile,
  type LinkedFileDirectoryReader,
} from "../../application/agentLinkedFileProbe";
import {
  openOutsideLinkedFile,
  type AgentOutsideTextFilePort,
} from "../../application/agentOutsideLinkedFile";
import type { AgentFileViewerOwner } from "../../application/rightPanel/useAgentFileRevealRequests";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
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
  revealFileInViewer(
    path: string,
    line: number | null,
    owner?: AgentFileViewerOwner,
  ): Promise<boolean>;
  showExternalFileInViewer?(
    path: string,
    contents: string,
    line: number | null,
    owner?: AgentFileViewerOwner,
  ): Promise<boolean>;
  captureViewerOwner?(): AgentFileViewerOwner;
}

export function useAgentLinkedFileOpener({
  files,
  outsideFiles,
  workspace,
  revealFileInViewer,
  showExternalFileInViewer,
  captureViewerOwner,
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
      const line = location.line ?? null;
      const owner = captureViewerOwner?.();
      const reveal = (path: string): Promise<boolean> => revealFileInViewer(path, line, owner);
      if (root !== null) {
        return openOrClassifyLinkedFile(() => reveal(location.path), location.path, root, files);
      }
      const requested = generationRef.current;
      const isCurrent = () => requested !== null && generationRef.current === requested;
      return openOutsideLinkedFile(location.path, {
        outsideFiles,
        directories: files,
        workspace: () => workspaceRef.current,
        isCurrent,
        open: (path) => (isCurrent() ? reveal(path) : Promise.resolve(false)),
        openSnapshot: async (path, read) => {
          if (showExternalFileInViewer === undefined) return false;
          const contents = await read();
          if (contents === null || !isCurrent()) return false;
          return showExternalFileInViewer(path, contents, line, owner);
        },
      });
    },
    [captureViewerOwner, files, outsideFiles, revealFileInViewer, showExternalFileInViewer],
  );
}
