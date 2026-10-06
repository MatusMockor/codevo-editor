import {
  carriedAgentComposerDraftText,
  type AgentComposerDraftCarry,
} from "../domain/agentComposerDraftLineage";
import { isAgentComposerDraftTextRetainable } from "../domain/agentComposerDraftSnapshot";
import type { AgentComposerDraftStore } from "./agentComposerDrafts";

export interface AgentComposerPromptDraft {
  readonly key: string | null;
  readonly text: string;
  readonly vacated?: { readonly key: string; readonly text: string };
}

export function openAgentComposerPromptDraft(
  drafts: AgentComposerDraftStore,
  key: string | null,
): AgentComposerPromptDraft {
  return { key, text: key === null ? "" : drafts.readDraft(key) };
}

export function retargetAgentComposerPromptDraft(
  drafts: AgentComposerDraftStore,
  previous: AgentComposerPromptDraft,
  nextKey: string | null,
  carry: AgentComposerDraftCarry | null,
): AgentComposerPromptDraft {
  if (carry !== null && previous.key === carry.from && nextKey === carry.to) {
    return carriedPromptDraft(carry, previous.text, drafts.readDraft(carry.to));
  }
  return { key: nextKey, text: seededText(drafts, previous, nextKey) };
}

function carriedPromptDraft(
  carry: AgentComposerDraftCarry,
  carried: string,
  stored: string,
): AgentComposerPromptDraft {
  const merged = carriedAgentComposerDraftText(carried, stored);
  if (isAgentComposerDraftTextRetainable(merged)) {
    return { key: carry.to, text: merged, vacated: { key: carry.from, text: "" } };
  }
  return { key: carry.to, text: carried, vacated: { key: carry.from, text: stored } };
}

export function settleAgentComposerPromptDraft(
  drafts: AgentComposerDraftStore,
  draft: AgentComposerPromptDraft,
): void {
  if (draft.vacated !== undefined) drafts.writeDraft(draft.vacated.key, draft.vacated.text);
  if (draft.key === null) return;
  drafts.writeDraft(draft.key, draft.text);
}

export function retainForeignAgentComposerDraft(
  drafts: AgentComposerDraftStore,
  key: string | null,
  text: string,
): void {
  if (key === null) return;
  if (drafts.readDraft(key) !== "") return;
  drafts.writeDraft(key, text);
}

function seededText(
  drafts: AgentComposerDraftStore,
  previous: AgentComposerPromptDraft,
  nextKey: string | null,
): string {
  if (nextKey === null) return previous.key === null ? previous.text : "";
  const stored = drafts.readDraft(nextKey);
  if (stored !== "") return stored;
  if (previous.key === null) return previous.text;
  return "";
}
