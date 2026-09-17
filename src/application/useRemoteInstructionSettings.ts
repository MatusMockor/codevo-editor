import { useEffect, useState } from "react";
import type { RemoteRunnerGateway, RemoteRunnerProject } from "../domain/remoteRunner";

type Inventory =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly runnerId: string;
      readonly projects: readonly RemoteRunnerProject[];
    };

/** Loads configuration targets only while settings are expanded; stale owners never publish. */
export function useRemoteInstructionSettings(
  gateway: Pick<RemoteRunnerGateway, "getRunner" | "listProjects">,
  serverId: string,
  enabled: boolean,
): Inventory {
  const [state, setState] = useState<{
    readonly gateway: Pick<RemoteRunnerGateway, "getRunner" | "listProjects">;
    readonly serverId: string;
    readonly inventory: Inventory;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState({ gateway, serverId, inventory: { kind: "loading" } });
    void Promise.all([gateway.getRunner({ serverId }), gateway.listProjects({ serverId })])
      .then(([runner, projects]) => {
        if (alive)
          setState({
            gateway,
            serverId,
            inventory: { kind: "ready", runnerId: runner.runnerId, projects: projects.items },
          });
      })
      .catch(() => {
        if (alive) setState({ gateway, serverId, inventory: { kind: "failed" } });
      });
    return () => {
      alive = false;
    };
  }, [enabled, gateway, serverId]);
  return enabled && state?.gateway === gateway && state.serverId === serverId
    ? state.inventory
    : { kind: "loading" };
}
