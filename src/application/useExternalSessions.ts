import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import type { AgentCliKind } from "../domain/agentTask";
import {
  isExternalAgentSessionId,
  type ExternalAgentSessionPreview,
  type ExternalAgentSessionSummary,
  type ExternalAgentSessionView,
  type ExternalSessionListSnapshot,
} from "../domain/externalAgentSession";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  isCurrentProjectOwner,
  projectAuthority,
  projectByRootKey,
  warning,
  type AgentProjectAuthority,
} from "./agentProjectAuthority";
import type {
  AgentTasksNotice,
  ExternalSessionGateway,
  ExternalSessionsState,
  ExternalSessionsSurface,
  ExternalSessionsTarget,
} from "./agentThreadPorts";

export const MAX_EXTERNAL_SESSION_PREVIEW_CACHE = 32;

export const EXTERNAL_SESSIONS_OWNER_LOST_NOTICE =
  "The project is no longer available, so its terminal sessions were not loaded.";
export const EXTERNAL_SESSIONS_LIST_FAILED_NOTICE =
  "Terminal sessions could not be listed for this project.";
export const EXTERNAL_SESSION_PREVIEW_FAILED_NOTICE =
  "That terminal session could not be previewed.";

export interface ExternalSessionsDependencies {
  readonly externalSessionGateway: ExternalSessionGateway;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly importPending?: boolean;
}

type PreviewEntry =
  | { readonly kind: "loading" }
  | { readonly kind: "loaded"; readonly preview: ExternalAgentSessionPreview }
  | { readonly kind: "failed"; readonly reason: string };

interface PublishedState {
  readonly state: ExternalSessionsState;
  readonly target: ExternalSessionsTarget | null;
  readonly snapshot: ExternalSessionListSnapshot;
  readonly reason: string | null;
  readonly previews: ReadonlyMap<string, PreviewEntry>;
  readonly activePreviewKey: string | null;
}

const EMPTY_SNAPSHOT: ExternalSessionListSnapshot = Object.freeze({
  sessions: Object.freeze([]),
  skipped: 0,
  truncated: false,
});

const CLOSED_STATE: PublishedState = Object.freeze({
  state: "closed",
  target: null,
  snapshot: EMPTY_SNAPSHOT,
  reason: null,
  previews: new Map<string, PreviewEntry>(),
  activePreviewKey: null,
});

