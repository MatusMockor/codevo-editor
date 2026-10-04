import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AgentImageOutputPolicy, AgentImageSurfacePort } from "../domain/agentImageShrink";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentAttachmentGateway, StoredAgentAttachmentRequest } from "./agentAttachmentPorts";
import { RemoteAttachmentStore } from "./remoteAttachmentStore";
import { useAgentAttachmentImages } from "./useAgentAttachmentImages";
import {
  useAgentComposerAttachments,
  type AgentAttachmentOwner,
} from "./useAgentComposerAttachments";
import {
  createRemoteAttachmentEpoch,
  loadRemoteTaskAttachments,
  presentRemoteAttachmentError,
  readRemoteAttachment,
  remoteAttachmentBlocker,
  remoteAttachmentDisplayId,
  remoteAttachmentErrorRecovery,
  remoteAttachmentImageMime,
  RemoteAttachmentUnavailableError,
  reviseRemoteAttachments,
  sameAttachmentOwner,
  type RemoteAttachmentReadAuthority,
  type RemoteAttachmentRegistry,
  type RemoteAttachmentRetention,
  type RemoteTaskAttachments,
} from "./remoteAttachmentHistory";
import {
  forgetRemoteAttachmentRetries,
  recordRemoteAttachmentFailure,
  recoverRemoteAttachmentRetries,
  settleRemoteAttachmentRetry,
  type RemoteAttachmentRetries,
} from "./remoteAttachmentRetry";

