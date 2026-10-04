import { useEffect, useMemo, useState } from "react";
import type { RemoteRunnerGateway, RemoteRunnerProject } from "../domain/remoteRunner";

export const MAX_REMOTE_PROJECT_INVENTORY_SERVERS = 16;
export const REMOTE_PROJECT_INVENTORY_SLOW_AFTER_MS = 15_000;

export type RemoteProjectInventoryGateway = Pick<RemoteRunnerGateway, "getRunner" | "listProjects">;

export type RemoteProjectInventory =
  | { readonly kind: "loading" }
  | { readonly kind: "slow" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "ready";
      readonly runnerId: string;
      readonly projects: ReadonlyArray<RemoteRunnerProject>;
    };

export type RemoteProjectInventories = ReadonlyMap<string, RemoteProjectInventory>;

interface InventoryOwner {
  readonly gateway: RemoteProjectInventoryGateway;
  readonly serverKey: string;
}

interface InventoryState {
  readonly owner: InventoryOwner;
  readonly inventories: RemoteProjectInventories;
}

const NO_INVENTORIES: RemoteProjectInventories = new Map();
const LOADING: RemoteProjectInventory = { kind: "loading" };
const SLOW: RemoteProjectInventory = { kind: "slow" };
const FAILED: RemoteProjectInventory = { kind: "failed" };

export function useRemoteProjectInventories(
  gateway: RemoteProjectInventoryGateway | null,
  serverIds: ReadonlyArray<string>,
  enabled: boolean,
): RemoteProjectInventories {
  const serverKey = JSON.stringify(serverIds.slice(0, MAX_REMOTE_PROJECT_INVENTORY_SERVERS));
  const pending = useMemo(() => loadingInventories(serverKey), [serverKey]);
  const [state, setState] = useState<InventoryState | null>(null);

  useEffect(() => {
    if (!enabled || gateway === null) return;
    const owner: InventoryOwner = { gateway, serverKey };
    let alive = true;
    const publish = (change: (current: RemoteProjectInventories) => RemoteProjectInventories) => {
      if (!alive) return;
      setState((current) => {
        if (current?.owner !== owner) return current;
        return { owner, inventories: change(current.inventories) };
      });
    };
    setState({ owner, inventories: loadingInventories(serverKey) });
    for (const serverId of serverIdsOf(serverKey)) {
      void loadInventory(gateway, serverId).then((inventory) => {
        publish((current) => new Map(current).set(serverId, inventory));
      });
    }
    const timer = window.setTimeout(
      () => publish(slowWhileLoading),
      REMOTE_PROJECT_INVENTORY_SLOW_AFTER_MS,
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
      setState(null);
    };
  }, [enabled, gateway, serverKey]);

  if (!enabled || gateway === null) return NO_INVENTORIES;
  if (state?.owner.gateway !== gateway || state.owner.serverKey !== serverKey) return pending;
  return state.inventories;
}

async function loadInventory(
  gateway: RemoteProjectInventoryGateway,
  serverId: string,
): Promise<RemoteProjectInventory> {
  try {
    const [runner, projects] = await Promise.all([
      gateway.getRunner({ serverId }),
      gateway.listProjects({ serverId }),
    ]);
    return { kind: "ready", runnerId: runner.runnerId, projects: projects.items };
  } catch {
    return FAILED;
  }
}

function slowWhileLoading(current: RemoteProjectInventories): RemoteProjectInventories {
  return new Map(
    [...current].map(([serverId, inventory]) => [
      serverId,
      inventory.kind === "loading" ? SLOW : inventory,
    ]),
  );
}

function loadingInventories(serverKey: string): RemoteProjectInventories {
  return new Map(serverIdsOf(serverKey).map((serverId) => [serverId, LOADING]));
}

function serverIdsOf(serverKey: string): ReadonlyArray<string> {
  const decoded: unknown = JSON.parse(serverKey);
  if (!Array.isArray(decoded)) return [];
  return decoded.filter((serverId): serverId is string => typeof serverId === "string");
}