export function useExternalSessions(
  dependencies: ExternalSessionsDependencies,
): ExternalSessionsSurface {
  const [published, setPublished] = useState<PublishedState>(CLOSED_STATE);

  const dependenciesRef = useRef(dependencies);
  const publishedRef = useRef(published);
  publishedRef.current = published;
  const mountedRef = useRef(true);
  const listGenerationRef = useRef(0);
  const previewGenerationRef = useRef(0);

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const publish = useCallback((next: PublishedState): void => {
    publishedRef.current = next;
    setPublished(next);
  }, []);

  const beginListRequest = useCallback((): number => {
    listGenerationRef.current += 1;
    previewGenerationRef.current += 1;
    return listGenerationRef.current;
  }, []);

  const runLoad = useCallback(
    async (target: ExternalSessionsTarget, generation: number): Promise<void> => {
      const authority = authorityForTarget(dependenciesRef.current.projects, target);
      if (authority === null) {
        failLoad(dependenciesRef, publish, target, EXTERNAL_SESSIONS_OWNER_LOST_NOTICE);
        return;
      }
      const project = projectByRootKey(dependenciesRef.current.projects, target.rootKey);
      if (project === undefined) {
        failLoad(dependenciesRef, publish, target, EXTERNAL_SESSIONS_OWNER_LOST_NOTICE);
        return;
      }

      const loaded = await attempt(() =>
        dependenciesRef.current.externalSessionGateway.listExternalSessions({
          projectRoot: project.rootPath,
          repositoryRoot: project.rootPath,
        }),
      );
      if (!mountedRef.current) return;
      if (listGenerationRef.current !== generation) return;
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, target.repositoryRoot)) {
        failLoad(dependenciesRef, publish, target, EXTERNAL_SESSIONS_OWNER_LOST_NOTICE);
        return;
      }
      if (!loaded.ok) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, loaded.error);
        failLoad(dependenciesRef, publish, target, EXTERNAL_SESSIONS_LIST_FAILED_NOTICE);
        return;
      }

      const current = publishedRef.current;
      const listed = new Set(
        loaded.value.sessions.map((session) =>
          providerSessionKey(session.provider, session.sessionId),
        ),
      );
      publish({
        state: "ready",
        target,
        snapshot: loaded.value,
        reason: null,
        previews: retainPreviews(current.previews, listed),
        activePreviewKey: retainActivePreview(current.activePreviewKey, listed),
      });
    },
    [publish],
  );

  const open = useCallback(
    async (target: ExternalSessionsTarget): Promise<void> => {
      const generation = beginListRequest();
      publish({ ...CLOSED_STATE, state: "loading", target });
      await runLoad(target, generation);
    },
    [beginListRequest, publish, runLoad],
  );

  const reload = useCallback(async (): Promise<void> => {
    const target = publishedRef.current.target;
    if (target === null) return;
    const generation = beginListRequest();
    publish({ ...publishedRef.current, state: "loading", reason: null });
    await runLoad(target, generation);
  }, [beginListRequest, publish, runLoad]);

  const close = useCallback((): void => {
    beginListRequest();
    publish(CLOSED_STATE);
  }, [beginListRequest, publish]);

  const loadPreview = useCallback(
    async (sessionId: string): Promise<void> => {
      const current = publishedRef.current;
      const target = current.target;
      if (target === null || current.state !== "ready") return;
      if (!isExternalAgentSessionId(sessionId)) return;
      const summary = current.snapshot.sessions.find((session) => session.sessionId === sessionId);
      if (summary === undefined) return;

      const key = providerSessionKey(summary.provider, sessionId);
      const cached = current.previews.get(key);
      if (cached?.kind === "loaded" || cached?.kind === "loading") {
        publish({ ...current, activePreviewKey: key });
        return;
      }

      const authority = authorityForTarget(dependenciesRef.current.projects, target);
      if (authority === null) {
        failLoad(dependenciesRef, publish, target, EXTERNAL_SESSIONS_OWNER_LOST_NOTICE);
        return;
      }
      const project = projectByRootKey(dependenciesRef.current.projects, target.rootKey);
      if (project === undefined) {
        failLoad(dependenciesRef, publish, target, EXTERNAL_SESSIONS_OWNER_LOST_NOTICE);
        return;
      }

      previewGenerationRef.current += 1;
      const previewGeneration = previewGenerationRef.current;
      const listGeneration = listGenerationRef.current;
      publish({
        ...current,
        activePreviewKey: key,
        previews: withPreview(current.previews, key, { kind: "loading" }),
      });

      const loaded = await attempt(() =>
        dependenciesRef.current.externalSessionGateway.previewExternalSession({
          provider: summary.provider,
          sessionId,
          projectRoot: project.rootPath,
          repositoryRoot: summary.cwd,
        }),
      );
      if (!mountedRef.current) return;
      if (previewGenerationRef.current !== previewGeneration) return;
      if (listGenerationRef.current !== listGeneration) return;
      if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, target.repositoryRoot)) {
        failLoad(dependenciesRef, publish, target, EXTERNAL_SESSIONS_OWNER_LOST_NOTICE);
        return;
      }

      const entry = previewEntryFor(dependenciesRef, loaded);
      publish({
        ...publishedRef.current,
        previews: withPreview(publishedRef.current.previews, key, entry),
      });
    },
    [publish],
  );

  const sessions = useMemo(
    () => decorateSessions(published.snapshot.sessions, published.target, dependencies.threads),
    [dependencies.threads, published.snapshot.sessions, published.target],
  );

  const activeEntry =
    published.activePreviewKey === null
      ? undefined
      : published.previews.get(published.activePreviewKey);

  const preview = activeEntry?.kind === "loaded" ? activeEntry.preview : null;
  const previewPending = activeEntry?.kind === "loading";

  return useMemo(
    () => ({
      state: published.state,
      target: published.target,
      sessions,
      skipped: published.snapshot.skipped,
      truncated: published.snapshot.truncated,
      preview,
      previewPending,
      importPending: dependencies.importPending ?? false,
      open,
      reload,
      close,
      loadPreview,
    }),
    [
      close,
      dependencies.importPending,
      loadPreview,
      open,
      preview,
      previewPending,
      published.snapshot.skipped,
      published.snapshot.truncated,
      published.state,
      published.target,
      reload,
      sessions,
    ],
  );
}

