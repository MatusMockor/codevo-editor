import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  closeAgentAttachmentIntakeTicket,
  type AgentAttachmentIntakeTicket,
} from "../../application/agentAttachmentIntakeTickets";
import type {
  AgentAttachmentSource,
  AgentComposerAttachmentsSurface,
} from "../../application/useAgentComposerAttachments";
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

interface Captured {
  readonly intake: (sources: ReadonlyArray<AgentAttachmentSource>) => Promise<void>;
  readonly isCurrent: () => boolean;
  readonly refuse: (reason: string) => void;
  readonly serverId: () => string | null;
  readonly release: () => void;
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
  const presented = useRef({ attachments, serverId });
  const leases = useRef(new Set<AgentAttachmentIntakeTicket>());
  useLayoutEffect(() => {
    current.current = owner;
    return () => {
      current.current = null;
    };
  }, [owner]);
  useLayoutEffect(() => {
    presented.current = { attachments, serverId };
  });
  useLayoutEffect(() => {
    const owned = leases.current;
    return () => {
      for (const ticket of owned) closeAgentAttachmentIntakeTicket(ticket);
      owned.clear();
    };
  }, []);
  useEffect(() => {
    for (const ticket of [...leases.current]) {
      if (!dispatching && attachments?.holdsIntake?.(ticket) === true) continue;
      leases.current.delete(ticket);
      closeAgentAttachmentIntakeTicket(ticket);
    }
  });

  const draftOwned = (ticket: AgentAttachmentIntakeTicket): Captured => {
    leases.current.add(ticket);
    const isCurrent = () =>
      leases.current.has(ticket) && presented.current.attachments?.holdsIntake?.(ticket) === true;
    return {
      isCurrent,
      intake: async (sources) => {
        const resume = presented.current.attachments?.continueIntake?.(ticket, isCurrent) ?? null;
        if (resume !== null) await resume(sources);
      },
      refuse: (reason) => presented.current.attachments?.refuse(reason),
      serverId: () => presented.current.serverId,
      release: () => {
        leases.current.delete(ticket);
        closeAgentAttachmentIntakeTicket(ticket);
      },
    };
  };
  const capture = (): Captured | null => {
    if (dispatching || target === null || attachments === null) return null;
    if (attachments.openIntake !== undefined) {
      const ticket = attachments.openIntake(target);
      return ticket === null ? null : draftOwned(ticket);
    }
    const isCurrent = () => current.current === owner;
    const intake = attachments.captureIntake?.(target, isCurrent);
    if (!intake) {
      attachments.refuse("The attachment draft is unavailable. Select the project again.");
      return null;
    }
    return {
      intake,
      isCurrent,
      refuse: attachments.refuse,
      serverId: () => serverId,
      release: () => undefined,
    };
  };
  const readPaths = async (paths: ReadonlyArray<string>, captured: Captured) => {
    const pending = paths.slice(0, MAX_AGENT_COMPOSER_PASTED_FILES);
    const read = options.readImagePath ?? readAgentAttachmentImagePath;
    for (let index = 0; index < pending.length; index += 1) {
      if (!captured.isCurrent()) return;
      if (captured.serverId() === null) {
        await captured.intake(agentAttachmentSourcesFromPaths(pending.slice(index)));
        return;
      }
      const path = pending[index];
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
  const withIntake = async (work: (captured: Captured) => Promise<void>): Promise<void> => {
    const captured = capture();
    if (!captured) return;
    try {
      await work(captured);
    } finally {
      captured.release();
    }
  };
  const open = () =>
    withIntake(async (captured) => {
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
    });
  const drop = (paths: ReadonlyArray<string>) =>
    withIntake(async (captured) => {
      try {
        await readPaths(paths, captured);
      } catch (error: unknown) {
        fail(captured, error);
      }
    });
  const paste = (files: ReadonlyArray<File>) =>
    withIntake(async (captured) => {
      try {
        const sources = await agentAttachmentSourcesFromFiles(files);
        if (captured.isCurrent()) await captured.intake(sources);
      } catch (error: unknown) {
        if (captured.isCurrent()) captured.refuse(agentAttachmentPasteFailureMessage(error));
      }
    });
  const pasteText = (text: string, name: string) =>
    withIntake(async (captured) => {
      try {
        const bytes = new TextEncoder().encode(text).buffer;
        await captured.intake([{ kind: "bytes", name, mime: "text/plain;charset=utf-8", bytes }]);
      } catch (error: unknown) {
        fail(captured, error);
      }
    });
  return { open, drop, paste, pasteText };
}
