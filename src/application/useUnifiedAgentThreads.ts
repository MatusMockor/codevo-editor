import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentAttachment } from "../domain/agentAttachment";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../domain/remoteRunner";
import type { AgentThreadsSurface, AgentThreadView } from "./agentThreadPorts";
import type { AgentAttachmentOwner } from "./useAgentComposerAttachments";
import {
  RemoteAgentProjection,
  remoteAgentProjectKey,
  remoteAgentThreadKey,
} from "./remoteAgentProjection";
import { useRemoteHistorySearchPort } from "./useRemoteHistorySearchPort";
import { useRemoteAgentInventory } from "./useRemoteAgentInventory";
import { useRemotePendingMessages } from "./useRemotePendingMessages";
import { useRemoteAgentMutations } from "./useRemoteAgentMutations";
import { useRemoteAgentAttachments } from "./useRemoteAgentAttachments";
import { useRemoteAgentMetadata, type RemoteAgentMetadataRepository } from "./remoteAgentMetadata";
import {
  isRemoteAgentIdentity,
  remoteAgentNotice,
  remoteAgentThreadActions,
} from "./remoteAgentSurface";
import { useRemoteAgentStableSurface } from "./useRemoteAgentStableSurface";
import { useRemoteAgentChanges } from "./useRemoteAgentChanges";
import { useRemoteAgentImages } from "./useRemoteAgentImages";

export interface UnifiedAgentThreadsOptions {
  readonly local: AgentThreadsSurface;
  readonly gateway: RemoteRunnerGateway | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly selectedServerId: string | null;
  readonly workspaceOwner: string | null;
  readonly selectedThreadId: string | null;
  readonly selectedProjectRootKey?: string | null;
  readonly localProjects: readonly AgentProjectDescriptor[];
  readonly metadataRepository?: RemoteAgentMetadataRepository;
  readonly imageSurface?: AgentImageSurfacePort | null;
}

