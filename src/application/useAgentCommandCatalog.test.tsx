// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentCommandCatalog } from "../domain/agentCommandCatalog";
import {
  DeferredAgentCommandCatalogGateway,
  DeferredRemoteCommandCatalogGateway,
  agentCommandCatalogFixture,
} from "../test/agentCommandCatalogTestSupport";
import { agentCommandCatalogSource } from "./agentCommandCatalogGateway";
import {
  AGENT_COMMAND_CATALOG_RETRY_DELAYS_MS,
  AGENT_COMMAND_CATALOG_TTL_MS,
  AgentCommandCatalogCache,
  MAX_AGENT_COMMAND_CATALOG_KEYS,
  type AgentCommandCatalogStore,
} from "./agentCommandCatalogStore";
import {
  agentCommandCatalogScopeTarget,
  useAgentCommandCatalog,
  type AgentCommandCatalogAttention,
  type AgentCommandCatalogScope,
} from "./useAgentCommandCatalog";

const SERVER_ONE = "3f2b8c1e-5a47-4d09-9c3e-7b1a2d4e6f80";
const SERVER_TWO = "9a1c2b3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const A = {
  kind: "local",
  repositoryRoot: "/work/a",
  provider: "claudeCode",
} satisfies AgentCommandCatalogScope;
const B = { ...A, repositoryRoot: "/work/b" } satisfies AgentCommandCatalogScope;
const A_CODEX = { ...A, provider: "codex" } satisfies AgentCommandCatalogScope;
const PROJECT = { serverId: SERVER_ONE, runnerId: "runner-home", projectId: "codevo-editor" };
const ON_SERVER = {
  kind: "server",
  serverId: SERVER_ONE,
  project: PROJECT,
  provider: "claudeCode",
} satisfies AgentCommandCatalogScope;
const forServer = agentCommandCatalogFixture("claudeCode", [{ name: "on-server" }]);
const forOther = agentCommandCatalogFixture("claudeCode", [{ name: "on-other" }]);
const forA = agentCommandCatalogFixture("claudeCode", [{ name: "for-a" }]);
const forB = agentCommandCatalogFixture("claudeCode", [{ name: "for-b" }]);
const newerA = agentCommandCatalogFixture("claudeCode", [{ name: "newer-a" }]);
const skills = agentCommandCatalogFixture("codex", [{ name: "skill" }]);

interface HarnessProps {
  readonly store: AgentCommandCatalogStore | null;
  readonly scope: AgentCommandCatalogScope;
  readonly attention: AgentCommandCatalogAttention;
}

