import { useLayoutEffect, useMemo, useRef } from "react";
import type { AgentComposerAttachmentsSurface } from "../../application/useAgentComposerAttachments";
import { readAgentAttachmentImagePath } from "../../infrastructure/tauriAgentImageSource";
import {
  agentAttachmentPasteFailureMessage,
  agentAttachmentSourcesFromFiles,
  agentAttachmentSourcesFromPaths,
  AGENT_ATTACHMENT_PICKER_FAILURE,
  MAX_AGENT_COMPOSER_PASTED_FILES,
  type AgentComposerFilePicker,
} from "./agentComposerAttachmentPorts";

interface Options {
  readonly attachments: AgentComposerAttachmentsSurface | null;
  readonly target: string | null;
  readonly serverId: string | null;
  readonly promptOwnerKey: string | undefined;
  readonly dispatching: boolean;
  readonly picker: AgentComposerFilePicker;
  readonly readImagePath?: (path: string) => Promise<ArrayBuffer>;
}

/** Share exact draft ownership across local and server clipboard, picker and drop intake. */
export function useAgentAttachmentIntake(options: Options) {
  const { attachments, target, serverId, promptOwnerKey, dispatching, picker } = options;
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
  useLayoutEffect(() => {
    current.current = owner;
    return () => {
      current.current = null;
    };
  }, [owner]);

  const capture = () => {
    if (dispatching || target === null || attachments === null) return null;
    const isCurrent = () => current.current === owner;
    const intake = attachments.captureIntake?.(target, isCurrent);
    if (!intake) {
      attachments.refuse("The attachment draft is unavailable. Select the project again.");
      return null;
    }
    return { intake, isCurrent, refuse: attachments.refuse };
  };
  type Captured = NonNullable<ReturnType<typeof capture>>;
  const readPaths = async (paths: ReadonlyArray<string>, captured: Captured) => {
    if (serverId === null) {
      if (captured.isCurrent() && paths.length > 0)
        await captured.intake(
          agentAttachmentSourcesFromPaths(paths.slice(0, MAX_AGENT_COMPOSER_PASTED_FILES)),
        );
      return;
    }
    const read = options.readImagePath ?? readAgentAttachmentImagePath;
    for (const path of paths.slice(0, MAX_AGENT_COMPOSER_PASTED_FILES)) {
      if (!captured.isCurrent()) return;
      const bytes = await read(path);
      if (!captured.isCurrent()) return;
      const segments = path.split(/[/\\]/u);
      const name = segments[segments.length - 1] ?? "image";
      await captured.intake([{ kind: "bytes", name, mime: "", bytes }]);
    }
  };
  const fail = (captured: Captured, error: unknown) => {
    if (captured.isCurrent())
      captured.refuse(
        error instanceof Error ? error.message : agentAttachmentPasteFailureMessage(error),
      );
  };
  const open = async () => {
    const captured = capture();
    if (!captured) return;
    let paths: ReadonlyArray<string>;
    try {
      paths = await picker();
    } catch {
      if (captured.isCurrent()) captured.refuse(AGENT_ATTACHMENT_PICKER_FAILURE);
      return;
    }
    if (!captured.isCurrent()) return;
    try {
      await readPaths(paths, captured);
    } catch (error: unknown) {
      fail(captured, error);
    }
  };
  const drop = async (paths: ReadonlyArray<string>) => {
    const captured = capture();
    if (!captured) return;
    try {
      await readPaths(paths, captured);
    } catch (error: unknown) {
      fail(captured, error);
    }
  };
  const paste = async (files: ReadonlyArray<File>) => {
    const captured = capture();
    if (!captured) return;
    try {
      const sources = await agentAttachmentSourcesFromFiles(files);
      if (captured.isCurrent()) await captured.intake(sources);
    } catch (error: unknown) {
      if (captured.isCurrent()) captured.refuse(agentAttachmentPasteFailureMessage(error));
    }
  };
  return { open, drop, paste };
}
