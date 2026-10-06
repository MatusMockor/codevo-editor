import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  advanceAgentComposerDraftLineage,
  agentComposerDraftIdentityEqual,
  agentComposerDraftIdentityKey,
  NO_AGENT_COMPOSER_DRAFT,
  openAgentComposerDraftLineage,
  type AgentComposerDraftCarry,
  type AgentComposerDraftIdentity,
  type AgentComposerDraftLineage,
} from "../domain/agentComposerDraftLineage";
import { carryAgentAttachmentDrafts } from "./agentAttachmentCarry";
import { agentDraftDispatchKey, agentThreadDispatchKey } from "./agentDispatchKeys";
import { remoteAgentProjectServerId } from "./remoteAgentProjection";
import type { AgentComposerAttachmentsSurface } from "./useAgentComposerAttachments";

type DraftScopes = (draftKey: string) => AgentComposerAttachmentsSurface;

export interface AgentComposerDraftLineageOptions {
  readonly threadId: string | null;
  readonly projectRootKey: string | null;
  readonly requestedRootKey: string | null;
  readonly navigation: number;
  readonly attachments: AgentComposerAttachmentsSurface;
}

export interface AgentComposerDraftLineageView {
  readonly draftKey: string | null;
  readonly carry: AgentComposerDraftCarry | null;
  readonly held: boolean;
  readonly attachments: AgentComposerAttachmentsSurface;
}

interface Handover {
  readonly from: string;
  readonly scopes: DraftScopes | null;
}

interface LineageState {
  readonly lineage: AgentComposerDraftLineage;
  readonly natural: AgentComposerDraftIdentity;
  readonly navigation: number;
  readonly origin: DraftScopes | null;
  readonly handover: Handover | null;
}

export function agentComposerDraftIdentity(
  threadId: string | null,
  projectRootKey: string | null,
  requestedRootKey: string | null = null,
): AgentComposerDraftIdentity {
  if (threadId !== null) return { kind: "thread", key: agentThreadDispatchKey(threadId) };
  if (projectRootKey === null && requestedRootKey === null) return NO_AGENT_COMPOSER_DRAFT;
  if (projectRootKey === null) return { kind: "none", requested: requestedRootKey };
  return {
    kind: "new",
    key: agentDraftDispatchKey(projectRootKey),
    machine: remoteAgentProjectServerId(projectRootKey),
  };
}

export function useAgentComposerDraftLineage({
  attachments,
  navigation,
  projectRootKey,
  requestedRootKey,
  threadId,
}: AgentComposerDraftLineageOptions): AgentComposerDraftLineageView {
  const natural = agentComposerDraftIdentity(threadId, projectRootKey, requestedRootKey);
  const scopes = attachments.forDraft ?? null;
  const committedScopes = useRef(scopes);
  const [state, setState] = useState<LineageState>(() => ({
    lineage: openAgentComposerDraftLineage(natural),
    natural,
    navigation,
    origin: null,
    handover: null,
  }));
  let current = state;
  if (!agentComposerDraftIdentityEqual(state.natural, natural) || state.navigation !== navigation) {
    current = advanceLineageState(state, natural, navigation, committedScopes.current);
    setState(current);
  }
  useLayoutEffect(() => {
    committedScopes.current = scopes;
  });

  const draftKey = agentComposerDraftIdentityKey(current.lineage.presented);
  const heldScopes = current.lineage.hold === "released" ? null : current.origin;
  const held = current.lineage.hold !== "released";
  const handover = current.handover;
  useLayoutEffect(() => {
    if (handover === null || draftKey === null || projectRootKey === null) return;
    carryAgentAttachmentDrafts(
      handover.scopes?.(handover.from) ?? null,
      scopes?.(draftKey) ?? null,
      projectRootKey,
    );
  }, [handover, draftKey, projectRootKey, scopes]);

  const carriedFrom = current.lineage.carriedFrom;
  const carry = useMemo<AgentComposerDraftCarry | null>(
    () => (carriedFrom === null || draftKey === null ? null : { from: carriedFrom, to: draftKey }),
    [carriedFrom, draftKey],
  );

  return {
    draftKey,
    carry,
    held,
    attachments: presentedAttachments(attachments, held ? heldScopes : scopes, draftKey),
  };
}

function presentedAttachments(
  attachments: AgentComposerAttachmentsSurface,
  scopes: DraftScopes | null,
  draftKey: string | null,
): AgentComposerAttachmentsSurface {
  if (draftKey === null) return attachments;
  return scopes?.(draftKey) ?? attachments;
}

function advanceLineageState(
  state: LineageState,
  natural: AgentComposerDraftIdentity,
  navigation: number,
  previousScopes: DraftScopes | null,
): LineageState {
  const lineage = advanceAgentComposerDraftLineage(
    state.lineage,
    natural,
    state.navigation === navigation ? "environment" : "navigation",
  );
  const origin = state.lineage.hold === "released" ? previousScopes : state.origin;
  const carriedFrom =
    agentComposerDraftIdentityKey(lineage.presented) ===
    agentComposerDraftIdentityKey(state.lineage.presented)
      ? null
      : lineage.carriedFrom;
  return {
    lineage,
    natural,
    navigation,
    origin: lineage.hold === "released" ? null : origin,
    handover: carriedFrom === null ? null : { from: carriedFrom, scopes: origin },
  };
}