function renderCatalog(
  store: AgentCommandCatalogStore | null,
  scope: AgentCommandCatalogScope,
  attention: AgentCommandCatalogAttention = "mounted",
) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const seen: Array<AgentCommandCatalog | null> = [];
  const renders: Array<{
    readonly scope: AgentCommandCatalogScope;
    readonly catalog: AgentCommandCatalog | null;
  }> = [];
  let props: HarnessProps = { store, scope, attention };
  function Harness(current: HarnessProps) {
    const catalog = useAgentCommandCatalog(current.store, current.scope, current.attention);
    seen.push(catalog);
    renders.push({ scope: current.scope, catalog });
    return null;
  }
  act(() => root.render(<Harness {...props} />));
  return {
    seen,
    renders,
    get current() {
      return seen[seen.length - 1] ?? null;
    },
    rerender(next: Partial<HarnessProps>) {
      props = { ...props, ...next };
      act(() => root.render(<Harness {...props} />));
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

function setup() {
  const gateway = new DeferredAgentCommandCatalogGateway();
  const remote = new DeferredRemoteCommandCatalogGateway();
  const store = new AgentCommandCatalogCache(agentCommandCatalogSource(gateway, remote));
  return { gateway, remote, store };
}

describe("useAgentCommandCatalog", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the catalog for the mounted workspace and provider", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A);
    expect(hook.current).toBeNull();
    expect(gateway.requests()).toEqual([{ repositoryRoot: "/work/a", provider: "claudeCode" }]);
    await act(async () => gateway.reads[0]?.resolve(forA));
    expect(hook.current).toBe(forA);
    hook.unmount();
  });

  it.each<[string, AgentCommandCatalogScope]>([
    ["no workspace root", { ...A, repositoryRoot: null }],
    ["a root that is not an absolute path", { ...A, repositoryRoot: "pending-clone" }],
    ["a server target without a resolved project", { ...ON_SERVER, project: null }],
    ["a server target that is still resolving", { ...ON_SERVER, serverId: "unavailable" }],
    ["a project that belongs to another server", { ...ON_SERVER, serverId: SERVER_TWO }],
    [
      "a project without a runner identity",
      { ...ON_SERVER, project: { ...PROJECT, runnerId: "" } },
    ],
    [
      "a project id the runner route cannot carry",
      { ...ON_SERVER, project: { ...PROJECT, projectId: "a/b" } },
    ],
  ])("never calls a gateway for %s", async (_name, scope) => {
    const { gateway, remote, store } = setup();
    const hook = renderCatalog(store, scope, "mounted");
    hook.rerender({ attention: "focused" });
    hook.rerender({ attention: "menu" });
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS * 2));
    hook.rerender({ attention: "focused" });
    expect(gateway.reads).toHaveLength(0);
    expect(remote.reads).toHaveLength(0);
    expect(hook.current).toBeNull();
    expect(agentCommandCatalogScopeTarget(scope)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    hook.unmount();
  });

  it("reads a server target from its runner and never from this machine", async () => {
    const { gateway, remote, store } = setup();
    const hook = renderCatalog(store, ON_SERVER);
    expect(remote.requests()).toEqual([{ ...PROJECT, provider: "claude" }]);
    expect(gateway.reads).toHaveLength(0);
    await act(async () => remote.reads[0]?.resolve(forServer));
    expect(hook.current).toBe(forServer);
    hook.rerender({ scope: { ...ON_SERVER, project: { ...PROJECT } } });
    hook.rerender({ scope: { ...ON_SERVER, project: { ...PROJECT } }, attention: "focused" });
    expect(remote.reads).toHaveLength(1);
    expect(hook.current).toBe(forServer);
    hook.unmount();
  });

  it("never shows a local catalog for a server target or a server catalog locally", async () => {
    const { gateway, remote, store } = setup();
    const hook = renderCatalog(store, A);
    hook.rerender({ scope: ON_SERVER });
    await act(async () => gateway.reads[0]?.resolve(forA));
    expect(hook.current).toBeNull();
    hook.rerender({ scope: A });
    expect(hook.current).toBe(forA);
    await act(async () => remote.reads[0]?.resolve(forServer));
    expect(hook.current).toBe(forA);
    hook.rerender({ scope: ON_SERVER });
    expect(hook.current).toBe(forServer);
    hook.rerender({ scope: { ...ON_SERVER, project: null } });
    expect(hook.current).toBeNull();
    expect(gateway.reads).toHaveLength(1);
    expect(remote.reads).toHaveLength(1);
    expect(
      hook.renders.filter(
        (render) =>
          (render.scope.kind === "local" && render.catalog === forServer) ||
          (render.scope.kind === "server" && render.catalog === forA),
      ),
    ).toEqual([]);
    hook.unmount();
  });

  it("never shows one server's or one runner identity's catalog for another", async () => {
    const { remote, store } = setup();
    const replaced = { ...ON_SERVER, project: { ...PROJECT, runnerId: "runner-replaced" } };
    const elsewhere = {
      ...ON_SERVER,
      serverId: SERVER_TWO,
      project: { ...PROJECT, serverId: SERVER_TWO },
    };
    const hook = renderCatalog(store, ON_SERVER);
    hook.rerender({ scope: replaced });
    hook.rerender({ scope: elsewhere });
    expect(remote.requests().map((request) => [request.serverId, request.runnerId])).toEqual([
      [SERVER_ONE, "runner-home"],
      [SERVER_ONE, "runner-replaced"],
      [SERVER_TWO, "runner-home"],
    ]);
    await act(async () => remote.reads[0]?.resolve(forServer));
    await act(async () => remote.reads[1]?.resolve(forOther));
    expect(hook.current).toBeNull();
    hook.rerender({ scope: replaced });
    expect(hook.current).toBe(forOther);
    hook.rerender({ scope: ON_SERVER });
    expect(hook.current).toBe(forServer);
    hook.rerender({ scope: elsewhere });
    expect(hook.current).toBeNull();
    expect(remote.reads).toHaveLength(3);
    hook.unmount();
  });

  it("keeps the last good runner catalog when the runner answers for the wrong provider", async () => {
    const { remote, store } = setup();
    const hook = renderCatalog(store, ON_SERVER);
    await act(async () => remote.reads[0]?.resolve(forServer));
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS));
    hook.rerender({ attention: "menu" });
    await act(async () => remote.reads[1]?.resolve(skills));
    expect(hook.current).toBe(forServer);
    hook.unmount();
  });

  it("fills an open menu once a quick retry of a failed first read succeeds", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A, "menu");
    await act(async () => gateway.reads[0]?.reject("Agent command catalog is still loading."));
    expect(hook.current).toBeNull();
    await act(async () =>
      vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_RETRY_DELAYS_MS[0] - 1),
    );
    expect(gateway.reads).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(gateway.reads).toHaveLength(2);
    await act(async () => gateway.reads[1]?.resolve(forA));
    expect(hook.current).toBe(forA);
    hook.unmount();
  });

  it("stops retrying a failed read once the composer leaves that target", async () => {
    const { gateway, remote, store } = setup();
    const hook = renderCatalog(store, ON_SERVER, "menu");
    await act(async () => remote.reads[0]?.reject("Runner request failed (HTTP 503)."));
    hook.rerender({ scope: A });
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS));
    expect(remote.reads).toHaveLength(1);
    expect(gateway.reads).toHaveLength(1);
    const second = renderCatalog(store, ON_SERVER, "menu");
    await act(async () => remote.reads[1]?.reject("Runner request failed (HTTP 503)."));
    second.unmount();
    hook.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS));
    expect(remote.reads).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("offers nothing without a store", () => {
    const hook = renderCatalog(null, A, "menu");
    expect(hook.current).toBeNull();
    hook.unmount();
  });

  it("shares one read between composers and reuses it across remounts", async () => {
    const { gateway, store } = setup();
    const left = renderCatalog(store, A);
    const right = renderCatalog(store, { ...A });
    expect(gateway.reads).toHaveLength(1);
    await act(async () => gateway.reads[0]?.resolve(forA));
    expect(left.current).toBe(forA);
    expect(right.current).toBe(forA);
    left.unmount();
    right.unmount();
    const remounted = renderCatalog(store, A, "focused");
    expect(remounted.seen).toEqual([forA]);
    expect(gateway.reads).toHaveLength(1);
    remounted.unmount();
  });

  it("revalidates on focus or menu open only after the TTL and keeps the stale list meanwhile", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A);
    await act(async () => gateway.reads[0]?.resolve(forA));
    hook.rerender({ attention: "focused" });
    hook.rerender({ attention: "menu" });
    hook.rerender({ attention: "focused" });
    expect(gateway.reads).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS));
    expect(gateway.reads).toHaveLength(1);
    hook.rerender({ attention: "menu" });
    expect(gateway.reads).toHaveLength(2);
    expect(hook.current).toBe(forA);
    hook.rerender({ attention: "focused" });
    expect(gateway.reads).toHaveLength(2);
    await act(async () => gateway.reads[1]?.resolve(newerA));
    expect(hook.current).toBe(newerA);
    hook.unmount();
  });

  it("keeps showing a mounted composer's catalog while 16 other targets are refreshed", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A, "menu");
    await act(async () => gateway.reads[0]?.resolve(forA));
    const rendersBefore = hook.seen.length;
    await act(async () => {
      for (let index = 0; index < MAX_AGENT_COMMAND_CATALOG_KEYS; index += 1) {
        store.refresh({ kind: "local", repositoryRoot: `/work/other-${index}`, provider: "codex" });
      }
      gateway.reads.slice(1).forEach((read) => read.resolve(skills));
    });
    expect(hook.current).toBe(forA);
    expect(hook.seen).toHaveLength(rendersBefore);
    hook.rerender({ attention: "focused" });
    hook.rerender({ attention: "menu" });
    expect(hook.current).toBe(forA);
    expect(gateway.reads).toHaveLength(1 + MAX_AGENT_COMMAND_CATALOG_KEYS);
    hook.unmount();
  });

  it("keeps the last good catalog when a revalidation fails", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A);
    await act(async () => gateway.reads[0]?.resolve(forA));
    await act(async () => vi.advanceTimersByTimeAsync(AGENT_COMMAND_CATALOG_TTL_MS));
    hook.rerender({ attention: "focused" });
    await act(async () => gateway.reads[1]?.reject("probe failed"));
    expect(hook.current).toBe(forA);
    hook.unmount();
  });

  it("offers nothing, without failing, when the only read fails", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A);
    await act(async () => gateway.reads[0]?.reject("no provider CLI"));
    expect(hook.current).toBeNull();
    expect(hook.seen.every((catalog) => catalog === null)).toBe(true);
    hook.unmount();
  });

  it("never shows workspace A's late result while workspace B is selected, across A, B, A", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A);
    hook.rerender({ scope: B });
    expect(gateway.requests().map((request) => request.repositoryRoot)).toEqual([
      "/work/a",
      "/work/b",
    ]);
    await act(async () => gateway.reads[0]?.resolve(forA));
    expect(hook.current).toBeNull();
    hook.rerender({ scope: A });
    expect(hook.current).toBe(forA);
    hook.rerender({ scope: B });
    expect(hook.current).toBeNull();
    await act(async () => gateway.reads[1]?.resolve(forB));
    expect(hook.current).toBe(forB);
    hook.rerender({ scope: A });
    expect(hook.current).toBe(forA);
    expect(gateway.reads).toHaveLength(2);
    expect(hook.renders.filter((render) => render.scope === B && render.catalog === forA)).toEqual(
      [],
    );
    expect(hook.renders.filter((render) => render.scope === A && render.catalog === forB)).toEqual(
      [],
    );
    hook.unmount();
  });

  it("never shows one provider's late result for the other provider", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A);
    hook.rerender({ scope: A_CODEX });
    expect(gateway.requests().map((request) => request.provider)).toEqual(["claudeCode", "codex"]);
    await act(async () => gateway.reads[0]?.resolve(forA));
    expect(hook.current).toBeNull();
    await act(async () => gateway.reads[1]?.resolve(skills));
    expect(hook.current).toBe(skills);
    hook.rerender({ scope: A });
    expect(hook.current).toBe(forA);
    expect(
      hook.renders.filter(
        (render) => render.catalog !== null && render.catalog.provider !== render.scope.provider,
      ),
    ).toEqual([]);
    hook.unmount();
  });

  it("drops a provider's answer that arrives under the wrong provider key", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A_CODEX);
    await act(async () => gateway.reads[0]?.resolve(forA));
    expect(hook.current).toBeNull();
    hook.unmount();
  });

  it("stops listening after unmount while the shared cache still records the result", async () => {
    const { gateway, store } = setup();
    const hook = renderCatalog(store, A);
    hook.unmount();
    const rendersBefore = hook.seen.length;
    await act(async () => gateway.reads[0]?.resolve(forA));
    expect(hook.seen).toHaveLength(rendersBefore);
    const next = renderCatalog(store, A);
    expect(next.current).toBe(forA);
    expect(gateway.reads).toHaveLength(1);
    next.unmount();
  });

  it("starts over when the store is replaced", async () => {
    const old = setup();
    const replacement = setup();
    const hook = renderCatalog(old.store, A);
    hook.rerender({ store: replacement.store });
    await act(async () => old.gateway.reads[0]?.resolve(forA));
    expect(hook.current).toBeNull();
    await act(async () => replacement.gateway.reads[0]?.resolve(newerA));
    expect(hook.current).toBe(newerA);
    hook.unmount();
  });
});
