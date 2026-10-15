import { useCallback, useEffect, useState } from "react";
import type {
  AgentFileViewerDocument,
  AgentFileViewerMarkdownMode,
  AgentFileViewerSession,
  AgentFileViewerSessions,
  AgentFileViewerTarget,
} from "../../../../application/rightPanel/useAgentFileViewerSessions";
import type { AgentSurfaceFileTreeSurface } from "../../../../application/useAgentSurfaceFileTree";
import type { FileEntry } from "../../../../domain/workspace";
import {
  directoriesToReveal,
  relativePathInTree,
  relativePathWithin,
  type FileViewerCheckout,
} from "../fileViewer/fileViewerModel";

export interface AgentFilesReveal {
  readonly path: string;
  readonly line: number | null;
  readonly sequence: number;
  readonly request?: number | null;
}

export interface AgentFilesViewerOptions {
  readonly owner: string | null;
  readonly threadId: string | null;
  readonly tree: AgentSurfaceFileTreeSurface | null;
  readonly reveal: AgentFilesReveal | null;
  readonly checkout: FileViewerCheckout | null;
  readonly sessions: AgentFileViewerSessions;
}

export interface AgentFilesViewer {
  readonly owner: string | null;
  readonly target: AgentFileViewerTarget | null;
  readonly treeFocus: string | null;
  readonly treeFocusSignal: number;
  open(entry: FileEntry): void;
  close(): void;
  revealDirectory(directory: string): void;
  setMarkdownMode(mode: AgentFileViewerMarkdownMode): void;
  rememberScroll(target: AgentFileViewerTarget, scrollTop: number): void;
}

interface RevealSettlement {
  readonly request: number;
  readonly accepted: boolean;
}

interface ViewerState {
  readonly owner: string | null;
  readonly root: string | null;
  readonly session: AgentFileViewerSession | null;
  readonly treeFocusSignal: number;
  readonly settlement: RevealSettlement | null;
}

const EMPTY: ViewerState = {
  owner: null,
  root: null,
  session: null,
  treeFocusSignal: 0,
  settlement: null,
};

