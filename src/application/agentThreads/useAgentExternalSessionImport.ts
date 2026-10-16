import { useCallback, useEffect, useRef } from "react";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentCliKind } from "../../domain/agentTask";
import {
  normalizeAgentThreadTitle,
  runningTurn,
  type AgentThread,
  type AgentThreadsState,
} from "../../domain/agentThread";
import { agentThreadAutoTitle } from "../../domain/agentThreadAutoTitle";
import { normalizeAgentCliKind } from "../../domain/agentSettings";
import { isExternalAgentSessionId } from "../../domain/externalAgentSession";
import type { ExternalSessionImportGateway } from "../../domain/externalSessionImport";
import { attempt, info, projectByRootKey, warning } from "../agentProjectAuthority";
import type { AgentProviderAdmissionAuthorityReader } from "../agentProviderAdmissionAuthority";
import type {
  AgentTasksNotice,
  AgentThreadStoreGateway,
  AgentThreadStoreSurface,
  ExternalSessionImportRequest,
  ExternalSessionImportResult,
} from "../agentThreadPorts";
import {
  mintUnusedId,
  usedTurnIds,
  type AgentTurnAdmissionDependencies,
} from "../agentTurnAdmission";
import { importSavedSessionHistory } from "../importSavedSessionHistory";

export const IMPORT_INVALID_SESSION_NOTICE =
  "This terminal session id is not valid, so it cannot be imported.";
export const IMPORT_PROVIDER_MISMATCH_NOTICE =
  "This session was recorded by a different agent CLI, so it cannot be imported here.";
export const IMPORT_CLI_NOT_CONFIGURED_NOTICE =
  "Configure the agent CLI before importing a terminal session.";
export const IMPORT_PROJECT_UNAVAILABLE_NOTICE =
  "This project is not available, so the session cannot be imported.";
export const IMPORT_DUPLICATE_NOTICE = "This session is already imported.";
export const IMPORT_STORE_NOT_READY_NOTICE =
  "Saved threads are still loading for this project, so the session was not imported. Try again.";
const IMPORT_ID_MINT_FAILED_NOTICE = "A thread id could not be minted. Try again.";

export interface AgentExternalSessionImportInput {
  readonly store: AgentThreadStoreSurface;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly importGateway: ExternalSessionImportGateway | undefined;
  readonly agentThreadStoreGateway: AgentThreadStoreGateway;
  readonly launchIdentityForProject: AgentTurnAdmissionDependencies["launchIdentityForProject"];
  readonly getAgentCliKind: () => AgentCliKind;
  readonly getAgentProviderAdmissionAuthority: AgentProviderAdmissionAuthorityReader;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly now?: () => number;
  readonly createEntropyHex4?: () => string;
}

