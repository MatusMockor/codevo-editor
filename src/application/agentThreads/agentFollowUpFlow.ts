import { runningTurn } from "../../domain/agentThread";
import { resumePlanSessionId } from "../../domain/agentSessionIdentity";
import {
  isCurrentThreadLaunchAuthority,
  launchAuthorityHolds,
  threadLaunchAuthorityLoss,
  warning,
} from "../agentProjectAuthority";
import type { AgentFollowUpRequest } from "../agentThreadPorts";
import {
  AGENT_FOLLOW_UP_NOT_PREPARED_NOTICE,
  admitFollowUp,
  mintUnusedId,
  providerAdmissionHolds,
  usedTurnIds,
} from "../agentTurnAdmission";
import { prepareTurnAttachments, type ClaimedTurnAttachments } from "../agentTurnAttachments";
import { agentDispatchClaimNotice, agentThreadDispatchKey } from "../agentDispatchKeys";
import { inspectFollowUpRestart, refuseFollowUpBeforeStart } from "../useAgentFollowUpRestart";
import { followUpStartedNotice } from "../agentTurnSessionReports";
import {
  turnAttachmentAuthority,
  type AgentTurnDispatchContext,
} from "./agentTurnDispatchContract";

export async function sendAgentFollowUp(
  context: AgentTurnDispatchContext,
  request: AgentFollowUpRequest,
  isCurrent: () => boolean = () => true,
  claimed?: ClaimedTurnAttachments,
): Promise<boolean> {
  const { dependenciesRef, mountedRef } = context;
  context.restartRefusals.forget(request.threadId);
  let deps = dependenciesRef.current;
  const candidate = deps.store.state.threads.get(request.threadId);
  if (
    candidate !== undefined &&
    !candidate.archived &&
    runningTurn(candidate) === null &&
    deps.launchIdentityForProject(candidate.owner.rootKey) === null &&
    deps.ensureProjectLaunchIdentity !== undefined
  ) {
    if (context.preparingThreads.has(candidate.threadId)) {
      deps.setNotice(warning("This thread is already preparing to continue."));
      return false;
    }
    context.preparingThreads.add(candidate.threadId);
    try {
      await deps.ensureProjectLaunchIdentity(candidate.owner.rootKey);
    } finally {
      context.preparingThreads.delete(candidate.threadId);
    }
    deps = dependenciesRef.current;
  }
  if (!isCurrent()) return false;
  const admitted = admitFollowUp(
    deps,
    request,
    context.inFlightThreads,
    context.sessionContinuity.resumePlan,
  );
  if (admitted === null) return false;
  const {
    thread,
    previousOwnerId,
    authority,
    projectRoot,
    prompt,
    providerAuthority,
    resumePlan,
    launch,
  } = admitted;
  const resumeSessionId = resumePlanSessionId(resumePlan);
  const repositoryRoot = thread.owner.repositoryRoot;
  if (previousOwnerId !== thread.owner.ownerId) {
    deps.store.dispatchAction({
      kind: "ownerRebound",
      threadId: thread.threadId,
      previousOwnerId,
      owner: thread.owner,
    });
  }
  const reboundThread = deps.store.currentState().threads.get(thread.threadId);
  if (reboundThread?.owner.ownerId !== thread.owner.ownerId) {
    deps.setNotice(warning(AGENT_FOLLOW_UP_NOT_PREPARED_NOTICE));
    return false;
  }
  const turnId = mintUnusedId(
    deps,
    new Set([...usedTurnIds(deps.store.state), ...context.mintedIds]),
  );
  if (turnId === null) {
    deps.setNotice(warning("A turn id could not be minted. Try again."));
    return false;
  }
  const dispatchKey = agentThreadDispatchKey(reboundThread.threadId);
  const claim = context.claimDispatch(dispatchKey);
  if (claim !== "claimed") {
    deps.setNotice(warning(agentDispatchClaimNotice(claim)));
    return false;
  }
  context.mintedIds.add(turnId);
  context.inFlightThreads.add(reboundThread.threadId);
  context.beginPendingTurn(reboundThread.provider.kind);
  const surfaceIsCurrent = (): boolean =>
    isCurrent() && isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority);
  const launchHolds = (): boolean =>
    isCurrent() &&
    launchAuthorityHolds(
      dependenciesRef,
      threadLaunchAuthorityLoss(dependenciesRef, mountedRef, authority),
      authority.rootKey,
    );
  const stillCurrent = (): boolean =>
    launchHolds() &&
    providerAdmissionHolds(dependenciesRef.current, providerAuthority, surfaceIsCurrent);
  try {
    const [flushed, verdict] = await Promise.all([
      deps.store.flushThread?.(reboundThread.threadId),
      inspectFollowUpRestart(deps, reboundThread, { ...request, launch }),
    ]);
    if (!stillCurrent()) return false;
    if (flushed === false) {
      dependenciesRef.current.setNotice(warning(AGENT_FOLLOW_UP_NOT_PREPARED_NOTICE));
      return false;
    }
    if (verdict === "confirm") {
      refuseFollowUpBeforeStart(
        dependenciesRef.current,
        context.restartRefusals,
        reboundThread.threadId,
      );
      return false;
    }
    const prepared =
      claimed ??
      (await prepareTurnAttachments(
        {
          ...dependenciesRef.current,
          setNotice: (notice) => {
            if (
              isCurrent() &&
              isCurrentThreadLaunchAuthority(dependenciesRef, mountedRef, authority)
            )
              dependenciesRef.current.setNotice(notice);
          },
        },
        request,
        turnAttachmentAuthority(authority),
        reboundThread.threadId,
        prompt,
      ));
    if (prepared === null || !stillCurrent()) return false;
    const followedUp = await context.runTurnStart({
      isCurrent,
      startedNotice: followUpStartedNotice(resumePlan, prepared.notice),
      authority,
      authorityScope: "thread",
      projectRoot,
      threadId: reboundThread.threadId,
      repositoryRoot,
      cwd: reboundThread.target.worktreePath ?? repositoryRoot,
      isolation: reboundThread.target.isolation,
      worktreePath: reboundThread.target.worktreePath,
      prompt: prepared.prompt,
      attachments: prepared.attachments,
      attachmentReferences: prepared.references,
      turnId,
      agentCliKind: reboundThread.provider.kind,
      providerAuthority,
      resumeSessionId,
      launch,
      ...(request.sessionRestart === undefined ? {} : { sessionRestart: request.sessionRestart }),
      createdWorktree: null,
      registration: "before-start",
      onSessionRestartRefused: () => {
        if (isCurrent()) context.restartRefusals.refuse(reboundThread.threadId, turnId);
      },
      register: (turn) => {
        context.registerStream(reboundThread, turn.turnId, resumeSessionId, turn.codexTransport);
        dependenciesRef.current.store.dispatchAction({
          kind: "turnStarted",
          threadId: reboundThread.threadId,
          turn,
        });
      },
    });
    return followedUp;
  } finally {
    context.endPendingTurn(reboundThread.provider.kind);
    context.mintedIds.delete(turnId);
    context.inFlightThreads.delete(reboundThread.threadId);
    context.releaseDispatch(dispatchKey);
  }
}
