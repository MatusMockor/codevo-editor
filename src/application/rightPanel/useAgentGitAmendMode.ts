import { useRef, useState, type RefObject } from "react";
import { withBoundedEntry } from "../../domain/boundedKeyedMap";
import { useLatest } from "../../ui/foundation/useLatest";
import type { AgentGitAmendAvailability, AgentGitCommitPort } from "./projectGitCommitPort";

export const MAX_REMEMBERED_AMEND_MODES = 16;
const SHORT_SHA_LENGTH = 7;
const AMEND_CHECK_FAILURE = "Could not read the last commit.";

export interface AgentGitAmendView {
  readonly active: boolean;
  readonly checking: boolean;
  readonly unavailableReason: string | null;
  readonly shortSha: string | null;
}

type AmendMode =
  | { readonly phase: "off"; readonly reason: string | null }
  | { readonly phase: "checking" }
  | { readonly phase: "on"; readonly headSha: string; readonly savedDraft: string };

export interface AgentGitAmendAuthority {
  readonly key: string | null;
  readonly generation: number;
}

export interface UseAgentGitAmendModeOptions {
  readonly statusKey: string | null;
  readonly authority: RefObject<AgentGitAmendAuthority>;
  readonly port: RefObject<AgentGitCommitPort | null>;
  readonly message: string;
  replaceMessage(next: string): void;
}

export interface AgentGitAmendMode {
  readonly view: AgentGitAmendView;
  readonly headSha: string | null;
  check(): void;
  setActive(active: boolean): void;
  finish(key: string): void;
}

export function useAgentGitAmendMode(options: UseAgentGitAmendModeOptions): AgentGitAmendMode {
  const { authority, port, statusKey } = options;
  const [modes, setModes] = useState<ReadonlyMap<string, AmendMode>>(() => new Map());
  const nextToken = useRef(0);
  const pending = useRef(new Map<string, number>());
  const messageRef = useLatest(options.message);
  const replaceRef = useLatest(options.replaceMessage);
  const mode = (statusKey === null ? undefined : modes.get(statusKey)) ?? OFF;

  const put = (key: string, next: AmendMode | null): void =>
    setModes((current) => withBoundedEntry(current, key, next, MAX_REMEMBERED_AMEND_MODES));

  const load = (enable: boolean): void => {
    const { key, generation } = authority.current;
    const amendPort = port.current;
    if (key === null || amendPort === null) return;
    nextToken.current += 1;
    const token = nextToken.current;
    pending.current.set(key, token);
    const savedDraft = messageRef.current;
    put(key, CHECKING);
    const settle = (availability: AgentGitAmendAvailability): void => {
      if (pending.current.get(key) !== token) return;
      pending.current.delete(key);
      const current = authority.current;
      if (current.key !== key || current.generation !== generation) {
        put(key, null);
        return;
      }
      if (availability.kind === "unavailable") {
        put(key, { phase: "off", reason: availability.reason });
        return;
      }
      if (!enable) {
        put(key, null);
        return;
      }
      put(key, { phase: "on", headSha: availability.headSha, savedDraft });
      replaceRef.current(availability.message);
    };
    void amendPort.amendCandidate().then(settle, (reason: unknown) =>
      settle({
        kind: "unavailable",
        reason:
          reason instanceof Error && reason.message.length > 0
            ? reason.message
            : AMEND_CHECK_FAILURE,
      }),
    );
  };

  const setActive = (active: boolean): void => {
    const { key } = authority.current;
    if (key === null) return;
    if (active) {
      if (mode.phase === "off") load(true);
      return;
    }
    pending.current.delete(key);
    if (mode.phase === "on") replaceRef.current(mode.savedDraft);
    put(key, null);
  };

  return {
    view: {
      active: mode.phase === "on",
      checking: mode.phase === "checking",
      unavailableReason: mode.phase === "off" ? mode.reason : null,
      shortSha: mode.phase === "on" ? mode.headSha.slice(0, SHORT_SHA_LENGTH) : null,
    },
    headSha: mode.phase === "on" ? mode.headSha : null,
    check: () => {
      if (mode.phase === "off") load(false);
    },
    setActive,
    finish: (key) => {
      pending.current.delete(key);
      put(key, null);
    },
  };
}

const OFF: AmendMode = { phase: "off", reason: null };
const CHECKING: AmendMode = { phase: "checking" };
