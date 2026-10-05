import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentAccountUsageLoadState } from "../domain/agentAccountUsage";
import type { AgentAccountUsageSourcesPort } from "../domain/agentAccountUsageSources";
import type { RemoteRunnerGateway, RemoteRunnerServer } from "../domain/remoteRunner";
import type { RemoteAgentInventorySnapshot } from "./remoteAgentInventoryLoad";
import { createAgentAccountUsageSources } from "./agentAccountUsageSources";
import type { AgentAccountUsageStates } from "./useAgentAccountUsageSourceProjection";
import type { AgentAccountUsageRefreshOutcome } from "./agentAccountUsageRefresh";

const PROVIDERS = ["claudeCode", "codex"] as const;
const POLL_MS = 60_000;
const MAX_CONCURRENCY = 4;
interface Target {
  readonly serverId: string;
  readonly runnerId: string;
  readonly source: string;
}
interface Options {
  readonly gateway: RemoteRunnerGateway | null;
  readonly servers: readonly RemoteRunnerServer[];
  readonly snapshots: readonly RemoteAgentInventorySnapshot[];
  readonly selectedServerId: string | null;
  readonly workspaceOwner: string | null;
  readonly sources?: AgentAccountUsageSourcesPort;
}
const UNAVAILABLE: AgentAccountUsageStates = {
  claudeCode: { kind: "unavailable" },
  codex: { kind: "unavailable" },
};

