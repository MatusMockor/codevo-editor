import { useEffect, useState } from "react";
import type {
  RepositoryHostsSnapshot,
  RepositoryHostsState,
  RepositoryProvider,
} from "../domain/repositoryLookup";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";

export type RepositoryHostStatus =
  | Readonly<{ kind: "checking" }>
  | Readonly<{ kind: "ready"; host: string }>
  | Readonly<{ kind: "signedOut"; host: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "unavailable" }>;
export type RepositoryHostStatuses = Readonly<Record<RepositoryProvider, RepositoryHostStatus>>;

const CHECKING: RepositoryHostStatuses = Object.freeze({
  github: { kind: "checking" },
  gitlab: { kind: "checking" },
});
const UNAVAILABLE: RepositoryHostStatuses = Object.freeze({
  github: { kind: "unavailable" },
  gitlab: { kind: "unavailable" },
});

export function repositoryHostStatuses(snapshot: RepositoryHostsSnapshot): RepositoryHostStatuses {
  return { github: hostStatus(snapshot.github), gitlab: hostStatus(snapshot.gitlab) };
}

export function useRepositoryHostStatus(
  gateway: RepositoryLookupGateway | null,
  enabled: boolean,
): RepositoryHostStatuses {
  const [loaded, setLoaded] = useState<Readonly<{
    gateway: RepositoryLookupGateway;
    statuses: RepositoryHostStatuses;
  }> | null>(null);
  useEffect(() => {
    if (gateway === null || !enabled) return;
    let disposed = false;
    void gateway
      .listHosts()
      .then((snapshot) => {
        if (!disposed) setLoaded({ gateway, statuses: repositoryHostStatuses(snapshot) });
      })
      .catch(() => {
        if (!disposed) setLoaded({ gateway, statuses: UNAVAILABLE });
      });
    return () => {
      disposed = true;
    };
  }, [enabled, gateway]);
  if (gateway === null) return UNAVAILABLE;
  return loaded?.gateway === gateway ? loaded.statuses : CHECKING;
}

function hostStatus(state: RepositoryHostsState): RepositoryHostStatus {
  switch (state.status) {
    case "ready": {
      const authenticated = state.hosts.find((host) => host.auth === "authenticated");
      if (authenticated !== undefined) return { kind: "ready", host: authenticated.host };
      const first = state.hosts[0];
      if (first === undefined) return { kind: "missing" };
      return { kind: "signedOut", host: first.host };
    }
    case "cliMissing":
      return { kind: "missing" };
    case "failed":
      return { kind: "unavailable" };
    default: {
      const unsupported: never = state;
      return unsupported;
    }
  }
}
