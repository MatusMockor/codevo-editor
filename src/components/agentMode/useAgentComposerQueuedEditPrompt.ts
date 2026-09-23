import { useEffect, useRef } from "react";
import { mergeRestoredPrompt } from "../../application/agentQueuedMessageEdit";
import type { AgentComposerQueuedEdit } from "./agentComposerQueuedEdit";

interface ComposerDraftSnapshot {
  readonly key: string | null;
  readonly text: string;
}

interface StashedComposerDraft {
  readonly lease: number;
  readonly text: string;
  readonly queuedPrompt: string;
  readonly abandoned: boolean;
}

const MAX_STASHED_COMPOSER_DRAFTS = 16;

export function useAgentComposerQueuedEditPrompt(
  queuedEdit: AgentComposerQueuedEdit | null,
  draftKey: string | null,
  draftRef: { readonly current: ComposerDraftSnapshot },
  replaceDraft: (key: string, text: string, focus: boolean) => void,
): void {
  const stashesRef = useRef(new Map<string, StashedComposerDraft>());
  useEffect(() => {
    const stashes = stashesRef.current;
    abandonForeignStashes(stashes, draftKey);
    if (draftKey === null) return;
    const stashed = stashes.get(draftKey);
    const current = draftRef.current;
    const typed = current.key === draftKey ? current.text : "";
    if (queuedEdit !== null && queuedEdit.threadId === draftKey) {
      if (stashed?.lease === queuedEdit.lease) {
        if (stashed.abandoned) stashes.set(draftKey, { ...stashed, abandoned: false });
        return;
      }
      const text = stashed === undefined ? typed : settledDraftText(stashed, typed);
      stashes.delete(draftKey);
      if (stashes.size >= MAX_STASHED_COMPOSER_DRAFTS) {
        const oldest = stashes.keys().next().value;
        if (oldest !== undefined) stashes.delete(oldest);
      }
      stashes.set(draftKey, {
        lease: queuedEdit.lease,
        text,
        queuedPrompt: queuedEdit.prompt,
        abandoned: false,
      });
      replaceDraft(draftKey, queuedEdit.prompt, true);
      return;
    }
    if (stashed === undefined) return;
    stashes.delete(draftKey);
    replaceDraft(draftKey, settledDraftText(stashed, typed), false);
  }, [draftKey, draftRef, queuedEdit, replaceDraft]);
}

function abandonForeignStashes(
  stashes: Map<string, StashedComposerDraft>,
  draftKey: string | null,
): void {
  for (const [key, stashed] of stashes) {
    if (key === draftKey || stashed.abandoned) continue;
    stashes.set(key, { ...stashed, abandoned: true });
  }
}

function settledDraftText(stashed: StashedComposerDraft, typed: string): string {
  if (!stashed.abandoned) return stashed.text;
  if (typed.trim() === "" || typed === stashed.queuedPrompt) return stashed.text;
  return mergeRestoredPrompt(stashed.text, typed);
}
