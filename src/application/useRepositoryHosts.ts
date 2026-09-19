import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type {
  RemoteProjectSourceKind,
  RepositoryHost,
  RepositoryHostsSnapshot,
  RepositoryHostsState,
  RepositoryProvider,
} from "../domain/repositoryLookup";
import type { RemoteAddProjectSourceAvailability } from "./remoteAddProjectMachine";
import type { RepositoryLookupGateway } from "./repositoryLookupPorts";

export type RepositoryHostsOptions = Readonly<{
  runnerGateway: RemoteRunnerGateway | null;
  lookupGateway: RepositoryLookupGateway | null;
  serverId: string | null;
  workspaceOwner: string | null;
  open: boolean;
}>;

export type RepositoryCloningProbe =
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "supported"; runnerId: string }>
  | Readonly<{ status: "unsupported" }>
  | Readonly<{ status: "probeFailed" }>;

export type RepositoryHostsLoad = Readonly<{
  snapshot: RepositoryHostsSnapshot | null;
  failed: boolean;
}>;

export type RepositoryHostsSurface = Readonly<{
  load: RepositoryHostsLoad;
  cloning: RepositoryCloningProbe;
  runnerId: string | null;
  hosts: Readonly<Record<RepositoryProvider, readonly RepositoryHost[]>>;
  hostsTruncated: Readonly<Record<RepositoryProvider, boolean>>;
  availability: Readonly<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>>;
  retry(): void;
}>;

type HostsOwner = Readonly<{
  runnerGateway: RemoteRunnerGateway | null;
  lookupGateway: RepositoryLookupGateway | null;
  serverId: string | null;
  workspaceOwner: string | null;
}>;

const IDLE_LOAD: RepositoryHostsLoad = Object.freeze({ snapshot: null, failed: false });
const PROBING: RepositoryCloningProbe = Object.freeze({ status: "checking" });
const UNSUPPORTED: RepositoryCloningProbe = Object.freeze({ status: "unsupported" });
const PROBE_FAILED: RepositoryCloningProbe = Object.freeze({ status: "probeFailed" });
const READY: RemoteAddProjectSourceAvailability = Object.freeze({ status: "ready" });
const CHECKING: RemoteAddProjectSourceAvailability = Object.freeze({ status: "checking" });
const NO_HOSTS: readonly RepositoryHost[] = Object.freeze([]);
const NO_TRUNCATION: Readonly<Record<RepositoryProvider, boolean>> = Object.freeze({
  github: false,
  gitlab: false,
});

