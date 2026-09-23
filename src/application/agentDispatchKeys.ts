import { useCallback, useEffect, useRef, useState } from "react";

export const MAX_CONCURRENT_AGENT_DISPATCHES = 64;
export const AGENT_DISPATCH_IN_PROGRESS_NOTICE = "This conversation is already starting.";
export const AGENT_DISPATCH_CAPACITY_NOTICE =
  "Too many conversations are starting at once. Wait for one to start.";

const EMPTY_KEYS: ReadonlySet<string> = new Set();

export function agentDraftDispatchKey(projectRootKey: string): string {
  return `new:${projectRootKey}`;
}

export function agentThreadDispatchKey(threadId: string): string {
  return threadId;
}

export type AgentDispatchClaim = "claimed" | "busy" | "full";

export interface AgentDispatchKeys {
  readonly keys: ReadonlySet<string>;
  claim(key: string): AgentDispatchClaim;
  release(key: string): void;
}

export function agentDispatchClaimNotice(claim: Exclude<AgentDispatchClaim, "claimed">): string {
  switch (claim) {
    case "busy":
      return AGENT_DISPATCH_IN_PROGRESS_NOTICE;
    case "full":
      return AGENT_DISPATCH_CAPACITY_NOTICE;
    default:
      return unsupportedClaim(claim);
  }
}

export function useAgentDispatchKeys(
  capacity: number = MAX_CONCURRENT_AGENT_DISPATCHES,
): AgentDispatchKeys {
  const active = useRef(new Set<string>());
  const mounted = useRef(true);
  const [keys, setKeys] = useState<ReadonlySet<string>>(EMPTY_KEYS);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const publish = useCallback((): void => {
    if (!mounted.current) return;
    setKeys(active.current.size === 0 ? EMPTY_KEYS : new Set(active.current));
  }, []);

  const claim = useCallback(
    (key: string): AgentDispatchClaim => {
      if (active.current.has(key)) return "busy";
      if (active.current.size >= capacity) return "full";
      active.current.add(key);
      publish();
      return "claimed";
    },
    [capacity, publish],
  );

  const release = useCallback(
    (key: string): void => {
      if (!active.current.delete(key)) return;
      publish();
    },
    [publish],
  );

  return { keys, claim, release };
}

function unsupportedClaim(claim: never): never {
  throw new TypeError(`Unsupported dispatch claim: ${String(claim)}.`);
}
