import { HEAD_WORKTREE_BASE } from "../../domain/agentWorktreeBase";
import { agentThreadAutoTitle } from "../../domain/agentThreadAutoTitle";
import type { AgentThread } from "../../domain/agentThread";
import {
  AGENT_TASKS_SOURCE,
  isCurrentTaskLaunchAuthority,
  launchAuthorityHolds,
  taskLaunchAuthorityLoss,
  warning,
} from "../agentProjectAuthority";
import { notifyAgentThreadIdentified } from "../agentThreadIdentification";
import type { AgentThreadStartRequest, AgentThreadStartResult } from "../agentThreadPorts";
import {
  compensateCreatedWorktree,
  createThreadWorktree,
} from "../agentThreadWorktreeProvisioning";
import { admitPreviousWorktreeReuse, claimPreviousWorktree } from "../agentPreviousWorktreeReuse";
import type { AgentWorktreeStartLease } from "../agentWorktreeUseRegistry";
import {
  admitStart,
  ensureLease,
  mintUnusedId,
  providerAdmissionHolds,
  providerAdmissionIsCurrent,
  reportPreflight,
  usedTurnIds,
} from "../agentTurnAdmission";
import { prepareTurnAttachments, retryAttachmentThreadId } from "../agentTurnAttachments";
import { agentDispatchClaimNotice, agentDraftDispatchKey } from "../agentDispatchKeys";
import { rememberAttachmentReservation } from "../agentTurnDispatchPolicy";
import {
  turnAttachmentAuthority,
  type AgentTurnDispatchContext,
} from "./agentTurnDispatchContract";

