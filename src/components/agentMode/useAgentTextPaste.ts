import { useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { AgentComposerAttachmentsSurface } from "../../application/useAgentComposerAttachments";
import { MAX_AGENT_FILE_BYTES, MAX_AGENT_TURN_ATTACHMENTS } from "../../domain/agentAttachment";
import { nextAgentPastedTextName, shouldAttachAgentTextPaste } from "../../domain/agentTextPaste";

interface Options {
  readonly ownerKey: string;
  readonly prompt: string;
  readonly promptBytes: number;
  readonly attachments: AgentComposerAttachmentsSurface | null;
  readonly available: boolean;
  readonly pasteText: (text: string, name: string) => Promise<void>;
  readonly refuse: (message: string) => void;
  readonly currentAuthority: () => object | null;
  readonly onPromptChange: (text: string) => void;
}

/** Fold clipboard text into the existing owned file pipeline, preserving its original bytes. */
export function useAgentTextPaste(options: Options) {
  const {
    ownerKey,
    prompt,
    promptBytes,
    attachments,
    available,
    pasteText,
    refuse,
    currentAuthority,
    onPromptChange,
  } = options;
  const [conversion, setConversion] = useState<{
    ownerKey: string;
    prompt: string;
    replacement: string;
    name: string;
    authority: object | null;
  } | null>(null);
  useLayoutEffect(() => {
    if (conversion === null) return;
    if (
      conversion.authority === null ||
      conversion.authority !== currentAuthority() ||
      conversion.ownerKey !== ownerKey ||
      conversion.prompt !== prompt
    ) {
      setConversion(null);
      return;
    }
    const draft = attachments?.drafts.find((entry) => entry.name === conversion.name);
    if (draft?.state === "ready") {
      onPromptChange(conversion.replacement);
      setConversion(null);
    } else if (draft?.state === "failed" || attachments?.refusal) {
      setConversion(null);
    }
  }, [conversion, ownerKey, prompt, attachments, onPromptChange, currentAuthority]);
  const reserved = useRef({ ownerKey: ownerKey, names: new Set<string>(), sequence: 1 });
  const bypassUntil = useRef(0);
  if (reserved.current.ownerKey !== ownerKey) {
    reserved.current = { ownerKey, names: new Set(), sequence: 1 };
    bypassUntil.current = 0;
  }
  const reservedCount = () =>
    (attachments?.drafts.length ?? 0) +
    [...reserved.current.names].filter(
      (name) => !attachments?.drafts.some((draft) => draft.name === name),
    ).length;
  const reserveName = () => {
    const state = reserved.current;
    const name = nextAgentPastedTextName(
      [...state.names, ...(attachments?.drafts.map((draft) => draft.name) ?? [])],
      state.sequence,
    );
    state.sequence = name === "pasted-text.txt" ? 2 : Number(name.match(/-(\d+)\.txt$/)?.[1]) + 1;
    state.names.add(name);
    return name;
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    bypassUntil.current =
      event.key.toLowerCase() === "v" &&
      event.shiftKey &&
      !event.altKey &&
      event.metaKey !== event.ctrlKey
        ? Date.now() + 1000
        : 0;
  };
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>): boolean => {
    const bypass = Date.now() <= bypassUntil.current;
    bypassUntil.current = 0;
    if (bypass) return false;
    const text = event.clipboardData.getData("text/plain");
    if (
      !shouldAttachAgentTextPaste(
        text,
        prompt,
        event.currentTarget.selectionStart,
        event.currentTarget.selectionEnd,
        promptBytes,
      )
    )
      return false;
    event.preventDefault();
    if (!available || attachments === null) {
      refuse("Choose an available project to attach this pasted text, then paste again.");
      return true;
    }
    if (reservedCount() >= MAX_AGENT_TURN_ATTACHMENTS) {
      refuse("Up to 8 attachments per message. Remove an attachment, then paste again.");
      return true;
    }
    if (
      text.length > MAX_AGENT_FILE_BYTES ||
      new TextEncoder().encode(text).byteLength > MAX_AGENT_FILE_BYTES
    ) {
      refuse("Pasted text is larger than 50 MiB. Paste a smaller excerpt.");
      return true;
    }
    // Reserve synchronously: a second paste can arrive before staging publishes its draft.
    const names = reserved.current.names;
    const name = reserveName();
    const start = event.currentTarget.selectionStart;
    const end = event.currentTarget.selectionEnd;
    if (end > start)
      setConversion({
        ownerKey: ownerKey,
        prompt: prompt,
        replacement: prompt.slice(0, start) + prompt.slice(end),
        name,
        authority: currentAuthority(),
      });
    void pasteText(text, name).finally(() => names.delete(name));
    return true;
  };
  const convertDraft = () => {
    if (conversion !== null || !available || attachments === null) return;
    if (reservedCount() >= MAX_AGENT_TURN_ATTACHMENTS) {
      refuse("Remove an attachment before attaching this draft.");
      return;
    }
    if (
      prompt.length > MAX_AGENT_FILE_BYTES ||
      new TextEncoder().encode(prompt).byteLength > MAX_AGENT_FILE_BYTES
    ) {
      refuse("Pasted text is larger than 50 MiB. Paste a smaller excerpt.");
      return;
    }
    const names = reserved.current.names;
    const name = reserveName();
    setConversion({
      ownerKey: ownerKey,
      prompt: prompt,
      replacement: "",
      name,
      authority: currentAuthority(),
    });
    void pasteText(prompt, name).finally(() => names.delete(name));
  };
  return { paste, keyDown, convertDraft, converting: conversion !== null };
}
