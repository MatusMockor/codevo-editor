import { useCallback, useMemo } from "react";
import { agentProjectOwnsOwner, type AgentProjectDescriptor } from "../../domain/agentProject";
import type { AgentImageSurfacePort } from "../../domain/agentImageShrink";
import type { AgentThread } from "../../domain/agentThread";
import type { AgentAttachmentGateway } from "../agentAttachmentPorts";
import type { AgentInlineImageGateway } from "../agentInlineImagePorts";
import { AGENT_TASKS_SOURCE, attempt, projectByRootKey } from "../agentProjectAuthority";
import { createAgentQuestionAttachmentsPort } from "../agentQuestionAttachments";
import type { AgentThreadStoreSurface, AgentThreadsSurface } from "../agentThreadPorts";
import type { AgentTurnAdmissionDependencies } from "../agentTurnAdmission";
import { useAgentAttachmentImages } from "../useAgentAttachmentImages";
import {
  useAgentComposerAttachments,
  type AgentAttachmentOwner,
} from "../useAgentComposerAttachments";
import { useAgentInlineImages } from "../useAgentInlineImages";

export interface AgentThreadAttachmentsInput {
  readonly store: AgentThreadStoreSurface;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly attachmentGateway: AgentAttachmentGateway | null;
  readonly imageSurface: AgentImageSurfacePort | null;
  readonly inlineImageGateway: AgentInlineImageGateway | null;
  readonly launchIdentityForProject: AgentTurnAdmissionDependencies["launchIdentityForProject"];
  readonly reportError: (source: string, error: unknown) => void;
}

export type AgentThreadAttachmentsSurface = Pick<
  AgentThreadsSurface,
  "attachments" | "attachmentImages" | "inlineImages" | "questionAttachments" | "revealAttachment"
>;

export function useAgentThreadAttachments(
  input: AgentThreadAttachmentsInput,
): AgentThreadAttachmentsSurface {
  const {
    store,
    projects,
    attachmentGateway,
    imageSurface,
    inlineImageGateway,
    launchIdentityForProject: resolveLaunchIdentity,
    reportError,
  } = input;
  const resolveAttachmentOwner = useCallback(
    (projectRootKey: string): AgentAttachmentOwner | null => {
      const project = projectByRootKey(projects, projectRootKey);
      if (project === undefined || project.origin === "closed-tab-live-tasks") return null;
      const identity = resolveLaunchIdentity(projectRootKey);
      if (identity === null) return null;
      return {
        projectRootKey,
        ownerId: project.ownerId,
        generation: project.generation,
        workspaceId: identity.workspaceId,
      };
    },
    [projects, resolveLaunchIdentity],
  );

  const attachments = useAgentComposerAttachments({
    gateway: attachmentGateway,
    imageSurface,
    resolveOwner: resolveAttachmentOwner,
    reportError,
  });

  const attachmentImages = useAgentAttachmentImages({
    gateway: attachmentGateway,
    reportError,
  });

  const inlineImages = useAgentInlineImages({
    gateway: inlineImageGateway,
  });

  const attachmentDrafts = attachments.forDraft;
  const attachmentRevision = attachments.revision;
  const questionAttachments = useMemo(
    () =>
      attachmentGateway === null || attachmentRevision === undefined
        ? undefined
        : createAgentQuestionAttachmentsPort({
            gateway: attachmentGateway,
            forDraft: attachmentDrafts,
            resolveThreadRootKey: (threadId) => {
              const thread = store.currentState().threads.get(threadId);
              if (thread === undefined || !ownsThread(projects, thread)) return null;
              return thread.owner.rootKey;
            },
          }),
    [attachmentGateway, attachmentDrafts, attachmentRevision, projects, store],
  );

  const revealAttachment = useCallback(
    async (threadId: string, attachmentId: string): Promise<void> => {
      const thread = store.currentState().threads.get(threadId);
      if (thread === undefined || attachmentGateway === null) return;
      if (!ownsThread(projects, thread)) return;
      const revealed = await attempt(() =>
        attachmentGateway.revealAgentAttachment({
          workspaceId: thread.owner.ownerId,
          threadId,
          attachmentId,
        }),
      );
      if (revealed.ok) return;
      reportError(AGENT_TASKS_SOURCE, revealed.error);
    },
    [attachmentGateway, projects, reportError, store],
  );

  return { attachments, attachmentImages, inlineImages, questionAttachments, revealAttachment };
}

function ownsThread(projects: ReadonlyArray<AgentProjectDescriptor>, thread: AgentThread): boolean {
  return projects.some((project) => agentProjectOwnsOwner(project, thread.owner));
}
