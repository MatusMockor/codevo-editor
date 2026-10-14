import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  agentThreadRequestScopeKey,
  type AgentPendingInteractionTarget,
} from "./agentPendingInteractionTargets";
import type { AgentThreadRequestScope } from "./agentThreadRequestPorts";
import type {
  RemoteAgentThreadRequestDescription,
  RemoteAgentThreadRequestFeed,
} from "./remoteAgentThreadRequestFeed";

export type AgentThreadRequestDescriber = Pick<
  RemoteAgentThreadRequestFeed,
  "describe" | "release"
>;

interface Described {
  readonly scope: AgentThreadRequestScope;
  readonly description: RemoteAgentThreadRequestDescription;
}

interface Wanted {
  readonly describer: AgentThreadRequestDescriber | null;
  readonly scopes: ReadonlyMap<string, Described>;
}

const NOTHING_WANTED: Wanted = { describer: null, scopes: new Map() };

export function useAgentPendingInteractionDescriptions(
  describer: AgentThreadRequestDescriber | null,
  targets: ReadonlyArray<AgentPendingInteractionTarget>,
): void {
  const scopes = useMemo(() => describedScopes(targets), [targets]);
  const signature = JSON.stringify(
    [...scopes].sort(([left], [right]) => left.localeCompare(right)),
  );
  const wantedRef = useRef<Wanted>(NOTHING_WANTED);
  const describedRef = useRef(new Map<string, AgentThreadRequestScope>());

  useLayoutEffect(() => {
    wantedRef.current = { describer, scopes };
    return () => {
      wantedRef.current = NOTHING_WANTED;
    };
  }, [describer, scopes]);

  useEffect(() => {
    if (describer === null) return undefined;
    const described = describedRef.current;
    for (const [key, { scope, description }] of wantedRef.current.scopes) {
      if (describer.describe(scope, description).kind === "tracked") described.set(key, scope);
    }
    return () => {
      const next = wantedRef.current;
      for (const [key, scope] of [...described]) {
        if (next.describer === describer && next.scopes.has(key)) continue;
        described.delete(key);
        describer.release(scope);
      }
    };
  }, [describer, signature]);
}

function describedScopes(
  targets: ReadonlyArray<AgentPendingInteractionTarget>,
): ReadonlyMap<string, Described> {
  const scopes = new Map<string, Described>();
  for (const { scope, description } of targets) {
    if (description === null) continue;
    scopes.set(agentThreadRequestScopeKey(scope), { scope, description });
  }
  return scopes;
}
