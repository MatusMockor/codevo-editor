import { useCallback, useLayoutEffect, useMemo, useRef, type ChangeEvent } from "react";
import type { AgentComposerAttachmentsSurface } from "../../application/useAgentComposerAttachments";
import {
  agentAttachmentPasteFailureMessage,
  agentAttachmentSourcesFromFiles,
  AGENT_ATTACHMENT_PICKER_FAILURE,
  MAX_AGENT_COMPOSER_PASTED_FILES,
} from "./agentComposerAttachmentPorts";

interface Options {
  readonly attachments: AgentComposerAttachmentsSurface | null;
  readonly target: string | null;
  readonly serverId: string | null;
  readonly promptOwnerKey: string | undefined;
  readonly dispatching: boolean;
}

export function useAgentRemoteAttachmentPicker(options: Options) {
  const { attachments, target, serverId, promptOwnerKey, dispatching } = options;
  const inputRef = useRef<HTMLInputElement>(null);
  const owner = useMemo(
    () => ({
      target,
      serverId,
      promptOwnerKey,
      dispatching,
      captureIntake: attachments?.captureIntake,
    }),
    [target, serverId, promptOwnerKey, dispatching, attachments?.captureIntake],
  );
  const current = useRef<object | null>(owner);
  const operation = useRef(0);
  const pending = useRef<{
    generation: number;
    owner: object;
    intake: NonNullable<ReturnType<NonNullable<AgentComposerAttachmentsSurface["captureIntake"]>>>;
    refuse: AgentComposerAttachmentsSurface["refuse"];
  } | null>(null);
  useLayoutEffect(() => {
    current.current = owner;
    return () => {
      current.current = null;
      pending.current = null;
    };
  }, [owner]);

  const cancel = useCallback(() => {
    operation.current++;
    pending.current = null;
    if (inputRef.current !== null) inputRef.current.value = "";
  }, []);
  useLayoutEffect(() => {
    const input = inputRef.current;
    input?.addEventListener("cancel", cancel);
    return () => input?.removeEventListener("cancel", cancel);
  }, [cancel, serverId]);
  const open = () => {
    cancel();
    if (dispatching || serverId === null || target === null || attachments === null) return;
    const generation = operation.current;
    const intake = attachments.captureIntake?.(
      target,
      () => current.current === owner && operation.current === generation,
    );
    if (intake === null || intake === undefined || inputRef.current === null) {
      attachments.refuse(AGENT_ATTACHMENT_PICKER_FAILURE);
      return;
    }
    pending.current = { owner, intake, refuse: attachments.refuse, generation: operation.current };
    try {
      inputRef.current.click();
    } catch {
      cancel();
      if (current.current === owner) attachments.refuse(AGENT_ATTACHMENT_PICKER_FAILURE);
    }
  };
  const change = async (event: ChangeEvent<HTMLInputElement>) => {
    const captured = pending.current;
    const files = Array.from(event.currentTarget.files ?? []).slice(
      0,
      MAX_AGENT_COMPOSER_PASTED_FILES,
    );
    event.currentTarget.value = "";
    pending.current = null;
    if (
      captured === null ||
      current.current !== captured.owner ||
      operation.current !== captured.generation ||
      files.length === 0
    )
      return;
    try {
      const sources = await agentAttachmentSourcesFromFiles(files);
      if (current.current !== captured.owner || operation.current !== captured.generation) return;
      await captured.intake(sources);
    } catch (error: unknown) {
      if (current.current === captured.owner && operation.current === captured.generation)
        captured.refuse(agentAttachmentPasteFailureMessage(error));
    }
  };
  return { inputRef, open, change };
}