export function useAgentFilesViewer({
  checkout,
  owner,
  reveal,
  sessions,
  threadId,
  tree,
}: AgentFilesViewerOptions): AgentFilesViewer {
  const root = tree?.rootPath ?? null;
  const [state, setState] = useState<ViewerState>(EMPTY);

  let current = state;
  if (owner !== null && root !== null && (current.owner !== owner || current.root !== root)) {
    current = {
      owner,
      root,
      session: restoredSession(sessions.session(owner), root),
      treeFocusSignal: current.treeFocusSignal + 1,
      settlement: null,
    };
  }
  const session = current.owner === owner && current.root === root ? current.session : null;
  if (session !== null && reveal !== null && reveal.sequence !== session.handledReveal) {
    const request = reveal.request ?? null;
    const pending =
      request === null
        ? null
        : sessions.requests.pending(request, threadId, reveal.path, reveal.line);
    const next =
      request !== null && pending === null
        ? { session: { ...session, handledReveal: reveal.sequence }, accepted: false }
        : revealedSession(session, reveal, checkout, pending?.payload ?? null);
    current = {
      ...current,
      session: next.session,
      treeFocusSignal: current.treeFocusSignal + (next.accepted ? 1 : 0),
      settlement: request === null ? null : { request, accepted: next.accepted },
    };
  }
  if (current !== state) setState(current);

  useEffect(() => {
    if (state.owner === null || state.session === null) return;
    sessions.save(state.owner, state.session);
  }, [sessions, state.owner, state.session]);

  useEffect(() => {
    const settlement = state.settlement;
    if (settlement === null) return;
    sessions.requests.settle(settlement.request, settlement.accepted);
  }, [sessions, state.settlement]);

  const update = useCallback(
    (change: (session: AgentFileViewerSession) => AgentFileViewerSession, focus = false) => {
      setState((previous) => {
        if (previous.session === null || previous.owner !== owner || previous.root !== root) {
          return previous;
        }
        const next = change(previous.session);
        if (next === previous.session) return previous;
        return {
          ...previous,
          session: next,
          treeFocusSignal: previous.treeFocusSignal + (focus ? 1 : 0),
          settlement: null,
        };
      });
    },
    [owner, root],
  );

  const open = useCallback(
    (entry: FileEntry) => {
      if (root === null || entry.kind !== "file") return;
      const relativePath = relativePathWithin(root, entry.path);
      if (relativePath === null) return;
      update((previous) => {
        const document = previous.target?.document;
        const same =
          document?.kind === "workspace" &&
          document.relativePath === relativePath &&
          previous.target?.revealLine === null;
        if (same) return previous;
        return {
          ...previous,
          target: {
            document: { kind: "workspace", root, relativePath },
            revealLine: null,
            revealSequence: 0,
            markdownMode: "rendered",
            scrollTop: null,
          },
          treeFocus: entry.path,
        };
      });
    },
    [root, update],
  );

  const close = useCallback(() => {
    update((previous) => (previous.target === null ? previous : { ...previous, target: null }));
  }, [update]);

  const revealDirectory = useCallback(
    (directory: string) => {
      if (tree === null || root === null) return;
      for (const path of directoriesToReveal(root, directory)) {
        if (!tree.expandedDirectories.has(path)) tree.toggleDirectory(path);
      }
      update(
        (previous) => ({
          ...previous,
          target: null,
          treeFocus: directory === root ? null : directory,
        }),
        true,
      );
    },
    [root, tree, update],
  );

  const setMarkdownMode = useCallback(
    (markdownMode: AgentFileViewerMarkdownMode) => {
      update((previous) => {
        if (previous.target === null || previous.target.markdownMode === markdownMode) {
          return previous;
        }
        return { ...previous, target: { ...previous.target, markdownMode } };
      });
    },
    [update],
  );

  const rememberScroll = useCallback(
    (target: AgentFileViewerTarget, scrollTop: number) => {
      if (owner === null) return;
      sessions.rememberScroll(owner, target, scrollTop);
    },
    [owner, sessions],
  );

  return {
    owner,
    target: session?.target ?? null,
    treeFocus: session?.treeFocus ?? null,
    treeFocusSignal: current.treeFocusSignal,
    open,
    close,
    revealDirectory,
    setMarkdownMode,
    rememberScroll,
  };
}

function restoredSession(
  saved: AgentFileViewerSession | null,
  root: string,
): AgentFileViewerSession {
  if (saved !== null && saved.root === root) return saved;
  return { root, target: null, treeFocus: null, handledReveal: saved?.handledReveal ?? null };
}

function revealedSession(
  session: AgentFileViewerSession,
  reveal: AgentFilesReveal,
  checkout: FileViewerCheckout | null,
  external: AgentFileViewerDocument | null,
): { readonly session: AgentFileViewerSession; readonly accepted: boolean } {
  const handled = { ...session, handledReveal: reveal.sequence };
  const root = session.root;
  const relativePath = relativePathInTree(root, reveal.path, checkout);
  const markdownMode = reveal.line === null ? "rendered" : "source";
  if (relativePath !== null) {
    return {
      accepted: true,
      session: {
        ...handled,
        target: {
          document: { kind: "workspace", root, relativePath },
          revealLine: reveal.line,
          revealSequence: reveal.sequence,
          markdownMode,
          scrollTop: null,
        },
        treeFocus: `${root.endsWith("/") ? root.slice(0, -1) : root}/${relativePath}`,
      },
    };
  }
  if (external === null || external.kind !== "external")
    return { accepted: false, session: handled };
  return {
    accepted: true,
    session: {
      ...handled,
      target: {
        document: external,
        revealLine: reveal.line,
        revealSequence: reveal.sequence,
        markdownMode,
        scrollTop: null,
      },
    },
  };
}