/** Selected and active runner accounts are polled independently of local conversations. */
export function useRemoteAgentAccountUsage(options: Options) {
  const fallback = useMemo(createAgentAccountUsageSources, []);
  const sources = options.sources ?? fallback;
  const recentlyActive = useRef(new Set<string>());
  const configured = new Set(options.servers.slice(0, 64).map((server) => server.id));
  for (const id of recentlyActive.current)
    if (!configured.has(id)) recentlyActive.current.delete(id);
  const taskStates = useRef(new Map<string, string>());
  for (const snapshot of options.snapshots) {
    if (!configured.has(snapshot.serverId)) continue;
    for (const task of snapshot.tasks) {
      const key = JSON.stringify([snapshot.serverId, task.runnerId, task.id]);
      const previous = taskStates.current.get(key);
      if (
        (previous === "running" || previous === "queued") &&
        task.status !== "running" &&
        task.status !== "queued"
      )
        recentlyActive.current.add(snapshot.serverId);
    }
  }
  taskStates.current = new Map(
    options.snapshots.flatMap((snapshot) =>
      snapshot.tasks.map((task) => [
        JSON.stringify([snapshot.serverId, task.runnerId, task.id]),
        task.status,
      ]),
    ),
  );
  const targets = options.servers.slice(0, 64).flatMap((server): Target[] => {
    const snapshot = options.snapshots.find((item) => item.serverId === server.id);
    if (
      !server.connected ||
      !snapshot?.connected ||
      !snapshot.descriptor?.capabilities.accountUsage ||
      !options.gateway?.getAccountUsage ||
      (server.id !== options.selectedServerId &&
        !recentlyActive.current.has(server.id) &&
        !snapshot.tasks.some((task) => task.status === "running" || task.status === "queued"))
    )
      return [];
    const runnerId = snapshot.descriptor.runnerId;
    return [
      {
        serverId: server.id,
        runnerId,
        source: JSON.stringify([server.id, server.host, server.username, server.port, runnerId]),
      },
    ];
  });
  // Includes disconnected endpoints to revoke reconnect A -> B -> A requests.
  const configuration = JSON.stringify(options.servers);
  const targetKey = JSON.stringify(targets);
  const leaseRef = useRef({
    gateway: options.gateway,
    workspaceOwner: options.workspaceOwner,
    configuration,
    targetKey,
    sources,
  });
  if (
    leaseRef.current.gateway !== options.gateway ||
    leaseRef.current.workspaceOwner !== options.workspaceOwner ||
    leaseRef.current.configuration !== configuration ||
    leaseRef.current.targetKey !== targetKey ||
    leaseRef.current.sources !== sources
  )
    leaseRef.current = {
      gateway: options.gateway,
      workspaceOwner: options.workspaceOwner,
      configuration,
      targetKey,
      sources,
    };
  const lease = leaseRef.current;
  const stableTargets = useMemo(() => JSON.parse(targetKey) as Target[], [targetKey]);
  const mountAuthority = useRef<object | null>(null);
  const active = useRef(
    new Map<
      string,
      {
        readonly lease: object;
        readonly mount: object;
        readonly promise: Promise<AgentAccountUsageRefreshOutcome>;
      }
    >(),
  );
  const [states, setStates] = useState<{
    readonly lease: object;
    readonly values: ReadonlyMap<string, AgentAccountUsageLoadState>;
  }>({ lease, values: new Map() });
  const [, update] = useState(0);
  useEffect(() => sources.subscribe(() => update((value) => value + 1)), [sources]);
  useEffect(() => {
    const mount = {};
    mountAuthority.current = mount;
    return () => {
      if (mountAuthority.current === mount) mountAuthority.current = null;
    };
  }, []);
  const refresh = useCallback(
    (
      target: Target,
      provider: "claudeCode" | "codex",
    ): Promise<AgentAccountUsageRefreshOutcome> => {
      const mount = mountAuthority.current;
      const valid = () =>
        mount !== null && mountAuthority.current === mount && leaseRef.current === lease;
      const read = lease.gateway?.getAccountUsage;
      if (!valid() || !read) return Promise.resolve({ kind: "unavailable" });
      const key = JSON.stringify([target.source, provider]);
      const pending = active.current.get(key);
      if (pending)
        return pending.lease === lease && pending.mount === mount
          ? pending.promise
          : pending.promise.then(() =>
              valid() ? refresh(target, provider) : { kind: "superseded" },
            );
      if (active.current.size >= MAX_CONCURRENCY) return Promise.resolve({ kind: "superseded" });
      const queryRevision = sources.revision();
      const publish = (state: AgentAccountUsageLoadState) => {
        if (!valid()) return;
        setStates((previous) => ({
          lease,
          values: new Map(previous.lease === lease ? previous.values : []).set(key, state),
        }));
      };
      const operation = (async (): Promise<AgentAccountUsageRefreshOutcome> => {
        try {
          const snapshot = await read.call(lease.gateway, {
            serverId: target.serverId,
            runnerId: target.runnerId,
            provider: provider === "claudeCode" ? "claude" : "codex",
          });
          if (!valid()) return { kind: "superseded" };
          if (snapshot.provider !== provider) throw new Error("Unexpected account usage provider.");
          const accepted = sources.observe(target.source, snapshot, queryRevision);
          // A superseded read still has a valid newer snapshot for this exact source.
          const current = sources.read(target.source, provider);
          if (current) publish({ kind: "ready", snapshot: current });
          return { kind: accepted ? "refreshed" : "superseded" };
        } catch {
          if (!valid()) return { kind: "superseded" };
          publish({ kind: "unavailable" });
          return { kind: "failed" };
        } finally {
          active.current.delete(key);
        }
      })();
      active.current.set(key, { lease, mount: mount!, promise: operation });
      return operation;
    },
    [lease, sources],
  );
  const completionKey = JSON.stringify(
    options.snapshots.flatMap((snapshot) =>
      stableTargets.some((target) => target.serverId === snapshot.serverId)
        ? snapshot.tasks
            .filter(
              (task) =>
                task.status !== "draft" && task.status !== "running" && task.status !== "queued",
            )
            .map((task) => [snapshot.serverId, task.id, task.sequence, task.status])
        : [],
    ),
  );
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const requests = stableTargets.flatMap((target) =>
        PROVIDERS.map((provider) => ({ target, provider })),
      );
      for (let offset = 0; offset < requests.length && !disposed; offset += MAX_CONCURRENCY) {
        await Promise.all(
          requests
            .slice(offset, offset + MAX_CONCURRENCY)
            .map(({ target, provider }) => refresh(target, provider)),
        );
      }
      if (!disposed) {
        for (const target of stableTargets) recentlyActive.current.delete(target.serverId);
        update((value) => value + 1);
      }
      if (!disposed) timer = setTimeout(() => void run(), POLL_MS);
    };
    void run();
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [completionKey, refresh, stableTargets]);
  const selected = stableTargets.find((target) => target.serverId === options.selectedServerId);
  const project = (provider: "claudeCode" | "codex"): AgentAccountUsageLoadState => {
    if (!selected) return UNAVAILABLE[provider];
    const state =
      states.lease === lease
        ? states.values.get(JSON.stringify([selected.source, provider]))
        : undefined;
    if (!state) return { kind: "loading" };
    const snapshot = state.kind === "ready" ? sources.read(selected.source, provider) : null;
    return snapshot ? { kind: "ready", snapshot } : state;
  };
  return {
    accountUsage: {
      claudeCode: project("claudeCode"),
      codex: project("codex"),
    } as AgentAccountUsageStates,
    refreshAccountUsage: (provider: "claudeCode" | "codex") =>
      selected
        ? refresh(selected, provider)
        : Promise.resolve<AgentAccountUsageRefreshOutcome>({ kind: "unavailable" }),
  };
}
