import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RepositoryLookupOutcome, RepositoryLookupRequest } from "../domain/repositoryLookup";
import type { RemoteAddProjectLookupOutcome } from "./remoteAddProjectMachine";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";

export type RepositoryLookupOptions = Readonly<{
  gateway: RepositoryLookupGateway | null;
  serverId: string | null;
  workspaceOwner: string | null;
}>;

export type RepositoryLookupSurface = Readonly<{
  submit(request: RepositoryLookupRequest): Promise<RemoteAddProjectLookupOutcome | null>;
  reset(): void;
}>;

const BUSY: RemoteAddProjectLookupOutcome = Object.freeze({ status: "failed", reason: "busy" });
const FAILED: RemoteAddProjectLookupOutcome = Object.freeze({
  status: "failed",
  reason: "unknown",
});

export function useRepositoryLookup({
  gateway,
  serverId,
  workspaceOwner,
}: RepositoryLookupOptions): RepositoryLookupSurface {
  const owner = useRef({ gateway, serverId, workspaceOwner });
  if (
    owner.current.gateway !== gateway ||
    owner.current.serverId !== serverId ||
    owner.current.workspaceOwner !== workspaceOwner
  )
    owner.current = { gateway, serverId, workspaceOwner };
  const captured = owner.current;
  const mounted = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [captured]);

  const reset = useCallback(() => {
    generation.current += 1;
  }, []);

  const submit = useCallback(
    async (request: RepositoryLookupRequest): Promise<RemoteAddProjectLookupOutcome | null> => {
      generation.current += 1;
      const mine = generation.current;
      const valid = () =>
        mounted.current && owner.current === captured && generation.current === mine;
      if (captured.gateway === null) {
        if (!valid()) return null;
        return FAILED;
      }
      try {
        const outcome = await captured.gateway.lookup(request);
        if (!valid()) return null;
        return publishableOutcome(outcome);
      } catch {
        if (!valid()) return null;
        return FAILED;
      }
    },
    [captured],
  );

  return useMemo(() => ({ submit, reset }), [submit, reset]);
}

function publishableOutcome(outcome: RepositoryLookupOutcome): RemoteAddProjectLookupOutcome {
  if (outcome.status === "ok") return outcome;
  if (outcome.status === "rateLimited") return outcome;
  if (outcome.status === "failed") return outcome;
  if (outcome.status === "superseded") return BUSY;
  return { status: outcome.status };
}
