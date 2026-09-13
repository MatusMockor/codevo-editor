import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { AgentAttachment } from "../domain/agentAttachment";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import type { RemoteRunnerGateway, RemoteRunnerTask } from "../domain/remoteRunner";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import { RemoteAttachmentStore } from "./remoteAttachmentStore";
import { useAgentAttachmentImages } from "./useAgentAttachmentImages";
import {
  useAgentComposerAttachments,
  type AgentAttachmentOwner,
} from "./useAgentComposerAttachments";
import {
  loadRemoteTaskAttachments,
  readRemoteAttachment,
  type RemoteAttachmentRegistry,
} from "./remoteAttachmentHistory";

export interface RemoteAgentAttachmentsDependencies {
  readonly gateway: RemoteRunnerGateway | null;
  readonly imageSurface: AgentImageSurfacePort | null;
  readonly resolveOwner: (projectRootKey: string) => AgentAttachmentOwner | null;
  readonly resolveServer: (threadId: string) => string | null;
  readonly reportError: (source: string, error: unknown) => void;
}

export function useRemoteAgentAttachments(dependencies: RemoteAgentAttachmentsDependencies) {
  const current = useRef(dependencies);
  const mounted = useRef(true);
  const registry = useRef<RemoteAttachmentRegistry>(new Map());
  useLayoutEffect(() => {
    current.current = dependencies;
  });
  const ownerIsCurrent = useMemo(
    () =>
      (owner: AgentAttachmentOwner): boolean => {
        const candidate = current.current.resolveOwner(owner.projectRootKey);
        return (
          mounted.current &&
          candidate !== null &&
          candidate.projectRootKey === owner.projectRootKey &&
          candidate.ownerId === owner.ownerId &&
          candidate.generation === owner.generation &&
          candidate.workspaceId === owner.workspaceId
        );
      },
    [],
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
    mounted.current = true;
    return () => {
      mounted.current = false;
      store.clear();
      registry.current.clear();
    };
  }, [store]);
  const imagesGateway = useMemo<AgentAttachmentGateway>(
    () => ({
      stageAgentAttachmentBytes: (request) => store.stageAgentAttachmentBytes(request),
      stageAgentAttachmentFromPath: (request) => store.stageAgentAttachmentFromPath(request),
      inspectAgentAttachmentCandidate: (request) => store.inspectAgentAttachmentCandidate(request),
      readAgentAttachmentCandidate: (request) => store.readAgentAttachmentCandidate(request),
      claimAgentAttachments: (request) => store.claimAgentAttachments(request),
      releaseAgentAttachment: (request) => store.releaseAgentAttachment(request),
      revealAgentAttachment: (request) => store.revealAgentAttachment(request),
      readAgentAttachment: (request) =>
        readRemoteAttachment(registry.current, request, {
          gateway: current.current.gateway,
          ownerIsCurrent,
          isGatewayCurrent: (gateway) => current.current.gateway === gateway,
          resolveServer: (threadId) => current.current.resolveServer(threadId),
        }),
    }),
    [store, ownerIsCurrent],
  );
  const attachments = useAgentComposerAttachments({ ...dependencies, gateway: store });
  const attachmentImages = useAgentAttachmentImages({
    gateway: imagesGateway,
    reportError: dependencies.reportError,
  });
  const lastGateway = useRef(dependencies.gateway);
  useLayoutEffect(() => {
    const invalidWorkspaces = new Set<string>();
    const gatewayChanged = lastGateway.current !== dependencies.gateway;
    lastGateway.current = dependencies.gateway;
    for (const [key, entry] of registry.current) {
      if (gatewayChanged || !ownerIsCurrent(entry.owner)) {
        invalidWorkspaces.add(entry.owner.workspaceId);
        registry.current.delete(key);
      }
    }
    for (const workspaceId of invalidWorkspaces) attachmentImages.releaseWorkspace(workspaceId);
    if (gatewayChanged) {
      attachments.clear();
      store.clear();
    }
  });
  return {
    attachments: {
      ...attachments,
      markSent: (draftIds: readonly string[]) => {
        for (const draft of attachments.drafts) {
          if (draftIds.includes(draft.draftId) && draft.attachmentId !== null) {
            void store.releaseAgentAttachment({
              workspaceId:
                dependencies.resolveOwner(attachments.projectRootKey ?? "")?.workspaceId ?? "",
              attachmentId: draft.attachmentId,
            });
          }
        }
        attachments.markSent(draftIds);
      },
    },
    attachmentImages,
    resolve: store.resolve.bind(store),
    loadTaskAttachments: (
      task: RemoteRunnerTask,
      serverId: string,
      owner: AgentAttachmentOwner,
    ): Promise<readonly AgentAttachment[]> =>
      loadRemoteTaskAttachments(
        registry.current,
        task,
        serverId,
        owner,
        current.current.gateway,
        ownerIsCurrent,
        (gateway) => current.current.gateway === gateway,
      ),
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