export async function startAgentThread(
  context: AgentTurnDispatchContext,
  request: AgentThreadStartRequest,
): Promise<AgentThreadStartResult | null> {
  const { dependenciesRef, mountedRef } = context;
  const deps = dependenciesRef.current;
  const admitted = admitStart(deps, request);
  if (admitted === null) return null;
  const { authority, project, prompt, agentCliKind, providerAuthority, launch } = admitted;
  const repositoryRoot = request.repositoryRoot;
  const providerHolds = (): boolean =>
    providerAdmissionHolds(dependenciesRef.current, providerAuthority, () =>
      isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot),
    );
  const launchHolds = (): boolean =>
    launchAuthorityHolds(
      dependenciesRef,
      taskLaunchAuthorityLoss(dependenciesRef, mountedRef, authority, repositoryRoot),
      authority.rootKey,
    );
  const reuse = request.reuseWorktree ?? null;
  const reuseClaim =
    reuse === null ? null : { authority, repositoryRoot, isolation: request.isolation, reuse };
  if (reuseClaim !== null && !admitPreviousWorktreeReuse(deps, reuseClaim)) return null;
  const dispatchKey = agentDraftDispatchKey(request.projectRootKey);
  const usedIds = new Set([
    ...deps.store.state.threads.keys(),
    ...usedTurnIds(deps.store.state),
    ...context.mintedIds,
  ]);
  const threadId =
    retryAttachmentThreadId(
      context.attachmentThreads.get(dispatchKey) ?? null,
      authority,
      usedIds,
    ) ?? mintUnusedId(deps, usedIds);
  const turnId = threadId === null ? null : mintUnusedId(deps, usedIds.add(threadId));
  if (threadId === null || turnId === null) {
    deps.setNotice(warning("A thread id could not be minted. Try again."));
    return null;
  }
  const claim = context.claimDispatch(dispatchKey);
  if (claim !== "claimed") {
    deps.setNotice(warning(agentDispatchClaimNotice(claim)));
    return null;
  }
  context.mintedIds.add(threadId).add(turnId);
  context.beginPendingTurn(agentCliKind);
  notifyAgentThreadIdentified(request.onThreadIdentified, threadId, (error) =>
    dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error),
  );
  let releaseSlot: (() => void) | undefined;
  let reuseLease: AgentWorktreeStartLease | null = null;
  try {
    const leased = await ensureLease(
      deps,
      dependenciesRef,
      mountedRef,
      project,
      authority,
      repositoryRoot,
      providerHolds,
    );
    if (!launchHolds() || !leased) return null;
    if (!providerHolds()) return null;
    const admission = await deps.store.reserveThreadSlot?.(threadId, {
      rootKey: authority.rootKey,
      ownerId: authority.workspaceId,
      repositoryRoot,
    });
    if (admission === null) {
      if (isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
        dependenciesRef.current.setNotice(
          warning("A conversation could not be saved to make room. Retry after saving finishes."),
        );
      }
      return null;
    }
    releaseSlot = admission;
    if (!launchHolds() || !providerHolds()) return null;
    if (request.isolation === "in-place") {
      const preflight = await deps.preflightInPlace(
        repositoryRoot,
        authority,
        request.unsafeInPlaceConfirmationKey,
      );
      if (preflight.kind === "superseded") return null;
      if (!launchHolds() || preflight.kind === "owner-lost") return null;
      if (!providerHolds()) return null;
      if (!reportPreflight(deps, preflight)) return null;
    }
    const createdWorktree =
      request.isolation === "worktree" && reuse === null
        ? await createThreadWorktree(
            dependenciesRef,
            mountedRef,
            authority,
            repositoryRoot,
            threadId,
            request.worktreeBase ?? HEAD_WORKTREE_BASE,
          )
        : null;
    if (request.isolation === "worktree" && reuse === null && createdWorktree === null) {
      if (
        mountedRef.current &&
        providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)
      ) {
        deps.onWorktreeDispatchFailed?.();
      }
      return null;
    }
    if (!launchHolds() || !providerHolds()) {
      if (createdWorktree !== null) {
        await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, createdWorktree);
      }
      return null;
    }
    const worktreePath = createdWorktree?.receipt.worktreePath ?? reuse?.worktreePath ?? null;
    if (!providerHolds()) {
      if (createdWorktree !== null) {
        await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, createdWorktree);
      }
      return null;
    }
    if (createdWorktree !== null) {
      dependenciesRef.current.worktreeUses?.noteCreated(createdWorktree.receipt.worktreePath);
      dependenciesRef.current.onWorktreeCreated?.(
        repositoryRoot,
        createdWorktree.receipt.worktreePath,
      );
    }
    if (!providerHolds()) {
      if (createdWorktree !== null) {
        await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, createdWorktree);
      }
      return null;
    }
    const reservation = { authority, threadId };
    if (request.attachments?.some((attachment) => attachment.kind === "staged")) {
      rememberAttachmentReservation(context.attachmentThreads, dispatchKey, reservation);
    }
    const prepared = await prepareTurnAttachments(
      dependenciesRef.current,
      request,
      turnAttachmentAuthority(authority),
      threadId,
      prompt,
    );
    if (prepared === null || !launchHolds() || !providerHolds()) {
      if (createdWorktree !== null) {
        await compensateCreatedWorktree(dependenciesRef, mountedRef, authority, createdWorktree);
      }
      return null;
    }
    if (reuseClaim !== null) {
      reuseLease = claimPreviousWorktree(dependenciesRef.current, reuseClaim);
      if (reuseLease === null) return null;
    }
    const now = deps.now ?? Date.now;
    context.attachmentThreads.delete(dispatchKey);
    const started = await context.runTurnStart({
      authority,
      authorityScope: "project",
      projectRoot: admitted.project.rootPath,
      threadId,
      repositoryRoot,
      cwd: worktreePath ?? repositoryRoot,
      isolation: request.isolation,
      worktreePath,
      prompt: prepared.prompt,
      attachments: prepared.attachments,
      attachmentReferences: prepared.references,
      turnId,
      agentCliKind,
      providerAuthority,
      resumeSessionId: null,
      launch,
      createdWorktree,
      reusedWorktreePath: reuse?.worktreePath ?? null,
      registration: "after-start",
      startedNotice: prepared.notice,
      onDefiniteStartRejection: () => {
        if (isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot)) {
          rememberAttachmentReservation(context.attachmentThreads, dispatchKey, reservation);
        }
      },
      register: (turn) => {
        const createdAt = now();
        const thread: AgentThread = {
          threadId,
          owner: { rootKey: authority.rootKey, ownerId: authority.workspaceId, repositoryRoot },
          target: { isolation: request.isolation, worktreePath },
          provider: { kind: agentCliKind, sessionId: null },
          title: agentThreadAutoTitle(prompt === "" ? prepared.prompt : prompt),
          pinned: false,
          archived: false,
          createdAtEpochMs: createdAt,
          updatedAtEpochMs: createdAt,
          turns: [turn],
          turnsTruncated: false,
          integration: null,
          viewedAtEpochMs: createdAt,
          externalOrigin: null,
        };
        context.registerStream(thread, turn.turnId, null, turn.codexTransport);
        dependenciesRef.current.store.dispatchAction({ kind: "threadCreated", thread });
      },
    });
    if (
      !started &&
      request.isolation === "worktree" &&
      mountedRef.current &&
      isCurrentTaskLaunchAuthority(dependenciesRef, mountedRef, authority, repositoryRoot) &&
      providerAdmissionIsCurrent(dependenciesRef.current, providerAuthority)
    ) {
      deps.onWorktreeDispatchFailed?.();
    }
    return started ? { threadId } : null;
  } finally {
    reuseLease?.release();
    releaseSlot?.();
    context.endPendingTurn(agentCliKind);
    context.mintedIds.delete(threadId);
    context.mintedIds.delete(turnId);
    context.releaseDispatch(dispatchKey);
  }
}
