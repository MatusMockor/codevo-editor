import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectOwnsLaunchRoot } from "../../domain/agentProject";
import type { AgentCliKind } from "../../domain/agentTask";
import type {
  AgentThreadsSurface,
  ExternalSessionsSurface,
} from "../../application/agentThreadPorts";
import type { AgentTerminalSessionsTarget } from "./useAgentThreadNavigation";

export interface SessionImportSelection {
  readonly sessionId: string;
  readonly provider: AgentCliKind;
}

export interface AgentSessionImportOptions {
  readonly open: boolean;
  readonly target: AgentTerminalSessionsTarget | null;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly surface: ExternalSessionsSurface | null;
  readonly importSession: AgentThreadsSurface["importExternalSession"];
  readonly onComplete: (threadId: string) => void;
}

type ImportState =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly completed: number; readonly total: number }
  | { readonly kind: "failed"; readonly notice: string };

export const MAX_SESSION_IMPORT_BATCH = 50;

export function useAgentSessionImport(options: AgentSessionImportOptions) {
  const [state, setState] = useState<ImportState>({ kind: "idle" });
  const latest = useRef(options);
  const generation = useRef(0);
  const pending = useRef(false);
  const imported = useRef(new Map<string, string>());
  const project = options.projects.find(
    (entry) => entry.rootKey === options.target?.projectRootKey,
  );
  const externalTarget = options.surface?.target;
  const ownerId = project?.ownerId;
  const ownerGeneration = project?.generation;
  const origin = project?.origin;
  const cancel = useCallback(() => {
    generation.current += 1;
    pending.current = false;
    imported.current.clear();
    setState((current) => (current.kind === "idle" ? current : { kind: "idle" }));
  }, []);

  useLayoutEffect(() => {
    latest.current = options;
  });
  useLayoutEffect(() => {
    cancel();
    const retainedImports = imported.current;
    return () => {
      generation.current += 1;
      pending.current = false;
      retainedImports.clear();
    };
  }, [cancel, externalTarget, options.open, options.target, origin, ownerGeneration, ownerId]);

  const importMany = useCallback(async (selection: ReadonlyArray<SessionImportSelection>) => {
    const initial = latest.current;
    if (pending.current || initial.surface?.importPending) return;
    if (selection.length === 0) return;
    if (selection.length > MAX_SESSION_IMPORT_BATCH) {
      setState({ kind: "failed", notice: "Select up to 50 sessions at a time." });
      return;
    }
    const token = generation.current;
    const target = initial.target;
    if (target === null || !initial.open) return;
    const owner = initial.projects.find((entry) => entry.rootKey === target.projectRootKey);
    if (owner === undefined || owner.origin === "closed-tab-live-tasks") return;
    const current = () => {
      const value = latest.current;
      const candidate = value.projects.find((entry) => entry.rootKey === target.projectRootKey);
      return (
        generation.current === token &&
        value.open &&
        value.target === target &&
        value.surface?.state === "ready" &&
        value.surface.target?.rootKey === target.projectRootKey &&
        value.surface.target.repositoryRoot === target.repositoryRoot &&
        candidate !== undefined &&
        candidate.ownerId === owner.ownerId &&
        candidate.generation === owner.generation &&
        candidate.origin !== "closed-tab-live-tasks" &&
        agentProjectOwnsLaunchRoot(candidate, target.repositoryRoot)
      );
    };
    if (!current()) return;
    const unique = [...new Map(selection.map((entry) => [sessionKey(entry), entry])).values()];
    pending.current = true;
    let succeeded = 0;
    let firstThread: string | null = null;
    setState({ kind: "running", completed: 0, total: unique.length });
    for (const [index, entry] of unique.entries()) {
      if (!current()) break;
      const session = latest.current.surface?.sessions.find(
        (candidate) =>
          candidate.provider === entry.provider && candidate.sessionId === entry.sessionId,
      );
      const currentOwner = latest.current.projects.find(
        (candidate) => candidate.rootKey === target.projectRootKey,
      );
      if (
        session !== undefined &&
        currentOwner !== undefined &&
        agentProjectOwnsLaunchRoot(currentOwner, session.cwd)
      ) {
        const key = sessionKey(entry);
        let threadId = imported.current.get(key) ?? session.alreadyImportedThreadId;
        if (threadId === null || threadId === undefined) {
          try {
            const result = await latest.current.importSession({
              projectRootKey: target.projectRootKey,
              repositoryRoot: session.cwd,
              provider: session.provider,
              sessionId: session.sessionId,
              title: session.title,
              firstPrompt: session.firstPrompt,
            });
            if (!current()) break;
            threadId = result?.threadId ?? null;
          } catch {
            if (!current()) break;
            threadId = null;
          }
        }
        if (threadId !== null && threadId !== undefined) {
          imported.current.set(key, threadId);
          while (imported.current.size > 200) {
            const oldest = imported.current.keys().next();
            if (oldest.done) break;
            imported.current.delete(oldest.value);
          }
          firstThread ??= threadId;
          succeeded += 1;
        }
      }
      if (!current()) break;
      setState({ kind: "running", completed: index + 1, total: unique.length });
    }
    if (generation.current !== token) return;
    pending.current = false;
    if (!current()) {
      setState({ kind: "idle" });
      return;
    }
    if (succeeded === unique.length && firstThread !== null) {
      setState({ kind: "idle" });
      latest.current.onComplete(firstThread);
      return;
    }
    setState({
      kind: "failed",
      notice: `${succeeded} of ${unique.length} sessions imported. Successful imports are kept. Check that the selected sessions' provider is configured, then retry the remaining sessions.`,
    });
  }, []);

  const importOne = useCallback(
    (sessionId: string, provider: AgentCliKind) => {
      void importMany([{ sessionId, provider }]);
    },
    [importMany],
  );
  const surface = useMemo(
    () =>
      options.surface === null
        ? null
        : {
            ...options.surface,
            importPending: options.surface.importPending || state.kind === "running",
          },
    [options.surface, state.kind],
  );
  return {
    cancel,
    importMany,
    importOne,
    surface,
    importProgress:
      state.kind === "running" ? { completed: state.completed, total: state.total } : null,
    importNotice: state.kind === "failed" ? state.notice : null,
  };
}

function sessionKey(session: SessionImportSelection): string {
  return `${session.provider}:${session.sessionId}`;
}