export function useAgentExternalSessionImport(
  input: AgentExternalSessionImportInput,
): (request: ExternalSessionImportRequest) => Promise<ExternalSessionImportResult | null> {
  const {
    store,
    projects,
    importGateway,
    agentThreadStoreGateway,
    launchIdentityForProject,
    getAgentCliKind,
    getAgentProviderAdmissionAuthority,
    reportError,
    setNotice,
    now: clock,
    createEntropyHex4,
  } = input;
  const { currentState, dispatchAction, loadedRootKeys } = store;
  const importAuthorityRef = useRef({ projects, store });
  importAuthorityRef.current = { projects, store };
  const importMounted = useRef(true);
  useEffect(() => {
    importMounted.current = true;
    return () => {
      importMounted.current = false;
    };
  }, []);

  return useCallback(
    async (request: ExternalSessionImportRequest): Promise<ExternalSessionImportResult | null> => {
      if (!isExternalAgentSessionId(request.sessionId)) {
        setNotice(warning(IMPORT_INVALID_SESSION_NOTICE));
        return null;
      }
      const project = projectByRootKey(projects, request.projectRootKey);
      if (
        project === undefined ||
        project.origin === "closed-tab-live-tasks" ||
        (project.rootPath !== request.repositoryRoot &&
          !project.repositories.some(
            (repository) => repository.repositoryRoot === request.repositoryRoot,
          ))
      ) {
        setNotice(warning(IMPORT_PROJECT_UNAVAILABLE_NOTICE));
        return null;
      }
      const identity = launchIdentityForProject(project.rootKey);
      if (identity === null) {
        setNotice(warning(IMPORT_PROJECT_UNAVAILABLE_NOTICE));
        return null;
      }
      if (!loadedRootKeys.has(project.rootKey)) {
        setNotice(warning(IMPORT_STORE_NOT_READY_NOTICE));
        return null;
      }
      const owned = () => {
        const current = importAuthorityRef.current.projects.find(
          (entry) => entry.rootKey === project.rootKey,
        );
        return (
          importMounted.current &&
          current?.generation === project.generation &&
          current?.ownerId === project.ownerId
        );
      };
      const finishImport = async (
        threadId: string,
        alreadyImported: boolean,
      ): Promise<ExternalSessionImportResult | null> => {
        if (importGateway === undefined) {
          setNotice(alreadyImported ? info(IMPORT_DUPLICATE_NOTICE) : null);
          return { threadId, alreadyImported };
        }
        const current = () =>
          owned() && importAuthorityRef.current.store.currentState().threads.has(threadId);
        const existing = importAuthorityRef.current.store.currentState().threads.get(threadId);
        // A running imported turn already passed the durable save barrier before launch.
        const saved =
          alreadyImported && existing !== undefined && runningTurn(existing) !== null
            ? true
            : await store.flushThread?.(threadId);
        if (!current()) return null;
        if (saved !== true) {
          setNotice(
            warning("The imported conversation could not be saved. Retry the import to continue."),
          );
          return null;
        }
        const imported = await attempt(() =>
          importSavedSessionHistory(
            importGateway,
            {
              rootKey: project.rootKey,
              ownerId: agentRootOwnerId(project.rootKey),
              threadId,
            },
            current,
          ),
        );
        if (!current()) return null;
        if (!imported.ok) {
          reportError("Session import", imported.error);
          setNotice(
            warning(
              "The session history could not be fully imported. Retry to continue from the saved progress.",
            ),
          );
          return null;
        }
        setNotice(
          imported.value.truncated
            ? warning(
                "The session was imported, but some source records were incomplete or exceeded the supported record size.",
              )
            : null,
        );
        return { threadId, alreadyImported };
      };
      const state = currentState();
      const existing = importedThreadFor(state, request);
      if (existing !== null) {
        return finishImport(existing.threadId, true);
      }
      const findImport = agentThreadStoreGateway.findAgentHistoryImport;
      if (findImport !== undefined) {
        const found = await attempt(() =>
          findImport.call(agentThreadStoreGateway, {
            rootKey: project.rootKey,
            ownerId: agentRootOwnerId(project.rootKey),
            provider: request.provider,
            sessionId: request.sessionId,
            repositoryRoot: request.repositoryRoot,
          }),
        );
        if (!owned()) return null;
        if (!found.ok) {
          reportError("Session import", found.error);
          setNotice(warning("Saved sessions could not be checked. Retry the import."));
          return null;
        }
        if (found.value !== null) {
          const restored = await store.restoreThread?.({
            ...found.value,
            owner: { ...found.value.owner, ownerId: identity.workspaceId },
          });
          if (!owned() || restored !== true) return null;
          return finishImport(found.value.threadId, true);
        }
      }
      if (request.provider !== normalizeAgentCliKind(getAgentCliKind())) {
        setNotice({
          kind: "warning",
          message: IMPORT_PROVIDER_MISMATCH_NOTICE,
          action: "configure-agent-cli",
        });
        return null;
      }
      if (getAgentProviderAdmissionAuthority(request.provider).disposition.kind !== "ready") {
        setNotice({
          kind: "warning",
          message: IMPORT_CLI_NOT_CONFIGURED_NOTICE,
          action: "configure-agent-cli",
        });
        return null;
      }
      const usedIds = new Set([...currentState().threads.keys(), ...usedTurnIds(currentState())]);
      const threadId = mintUnusedId({ now: clock, createEntropyHex4 }, usedIds);
      if (threadId === null) {
        setNotice(warning(IMPORT_ID_MINT_FAILED_NOTICE));
        return null;
      }
      const createdAt = (clock ?? Date.now)();
      const thread: AgentThread = {
        threadId,
        owner: {
          rootKey: project.rootKey,
          ownerId: identity.workspaceId,
          repositoryRoot: request.repositoryRoot,
        },
        target: { isolation: "in-place", worktreePath: null },
        provider: { kind: request.provider, sessionId: request.sessionId },
        title:
          normalizeAgentThreadTitle(request.title) ?? agentThreadAutoTitle(request.firstPrompt),
        pinned: false,
        archived: false,
        createdAtEpochMs: createdAt,
        updatedAtEpochMs: createdAt,
        turns: [],
        turnsTruncated: false,
        integration: null,
        viewedAtEpochMs: createdAt,
        externalOrigin: {
          provider: request.provider,
          sessionId: request.sessionId,
          importedAtEpochMs: createdAt,
        },
      };
      const reserve = store.reserveThreadSlot;
      const release =
        reserve === undefined ? () => undefined : await reserve(threadId, thread.owner);
      if (release === null) {
        if (owned())
          setNotice(warning("Save an existing conversation before importing another session."));
        return null;
      }
      try {
        if (!owned()) return null;
        dispatchAction({ kind: "threadCreated", thread });
        if (!currentState().threads.has(threadId)) return null;
        return await finishImport(threadId, false);
      } finally {
        release();
      }
    },
    [
      clock,
      createEntropyHex4,
      currentState,
      dispatchAction,
      getAgentCliKind,
      getAgentProviderAdmissionAuthority,
      launchIdentityForProject,
      importGateway,
      agentThreadStoreGateway,
      store,
      reportError,
      loadedRootKeys,
      projects,
      setNotice,
    ],
  );
}

function importedThreadFor(
  state: AgentThreadsState,
  request: ExternalSessionImportRequest,
): AgentThread | null {
  for (const thread of state.threads.values()) {
    if (thread.owner.repositoryRoot !== request.repositoryRoot) continue;
    if (
      thread.provider.kind === request.provider &&
      thread.provider.sessionId === request.sessionId
    ) {
      return thread;
    }
    const origin = thread.externalOrigin;
    if (origin === null) continue;
    if (origin.provider === request.provider && origin.sessionId === request.sessionId) {
      return thread;
    }
  }
  return null;
}
