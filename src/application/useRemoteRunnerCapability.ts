import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RemoteRunnerDescriptor, RemoteRunnerGateway } from "../domain/remoteRunner";

export type RemoteRunnerCapabilityName = keyof RemoteRunnerDescriptor["capabilities"];
export type RemoteRunnerCapabilityState =
  "idle" | "checking" | "supported" | "unsupported" | "failed";
export type RemoteRunnerCapabilityTarget = Readonly<{ serverId: string; runnerId: string }>;
export type RemoteRunnerCapability = Readonly<{
  state: RemoteRunnerCapabilityState;
  recheck(): void;
}>;

type Settled = Readonly<{ key: string; state: RemoteRunnerCapabilityState }>;
type RemoteRunnerDescriptorSource = Pick<RemoteRunnerGateway, "getRunner">;
type Probe = Readonly<{
  gateway: RemoteRunnerDescriptorSource;
  serverId: string;
  runnerId: string;
  capability: RemoteRunnerCapabilityName;
}>;

const capabilityOf = (probe: Probe, descriptor: RemoteRunnerDescriptor) => {
  if (descriptor.runnerId !== probe.runnerId) return "failed";
  return descriptor.capabilities[probe.capability] === true ? "supported" : "unsupported";
};

export function useRemoteRunnerCapability(
  gateway: RemoteRunnerDescriptorSource | null,
  target: RemoteRunnerCapabilityTarget | null,
  connected: boolean,
  capability: RemoteRunnerCapabilityName,
): RemoteRunnerCapability {
  const probe: Probe | null =
    gateway === null || target === null || !connected
      ? null
      : { gateway, serverId: target.serverId, runnerId: target.runnerId, capability };
  const key =
    probe === null ? null : JSON.stringify([probe.serverId, probe.runnerId, probe.capability]);
  const latest = useRef(probe);
  const [settled, setSettled] = useState<Settled | null>(null);
  const [attempt, setAttempt] = useState(0);

  useLayoutEffect(() => {
    latest.current = probe;
  });

  useEffect(() => {
    const current = latest.current;
    if (key === null || current === null) return;
    let live = true;
    void new Promise<RemoteRunnerDescriptor>((resolve) =>
      resolve(current.gateway.getRunner({ serverId: current.serverId })),
    )
      .then(
        (descriptor): RemoteRunnerCapabilityState => capabilityOf(current, descriptor),
        (): RemoteRunnerCapabilityState => "failed",
      )
      .then((state) => {
        if (live) setSettled({ key, state });
      });
    return () => {
      live = false;
      setSettled(null);
    };
  }, [attempt, key]);

  const state: RemoteRunnerCapabilityState =
    key === null ? "idle" : settled?.key !== key ? "checking" : settled.state;
  const failed = state === "failed";
  const recheck = useCallback(() => {
    if (failed) setAttempt((current) => current + 1);
  }, [failed]);
  return useMemo(() => ({ state, recheck }), [recheck, state]);
}
