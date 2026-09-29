import type { AgentComposerAttachmentDraft } from "../../application/useAgentComposerAttachments";
import type { AgentTurnAttachmentView } from "./agentTurnAttachmentPresentation";

export const MAX_AGENT_PENDING_SENDS = 16;

export type AgentPendingSendTarget =
  | { readonly kind: "followUp"; readonly threadId: string; readonly baseTurnId: string | null }
  | { readonly kind: "new"; readonly projectRootKey: string };

export interface AgentPendingSendAttachment {
  readonly view: AgentTurnAttachmentView;
  readonly previewUrl: string | null;
}

export interface AgentPendingSend {
  readonly id: number;
  readonly target: AgentPendingSendTarget;
  readonly prompt: string;
  readonly attachments: ReadonlyArray<AgentPendingSendAttachment>;
  readonly sentAtEpochMs: number;
  readonly status: "sending" | "failed";
}

export type AgentPendingSends = ReadonlyArray<AgentPendingSend>;

export type AgentPendingSendOutcome = "sent" | "failed" | "withdrawn";

export type AgentPendingSendAction =
  | { readonly kind: "begin"; readonly send: AgentPendingSend }
  | { readonly kind: "settle"; readonly id: number; readonly outcome: AgentPendingSendOutcome }
  | { readonly kind: "dismiss"; readonly id: number };

export type AgentPendingSendSelection =
  | { readonly kind: "thread"; readonly threadId: string; readonly lastTurnId: string | null }
  | { readonly kind: "new"; readonly projectRootKey: string };

export function reduceAgentPendingSends(
  state: AgentPendingSends,
  action: AgentPendingSendAction,
): AgentPendingSends {
  switch (action.kind) {
    case "begin": {
      const key = targetKey(action.send.target);
      const kept = state.filter(
        (entry) => entry.status === "sending" || targetKey(entry.target) !== key,
      );
      return [...kept, action.send].slice(-MAX_AGENT_PENDING_SENDS);
    }
    case "settle":
      if (!state.some((entry) => entry.id === action.id)) return state;
      if (action.outcome !== "failed") return state.filter((entry) => entry.id !== action.id);
      return state.map((entry) =>
        entry.id === action.id ? { ...entry, status: "failed" as const } : entry,
      );
    case "dismiss":
      if (!state.some((entry) => entry.id === action.id)) return state;
      return state.filter((entry) => entry.id !== action.id);
    default:
      return unsupportedAction(action);
  }
}

export function agentPendingSendFor(
  state: AgentPendingSends,
  selection: AgentPendingSendSelection | null,
): AgentPendingSend | null {
  if (selection === null) return null;
  for (let index = state.length - 1; index >= 0; index -= 1) {
    const entry = state[index];
    if (entry !== undefined && pendingSendMatches(entry.target, selection)) return entry;
  }
  return null;
}

export function agentPendingSendAttachments(
  drafts: ReadonlyArray<AgentComposerAttachmentDraft>,
): ReadonlyArray<AgentPendingSendAttachment> {
  return drafts.map(pendingSendAttachment);
}

function pendingSendAttachment(draft: AgentComposerAttachmentDraft): AgentPendingSendAttachment {
  if (
    draft.kind === "image" &&
    draft.previewUrl !== null &&
    draft.attachmentId !== null &&
    draft.mime !== null
  ) {
    return {
      view: {
        kind: "image",
        key: draft.draftId,
        name: draft.name,
        attachmentId: draft.attachmentId,
        mime: draft.mime,
        ...(draft.width === null ? {} : { width: draft.width }),
        ...(draft.height === null ? {} : { height: draft.height }),
      },
      previewUrl: draft.previewUrl,
    };
  }
  return {
    view: { kind: "chip", key: draft.draftId, name: draft.name, glyph: draft.kind },
    previewUrl: null,
  };
}

function pendingSendMatches(
  target: AgentPendingSendTarget,
  selection: AgentPendingSendSelection,
): boolean {
  if (target.kind === "followUp") {
    return (
      selection.kind === "thread" &&
      selection.threadId === target.threadId &&
      selection.lastTurnId === target.baseTurnId
    );
  }
  return selection.kind === "new" && selection.projectRootKey === target.projectRootKey;
}

function targetKey(target: AgentPendingSendTarget): string {
  return target.kind === "followUp"
    ? JSON.stringify(["followUp", target.threadId])
    : JSON.stringify(["new", target.projectRootKey]);
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported pending send action: ${JSON.stringify(action)}`);
}