interface DependenciesRef {
  readonly current: ExternalSessionsDependencies;
}

function failLoad(
  dependenciesRef: DependenciesRef,
  publish: (next: PublishedState) => void,
  target: ExternalSessionsTarget,
  reason: string,
): void {
  dependenciesRef.current.setNotice(warning(reason));
  publish({ ...CLOSED_STATE, state: "failed", target, reason });
}

function previewEntryFor(
  dependenciesRef: DependenciesRef,
  loaded:
    | { readonly ok: true; readonly value: ExternalAgentSessionPreview }
    | {
        readonly ok: false;
        readonly error: unknown;
      },
): PreviewEntry {
  if (loaded.ok) return { kind: "loaded", preview: loaded.value };
  dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, loaded.error);
  dependenciesRef.current.setNotice(warning(EXTERNAL_SESSION_PREVIEW_FAILED_NOTICE));
  return { kind: "failed", reason: EXTERNAL_SESSION_PREVIEW_FAILED_NOTICE };
}

function authorityForTarget(
  projects: ReadonlyArray<AgentProjectDescriptor>,
  target: ExternalSessionsTarget,
): AgentProjectAuthority | null {
  const project = projectByRootKey(projects, target.rootKey);
  if (project === undefined) return null;
  if (
    !project.repositories.some((repository) => repository.repositoryRoot === target.repositoryRoot)
  )
    return null;
  return projectAuthority(project);
}

function decorateSessions(
  summaries: ReadonlyArray<ExternalAgentSessionSummary>,
  target: ExternalSessionsTarget | null,
  threads: ReadonlyMap<string, AgentThread>,
): ReadonlyArray<ExternalAgentSessionView> {
  if (target === null) return [];
  const imported = importedThreadIds(threads);
  return summaries.map((summary) => ({
    ...summary,
    alreadyImportedThreadId:
      imported.get(repositorySessionKey(summary.cwd, summary.provider, summary.sessionId)) ?? null,
  }));
}

function importedThreadIds(threads: ReadonlyMap<string, AgentThread>): ReadonlyMap<string, string> {
  const imported = new Map<string, string>();
  for (const thread of threads.values()) {
    const origin = thread.externalOrigin;
    if (origin !== null) {
      imported.set(
        repositorySessionKey(thread.owner.repositoryRoot, origin.provider, origin.sessionId),
        thread.threadId,
      );
    }
    const sessionId = thread.provider.sessionId;
    if (sessionId === null) continue;
    const identity = repositorySessionKey(
      thread.owner.repositoryRoot,
      thread.provider.kind,
      sessionId,
    );
    if (imported.has(identity)) continue;
    imported.set(identity, thread.threadId);
  }
  return imported;
}

function repositorySessionKey(
  repositoryRoot: string,
  provider: AgentCliKind,
  sessionId: string,
): string {
  return `${repositoryRoot}:${providerSessionKey(provider, sessionId)}`;
}

function providerSessionKey(provider: AgentCliKind, sessionId: string): string {
  return `${provider}:${sessionId}`;
}

function withPreview(
  previews: ReadonlyMap<string, PreviewEntry>,
  key: string,
  entry: PreviewEntry,
): ReadonlyMap<string, PreviewEntry> {
  const next = new Map(previews);
  next.delete(key);
  next.set(key, entry);
  while (next.size > MAX_EXTERNAL_SESSION_PREVIEW_CACHE) {
    const oldest = next.keys().next();
    if (oldest.done === true) break;
    next.delete(oldest.value);
  }
  return next;
}

function retainPreviews(
  previews: ReadonlyMap<string, PreviewEntry>,
  listed: ReadonlySet<string>,
): ReadonlyMap<string, PreviewEntry> {
  const retained = [...previews].filter(([key]) => listed.has(key));
  if (retained.length === previews.size) return previews;
  return new Map(retained);
}

function retainActivePreview(
  activePreviewKey: string | null,
  listed: ReadonlySet<string>,
): string | null {
  if (activePreviewKey === null) return null;
  if (!listed.has(activePreviewKey)) return null;
  return activePreviewKey;
}
