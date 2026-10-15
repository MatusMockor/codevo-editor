import { useMemo, useState } from "react";
import type { AgentFileViewerOwner } from "../../application/rightPanel/useAgentFileRevealRequests";
import {
  createAgentFileViewerSessions,
  externalFileDocument,
  type AgentFileViewerDocument,
  type AgentFileViewerSessions,
} from "../../application/rightPanel/useAgentFileViewerSessions";
import type {
  AgentWorkbenchCommand,
  AgentWorkbenchLayoutState,
} from "../../application/useAgentWorkbenchLayout";
import { parseAgentFileRevealTarget } from "../../domain/agentWorkbenchLayoutFileReveal";
import type { FileEntry } from "../../domain/workspace";

export interface AgentFileViewerOpeners {
  readonly sessions: AgentFileViewerSessions;
  captureViewerOwner(): AgentFileViewerOwner;
  revealFileInViewer(
    path: string,
    line?: number | null,
    owner?: AgentFileViewerOwner,
  ): Promise<boolean>;
  showExternalFileInViewer(
    path: string,
    contents: string,
    line?: number | null,
    owner?: AgentFileViewerOwner,
  ): Promise<boolean>;
  onOpenFile(entry: FileEntry): void;
  onPreviewFile(entry: FileEntry): Promise<boolean>;
  revealEditor(): void;
}

export function useAgentFileViewerOpeners(
  dispatch: (command: AgentWorkbenchCommand) => void,
  sessionsOverride?: AgentFileViewerSessions,
): AgentFileViewerOpeners {
  const [ownSessions] = useState(createAgentFileViewerSessions);
  const sessions = sessionsOverride ?? ownSessions;
  return useMemo(() => {
    const requests = sessions.requests;
    const reveal = (
      path: string,
      line: number | null,
      owner: AgentFileViewerOwner,
      external: ((path: string) => AgentFileViewerDocument) | null,
    ): Promise<boolean> => {
      const target = parseAgentFileRevealTarget(path, line);
      if (target === null) return Promise.resolve(false);
      const payload = external === null ? null : external(target.path);
      const ticket = requests.begin(target.path, target.line, owner, payload);
      if (ticket === null) return Promise.resolve(false);
      dispatch({ kind: "revealFile", path: target.path, line: target.line, request: ticket.id });
      return ticket.settled;
    };
    const revealFileInViewer = (
      path: string,
      line: number | null = null,
      owner: AgentFileViewerOwner = requests.currentOwner(),
    ) => reveal(path, line, owner, null);
    return {
      sessions,
      captureViewerOwner: () => requests.currentOwner(),
      revealFileInViewer,
      showExternalFileInViewer: (
        path: string,
        contents: string,
        line: number | null = null,
        owner: AgentFileViewerOwner = requests.currentOwner(),
      ) => reveal(path, line, owner, (target) => externalFileDocument(target, contents)),
      onOpenFile: (entry) => void revealFileInViewer(entry.path),
      onPreviewFile: (entry) => revealFileInViewer(entry.path),
      revealEditor: ignoreEditorReveal,
    };
  }, [dispatch, sessions]);
}

export function useAgentFileViewerLayout(
  layout: AgentWorkbenchLayoutState,
  sessions: AgentFileViewerSessions,
): AgentWorkbenchLayoutState {
  return useMemo(
    () => ({
      ...layout,
      bindThread(threadId: string | null) {
        sessions.requests.bindOwner(threadId);
        layout.bindThread?.(threadId);
      },
    }),
    [layout, sessions],
  );
}

const ignoreEditorReveal = (): void => undefined;