/** Keeps one original editor surface; connection identities choose execution adapters only. */
export function useUnifiedAgentThreads(options: UnifiedAgentThreadsOptions) {
  const {
    local,
    gateway,
    servers,
    selectedServerId,
    workspaceOwner,
    selectedThreadId,
    localProjects,
    selectedProjectRootKey = null,
  } = options;
  const configuration = JSON.stringify(servers);
  const authority = useRef({
    gateway,
    workspaceOwner,
    configuration,
    selectedServerId,
    selectedThreadId,
    selectedProjectRootKey,
    generation: 1,
  });
  if (
    authority.current.gateway !== gateway ||
    authority.current.workspaceOwner !== workspaceOwner ||
    authority.current.configuration !== configuration ||
    authority.current.selectedServerId !== selectedServerId ||
    authority.current.selectedThreadId !== selectedThreadId ||
    authority.current.selectedProjectRootKey !== selectedProjectRootKey
  ) {
    authority.current = {
      gateway,
      workspaceOwner,
      configuration,
      selectedServerId,
      selectedThreadId,
      selectedProjectRootKey,
      generation:
        authority.current.generation +
        Number(
          authority.current.gateway !== gateway ||
            authority.current.workspaceOwner !== workspaceOwner ||
            authority.current.configuration !== configuration,
        ),
    };
  }
  const owner = authority.current;
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const valid = useCallback(
    (captured: object) => mounted.current && authority.current === captured,
    [],
  );
  const [noticeState, setNotice] = useState<{ owner: object; message: string } | null>(null);
  const notice = noticeState?.owner === owner ? noticeState.message : null;
  const report = useCallback(
    (message: string) => {
      if (valid(owner)) setNotice({ owner, message });
    },
    [owner, valid],
  );
  const reportError = useCallback(
    (_source: string, error: unknown) =>
      report(error instanceof Error ? error.message : "The server operation failed."),
    [report],
  );
  const inventory = useRemoteAgentInventory({ gateway, servers, workspaceOwner, selectedThreadId });
  const metadata = useRemoteAgentMetadata(options.metadataRepository);
  const projectTargets = useMemo(() => {
    const result = new Map<
      string,
      { serverId: string; runnerId: string; projectId: string; connected: boolean }
    >();
    for (const snapshot of inventory.snapshots) {
      if (snapshot.descriptor === null) continue;
      for (const project of snapshot.projects) {
        result.set(
          remoteAgentProjectKey(snapshot.serverId, snapshot.descriptor.runnerId, project.id),
          {
            serverId: snapshot.serverId,
            runnerId: snapshot.descriptor.runnerId,
            projectId: project.id,
            connected:
              snapshot.connected &&
              servers.some((server) => server.id === snapshot.serverId && server.connected),
          },
        );
      }
    }
    return result;
  }, [inventory.snapshots, servers]);
  const resolveOwner = useCallback(
    (projectRootKey: string): AgentAttachmentOwner | null => {
      const target = projectTargets.get(projectRootKey);
      return !target?.connected
        ? null
        : {
            projectRootKey,
            ownerId: projectRootKey,
            workspaceId: projectRootKey,
            generation: owner.generation,
          };
    },
    [projectTargets, owner],
  );
  const taskServers = useMemo(() => {
    const result = new Map<string, string>();
    for (const snapshot of inventory.snapshots)
      for (const task of snapshot.tasks) {
        result.set(
          remoteAgentThreadKey(snapshot.serverId, task.runnerId, task.conversationId ?? task.id),
          snapshot.serverId,
        );
      }
    return result;
  }, [inventory.snapshots]);
  const resolveServer = useCallback(
    (threadId: string) => taskServers.get(threadId) ?? null,
    [taskServers],
  );
  const remoteAttachments = useRemoteAgentAttachments({
    gateway,
    imageSurface: options.imageSurface ?? null,
    resolveOwner,
    resolveServer,
    reportError,
  });
  const attachmentPort = useRef(remoteAttachments);
  attachmentPort.current = remoteAttachments;
  const [attachmentState, setAttachmentState] = useState<{
    owner: object;
    values: ReadonlyMap<string, readonly AgentAttachment[]>;
  }>({ owner, values: new Map() });
  const attachmentValues = useMemo(
    () =>
      attachmentState.owner === owner
        ? attachmentState.values
        : new Map<string, readonly AgentAttachment[]>(),
    [attachmentState, owner],
  );
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      for (const snapshot of inventory.snapshots)
        for (const task of snapshot.tasks) {
          if (
            remoteAgentThreadKey(
              snapshot.serverId,
              task.runnerId,
              task.conversationId ?? task.id,
            ) !== selectedThreadId ||
            task.projectId === undefined ||
            !task.parts.some((part) => part.type === "attachment")
          )
            continue;
          const key = `${snapshot.serverId}\u0000${task.id}`;
          if (attachmentValues.has(key)) continue;
          const attachmentOwner = resolveOwner(
            remoteAgentProjectKey(snapshot.serverId, task.runnerId, task.projectId),
          );
          if (attachmentOwner === null) continue;
          try {
            const attachments = await attachmentPort.current.loadTaskAttachments(
              task,
              snapshot.serverId,
              attachmentOwner,
            );
            if (disposed || !valid(owner)) return;
            setAttachmentState((previous) => {
              const values = new Map(previous.owner === owner ? previous.values : []);
              values.set(key, attachments);
              while (values.size > 512) values.delete(values.keys().next().value!);
              return { owner, values };
            });
          } catch (error) {
            if (!disposed && valid(owner)) reportError("remote-attachments", error);
          }
        }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, [
    inventory.snapshots,
    selectedThreadId,
    owner,
    resolveOwner,
    valid,
    reportError,
    attachmentValues,
  ]);
  const projections = useRef(new Map<string, RemoteAgentProjection>());
  const projectMetadata = metadata.project;
  const projected = useMemo(() => {
    const views: AgentThreadView[] = [];
    const nextProjections = new Map<string, RemoteAgentProjection>();
    const errors = new Map<string, string>();
    for (const snapshot of inventory.snapshots) {
      if (snapshot.descriptor === null) continue;
      const key = `${snapshot.serverId}\u0000${snapshot.descriptor.runnerId}`;
      const projector = projections.current.get(key)?.fork() ?? new RemoteAgentProjection();
      nextProjections.set(key, projector);
      const attachmentsByTask = new Map<string, readonly AgentAttachment[]>();
      for (const task of snapshot.tasks) {
        const attachments = attachmentValues.get(`${snapshot.serverId}\u0000${task.id}`);
        if (attachments) attachmentsByTask.set(task.id, attachments);
      }
      try {
        for (const view of projector.project({
          ...snapshot,
          runnerId: snapshot.descriptor.runnerId,
          pendingMessagesSupported: snapshot.descriptor.capabilities.pendingMessages === true,
          interactiveQuestionsSupported:
            snapshot.descriptor.capabilities.interactiveQuestions === true,
          attachmentsByTask,
        })) {
          const presented = projectMetadata(view);
          if (presented) views.push(presented);
        }
      } catch (failure) {
        errors.set(
          snapshot.serverId,
          failure instanceof Error
            ? failure.message
            : "Remote conversation history is unavailable.",
        );
      }
    }
    return { views, errors, nextProjections };
  }, [inventory.snapshots, projectMetadata, attachmentValues]);
  useLayoutEffect(() => {
    projections.current = projected.nextProjections;
  }, [projected]);
  const remoteById = useMemo(
    () => new Map(projected.views.map((view) => [view.thread.threadId, view])),
    [projected.views],
  );
  const mutations = useRemoteAgentMutations({
    gateway,
    owner,
    valid,
    publish: inventory.publishTask,
    report,
    resolveAttachments: remoteAttachments.resolve,
  });
  const pendingMessages = useRemotePendingMessages({
    gateway,
    owner,
    valid,
    snapshots: inventory.snapshots,
    views: remoteById,
    resolveAttachments: remoteAttachments.resolve,
    publish: inventory.publishPending,
    refresh: inventory.refresh,
    report,
  });
  const deferredFollowUps = useMemo(
    () => new Map([...local.deferredFollowUps, ...pendingMessages.deferred]),
    [local.deferredFollowUps, pendingMessages.deferred],
  );
  const targetForThread = (id: string) => {
    const target = remoteById.get(id)?.execution;
    if (
      !target ||
      !servers.some((server) => server.id === target.serverId && server.connected) ||
      !inventory.snapshots.some(
        (snapshot) =>
          snapshot.serverId === target.serverId &&
          snapshot.connected &&
          snapshot.descriptor?.runnerId === target.runnerId,
      )
    ) {
      report("Reconnect this conversation's server to continue.");
      return null;
    }
    return target;
  };
  const remoteChanges = useRemoteAgentChanges({
    gateway,
    owner,
    valid,
    report,
    resolveTarget: (id) => {
      const target = remoteById.get(id)?.execution;
      return target &&
        inventory.snapshots.some(
          (snapshot) =>
            snapshot.serverId === target.serverId &&
            snapshot.connected &&
            snapshot.descriptor?.runnerId === target.runnerId &&
            snapshot.descriptor.capabilities.taskFileDiffs === true,
        )
        ? target
        : null;
    },
  });
  const actions = remoteAgentThreadActions({
    local,
    threads: projected.views,
    report,
    update: metadata.update,
    stop: async (id) => {
      const target = targetForThread(id);
      if (target) await mutations.stop(target);
    },
  });
  const selectedRemote = selectedThreadId === null ? null : remoteById.get(selectedThreadId);
  const remoteMode =
    selectedThreadId === null ? selectedServerId !== null : isRemoteAgentIdentity(selectedThreadId);
  const effectiveServerId = selectedRemote?.execution?.serverId ?? selectedServerId;
  const serverReady =
    servers.some((server) => server.id === effectiveServerId && server.connected) &&
    inventory.snapshots.some(
      (snapshot) =>
        snapshot.serverId === effectiveServerId &&
        snapshot.connected &&
        snapshot.descriptor?.capabilities.taskExecution &&
        snapshot.descriptor.capabilities.taskLaunchOptions === true,
    );
  const projects = useMemo(
    () => [
      ...localProjects,
      ...inventory.snapshots.flatMap((snapshot) =>
        snapshot.descriptor === null
          ? []
          : snapshot.projects.map((project): AgentProjectDescriptor => {
              const rootKey = remoteAgentProjectKey(
                snapshot.serverId,
                snapshot.descriptor!.runnerId,
                project.id,
              );
              return {
                rootKey,
                rootPath: rootKey,
                ownerId: rootKey,
                label: project.name,
                generation: owner.generation,
                trust: "trusted",
                origin: snapshot.serverId === selectedServerId ? "active-tab" : "background-tab",
                repositories: [
                  {
                    repositoryRoot: rootKey,
                    repositoryRelativePath: "",
                    mapping: { rootRelativePath: "" },
                  },
                ],
                isolationPolicy: snapshot.descriptor!.capabilities.taskIsolation
                  ? "in-place"
                  : "worktree",
                leaseToken: null,
              };
            }),
      ),
    ],
    [localProjects, inventory.snapshots, selectedServerId, owner],
  );
  const threads = useMemo(
    () =>
      [
        ...local.threads,
        ...projected.views.map((view) =>
          remoteChanges.summaries.has(view.thread.threadId)
            ? { ...view, changeSummary: remoteChanges.summaries.get(view.thread.threadId)! }
            : view,
        ),
      ].sort(
        (a, b) =>
          Number(b.thread.pinned) - Number(a.thread.pinned) ||
          b.thread.updatedAtEpochMs - a.thread.updatedAtEpochMs,
      ),
    [local.threads, projected.views, remoteChanges.summaries],
  );
  const attachmentImages = useRemoteAgentImages(
    local.attachmentImages,
    remoteAttachments.attachmentImages,
  );
  const remoteError =
    projected.errors.get(effectiveServerId ?? "") ??
    metadata.persistenceError ??
    inventory.snapshots.find((snapshot) => snapshot.serverId === effectiveServerId)?.error ??
    null;
  const historySearch = useRemoteHistorySearchPort({
    gateway,
    servers,
    workspaceOwner,
    views: threads,
  });
  const agents: AgentThreadsSurface = {
    ...local,
    historySearch,
    ...actions,
    showChanges: async (id) => {
      if (isRemoteAgentIdentity(id)) await remoteChanges.showChanges(id);
      else await local.showChanges(id);
    },
    hideChanges: (id) => {
      if (isRemoteAgentIdentity(id)) remoteChanges.hideChanges(id);
      else local.hideChanges(id);
    },
    showFileDiff: async (id, change) => {
      if (isRemoteAgentIdentity(id)) await remoteChanges.showFileDiff(id, change);
      else await local.showFileDiff(id, change);
    },
    hideFileDiff: (id) => {
      if (isRemoteAgentIdentity(id)) remoteChanges.hideFileDiff(id);
      else local.hideFileDiff(id);
    },
    openChangedFileDiff: async (id, change) => {
      if (isRemoteAgentIdentity(id)) await remoteChanges.showFileDiff(id, change);
      else await local.openChangedFileDiff(id, change);
    },
    threads,
    repositories: projects.flatMap((project) => project.repositories),
    attachments: remoteMode ? remoteAttachments.attachments : local.attachments,
    attachmentImages,
    revealAttachment: async (threadId, attachmentId) => {
      if (isRemoteAgentIdentity(threadId)) await remoteAttachments.reveal(threadId, attachmentId);
      else await local.revealAttachment(threadId, attachmentId);
    },
    externalHistory: {
      states: local.externalHistory?.states ?? new Map(),
      load: async (id) => {
        if (isRemoteAgentIdentity(id)) await inventory.refresh();
        else await local.externalHistory?.load(id);
      },
    },
    notice: remoteMode
      ? notice !== null
        ? remoteAgentNotice(notice)
        : remoteError !== null
          ? remoteAgentNotice(remoteError)
          : null
      : local.notice,
    deferredFollowUps,
    removeDeferredFollowUp: (threadId, id) => {
      if (isRemoteAgentIdentity(threadId)) void pendingMessages.remove(threadId, id);
      else local.removeDeferredFollowUp(threadId, id);
    },
    takeDeferredFollowUp: (threadId, id) => {
      if (isRemoteAgentIdentity(threadId)) return null;
      return local.takeDeferredFollowUp(threadId, id);
    },
    resumeDeferredFollowUps: async (threadId) => {
      if (isRemoteAgentIdentity(threadId)) await pendingMessages.resume(threadId);
      else await local.resumeDeferredFollowUps?.(threadId);
    },
    dispatching: local.dispatching || mutations.busy || pendingMessages.busy,
    agentCliConfigured: remoteMode ? serverReady : local.agentCliConfigured,
    agentCliKind: selectedRemote?.thread.provider.kind ?? local.agentCliKind,
    agentCliVersion: remoteMode ? null : local.agentCliVersion,
    liveTaskCount: remoteMode
      ? projected.views.filter(
          (view) => view.execution?.serverId === effectiveServerId && view.lifecycle === "running",
        ).length
      : local.liveTaskCount,
    maxConcurrentAgentTasks: remoteMode ? 64 : local.maxConcurrentAgentTasks,
    lastUsedLaunch: (key) => (isRemoteAgentIdentity(key) ? null : local.lastUsedLaunch(key)),
    isolationPreview: (root, key) =>
      isRemoteAgentIdentity(key ?? root)
        ? {
            repositoryRoot: root,
            repositoryStatus: { kind: "ready" },
            recommended: projects.some(
              (project) =>
                project.rootKey === (key ?? root) && project.isolationPolicy === "in-place",
            )
              ? { kind: "in-place" }
              : { kind: "worktree", reason: "policy" },
            inPlaceGuard: { kind: "safe" },
            inPlaceAllowed: projects.some(
              (project) =>
                project.rootKey === (key ?? root) && project.isolationPolicy === "in-place",
            ),
            confirmationKey: null,
          }
        : local.isolationPreview(root, key),
    refreshIsolationStatus: async (root, key) => {
      if (!isRemoteAgentIdentity(key ?? root)) return local.refreshIsolationStatus(root, key);
    },
    startThread: async (request) => {
      if (!isRemoteAgentIdentity(request.projectRootKey)) {
        if (remoteMode) {
          report("Select a project on the chosen server.");
          return null;
        }
        return local.startThread(request);
      }
      const target = projectTargets.get(request.projectRootKey);
      if (
        !target?.connected ||
        request.repositoryRoot !== request.projectRootKey ||
        target.serverId !== selectedServerId
      ) {
        report("Select an available project on the chosen server.");
        return null;
      }
      if (!serverReady) {
        report("Update this server's runner to support the selected model settings.");
        return null;
      }
      const task = await mutations.start(request, target);
      return task === null
        ? null
        : {
            threadId: remoteAgentThreadKey(
              target.serverId,
              target.runnerId,
              task.conversationId ?? task.id,
            ),
          };
    },
    sendFollowUp: async (request) => {
      if (!isRemoteAgentIdentity(request.threadId)) return local.sendFollowUp(request);
      const target = targetForThread(request.threadId);
      const view = remoteById.get(request.threadId);
      if (view?.thread.provider.kind !== request.launch.provider || view.thread.archived)
        return false;
      if (
        !inventory.snapshots.some(
          (snapshot) =>
            snapshot.serverId === target?.serverId &&
            snapshot.descriptor?.capabilities.taskLaunchOptions === true,
        )
      ) {
        report("Update this server's runner to support the selected model settings.");
        return false;
      }
      if (
        view.lifecycle === "running" ||
        (pendingMessages.deferred.get(request.threadId)?.length ?? 0) > 0
      )
        return pendingMessages.enqueue(request);
      return target !== null && (await mutations.followUp(request, target)) !== null;
    },
    steer: async (request) => {
      if (isRemoteAgentIdentity(request.threadId)) {
        if (request.delivery === "immediate") {
          report("Server messages are queued for the next turn.");
          return "kept";
        }
        return (await pendingMessages.enqueue(request)) ? "deferred" : "kept";
      }
      return local.steer(request);
    },
    importExternalSession: async (request) => {
      if (isRemoteAgentIdentity(request.projectRootKey)) {
        report("Importing server sessions is not available yet.");
        return null;
      }
      return local.importExternalSession(request);
    },
    dismissNotice: () => {
      setNotice(null);
      if (!remoteMode) local.dismissNotice();
    },
  };
  const authoritativeRemoteProjectKeys = useMemo(
    () =>
      new Set(
        inventory.snapshots.flatMap((snapshot) =>
          snapshot.connected &&
          snapshot.descriptor !== null &&
          !snapshot.inventoryTruncated &&
          snapshot.error === null &&
          !projected.errors.has(snapshot.serverId)
            ? snapshot.projects.map((project) =>
                remoteAgentProjectKey(snapshot.serverId, snapshot.descriptor!.runnerId, project.id),
              )
            : [],
        ),
      ),
    [inventory.snapshots, projected.errors],
  );
  const stableAgents = useRemoteAgentStableSurface(agents);
  return {
    agents: stableAgents,
    projects,
    authoritativeRemoteProjectKeys,
    remoteLoading: inventory.loading,
    refreshRemote: inventory.refresh,
  };
}