export interface RemoteAgentAttachmentsDependencies {
  readonly gateway: RemoteRunnerGateway | null;
  readonly imageSurface: AgentImageSurfacePort | null;
  readonly resolveOwner: (projectRootKey: string) => AgentAttachmentOwner | null;
  readonly resolveRetainedOwner: (projectRootKey: string) => AgentAttachmentOwner | null;
  readonly resolveServer: (threadId: string) => string | null;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface RemoteAttachmentHistoryLoad extends RemoteTaskAttachments {
  readonly epoch: number;
}

interface SharedLoad {
  readonly promise: Promise<RemoteAttachmentHistoryLoad>;
  readonly validEpoch: () => number;
}

type RevisedAuthority = Pick<
  RemoteAgentAttachmentsDependencies,
  "gateway" | "resolveOwner" | "resolveRetainedOwner"
>;

const REMOTE_IMAGE_OUTPUT_POLICY: AgentImageOutputPolicy = {
  maxBytes: 5 * 1024 * 1024,
  maxDimension: 8192,
  acceptedMimes: ["image/png", "image/jpeg"],
  encodeMime: "image/jpeg",
};
const MAX_SHARED_LOADS = 64;
const REVOKED: RemoteAttachmentRetention = {
  ownerIsRetained: () => false,
  ownerIsCurrent: () => false,
};

function sameRevisedAuthority(left: RevisedAuthority | null, right: RevisedAuthority): boolean {
  return (
    left !== null &&
    left.gateway === right.gateway &&
    left.resolveOwner === right.resolveOwner &&
    left.resolveRetainedOwner === right.resolveRetainedOwner
  );
}

function loadKey(task: RemoteRunnerTask, serverId: string, owner: AgentAttachmentOwner): string {
  const parts = task.parts.flatMap((part) =>
    part.type === "attachment" ? [remoteAttachmentDisplayId(part.attachmentId)] : [],
  );
  return [
    owner.generation,
    owner.ownerId,
    owner.workspaceId,
    serverId,
    task.runnerId,
    task.conversationId ?? task.id,
    ...parts,
  ].join("\0");
}

export function useRemoteAgentAttachments(dependencies: RemoteAgentAttachmentsDependencies) {
  const current = useRef(dependencies);
  const mounted = useRef(true);
  const registry = useRef<RemoteAttachmentRegistry>(new Map());
  const retries = useRef<RemoteAttachmentRetries>(new Map());
  const loads = useRef(new Map<string, SharedLoad>());
  const [registryEpoch] = useState(createRemoteAttachmentEpoch);
  const epoch = useSyncExternalStore(registryEpoch.subscribe, registryEpoch.read);
  useLayoutEffect(() => {
    current.current = dependencies;
  });
  const ownerIsCurrent = useMemo(
    () =>
      (owner: AgentAttachmentOwner): boolean => {
        const candidate = current.current.resolveOwner(owner.projectRootKey);
        return mounted.current && candidate !== null && sameAttachmentOwner(candidate, owner);
      },
    [],
  );
  const retention = useMemo<RemoteAttachmentRetention>(
    () => ({
      ownerIsCurrent,
      ownerIsRetained: (owner) => {
        const candidate = current.current.resolveRetainedOwner(owner.projectRootKey);
        return mounted.current && candidate !== null && sameAttachmentOwner(candidate, owner);
      },
    }),
    [ownerIsCurrent],
  );
  const readAuthority = useMemo(
    () => (): RemoteAttachmentReadAuthority => ({
      gateway: current.current.gateway,
      ownerIsCurrent,
      isGatewayCurrent: (gateway) => current.current.gateway === gateway,
      isWorkspaceConnected: (workspaceId) => current.current.resolveOwner(workspaceId) !== null,
      resolveServer: (threadId) => current.current.resolveServer(threadId),
    }),
    [ownerIsCurrent],
  );
  const store = useMemo(
    () =>
      new RemoteAttachmentStore({
        getGateway: () => current.current.gateway,
        resolveOwner: (workspaceId) => current.current.resolveOwner(workspaceId),
        ownerIsCurrent,
      }),
    [ownerIsCurrent],
  );
  useEffect(() => {
    const ownedRegistry = registry.current;
    const ownedRetries = retries.current;
    const ownedLoads = loads.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      store.clear();
      ownedRegistry.clear();
      ownedRetries.clear();
      ownedLoads.clear();
    };
  }, [store]);
  const readAttachment = useCallback(
    async (request: StoredAgentAttachmentRequest): Promise<ArrayBuffer> => {
      try {
        const bytes = await readRemoteAttachment(registry.current, request, readAuthority());
        settleRemoteAttachmentRetry(retries.current, request);
        return bytes;
      } catch (error) {
        recordRemoteAttachmentFailure(retries.current, request, error);
        throw error;
      }
    },
    [readAuthority],
  );
  const imagesGateway = useMemo<AgentAttachmentGateway>(
    () => ({
      stageAgentAttachmentBytes: (request) => store.stageAgentAttachmentBytes(request),
      inspectAgentAttachmentCandidate: (request) => store.inspectAgentAttachmentCandidate(request),
      readAgentAttachmentCandidate: (request) => store.readAgentAttachmentCandidate(request),
      claimAgentAttachments: (request) => store.claimAgentAttachments(request),
      releaseAgentAttachment: (request) => store.releaseAgentAttachment(request),
      revealAgentAttachment: (request) => store.revealAgentAttachment(request),
      readAgentAttachment: readAttachment,
    }),
    [store, readAttachment],
  );
  const attachments = useAgentComposerAttachments({
    ...dependencies,
    gateway: store,
    imageOutputPolicy: REMOTE_IMAGE_OUTPUT_POLICY,
    sentAttachmentDisposition: "release",
  });
  const reportImageError = useCallback((source: string, error: unknown): void => {
    if (remoteAttachmentErrorRecovery(error) === "whenReady") return;
    current.current.reportError(source, error);
  }, []);
  const attachmentImages = useAgentAttachmentImages({
    gateway: imagesGateway,
    reportError: reportImageError,
    presentError: presentRemoteAttachmentError,
  });
  const lastGateway = useRef(dependencies.gateway);
  const revised = useRef<RevisedAuthority | null>(null);
  useLayoutEffect(() => {
    const gatewayChanged = lastGateway.current !== dependencies.gateway;
    lastGateway.current = dependencies.gateway;
    if (!sameRevisedAuthority(revised.current, dependencies)) {
      revised.current = {
        gateway: dependencies.gateway,
        resolveOwner: dependencies.resolveOwner,
        resolveRetainedOwner: dependencies.resolveRetainedOwner,
      };
      const invalidated = reviseRemoteAttachments(
        registry.current,
        gatewayChanged ? REVOKED : retention,
      );
      forgetRemoteAttachmentRetries(retries.current, invalidated);
      for (const workspaceId of invalidated) attachmentImages.releaseWorkspace(workspaceId);
      if (invalidated.size > 0) registryEpoch.advance();
    }
    if (gatewayChanged) {
      retries.current.clear();
      loads.current.clear();
      attachmentImages.releaseAll();
      attachments.clearAll?.();
      store.clear();
    }
    const recovered = recoverRemoteAttachmentRetries(retries.current, (request) =>
      remoteAttachmentBlocker(registry.current, request, readAuthority()),
    );
    for (const request of recovered) {
      const mime = remoteAttachmentImageMime(registry.current, request);
      if (mime !== null) attachmentImages.retry({ ...request, mime });
    }
  });
  const loadTaskAttachments = useCallback(
    (
      task: RemoteRunnerTask,
      serverId: string,
      owner: AgentAttachmentOwner,
      startedEpoch: number,
    ): Promise<RemoteAttachmentHistoryLoad> => {
      const key = loadKey(task, serverId, owner);
      const shared = loads.current.get(key);
      if (shared !== undefined && shared.validEpoch() === startedEpoch) return shared.promise;
      let validEpoch = startedEpoch;
      let straddled = false;
      const onEvicted = (): void => {
        straddled ||= registryEpoch.read() !== validEpoch;
        registryEpoch.advance();
        validEpoch = registryEpoch.read();
      };
      const settle = (): void => {
        if (loads.current.get(key)?.promise === load) loads.current.delete(key);
      };
      const run = async (): Promise<RemoteAttachmentHistoryLoad> => {
        if (registryEpoch.read() !== startedEpoch)
          throw new RemoteAttachmentUnavailableError("notLoaded");
        const loaded = await loadRemoteTaskAttachments(registry.current, task, serverId, owner, {
          gateway: current.current.gateway,
          ownerIsCurrent,
          isGatewayCurrent: (gateway) => current.current.gateway === gateway,
          onEvicted,
        });
        if (straddled || registryEpoch.read() !== validEpoch)
          throw new RemoteAttachmentUnavailableError("notLoaded");
        return { ...loaded, epoch: validEpoch };
      };
      const load = run();
      if (loads.current.size >= MAX_SHARED_LOADS && !loads.current.has(key)) return load;
      loads.current.set(key, { promise: load, validEpoch: () => validEpoch });
      void load.then(settle, settle);
      return load;
    },
    [ownerIsCurrent, registryEpoch],
  );
  return {
    attachments,
    attachmentImages,
    epoch,
    resolve: store.resolve.bind(store),
    loadTaskAttachments,
    reveal: (_threadId: string, _attachmentId: string): void => {
      current.current.reportError(
        "Agent tasks",
        new Error(
          "Server attachments can be previewed here, but cannot be revealed in the local file browser.",
        ),
      );
    },
  };
}
