// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAccountUsageSnapshot } from "../domain/agentAccountUsage";
import type {
  RemoteRunnerGateway,
  RemoteRunnerServer,
  RemoteRunnerTask,
} from "../domain/remoteRunner";
import { emptyRemoteInventory } from "./remoteAgentInventoryLoad";
import { createAgentAccountUsageSources } from "./agentAccountUsageSources";
import { useRemoteAgentAccountUsage } from "./useRemoteAgentAccountUsage";

const accountIdentity = `account:v1:sha256:${"a".repeat(64)}`;
const server: RemoteRunnerServer = {
  id: "server",
  name: "Server",
  host: "linux",
  username: "user",
  port: 22,
  connected: true,
};
const usage = (provider: "claudeCode" | "codex", percent: number): AgentAccountUsageSnapshot => ({
  provider,
  accountIdentity,
  fetchedAtEpochMs: percent,
  windows: [
    {
      id: "weekly",
      label: "Weekly limit",
      usedPercent: percent,
      windowDurationMinutes: null,
      resetsAtEpochMs: null,
      resetsLabel: null,
    },
  ],
});
const snapshot = (
  runnerId = "runner",
  supported = true,
  tasks: readonly RemoteRunnerTask[] = [],
) => ({
  ...emptyRemoteInventory(server.id, true),
  tasks,
  descriptor: {
    protocolVersion: 1 as const,
    runnerId,
    name: "Server",
    capabilities: {
      taskExecution: true,
      instructionSync: true,
      eventReplay: true,
      accountUsage: supported,
    },
  },
});
const task = (status: RemoteRunnerTask["status"]): RemoteRunnerTask => ({
  id: "turn",
  sequence: 1,
  runnerId: "runner",
  provider: "codex",
  status,
  parts: [],
  createdAt: "2026-10-05T00:00:00Z",
});
describe("remote account usage", () => {
  const releases: (() => void)[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });
  afterEach(() => {
    act(() => releases.splice(0).forEach((release) => release()));
    vi.useRealTimers();
  });
  it("rejects responses captured before StrictMode effect cleanup and rereads the remounted source", async () => {
    const sources = createAgentAccountUsageSources();
    const observe = vi.spyOn(sources, "observe");
    let settle!: (snapshot: AgentAccountUsageSnapshot) => void;
    let codexRequests = 0;
    const getAccountUsage = vi
      .fn<NonNullable<RemoteRunnerGateway["getAccountUsage"]>>()
      .mockImplementation(async ({ provider }) => {
        if (provider === "codex" && codexRequests++ === 0)
          return new Promise((resolve) => {
            settle = resolve;
          });
        return usage(provider === "claude" ? "claudeCode" : "codex", 30);
      });
    let surface!: ReturnType<typeof useRemoteAgentAccountUsage>;
    const gateway = { getAccountUsage } as unknown as RemoteRunnerGateway;
    function Harness() {
      surface = useRemoteAgentAccountUsage({
        gateway,
        sources,
        servers: [server],
        snapshots: [snapshot()],
        workspaceOwner: "A",
        selectedServerId: server.id,
      });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    releases.push(() => root.unmount());
    await act(async () =>
      root.render(
        <StrictMode>
          <Harness />
        </StrictMode>,
      ),
    );
    await act(async () => settle(usage("codex", 99)));
    expect(surface.accountUsage.codex).toMatchObject({
      kind: "ready",
      snapshot: { windows: [{ usedPercent: 30 }] },
    });
    expect(observe.mock.calls.some(([, snapshot]) => snapshot.windows[0].usedPercent === 99)).toBe(
      false,
    );
    expect(codexRequests).toBe(2);
  });
  async function mount(selectedServerId: string | null = server.id) {
    const sources = createAgentAccountUsageSources();
    const getAccountUsage = vi
      .fn<NonNullable<RemoteRunnerGateway["getAccountUsage"]>>()
      .mockImplementation(async ({ provider }) =>
        usage(provider === "claude" ? "claudeCode" : "codex", 30),
      );
    const gateway = { getAccountUsage } as Pick<RemoteRunnerGateway, "getAccountUsage">;
    let options = {
      gateway: gateway as RemoteRunnerGateway,
      sources,
      servers: [server],
      snapshots: [snapshot()],
      workspaceOwner: "A",
      selectedServerId,
    };
    let surface!: ReturnType<typeof useRemoteAgentAccountUsage>;
    const root = createRoot(document.createElement("div"));
    releases.push(() => root.unmount());
    function Harness() {
      surface = useRemoteAgentAccountUsage(options);
      return null;
    }
    const render = async (overrides: Partial<typeof options> = {}) => {
      options = { ...options, ...overrides };
      await act(async () => {
        root.render(<Harness />);
      });
    };
    await render();
    return { surface: () => surface, render, getAccountUsage, sources };
  }
  it("polls the selected exact runner every minute and shares only the verified account", async () => {
    const h = await mount();
    expect(h.getAccountUsage).toHaveBeenCalledTimes(2);
    expect(h.getAccountUsage).toHaveBeenCalledWith({
      serverId: "server",
      runnerId: "runner",
      provider: "codex",
    });
    act(() => h.sources.observe("local", usage("codex", 40)));
    expect(h.surface().accountUsage.codex).toMatchObject({
      kind: "ready",
      snapshot: { windows: [{ usedPercent: 40 }] },
    });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(h.getAccountUsage).toHaveBeenCalledTimes(4);
  });
  it("shows unavailable for disconnected or old runners without substituting local usage", async () => {
    const h = await mount();
    act(() => h.sources.observe("local", usage("codex", 90)));
    await h.render({ snapshots: [snapshot("runner", false)] });
    expect(h.surface().accountUsage.codex).toEqual({ kind: "unavailable" });
    await h.render({ snapshots: [snapshot()], servers: [{ ...server, connected: false }] });
    expect(h.surface().accountUsage.codex).toEqual({ kind: "unavailable" });
    expect(h.getAccountUsage).toHaveBeenCalledTimes(2);
  });
  it("revokes pending workspace, endpoint, runner and reconnect ABA results", async () => {
    const h = await mount();
    let settle!: (snapshot: AgentAccountUsageSnapshot) => void;
    h.getAccountUsage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    let pending!: ReturnType<ReturnType<typeof useRemoteAgentAccountUsage>["refreshAccountUsage"]>;
    act(() => {
      pending = h.surface().refreshAccountUsage("codex");
    });
    await h.render({ servers: [{ ...server, connected: false }], workspaceOwner: "B" });
    await h.render({
      servers: [server],
      workspaceOwner: "A",
      snapshots: [snapshot("replacement")],
    });
    await act(async () => {
      settle(usage("codex", 99));
      expect(await pending).toEqual({ kind: "superseded" });
    });
    expect(h.surface().accountUsage.codex).toMatchObject({
      kind: "ready",
      snapshot: { windows: [{ usedPercent: 30 }] },
    });
  });
  it("refreshes after background task settlement and stops polling an idle unselected server", async () => {
    const h = await mount(null);
    expect(h.getAccountUsage).not.toHaveBeenCalled();
    await h.render({ snapshots: [snapshot("runner", true, [task("running")])] });
    expect(h.getAccountUsage).toHaveBeenCalledTimes(2);
    await h.render({ snapshots: [snapshot("runner", true, [task("succeeded")])] });
    expect(h.getAccountUsage).toHaveBeenCalledTimes(4);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(h.getAccountUsage).toHaveBeenCalledTimes(4);
  });
  it("releases stale same-runner pending ownership before servicing the reconnected source", async () => {
    const h = await mount();
    let settle!: (snapshot: AgentAccountUsageSnapshot) => void;
    h.getAccountUsage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    act(() => {
      void h.surface().refreshAccountUsage("codex");
    });
    await h.render({ servers: [{ ...server, connected: false }] });
    await h.render({ servers: [server] });
    await act(async () => settle(usage("codex", 99)));
    expect(h.surface().accountUsage.codex).toMatchObject({
      kind: "ready",
      snapshot: { windows: [{ usedPercent: 30 }] },
    });
  });
});
