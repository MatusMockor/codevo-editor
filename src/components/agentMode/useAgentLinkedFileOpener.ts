import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  openNamedLinkedFile,
  type LinkedFileSearch,
} from "../../application/agentLinkedFileBasenameLookup";
import {
  openOrClassifyLinkedFile,
  type LinkedFileDirectoryReader,
} from "../../application/agentLinkedFileProbe";
import {
  openHomeLinkedFile,
  openOutsideLinkedFile,
  type AgentOutsideLinkedFileOpening,
  type AgentOutsideTextFilePort,
} from "../../application/agentOutsideLinkedFile";
import type { AgentFileViewerOwner } from "../../application/rightPanel/useAgentFileRevealRequests";
import type { HomeDirectoryResolver } from "../../application/useHomeDirectory";
import type { AgentLocalFileOpenOutcome } from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";
import type { AgentLocalFileOpenRequest } from "./agentMarkdownLinks";
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
  readonly fileSearch?: LinkedFileSearch;
  readonly resolveHome?: HomeDirectoryResolver;
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
  fileSearch,
  resolveHome,
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
  const latestRequestRef = useRef(0);
  useEffect(
    () => () => {
      generationRef.current = null;
    },
    [],
  );
  return useCallback<AgentFileLocationOpener>(
    (request) => {
      const line = request.location.line ?? null;
      const owner = captureViewerOwner?.();
      const requested = generationRef.current;
      latestRequestRef.current += 1;
      const sequence = latestRequestRef.current;
      const isCurrent = () =>
        requested !== null &&
        generationRef.current === requested &&
        latestRequestRef.current === sequence &&
        isSameViewerOwner(owner, captureViewerOwner?.());
      const reveal = (path: string): Promise<boolean> =>
        isCurrent() ? revealFileInViewer(path, line, owner) : Promise.resolve(false);
      const outside: AgentOutsideLinkedFileOpening = {
        outsideFiles,
        directories: files,
        workspace: () => workspaceRef.current,
        isCurrent,
        open: reveal,
        openSnapshot: async (path, read) => {
          if (showExternalFileInViewer === undefined) return false;
          const contents = await read();
          if (contents === null || !isCurrent()) return false;
          return showExternalFileInViewer(path, contents, line, owner);
        },
      };
      return openLinkedFileRequest(request, {
        outside,
        search: fileSearch ?? null,
        resolveHome: resolveHome ?? null,
      });
    },
    [
      captureViewerOwner,
      fileSearch,
      files,
      outsideFiles,
      resolveHome,
      revealFileInViewer,
      showExternalFileInViewer,
    ],
  );
}

interface LinkedFileRoutes {
  readonly outside: AgentOutsideLinkedFileOpening;
  readonly search: LinkedFileSearch | null;
  readonly resolveHome: HomeDirectoryResolver | null;
}

function openLinkedFileRequest(
  request: AgentLocalFileOpenRequest,
  { outside, search, resolveHome }: LinkedFileRoutes,
): Promise<AgentLocalFileOpenOutcome> {
  const { path } = request.location;
  const { directories, isCurrent, open } = outside;
  switch (request.kind) {
    case "home":
      return openHomeLinkedFile(path, resolveHome, outside);
    case "name":
      return openNamedLinkedFile(path, request.root, { directories, search, isCurrent, open });
    case "path":
      if (request.root === null) return openOutsideLinkedFile(path, outside);
      return openOrClassifyLinkedFile(() => open(path), path, request.root, directories, isCurrent);
    default:
      return unsupportedRequest(request);
  }
}

function isSameViewerOwner(
  captured: AgentFileViewerOwner | undefined,
  current: AgentFileViewerOwner | undefined,
): boolean {
  if (captured === undefined || current === undefined) return captured === current;
  return captured.threadId === current.threadId && captured.generation === current.generation;
}

function unsupportedRequest(request: never): never {
  throw new Error(`Unsupported linked file request: ${String(request)}`);
}