export function useRepositoryHosts({
  runnerGateway,
  lookupGateway,
  serverId,
  workspaceOwner,
  open,
}: RepositoryHostsOptions): RepositoryHostsSurface {
  const owner = useRef<HostsOwner>({ runnerGateway, lookupGateway, serverId, workspaceOwner });
  if (
    owner.current.runnerGateway !== runnerGateway ||
    owner.current.lookupGateway !== lookupGateway ||
    owner.current.serverId !== serverId ||
    owner.current.workspaceOwner !== workspaceOwner
  )
    owner.current = { runnerGateway, lookupGateway, serverId, workspaceOwner };
  const captured = owner.current;
  const mounted = useRef(false);
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [load, setLoad] = useState<RepositoryHostsLoad>(IDLE_LOAD);
  const [cloning, setCloning] = useState<RepositoryCloningProbe>(PROBING);

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    const mine = generation.current;
    const valid = () =>
      mounted.current && owner.current === captured && generation.current === mine;
    setLoad(IDLE_LOAD);
    setCloning(PROBING);
    if (open) {
      void loadHosts(captured, valid, setLoad);
      void probeCloning(captured, valid, setCloning);
    }
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [captured, open, attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  const hosts = useMemo(() => authenticatedHosts(load.snapshot), [load.snapshot]);
  const hostsTruncated = useMemo(() => truncatedHosts(load.snapshot), [load.snapshot]);
  const availability = useMemo(
    () =>
      repositoryHostsAvailability({
        cloning,
        load,
        lookupAvailable: lookupGateway !== null,
      }),
    [cloning, load, lookupGateway],
  );
  const runnerId = cloning.status === "supported" ? cloning.runnerId : null;

  return useMemo(
    () => ({ load, cloning, runnerId, hosts, hostsTruncated, availability, retry }),
    [load, cloning, runnerId, hosts, hostsTruncated, availability, retry],
  );
}

export function repositoryHostsAvailability(
  input: Readonly<{
    cloning: RepositoryCloningProbe;
    load: RepositoryHostsLoad;
    lookupAvailable: boolean;
  }>,
): Readonly<Record<RemoteProjectSourceKind, RemoteAddProjectSourceAvailability>> {
  const clone = cloneAvailability(input.cloning);
  return Object.freeze({
    serverProject: READY,
    gitUrl: clone,
    github: providerAvailability("github", clone, input),
    gitlab: providerAvailability("gitlab", clone, input),
  });
}

export function authenticatedHosts(
  snapshot: RepositoryHostsSnapshot | null,
): Readonly<Record<RepositoryProvider, readonly RepositoryHost[]>> {
  if (snapshot === null) return Object.freeze({ github: NO_HOSTS, gitlab: NO_HOSTS });
  return Object.freeze({
    github: readyHosts(snapshot.github),
    gitlab: readyHosts(snapshot.gitlab),
  });
}

export function truncatedHosts(
  snapshot: RepositoryHostsSnapshot | null,
): Readonly<Record<RepositoryProvider, boolean>> {
  if (snapshot === null) return NO_TRUNCATION;
  return Object.freeze({
    github: isTruncated(snapshot.github),
    gitlab: isTruncated(snapshot.gitlab),
  });
}

function isTruncated(state: RepositoryHostsState): boolean {
  return state.status === "ready" && state.truncated;
}

function readyHosts(state: RepositoryHostsState): readonly RepositoryHost[] {
  if (state.status !== "ready") return NO_HOSTS;
  const hosts = state.hosts.filter((host) => host.auth === "authenticated");
  if (hosts.length === 0) return NO_HOSTS;
  return Object.freeze(hosts);
}

function cloneAvailability(cloning: RepositoryCloningProbe): RemoteAddProjectSourceAvailability {
  switch (cloning.status) {
    case "checking":
      return CHECKING;
    case "unsupported":
      return { status: "unavailable", reason: "cloningUnsupported" };
    case "probeFailed":
      return { status: "unavailable", reason: "probeFailed" };
    case "supported":
      return READY;
    default:
      return unsupportedProbe(cloning);
  }
}

function unsupportedProbe(probe: never): never {
  throw new TypeError(`Unsupported cloning probe: ${JSON.stringify(probe)}.`);
}

function providerAvailability(
  provider: RepositoryProvider,
  clone: RemoteAddProjectSourceAvailability,
  input: Readonly<{ load: RepositoryHostsLoad; lookupAvailable: boolean }>,
): RemoteAddProjectSourceAvailability {
  if (clone.status !== "ready") return clone;
  if (!input.lookupAvailable) return { status: "unavailable", reason: "lookupUnavailable" };
  if (input.load.failed) return { status: "unavailable", reason: "hostsFailed" };
  if (input.load.snapshot === null) return CHECKING;
  return hostsStateAvailability(input.load.snapshot[provider]);
}

function hostsStateAvailability(state: RepositoryHostsState): RemoteAddProjectSourceAvailability {
  if (state.status === "cliMissing") return { status: "unavailable", reason: "cliMissing" };
  if (state.status === "failed") return { status: "unavailable", reason: "hostsFailed" };
  if (state.hosts.every((host) => host.auth !== "authenticated")) {
    return { status: "unavailable", reason: "notAuthenticated" };
  }
  return READY;
}

async function loadHosts(
  captured: HostsOwner,
  valid: () => boolean,
  publish: (load: RepositoryHostsLoad) => void,
): Promise<void> {
  if (captured.lookupGateway === null) return;
  try {
    const snapshot = await captured.lookupGateway.listHosts();
    if (!valid()) return;
    publish({ snapshot, failed: false });
  } catch {
    if (!valid()) return;
    publish({ snapshot: null, failed: true });
  }
}

async function probeCloning(
  captured: HostsOwner,
  valid: () => boolean,
  publish: (probe: RepositoryCloningProbe) => void,
): Promise<void> {
  const runner = captured.runnerGateway;
  if (runner === null || captured.serverId === null) {
    if (valid()) publish(UNSUPPORTED);
    return;
  }
  try {
    const descriptor = await runner.getRunner({ serverId: captured.serverId });
    if (!valid()) return;
    if (descriptor.capabilities.projectCloning !== true) {
      publish(UNSUPPORTED);
      return;
    }
    publish({ status: "supported", runnerId: descriptor.runnerId });
  } catch {
    if (valid()) publish(PROBE_FAILED);
  }
}
