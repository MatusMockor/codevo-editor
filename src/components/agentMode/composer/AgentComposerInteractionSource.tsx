import { useContext, useLayoutEffect, useMemo, useState } from "react";
import { AgentThreadRequestDeliveryLedger } from "../../../application/agentThreadRequestDeliveryLedger";
import type { AgentQuestionApprovalGateway } from "../../../application/agentApprovalPorts";
import {
  localAgentThreadRequestResponder,
  remoteAgentThreadRequestResponder,
  type AgentThreadRequestResponder,
} from "../../../application/agentThreadRequestResponders";
import type { AgentThreadRequestFeed } from "../../../application/agentThreadRequestPorts";
import { remoteAgentThreadRequestControl } from "../../../application/unifiedAgentThreadRequestFeed";
import { useAgentThreadPendingRequests } from "../../../application/useAgentThreadPendingRequests";
import type { AgentThreadRequestClosure } from "../../../application/useAgentThreadRuntimeRequests";
import type { AgentRuntimeRequest } from "../../../domain/agentRuntimeRequest";
import { AgentThreadRequestFeedContext } from "../agentThreadRequestFeedContext";
import {
  AgentThreadRequestDeliveriesContext,
  AgentThreadRequestsScopeContext,
  type AgentThreadRequestsScopeValue,
} from "../agentThreadRequestsScopeContext";
import {
  AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE,
  pickAgentComposerInteraction,
  type AgentComposerInteraction,
  type AgentComposerQuestionAttachmentTarget,
} from "./agentComposerInteraction";

export interface AgentComposerInteractionSourceProps {
  readonly gateway: AgentQuestionApprovalGateway | null;
  readonly threadId: string | null;
  readonly questionAttachments?: AgentComposerQuestionAttachmentTarget;
  onChange(interaction: AgentComposerInteraction | null): void;
}

const NO_QUESTION_ATTACHMENTS: AgentComposerQuestionAttachmentTarget = {
  kind: "unavailable",
  reason: AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE,
};
const NO_OPEN_REQUESTS: readonly AgentRuntimeRequest[] = Object.freeze([]);
const NO_CLOSURE: AgentThreadRequestClosure = Object.freeze({
  closed: NO_OPEN_REQUESTS,
  listedTurnIds: new Set<string>(),
});

export function AgentComposerInteractionSource({
  gateway,
  onChange,
  threadId,
  questionAttachments = NO_QUESTION_ATTACHMENTS,
}: AgentComposerInteractionSourceProps) {
  const feed = useContext(AgentThreadRequestFeedContext);
  const shared = useContext(AgentThreadRequestsScopeContext);
  const provided = useContext(AgentThreadRequestDeliveriesContext);
  const [fallback] = useState(() => new AgentThreadRequestDeliveryLedger());
  const owned = shared !== null && shared.threadId === threadId ? shared : null;
  const ownerKey = owned === null ? null : JSON.stringify([owned.threadId, owned.scopeKey]);
  const responder = useResponder(feed, gateway, owned);
  const pending = useAgentThreadPendingRequests({
    ledger: provided ?? fallback,
    ownerKey,
    open: owned?.requests.open ?? NO_OPEN_REQUESTS,
    closure: owned?.requests.closure ?? NO_CLOSURE,
    responder,
    reachable: owned?.reachable ?? false,
  });
  const attachmentKind = questionAttachments.kind;
  const attachmentSubject = questionAttachmentSubject(questionAttachments);
  const attachments = useMemo(
    () => questionAttachmentTarget(attachmentKind, attachmentSubject),
    [attachmentKind, attachmentSubject],
  );
  const { items, respond } = pending;
  const grant = owned?.remote === true ? "turn" : "session";
  const interaction = useMemo(
    () => pickAgentComposerInteraction({ requests: items, attachments, grant, respond }),
    [attachments, grant, items, respond],
  );
  useLayoutEffect(() => {
    onChange(interaction);
  }, [interaction, onChange]);
  useLayoutEffect(() => () => onChange(null), [onChange]);
  return null;
}

function useResponder(
  feed: AgentThreadRequestFeed | null,
  gateway: AgentQuestionApprovalGateway | null,
  owned: AgentThreadRequestsScopeValue | null,
): AgentThreadRequestResponder | null {
  const scope = owned?.scope ?? null;
  const remote = owned?.remote ?? false;
  return useMemo(() => {
    if (scope === null) return null;
    if (remote) {
      const control = remoteAgentThreadRequestControl(feed);
      return control === null ? null : remoteAgentThreadRequestResponder(control, scope);
    }
    if (gateway === null || scope.workspaceId === null) return null;
    return localAgentThreadRequestResponder(gateway, scope.workspaceId);
  }, [feed, gateway, remote, scope]);
}

function questionAttachmentSubject(target: AgentComposerQuestionAttachmentTarget): string {
  switch (target.kind) {
    case "thread":
      return target.threadId;
    case "unavailable":
      return target.reason;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

function questionAttachmentTarget(
  kind: AgentComposerQuestionAttachmentTarget["kind"],
  subject: string,
): AgentComposerQuestionAttachmentTarget {
  switch (kind) {
    case "thread":
      return { kind, threadId: subject };
    case "unavailable":
      return { kind, reason: subject };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}
